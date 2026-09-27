package handler

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/logtoadmin"
)

// adminCacheTTL is how long /admin/* responses are cached — shorter than the
// default 5 minutes since this data (who signed up, who's admin) is read by
// a live admin console.
const adminCacheTTL = 60 * time.Second

// adminUserRolesConcurrency bounds how many per-user role lookups run at
// once when building a page of /admin/users — Logto's Management API has no
// batch "roles for these users" call.
const adminUserRolesConcurrency = 5

// adminStatsPageSize is the page size AdminUserStats uses while walking every
// user to compute new_7d/new_30d.
const adminStatsPageSize = 100

// adminStatsUserLimit caps how many users AdminUserStats walks for the
// new_7d/new_30d counts, so one request against a very large tenant can't
// turn into an unbounded number of upstream calls.
const adminStatsUserLimit = 1000

// adminScopeName is the Logto permission name that marks a role as
// admin-granting — the same permission RequireAdmin checks for in the JWT
// `scope` claim (see AGENTS.md "Admin RBAC").
const adminScopeName = "admin"

type adminUserOut struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	PrimaryEmail string   `json:"primary_email"`
	CreatedAt    string   `json:"created_at"`
	LastSignInAt *string  `json:"last_sign_in_at"`
	Roles        []string `json:"roles"`
}

type adminUsersResponse struct {
	Total    int            `json:"total"`
	Page     int            `json:"page"`
	PageSize int            `json:"page_size"`
	Users    []adminUserOut `json:"users"`
}

type adminUserStatsResponse struct {
	Total  int `json:"total"`
	New7d  int `json:"new_7d"`
	New30d int `json:"new_30d"`
	Admins int `json:"admins"`
}

type adminRoleOut struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	IsDefault   bool     `json:"is_default"`
	UserCount   int      `json:"user_count"`
	Scopes      []string `json:"scopes"`
}

type adminRolesResponse struct {
	Roles []adminRoleOut `json:"roles"`
}

// msToRFC3339 converts a Logto ms-epoch timestamp to RFC3339, or "" for zero.
func msToRFC3339(ms int64) string {
	if ms == 0 {
		return ""
	}
	return time.UnixMilli(ms).UTC().Format(time.RFC3339)
}

// msPtrToRFC3339Ptr converts a nullable Logto ms-epoch timestamp to a
// nullable RFC3339 string.
func msPtrToRFC3339Ptr(ms *int64) *string {
	if ms == nil || *ms == 0 {
		return nil
	}
	s := msToRFC3339(*ms)
	return &s
}

// intQueryOr reads a positive int query param, or fallback if absent/invalid.
func intQueryOr(r *http.Request, name string, fallback int) int {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 {
		return fallback
	}
	return v
}

// adminCacheGet writes a cached response body if present and returns true;
// callers should return immediately when it does.
func adminCacheGet(w http.ResponseWriter, r *http.Request, c *cache.Cache, key string) bool {
	cached, err := c.Get(r.Context(), key)
	if err != nil || cached == "" {
		return false
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Cache", "HIT")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(cached))
	return true
}

// adminCacheSet best-effort caches a JSON-encodable value for adminCacheTTL.
func adminCacheSet(r *http.Request, c *cache.Cache, key string, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	if err := c.Set(r.Context(), key, string(b), adminCacheTTL); err != nil {
		slog.Warn("admin cache set failed", "key", key, "error", err)
	}
}

// resolveUserRoles fetches each user's role names with bounded concurrency
// and fills out[i].Roles in place. A failed per-user lookup is logged and
// left as an empty slice rather than failing the whole page.
func resolveUserRoles(r *http.Request, la *logtoadmin.Client, users []logtoadmin.User, out []adminUserOut) {
	var wg sync.WaitGroup
	sem := make(chan struct{}, adminUserRolesConcurrency)
	for i, u := range users {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, userID string) {
			defer wg.Done()
			defer func() { <-sem }()
			roles, err := la.GetUserRoles(r.Context(), userID)
			if err != nil {
				slog.Warn("admin users: role lookup failed", "user_id", userID, "error", err)
				return
			}
			names := make([]string, len(roles))
			for j, role := range roles {
				names[j] = role.Name
			}
			out[i].Roles = names
		}(i, u.ID)
	}
	wg.Wait()
}

// AdminListUsers handles GET /admin/users?page=&page_size= — a page of Logto
// users with each one's role names resolved.
func AdminListUsers(la *logtoadmin.Client, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		page := intQueryOr(r, "page", 1)
		pageSize := intQueryOr(r, "page_size", 50)
		if pageSize > 200 {
			pageSize = 200
		}

		key := "admin:users:" + strconv.Itoa(page) + ":" + strconv.Itoa(pageSize)
		if adminCacheGet(w, r, c, key) {
			return
		}

		users, total, err := la.ListUsers(r.Context(), page, pageSize)
		if err != nil {
			slog.Error("admin users: list failed", "error", err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "logto management API unavailable"})
			return
		}

		out := make([]adminUserOut, len(users))
		for i, u := range users {
			out[i] = adminUserOut{
				ID:           u.ID,
				Name:         u.Name,
				PrimaryEmail: u.PrimaryEmail,
				CreatedAt:    msToRFC3339(u.CreatedAt),
				LastSignInAt: msPtrToRFC3339Ptr(u.LastSignInAt),
				Roles:        []string{},
			}
		}
		resolveUserRoles(r, la, users, out)

		resp := adminUsersResponse{Total: total, Page: page, PageSize: pageSize, Users: out}
		adminCacheSet(r, c, key, resp)
		writeJSON(w, http.StatusOK, resp)
	}
}

