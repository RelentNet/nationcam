package logtoadmin

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// newFakeLogto starts a fake Logto server: it issues a bearer token via the
// client_credentials grant (verifying the Basic-auth app id/secret and the
// grant's form fields) and serves canned users/roles/scopes responses,
// rejecting any Management API call that doesn't carry that exact token.
// forceUnauthorizedOnce, when set to 1, makes the *next* protected call
// return 401 once, to exercise the client's retry path.
func newFakeLogto(t *testing.T, wantAppID, wantAppSecret string) (srv *httptest.Server, tokenExchanges *int32, forceUnauthorizedOnce *int32) {
	t.Helper()
	tokenExchanges = new(int32)
	forceUnauthorizedOnce = new(int32)

	mux := http.NewServeMux()

	mux.HandleFunc("/oidc/token", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Errorf("token request method = %s, want POST", r.Method)
		}
		user, pass, ok := r.BasicAuth()
		if !ok || user != wantAppID || pass != wantAppSecret {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse token form: %v", err)
		}
		if got := r.PostForm.Get("grant_type"); got != "client_credentials" {
			t.Errorf("grant_type = %q, want client_credentials", got)
		}
		if got := r.PostForm.Get("resource"); got != managementResource {
			t.Errorf("resource = %q, want %q", got, managementResource)
		}
		if got := r.PostForm.Get("scope"); got != "all" {
			t.Errorf("scope = %q, want all", got)
		}
		atomic.AddInt32(tokenExchanges, 1)
		writeTestJSON(w, map[string]any{
			"access_token": "test-access-token",
			"expires_in":   3600,
		})
	})

	requireAuth := func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if atomic.CompareAndSwapInt32(forceUnauthorizedOnce, 1, 0) {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			if got := r.Header.Get("Authorization"); got != "Bearer test-access-token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			next(w, r)
		}
	}

	mux.HandleFunc("/api/users", requireAuth(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("page"); got == "" {
			t.Errorf("expected page query param")
		}
		w.Header().Set("Total-Number", "2")
		writeTestJSON(w, []map[string]any{
			{"id": "u1", "name": "Alice", "primaryEmail": "alice@example.com", "createdAt": int64(1700000000000), "lastSignInAt": int64(1700100000000)},
			{"id": "u2", "name": "Bob", "primaryEmail": "bob@example.com", "createdAt": int64(1700000000000), "lastSignInAt": nil},
		})
	}))

	mux.HandleFunc("/api/users/u1/roles", requireAuth(func(w http.ResponseWriter, r *http.Request) {
		writeTestJSON(w, []map[string]any{{"id": "r1", "name": "admin", "isDefault": false, "type": "User"}})
	}))

	mux.HandleFunc("/api/roles", requireAuth(func(w http.ResponseWriter, r *http.Request) {
		writeTestJSON(w, []map[string]any{
			{"id": "r1", "name": "admin", "description": "Admins", "isDefault": false, "type": "User"},
			{"id": "r2", "name": "member", "description": "Default role", "isDefault": true, "type": "User"},
		})
	}))

	mux.HandleFunc("/api/roles/r1/users", requireAuth(func(w http.ResponseWriter, r *http.Request) {
		writeTestJSON(w, []map[string]any{{"id": "u1", "name": "Alice", "primaryEmail": "alice@example.com", "createdAt": int64(1700000000000)}})
	}))

	mux.HandleFunc("/api/roles/r1/scopes", requireAuth(func(w http.ResponseWriter, r *http.Request) {
		writeTestJSON(w, []map[string]any{{"id": "s1", "name": "admin"}})
	}))

	mux.HandleFunc("/api/roles/r2/scopes", requireAuth(func(w http.ResponseWriter, r *http.Request) {
		writeTestJSON(w, []map[string]any{})
	}))

	srv = httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, tokenExchanges, forceUnauthorizedOnce
}

func writeTestJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func TestConfigured(t *testing.T) {
	if (&Client{}).Configured() {
		t.Error("empty client reports Configured")
	}
	if (&Client{AppID: "x"}).Configured() {
		t.Error("app id only reports Configured")
	}
	if (&Client{AppID: "x", AppSecret: "y"}).Configured() != true {
		t.Error("app id + secret does not report Configured")
	}
}

