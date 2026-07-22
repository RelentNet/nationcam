package middleware

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/go-jose/go-jose/v4"
)

type contextKey string

// UserIDKey is the context key for the authenticated user's Logto subject.
const UserIDKey contextKey = "user_id"

// scopesKey is the context key for the raw space-delimited `scope` claim.
const scopesKey contextKey = "scopes"

// adminScope is the Logto API-resource permission that grants write access.
// It must exist as a permission on the `LOGTO_API_RESOURCE` API resource, be
// attached to a role, and that role assigned to the user. See AGENTS.md.
const adminScope = "admin"

// Auth validates Logto-issued JWTs using the JWKS discovery endpoint.
type Auth struct {
	jwksURL  string
	issuer   string
	audience string // expected API resource indicator; empty disables the aud check
	mu       sync.RWMutex
	keySet   *jose.JSONWebKeySet
	fetched  time.Time
}

// NewAuth creates an Auth middleware that validates tokens from the given Logto
// endpoint. apiResource is the Logto API resource indicator expected in the
// token's aud claim (empty string skips audience validation).
func NewAuth(logtoEndpoint, apiResource string) *Auth {
	base := strings.TrimRight(logtoEndpoint, "/")
	return &Auth{
		jwksURL:  base + "/oidc/jwks",
		issuer:   base + "/oidc",
		audience: apiResource,
	}
}

// Authenticate is middleware that extracts and validates the JWT, setting user info in context.
// If no token is present, the request proceeds as unauthenticated.
func (a *Auth) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := extractBearerToken(r)
		if token == "" {
			next.ServeHTTP(w, r)
			return
		}

		claims, err := a.validateToken(r.Context(), token)
		if err != nil {
			slog.Warn("invalid token", "error", err)
			next.ServeHTTP(w, r)
			return
		}

		ctx := context.WithValue(r.Context(), UserIDKey, claims.Subject)
		ctx = context.WithValue(ctx, scopesKey, claims.Scope)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireAdmin rejects any request whose validated access token does not carry
// the adminScope permission in its `scope` claim. Unauthenticated requests have
// no scopes and are therefore rejected too — this fails closed.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		scopes, _ := r.Context().Value(scopesKey).(string)
		if !slices.Contains(strings.Fields(scopes), adminScope) {
			slog.Warn("admin access denied",
				"user_id", UserID(r.Context()), "path", r.URL.Path, "scopes", scopes)
			http.Error(w, `{"error":"forbidden","detail":"missing required permission: `+adminScope+`"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// UserID extracts the authenticated user ID from the request context.
func UserID(ctx context.Context) string {
	id, _ := ctx.Value(UserIDKey).(string)
	return id
}

type tokenClaims struct {
	Subject string `json:"sub"`
	// Scope holds the space-delimited permissions Logto granted for this API
	// resource, filtered by the user's roles.
	Scope     string   `json:"scope"`
	Issuer    string   `json:"iss"`
	Audience  audience `json:"aud"`
	Expiry    int64    `json:"exp"`
	NotBefore int64    `json:"nbf"`
}

// audience accepts both the string and array forms of the JWT aud claim.
type audience []string

func (a *audience) UnmarshalJSON(b []byte) error {
	var single string
	if err := json.Unmarshal(b, &single); err == nil {
		*a = audience{single}
		return nil
	}
	var many []string
	if err := json.Unmarshal(b, &many); err != nil {
		return err
	}
	*a = audience(many)
	return nil
}

// clockSkewLeeway tolerates small clock drift between Logto and the API.
const clockSkewLeeway = 60 * time.Second

func (a *Auth) validateToken(ctx context.Context, rawToken string) (*tokenClaims, error) {
	keys, err := a.getKeys(ctx)
	if err != nil {
		return nil, fmt.Errorf("fetch JWKS: %w", err)
	}

	tok, err := jose.ParseSigned(rawToken, []jose.SignatureAlgorithm{jose.RS256, jose.ES256, jose.ES384})
	if err != nil {
		return nil, fmt.Errorf("parse JWT: %w", err)
	}

	// Try each key until one works.
	var payload []byte
	for _, key := range keys.Keys {
		payload, err = tok.Verify(key)
		if err == nil {
			break
		}
	}
	if err != nil {
		return nil, fmt.Errorf("verify JWT: %w", err)
	}

	var claims tokenClaims
	if err := json.Unmarshal(payload, &claims); err != nil {
		return nil, fmt.Errorf("decode claims: %w", err)
	}

	now := time.Now()
	if claims.Expiry == 0 {
		return nil, fmt.Errorf("token has no exp claim")
	}
	if now.After(time.Unix(claims.Expiry, 0).Add(clockSkewLeeway)) {
		return nil, fmt.Errorf("token expired at %s", time.Unix(claims.Expiry, 0))
	}
	if claims.NotBefore != 0 && now.Add(clockSkewLeeway).Before(time.Unix(claims.NotBefore, 0)) {
		return nil, fmt.Errorf("token not valid yet (nbf %s)", time.Unix(claims.NotBefore, 0))
	}
	if claims.Issuer != a.issuer {
		return nil, fmt.Errorf("unexpected issuer %q (want %q)", claims.Issuer, a.issuer)
	}
	if a.audience != "" {
		found := false
		for _, aud := range claims.Audience {
			if aud == a.audience {
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("token audience %v does not include %q", claims.Audience, a.audience)
		}
	}

	return &claims, nil
}

func (a *Auth) getKeys(ctx context.Context) (*jose.JSONWebKeySet, error) {
	a.mu.RLock()
	if a.keySet != nil && time.Since(a.fetched) < 1*time.Hour {
		defer a.mu.RUnlock()
		return a.keySet, nil
	}
	a.mu.RUnlock()

	a.mu.Lock()
	defer a.mu.Unlock()

	// Double-check after acquiring write lock.
	if a.keySet != nil && time.Since(a.fetched) < 1*time.Hour {
		return a.keySet, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, a.jwksURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var ks jose.JSONWebKeySet
	if err := json.Unmarshal(body, &ks); err != nil {
		return nil, err
	}

	a.keySet = &ks
	a.fetched = time.Now()
	return a.keySet, nil
}

func extractBearerToken(r *http.Request) string {
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		return ""
	}
	return strings.TrimPrefix(auth, "Bearer ")
}
