// Package logtoadmin talks to Logto's Management API using a
// machine-to-machine (M2M) application's client-credentials grant. It backs
// the /admin/users and /admin/roles endpoints that let the admin console and
// Home read Logto's user/role data without console access.
package logtoadmin

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

// tokenBuffer is the safety margin before token expiry that triggers a
// refresh, so a request never races an about-to-expire token.
const tokenBuffer = 60 * time.Second

// managementResource is the Logto API resource indicator for the Management
// API itself (distinct from LOGTO_API_RESOURCE, which is NationCam's own
// API resource).
const managementResource = "https://default.logto.app/api"

// requestTimeout bounds every call to Logto — token exchange and each
// Management API request each get their own budget — so a slow or
// unreachable Logto instance never hangs a request to our own /admin
// endpoints.
const requestTimeout = 10 * time.Second

// Client is a Logto Management API client. It caches its access token and
// refreshes it shortly before expiry, retries a request once on 401, and
// never logs the app secret or an issued token.
type Client struct {
	Endpoint  string
	AppID     string
	AppSecret string
	HTTP      *http.Client

	mu       sync.Mutex
	token    string
	tokenExp time.Time
}

// NewClient builds a Client. It always returns a non-nil value — call
// Configured before relying on it, since AppID/AppSecret may be empty when
// the feature is disabled.
func NewClient(endpoint, appID, appSecret string) *Client {
	return &Client{
		Endpoint:  strings.TrimRight(endpoint, "/"),
		AppID:     appID,
		AppSecret: appSecret,
		HTTP:      &http.Client{Timeout: requestTimeout},
	}
}

// Configured reports whether both the M2M app ID and secret are set.
func (c *Client) Configured() bool {
	return c.AppID != "" && c.AppSecret != ""
}

// ── Types ────────────────────────────────────────────────────────────

// User is a Logto user account, trimmed to the fields the admin console and
// Home need.
type User struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	PrimaryEmail string `json:"primaryEmail"`
	CreatedAt    int64  `json:"createdAt"`    // ms epoch
	LastSignInAt *int64 `json:"lastSignInAt"` // ms epoch, nullable
}

// Role is a Logto role.
type Role struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	IsDefault   bool   `json:"isDefault"`
	Type        string `json:"type"`
}

// Scope is a Logto permission attached to an API resource or role.
type Scope struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// ── Management API methods ─────────────────────────────────────────

// ListUsers returns one page of users plus the tenant's total user count
// (from the Total-Number response header).
func (c *Client) ListUsers(ctx context.Context, page, pageSize int) ([]User, int, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 20
	}
	q := url.Values{
		"page":      {strconv.Itoa(page)},
		"page_size": {strconv.Itoa(pageSize)},
	}

	var users []User
	header, err := c.get(ctx, "/api/users?"+q.Encode(), &users)
	if err != nil {
		return nil, 0, err
	}

	total := len(users)
	if tn := header.Get("Total-Number"); tn != "" {
		if n, err := strconv.Atoi(tn); err == nil {
			total = n
		}
	}
	return users, total, nil
}

// GetUserRoles returns the roles assigned to a user.
func (c *Client) GetUserRoles(ctx context.Context, id string) ([]Role, error) {
	var roles []Role
	if _, err := c.get(ctx, "/api/users/"+url.PathEscape(id)+"/roles", &roles); err != nil {
		return nil, err
	}
	return roles, nil
}

// ListRoles returns every role in the tenant.
func (c *Client) ListRoles(ctx context.Context) ([]Role, error) {
	var roles []Role
	if _, err := c.get(ctx, "/api/roles", &roles); err != nil {
		return nil, err
	}
	return roles, nil
}

// ListRoleUsers returns the users assigned a given role.
func (c *Client) ListRoleUsers(ctx context.Context, roleID string) ([]User, error) {
	var users []User
	if _, err := c.get(ctx, "/api/roles/"+url.PathEscape(roleID)+"/users", &users); err != nil {
		return nil, err
	}
	return users, nil
}

// ListRoleScopes returns the permissions (scopes) attached to a role.
func (c *Client) ListRoleScopes(ctx context.Context, roleID string) ([]Scope, error) {
	var scopes []Scope
	if _, err := c.get(ctx, "/api/roles/"+url.PathEscape(roleID)+"/scopes", &scopes); err != nil {
		return nil, err
	}
	return scopes, nil
}

// ── HTTP + token plumbing ──────────────────────────────────────────

// get performs an authenticated GET against the Management API, retrying
// once on 401 after invalidating the cached token (it may have been revoked
// or the clock-based cache may be stale).
func (c *Client) get(ctx context.Context, path string, out any) (http.Header, error) {
	header, status, body, err := c.doGet(ctx, path)
	if err != nil {
		return nil, err
	}
	if status == http.StatusUnauthorized {
		c.invalidateToken()
		header, status, body, err = c.doGet(ctx, path)
		if err != nil {
			return nil, err
		}
	}
	if status >= 400 {
		return nil, fmt.Errorf("logto management API: %s returned %d: %s", path, status, strings.TrimSpace(string(body)))
	}
	if out != nil && len(body) > 0 {
		if err := json.Unmarshal(body, out); err != nil {
			return nil, fmt.Errorf("decode logto response: %w", err)
		}
	}
	return header, nil
}

func (c *Client) doGet(ctx context.Context, path string) (http.Header, int, []byte, error) {
	token, err := c.getToken(ctx)
	if err != nil {
		return nil, 0, nil, err
	}

	reqCtx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, c.Endpoint+path, nil)
	if err != nil {
		return nil, 0, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, 0, nil, fmt.Errorf("logto management API request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, 0, nil, err
	}
	return resp.Header, resp.StatusCode, body, nil
}

// getToken returns a cached access token, fetching a new one via the
// client-credentials grant if the cache is empty or near expiry.
func (c *Client) getToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.token != "" && time.Now().Before(c.tokenExp.Add(-tokenBuffer)) {
		return c.token, nil
	}
	return c.fetchToken(ctx)
}

func (c *Client) invalidateToken() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.token = ""
}

// fetchToken performs the client_credentials grant against Logto's OIDC
// token endpoint. Caller must hold c.mu. Never logs the secret or the
// returned token.
func (c *Client) fetchToken(ctx context.Context) (string, error) {
	form := url.Values{
		"grant_type": {"client_credentials"},
		"resource":   {managementResource},
		"scope":      {"all"},
	}

	reqCtx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, c.Endpoint+"/oidc/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(c.AppID, c.AppSecret)

	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", fmt.Errorf("logto token request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("logto token request returned %d", resp.StatusCode)
	}

	var result struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int64  `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("decode logto token response: %w", err)
	}
	if result.AccessToken == "" {
		return "", fmt.Errorf("logto token response missing access_token")
	}

	c.token = result.AccessToken
	c.tokenExp = time.Now().Add(time.Duration(result.ExpiresIn) * time.Second)
	return c.token, nil
}