// AdminUserStats handles GET /admin/users/stats →
// { total, new_7d, new_30d, admins }. new_7d/new_30d are computed by walking
// users (capped at adminStatsUserLimit); admins is the distinct count of
// users holding any role whose scopes include the `admin` permission.
func AdminUserStats(la *logtoadmin.Client, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const key = "admin:users:stats"
		if adminCacheGet(w, r, c, key) {
			return
		}

		ctx := r.Context()
		now := time.Now()
		cutoff7 := now.AddDate(0, 0, -7)
		cutoff30 := now.AddDate(0, 0, -30)

		var total, new7d, new30d int
		for page := 1; ; page++ {
			users, grandTotal, err := la.ListUsers(ctx, page, adminStatsPageSize)
			if err != nil {
				slog.Error("admin user stats: list users failed", "error", err)
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": "logto management API unavailable"})
				return
			}
			if page == 1 {
				total = grandTotal
			}
			for _, u := range users {
				created := time.UnixMilli(u.CreatedAt)
				if created.After(cutoff7) {
					new7d++
				}
				if created.After(cutoff30) {
					new30d++
				}
			}

			walked := page * adminStatsPageSize
			if len(users) < adminStatsPageSize || walked >= adminStatsUserLimit || walked >= total {
				break
			}
		}

		admins, err := countAdmins(ctx, la)
		if err != nil {
			slog.Error("admin user stats: admin count failed", "error", err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "logto management API unavailable"})
			return
		}

		resp := adminUserStatsResponse{Total: total, New7d: new7d, New30d: new30d, Admins: admins}
		adminCacheSet(r, c, key, resp)
		writeJSON(w, http.StatusOK, resp)
	}
}

// countAdmins returns the distinct count of users holding any role whose
// scopes include the admin permission.
func countAdmins(ctx context.Context, la *logtoadmin.Client) (int, error) {
	roles, err := la.ListRoles(ctx)
	if err != nil {
		return 0, err
	}

	adminIDs := make(map[string]struct{})
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, adminUserRolesConcurrency)
	errCh := make(chan error, len(roles))

	for _, role := range roles {
		wg.Add(1)
		sem <- struct{}{}
		go func(role logtoadmin.Role) {
			defer wg.Done()
			defer func() { <-sem }()

			scopes, err := la.ListRoleScopes(ctx, role.ID)
			if err != nil {
				errCh <- err
				return
			}
			hasAdmin := false
			for _, s := range scopes {
				if s.Name == adminScopeName {
					hasAdmin = true
					break
				}
			}
			if !hasAdmin {
				return
			}

			users, err := la.ListRoleUsers(ctx, role.ID)
			if err != nil {
				errCh <- err
				return
			}
			mu.Lock()
			for _, u := range users {
				adminIDs[u.ID] = struct{}{}
			}
			mu.Unlock()
		}(role)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			return 0, err
		}
	}

	return len(adminIDs), nil
}

// AdminListRoles handles GET /admin/roles → every role with its user count
// and scope names resolved.
func AdminListRoles(la *logtoadmin.Client, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const key = "admin:roles"
		if adminCacheGet(w, r, c, key) {
			return
		}

		ctx := r.Context()
		roles, err := la.ListRoles(ctx)
		if err != nil {
			slog.Error("admin roles: list failed", "error", err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "logto management API unavailable"})
			return
		}

		out := make([]adminRoleOut, len(roles))
		var wg sync.WaitGroup
		sem := make(chan struct{}, adminUserRolesConcurrency)
		for i, role := range roles {
			out[i] = adminRoleOut{
				ID:          role.ID,
				Name:        role.Name,
				Description: role.Description,
				IsDefault:   role.IsDefault,
				Scopes:      []string{},
			}
			wg.Add(1)
			sem <- struct{}{}
			go func(i int, roleID string) {
				defer wg.Done()
				defer func() { <-sem }()

				scopes, err := la.ListRoleScopes(ctx, roleID)
				if err != nil {
					slog.Warn("admin roles: scope lookup failed", "role_id", roleID, "error", err)
				} else {
					names := make([]string, len(scopes))
					for j, s := range scopes {
						names[j] = s.Name
					}
					out[i].Scopes = names
				}

				users, err := la.ListRoleUsers(ctx, roleID)
				if err != nil {
					slog.Warn("admin roles: user count lookup failed", "role_id", roleID, "error", err)
					return
				}
				out[i].UserCount = len(users)
			}(i, role.ID)
		}
		wg.Wait()

		resp := adminRolesResponse{Roles: out}
		adminCacheSet(r, c, key, resp)
		writeJSON(w, http.StatusOK, resp)
	}
}