func TestListUsersAndTokenCaching(t *testing.T) {
	srv, tokenExchanges, _ := newFakeLogto(t, "app-id", "app-secret")
	c := NewClient(srv.URL, "app-id", "app-secret")

	users, total, err := c.ListUsers(context.Background(), 1, 20)
	if err != nil {
		t.Fatalf("ListUsers: %v", err)
	}
	if total != 2 {
		t.Errorf("total = %d, want 2", total)
	}
	if len(users) != 2 || users[0].ID != "u1" || users[0].PrimaryEmail != "alice@example.com" {
		t.Fatalf("users = %+v", users)
	}
	if users[0].LastSignInAt == nil || *users[0].LastSignInAt != 1700100000000 {
		t.Errorf("users[0].LastSignInAt = %v, want 1700100000000", users[0].LastSignInAt)
	}
	if users[1].LastSignInAt != nil {
		t.Errorf("users[1].LastSignInAt = %v, want nil", users[1].LastSignInAt)
	}

	// A second call must reuse the cached token rather than exchanging again.
	if _, _, err := c.ListUsers(context.Background(), 2, 20); err != nil {
		t.Fatalf("second ListUsers: %v", err)
	}
	if got := atomic.LoadInt32(tokenExchanges); got != 1 {
		t.Errorf("token exchanges = %d, want 1 (token should be cached)", got)
	}
}

func TestGetUserRolesAndListRoles(t *testing.T) {
	srv, _, _ := newFakeLogto(t, "app-id", "app-secret")
	c := NewClient(srv.URL, "app-id", "app-secret")
	ctx := context.Background()

	roles, err := c.GetUserRoles(ctx, "u1")
	if err != nil {
		t.Fatalf("GetUserRoles: %v", err)
	}
	if len(roles) != 1 || roles[0].Name != "admin" {
		t.Fatalf("roles = %+v", roles)
	}

	all, err := c.ListRoles(ctx)
	if err != nil {
		t.Fatalf("ListRoles: %v", err)
	}
	if len(all) != 2 {
		t.Fatalf("ListRoles returned %d roles, want 2", len(all))
	}
	var admin, member *Role
	for i := range all {
		switch all[i].Name {
		case "admin":
			admin = &all[i]
		case "member":
			member = &all[i]
		}
	}
	if admin == nil || admin.IsDefault {
		t.Errorf("admin role = %+v, want IsDefault=false", admin)
	}
	if member == nil || !member.IsDefault {
		t.Errorf("member role = %+v, want IsDefault=true", member)
	}
}

func TestListRoleUsersAndScopes(t *testing.T) {
	srv, _, _ := newFakeLogto(t, "app-id", "app-secret")
	c := NewClient(srv.URL, "app-id", "app-secret")
	ctx := context.Background()

	users, err := c.ListRoleUsers(ctx, "r1")
	if err != nil {
		t.Fatalf("ListRoleUsers: %v", err)
	}
	if len(users) != 1 || users[0].ID != "u1" {
		t.Fatalf("ListRoleUsers = %+v", users)
	}

	scopes, err := c.ListRoleScopes(ctx, "r1")
	if err != nil {
		t.Fatalf("ListRoleScopes: %v", err)
	}
	if len(scopes) != 1 || scopes[0].Name != "admin" {
		t.Fatalf("ListRoleScopes = %+v", scopes)
	}

	noScopes, err := c.ListRoleScopes(ctx, "r2")
	if err != nil {
		t.Fatalf("ListRoleScopes(r2): %v", err)
	}
	if len(noScopes) != 0 {
		t.Fatalf("ListRoleScopes(r2) = %+v, want empty", noScopes)
	}
}

func TestRetriesOnceOn401(t *testing.T) {
	srv, tokenExchanges, forceUnauthorizedOnce := newFakeLogto(t, "app-id", "app-secret")
	c := NewClient(srv.URL, "app-id", "app-secret")

	// Prime a cached token, then force the *next* call to see a stale 401 —
	// the client should invalidate and re-fetch, then succeed.
	if _, _, err := c.ListUsers(context.Background(), 1, 20); err != nil {
		t.Fatalf("priming ListUsers: %v", err)
	}
	atomic.StoreInt32(forceUnauthorizedOnce, 1)

	users, _, err := c.ListUsers(context.Background(), 1, 20)
	if err != nil {
		t.Fatalf("ListUsers after forced 401: %v", err)
	}
	if len(users) != 2 {
		t.Fatalf("users after retry = %+v", users)
	}
	if got := atomic.LoadInt32(tokenExchanges); got != 2 {
		t.Errorf("token exchanges after 401 retry = %d, want 2 (one re-fetch)", got)
	}
}

func TestBadCredentialsFailToken(t *testing.T) {
	srv, _, _ := newFakeLogto(t, "app-id", "app-secret")
	c := NewClient(srv.URL, "app-id", "wrong-secret")

	if _, _, err := c.ListUsers(context.Background(), 1, 20); err == nil {
		t.Fatal("ListUsers with wrong secret succeeded, want error")
	}
}
