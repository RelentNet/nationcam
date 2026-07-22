package middleware

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
)

// testIssuer builds an Auth wired to a fake JWKS server plus a signer for
// minting tokens with arbitrary claims.
func testIssuer(t *testing.T) (*Auth, jose.Signer, func()) {
	t.Helper()

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	jwk := jose.JSONWebKey{Key: &priv.PublicKey, KeyID: "test-key", Algorithm: string(jose.ES256), Use: "sig"}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/oidc/jwks") {
			http.NotFound(w, r)
			return
		}
		json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{jwk}})
	}))

	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.ES256, Key: priv},
		(&jose.SignerOptions{}).WithHeader("kid", "test-key"),
	)
	if err != nil {
		srv.Close()
		t.Fatal(err)
	}

	auth := NewAuth(srv.URL, "https://api.nationcam.com")
	return auth, signer, srv.Close
}

func signToken(t *testing.T, signer jose.Signer, claims map[string]any) string {
	t.Helper()
	payload, err := json.Marshal(claims)
	if err != nil {
		t.Fatal(err)
	}
	sig, err := signer.Sign(payload)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := sig.CompactSerialize()
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestValidateToken(t *testing.T) {
	auth, signer, done := testIssuer(t)
	defer done()

	issuer := auth.issuer
	now := time.Now()

	valid := map[string]any{
		"sub": "user-1",
		"iss": issuer,
		"aud": "https://api.nationcam.com",
		"exp": now.Add(time.Hour).Unix(),
	}

	cases := []struct {
		name    string
		mutate  func(m map[string]any)
		wantErr string
	}{
		{name: "valid token", mutate: func(m map[string]any) {}},
		{
			name:   "aud as array",
			mutate: func(m map[string]any) { m["aud"] = []string{"other", "https://api.nationcam.com"} },
		},
		{
			name:    "expired",
			mutate:  func(m map[string]any) { m["exp"] = now.Add(-time.Hour).Unix() },
			wantErr: "expired",
		},
		{
			name:    "missing exp",
			mutate:  func(m map[string]any) { delete(m, "exp") },
			wantErr: "no exp claim",
		},
		{
			name:    "wrong issuer",
			mutate:  func(m map[string]any) { m["iss"] = "https://evil.example.com/oidc" },
			wantErr: "issuer",
		},
		{
			name:    "wrong audience",
			mutate:  func(m map[string]any) { m["aud"] = "https://other-api.example.com" },
			wantErr: "audience",
		},
		{
			name:    "not yet valid",
			mutate:  func(m map[string]any) { m["nbf"] = now.Add(time.Hour).Unix() },
			wantErr: "not valid yet",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			claims := make(map[string]any, len(valid))
			for k, v := range valid {
				claims[k] = v
			}
			tc.mutate(claims)

			got, err := auth.validateToken(context.Background(), signToken(t, signer, claims))
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("expected success, got error: %v", err)
				}
				if got.Subject != "user-1" {
					t.Fatalf("expected subject user-1, got %q", got.Subject)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected error containing %q, got success", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("expected error containing %q, got: %v", tc.wantErr, err)
			}
		})
	}
}

func TestValidateTokenSkipsAudWhenUnconfigured(t *testing.T) {
	auth, signer, done := testIssuer(t)
	defer done()
	auth.audience = ""

	token := signToken(t, signer, map[string]any{
		"sub": "user-1",
		"iss": auth.issuer,
		"exp": time.Now().Add(time.Hour).Unix(),
	})
	if _, err := auth.validateToken(context.Background(), token); err != nil {
		t.Fatalf("expected success with no audience configured, got: %v", err)
	}
}

func TestValidateTokenRejectsUnsignedGarbage(t *testing.T) {
	auth, _, done := testIssuer(t)
	defer done()

	if _, err := auth.validateToken(context.Background(), "not-a-jwt"); err == nil {
		t.Fatal("expected error for garbage token")
	}
}
