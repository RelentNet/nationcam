package handler

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/logtoadmin"
	mw "github.com/brandon-relentnet/nationcam/api/internal/middleware"
	"github.com/go-chi/chi/v5"
)

// ── Fake Logto Management API ───────────────────────────────────────

// newFakeLogtoServer starts an httptest server that accepts any
// client_credentials token exchange and serves a small, fixed set of users
// and roles: two users (one admin, one not), an "admin" role carrying the
// admin scope, and a default "member" role with no scopes.
func newFakeLogtoServer(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()

	mux.HandleFunc("/oidc/token", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": "fake-token",
			"expires_in":   3600,
		})
	})

	mux.HandleFunc("/api/users", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Total-Number", "2")
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{"id": "u1", "name": "Alice", "primaryEmail": "alice@example.com", "createdAt": int64(1893456000000), "lastSignInAt": int64(1893456000000)},
			{"id": "u2", "name": "Bob", "primaryEmail": "bob@example.com", "createdAt": int64(1893456000000), "lastSignInAt": nil},
		})
	})

	mux.HandleFunc("/api/users/u1/roles", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{{"id": "r1", "name": "admin", "isDefault": false, "type": "User"}})
	})
	mux.HandleFunc("/api/users/u2/roles", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{{"id": "r2", "name": "member", "isDefault": true, "type": "User"}})
	})

	mux.HandleFunc("/api/roles", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{
			{"id": "r1", "name": "admin", "description": "Admins", "isDefault": false, "type": "User"},
			{"id": "r2", "name": "member", "description": "Default role", "isDefault": true, "type": "User"},
		})
	})

	mux.HandleFunc("/api/roles/r1/scopes", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{{"id": "s1", "name": "admin"}})
	})
	mux.HandleFunc("/api/roles/r2/scopes", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{})
	})

	mux.HandleFunc("/api/roles/r1/users", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{{"id": "u1", "name": "Alice", "primaryEmail": "alice@example.com", "createdAt": int64(1893456000000)}})
	})
	mux.HandleFunc("/api/roles/r2/users", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode([]map[string]any{{"id": "u2", "name": "Bob", "primaryEmail": "bob@example.com", "createdAt": int64(1893456000000)}})
	})

	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

// ── Fake Redis (RESP2) ───────────────────────────────────────────────

// fakeRedisServer is a minimal in-memory RESP2 server: enough for
// go-redis/v9 to connect (it falls back to RESP2 when HELLO errors, which
// our "unknown command" default does) and run PING/GET/SET, which is all
// the cache wrapper needs. There is no miniredis dependency in go.mod, and
// these handlers only exercise best-effort caching (a Get/Set error is
// swallowed as a cache miss), so a small hand-rolled server is enough.
type fakeRedisServer struct {
	mu   sync.Mutex
	data map[string]string
	ln   net.Listener
}

func startFakeRedis(t *testing.T) string {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	fr := &fakeRedisServer{data: map[string]string{}, ln: ln}
	go fr.serve()
	t.Cleanup(func() { _ = ln.Close() })
	return ln.Addr().String()
}

func (fr *fakeRedisServer) serve() {
	for {
		conn, err := fr.ln.Accept()
		if err != nil {
			return
		}
		go fr.handleConn(conn)
	}
}

func (fr *fakeRedisServer) handleConn(conn net.Conn) {
	defer conn.Close()
	r := bufio.NewReader(conn)
	for {
		args, err := readRESPCommand(r)
		if err != nil {
			return
		}
		if len(args) == 0 {
			continue
		}
		switch strings.ToUpper(args[0]) {
		case "PING":
			_, _ = conn.Write([]byte("+PONG\r\n"))
		case "SET":
			if len(args) >= 3 {
				fr.mu.Lock()
				fr.data[args[1]] = args[2]
				fr.mu.Unlock()
			}
			_, _ = conn.Write([]byte("+OK\r\n"))
		case "GET":
			fr.mu.Lock()
			v, ok := fr.data[args[1]]
			fr.mu.Unlock()
			if !ok {
				_, _ = conn.Write([]byte("$-1\r\n"))
			} else {
				_, _ = fmt.Fprintf(conn, "$%d\r\n%s\r\n", len(v), v)
			}
		default:
			// Unknown command (including HELLO): a real RESP error reply, which
			// go-redis/v9 treats as "this server doesn't support HELLO" and
			// falls back to RESP2 rather than failing the connection.
			_, _ = fmt.Fprintf(conn, "-ERR unknown command '%s'\r\n", args[0])
		}
	}
}

// readRESPCommand reads one RESP2 array-of-bulk-strings command.
func readRESPCommand(r *bufio.Reader) ([]string, error) {
	line, err := r.ReadString('\n')
	if err != nil {
		return nil, err
	}
	line = strings.TrimRight(line, "\r\n")
	if len(line) == 0 || line[0] != '*' {
		return nil, fmt.Errorf("unexpected line: %q", line)
	}
	n, err := strconv.Atoi(line[1:])
	if err != nil {
		return nil, err
	}
	args := make([]string, 0, n)
	for i := 0; i < n; i++ {
		typeLine, err := r.ReadString('\n')
		if err != nil {
			return nil, err
		}
		typeLine = strings.TrimRight(typeLine, "\r\n")
		if len(typeLine) == 0 || typeLine[0] != '$' {
			return nil, fmt.Errorf("expected bulk string, got %q", typeLine)
		}
		size, err := strconv.Atoi(typeLine[1:])
		if err != nil {
			return nil, err
		}
		buf := make([]byte, size+2)
		if _, err := io.ReadFull(r, buf); err != nil {
			return nil, err
		}
		args = append(args, string(buf[:size]))
	}
	return args, nil
}

func newTestCache(t *testing.T) *cache.Cache {
	t.Helper()
	addr := startFakeRedis(t)
	c, err := cache.New(context.Background(), "redis://"+addr+"/0")
	if err != nil {
		t.Fatalf("cache.New: %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })
	return c
}

// ── Test router ──────────────────────────────────────────────────────

// buildAdminTestRouter mirrors the /admin wiring in router.go without
// pulling in the rest of NewRouter's dependencies (DB pool, uploads dir,
// snapshot store, ...), which this slice of endpoints never touches.
func buildAdminTestRouter(la *logtoadmin.Client, c *cache.Cache, opsAPIKey string) http.Handler {
	r := chi.NewRouter()
	if la != nil && la.Configured() {
		r.Route("/admin", func(r chi.Router) {
			r.Use(mw.RequireAPIKeyOrAdmin(opsAPIKey))
			r.Get("/users", AdminListUsers(la, c))
			r.Get("/users/stats", AdminUserStats(la, c))
			r.Get("/roles", AdminListRoles(la, c))
		})
	}
	return r
}

func doGet(t *testing.T, h http.Handler, path string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// ── Tests ────────────────────────────────────────────────────────────

func TestAdminRoutesNotMountedWhenUnconfigured(t *testing.T) {
	c := newTestCache(t)
	la := logtoadmin.NewClient("http://unused.invalid", "", "") // unconfigured
	h := buildAdminTestRouter(la, c, "ops-key")

	for _, path := range []string{"/admin/users", "/admin/users/stats", "/admin/roles"} {
		rec := doGet(t, h, path, nil)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404 (routes should not be mounted)", path, rec.Code)
		}
	}
}

func TestAdminUsersRequiresCredentials(t *testing.T) {
	srv := newFakeLogtoServer(t)
	c := newTestCache(t)
	la := logtoadmin.NewClient(srv.URL, "app-id", "app-secret")
	h := buildAdminTestRouter(la, c, "ops-key")

	rec := doGet(t, h, "/admin/users", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("no credentials: status = %d, want 401", rec.Code)
	}

	rec = doGet(t, h, "/admin/users", map[string]string{"X-API-Key": "wrong-key"})
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("wrong ops key: status = %d, want 401", rec.Code)
	}
}

func TestAdminListUsersWithOpsKey(t *testing.T) {
	srv := newFakeLogtoServer(t)
	c := newTestCache(t)
	la := logtoadmin.NewClient(srv.URL, "app-id", "app-secret")
	h := buildAdminTestRouter(la, c, "ops-key")

	rec := doGet(t, h, "/admin/users?page=1&page_size=50", map[string]string{"X-API-Key": "ops-key"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var resp adminUsersResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Total != 2 || resp.Page != 1 || resp.PageSize != 50 {
		t.Errorf("resp = %+v", resp)
	}
	if len(resp.Users) != 2 {
		t.Fatalf("users = %+v", resp.Users)
	}

	var alice, bob *adminUserOut
	for i := range resp.Users {
		switch resp.Users[i].ID {
		case "u1":
			alice = &resp.Users[i]
		case "u2":
			bob = &resp.Users[i]
		}
	}
	if alice == nil || alice.PrimaryEmail != "alice@example.com" || len(alice.Roles) != 1 || alice.Roles[0] != "admin" {
		t.Errorf("alice = %+v", alice)
	}
	if alice == nil || alice.LastSignInAt == nil {
		t.Errorf("alice.LastSignInAt = %v, want non-nil", alice)
	}
	if bob == nil || len(bob.Roles) != 1 || bob.Roles[0] != "member" {
		t.Errorf("bob = %+v", bob)
	}
	if bob == nil || bob.LastSignInAt != nil {
		t.Errorf("bob.LastSignInAt = %v, want nil", bob.LastSignInAt)
	}
}

func TestAdminUsersStatsWithLogtoUser(t *testing.T) {
	srv := newFakeLogtoServer(t)
	c := newTestCache(t)
	la := logtoadmin.NewClient(srv.URL, "app-id", "app-secret")
	h := buildAdminTestRouter(la, c, "") // empty ops key: only a signed-in Logto user passes

	// No credentials at all still fails even with an empty ops key.
	if rec := doGet(t, h, "/admin/users/stats", nil); rec.Code != http.StatusUnauthorized {
		t.Fatalf("no creds, empty ops key: status = %d, want 401", rec.Code)
	}

	// A signed-in Logto user (UserIDKey set in context, as Authenticate would
	// do after validating a JWT) passes.
	req := httptest.NewRequest(http.MethodGet, "/admin/users/stats", nil)
	req = req.WithContext(context.WithValue(req.Context(), mw.UserIDKey, "logto-user-id"))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var resp adminUserStatsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Total != 2 {
		t.Errorf("total = %d, want 2", resp.Total)
	}
	if resp.Admins != 1 {
		t.Errorf("admins = %d, want 1 (only the admin role carries the admin scope)", resp.Admins)
	}
	if resp.New7d != 2 || resp.New30d != 2 {
		t.Errorf("new_7d/new_30d = %d/%d, want 2/2 (fixture users have a far-future createdAt)", resp.New7d, resp.New30d)
	}
}

func TestAdminListRolesWithOpsKey(t *testing.T) {
	srv := newFakeLogtoServer(t)
	c := newTestCache(t)
	la := logtoadmin.NewClient(srv.URL, "app-id", "app-secret")
	h := buildAdminTestRouter(la, c, "ops-key")

	rec := doGet(t, h, "/admin/roles", map[string]string{"X-API-Key": "ops-key"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var resp adminRolesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Roles) != 2 {
		t.Fatalf("roles = %+v", resp.Roles)
	}

	var admin, member *adminRoleOut
	for i := range resp.Roles {
		switch resp.Roles[i].Name {
		case "admin":
			admin = &resp.Roles[i]
		case "member":
			member = &resp.Roles[i]
		}
	}
	if admin == nil || admin.IsDefault || admin.UserCount != 1 || len(admin.Scopes) != 1 || admin.Scopes[0] != "admin" {
		t.Errorf("admin role = %+v", admin)
	}
	if member == nil || !member.IsDefault || member.UserCount != 1 || len(member.Scopes) != 0 {
		t.Errorf("member role = %+v", member)
	}
}

