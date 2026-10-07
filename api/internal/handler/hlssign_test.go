package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

// withHLSClock pins hlsNow for one test.
func withHLSClock(t *testing.T, now time.Time) *time.Time {
	t.Helper()
	cur := now
	prev := hlsNow
	hlsNow = func() time.Time { return cur }
	t.Cleanup(func() { hlsNow = prev })
	return &cur
}

func TestHLSSignVerify(t *testing.T) {
	s := &hlsSigner{key: []byte("test-key-0123456789abcdef0123456789")}
	now := time.Unix(1_800_000_000, 0)
	exp := now.Add(5 * time.Minute).Unix()
	sig := s.sign(7, "seg1.ts", exp)

	if err := s.verify(7, "seg1.ts", exp, sig, now); err != nil {
		t.Fatalf("round trip: %v", err)
	}

	for name, tc := range map[string]struct {
		id   int32
		path string
		exp  int64
		sig  string
		want error
	}{
		"other video":     {8, "seg1.ts", exp, sig, errHLSBadSig},
		"other path":      {7, "seg2.ts", exp, sig, errHLSBadSig},
		"scope widened":   {7, hlsScopeAll, exp, sig, errHLSBadSig},
		"exp extended":    {7, "seg1.ts", exp + 3600, sig, errHLSBadSig},
		"sig flipped":     {7, "seg1.ts", exp, "A" + sig[1:], errHLSBadSig},
		"sig not base64":  {7, "seg1.ts", exp, "!!!", errHLSBadSig},
		"sig missing":     {7, "seg1.ts", exp, "", errHLSUnsigned},
		"other key":       {7, "seg1.ts", exp, (&hlsSigner{key: []byte("other")}).sign(7, "seg1.ts", exp), errHLSBadSig},
		"too far ahead":   {7, "seg1.ts", now.Add(24 * time.Hour).Unix(), s.sign(7, "seg1.ts", now.Add(24*time.Hour).Unix()), errHLSBadSig},
		"expired":         {7, "seg1.ts", now.Add(-time.Minute).Unix(), s.sign(7, "seg1.ts", now.Add(-time.Minute).Unix()), errHLSExpired},
		"just past skew":  {7, "seg1.ts", now.Add(-31 * time.Second).Unix(), s.sign(7, "seg1.ts", now.Add(-31*time.Second).Unix()), errHLSExpired},
		"inside skew":     {7, "seg1.ts", now.Add(-29 * time.Second).Unix(), s.sign(7, "seg1.ts", now.Add(-29*time.Second).Unix()), nil},
		"exactly at skew": {7, "seg1.ts", now.Add(-30 * time.Second).Unix(), s.sign(7, "seg1.ts", now.Add(-30*time.Second).Unix()), nil},
	} {
		if err := s.verify(tc.id, tc.path, tc.exp, tc.sig, now); !errors.Is(err, tc.want) {
			t.Errorf("%s: err = %v, want %v", name, err, tc.want)
		}
	}

	tok := s.playerToken(7, exp)
	if err := s.verifyPlayerToken(7, tok, now); err != nil {
		t.Errorf("player token: %v", err)
	}
	for name, bad := range map[string]string{
		"other video": s.playerToken(8, exp),
		"no dot":      strings.Replace(tok, ".", "", 1),
		"bad exp":     "x" + tok,
		"path sig":    strconv.FormatInt(exp, 10) + "." + s.sign(7, "index.m3u8", exp),
	} {
		if err := s.verifyPlayerToken(7, bad, now); err == nil {
			t.Errorf("player token %s: accepted", name)
		}
	}
	if err := s.verifyPlayerToken(7, tok, now.Add(5*time.Minute+31*time.Second)); !errors.Is(err, errHLSExpired) {
		t.Errorf("expired player token: err = %v", err)
	}
}

func TestHLSSetSigningKey(t *testing.T) {
	prev := currentHLSSigner()
	t.Cleanup(func() { hlsSignerPtr.Store(prev) })

	gen, err := SetHLSSigningKey("")
	if err != nil || !gen || len(currentHLSSigner().key) != 32 {
		t.Fatalf("empty key: generated=%v err=%v len=%d", gen, err, len(currentHLSSigner().key))
	}
	gen, err = SetHLSSigningKey("configured-key")
	if err != nil || gen || string(currentHLSSigner().key) != "configured-key" {
		t.Fatalf("configured key: generated=%v err=%v", gen, err)
	}
}

func TestHLSRequiresSignature(t *testing.T) {
	r, _ := hlsTestServer(t)
	ref := "https://nationcam.com/locations/x"
	signer := currentHLSSigner()
	now := hlsNow()

	for name, hdr := range map[string]map[string]string{
		// DAN-242: the Referer alone (spoofable) no longer fetches anything.
		"referer, no token":   {"Referer": ref, hlsTokenHeader: ""},
		"expired token":       {"Referer": ref, hlsTokenHeader: signer.playerToken(1, now.Add(-time.Minute).Unix())},
		"other camera token":  {"Referer": ref, hlsTokenHeader: signer.playerToken(3, now.Add(time.Minute).Unix())},
		"garbage token":       {"Referer": ref, hlsTokenHeader: "123.abc"},
		"valid token, no ref": nil,
	} {
		for _, target := range []string{"/hls/1/index.m3u8", "/hls/1/seg1.ts"} {
			if rec := hlsGet(r, target, hdr); rec.Code != http.StatusForbidden {
				t.Errorf("%s %s: status = %d, want 403", name, target, rec.Code)
			}
		}
	}

	// Signed URLs are bound to one file and expire.
	segURL := signer.signedURL(1, "seg1.ts", now.Add(time.Minute).Unix())
	if rec := hlsGet(r, strings.Replace(segURL, "/api", "", 1), nil); rec.Code != http.StatusOK {
		t.Errorf("signed segment = %d, want 200", rec.Code)
	}
	for name, target := range map[string]string{
		"path swapped":   strings.Replace(segURL, "seg1.ts", "cam_0.m3u8", 1),
		"video swapped":  strings.Replace(segURL, "/hls/1/", "/hls/3/", 1),
		"exp tampered":   strings.Replace(segURL, "exp=", "exp=9", 1),
		"sig dropped":    segURL[:strings.Index(segURL, "&sig=")],
		"expired":        signer.signedURL(1, "seg1.ts", now.Add(-time.Minute).Unix()),
		"manifest scope": strings.Replace(signer.signedURL(1, "index.m3u8", now.Add(time.Hour).Unix()), "index.m3u8", "seg1.ts", 1),
	} {
		target = strings.Replace(target, "/api", "", 1)
		if rec := hlsGet(r, target, map[string]string{hlsTokenHeader: ""}); rec.Code != http.StatusForbidden {
			t.Errorf("%s (%s): status = %d, want 403", name, target, rec.Code)
		}
	}
}

// TestHLSSignedRedirectFlow follows what a third-party HLS player does after
// the stream.m3u8 302: signed manifest -> signed variant -> signed segment,
// with no Referer and no token header.
func TestHLSSignedRedirectFlow(t *testing.T) {
	start := time.Unix(1_800_000_000, 0)
	clock := withHLSClock(t, start)
	r, _ := hlsTestServer(t)
	noToken := map[string]string{hlsTokenHeader: ""}
	strip := func(u string) string { return strings.Replace(u, "/api", "", 1) }

	manifestURL := hlsSignedManifestURL(1, hlsRedirectTTL)
	if !strings.HasPrefix(manifestURL, "/api/hls/1/index.m3u8?") {
		t.Fatalf("redirect target = %q", manifestURL)
	}
	rec := hlsGet(r, strip(manifestURL), noToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("signed manifest = %d %s", rec.Code, rec.Body.String())
	}
	var variant string
	for _, line := range strings.Split(rec.Body.String(), "\n") {
		if strings.HasPrefix(line, "/api/hls/1/cam_0.m3u8?") {
			variant = line
		}
	}
	if variant == "" {
		t.Fatalf("master not rewritten to a signed variant URI:\n%s", rec.Body.String())
	}
	vu, _ := url.Parse(variant)
	if got, want := vu.Query().Get("exp"), strconv.FormatInt(start.Add(hlsRedirectTTL).Unix(), 10); got != want {
		t.Errorf("variant exp = %s, want manifest exp %s", got, want)
	}

	rec = hlsGet(r, strip(variant), noToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("signed variant = %d", rec.Code)
	}
	body := rec.Body.String()
	var seg, initMap string
	for _, line := range strings.Split(body, "\n") {
		if strings.HasPrefix(line, "/api/hls/1/seg1.ts?") {
			seg = line
		}
		if i := strings.Index(line, `URI="`); i >= 0 {
			initMap = strings.TrimSuffix(line[i+len(`URI="`):], `"`)
		}
	}
	if seg == "" || !strings.HasPrefix(initMap, "/api/hls/1/init.mp4?") {
		t.Fatalf("variant not rewritten to signed URIs:\n%s", body)
	}
	su, _ := url.Parse(seg)
	if got, want := su.Query().Get("exp"), strconv.FormatInt(start.Add(hlsSegmentURLTTL).Unix(), 10); got != want {
		t.Errorf("segment exp = %s, want now+%s = %s", got, hlsSegmentURLTTL, want)
	}
	for _, bad := range []string{"seg2.ts", "elsewhere.example"} {
		if strings.Contains(body, bad) {
			t.Errorf("signed variant still references %q", bad)
		}
	}

	rec = hlsGet(r, strip(seg), noToken)
	if rec.Code != http.StatusOK || rec.Body.String() != "TSDATA" {
		t.Fatalf("signed segment = %d %q", rec.Code, rec.Body.String())
	}

	// Three minutes later the copied segment URL is dead, while the manifest
	// URL still works and hands out freshly signed segment URIs.
	*clock = start.Add(3 * time.Minute)
	if rec := hlsGet(r, strip(seg), noToken); rec.Code != http.StatusForbidden {
		t.Errorf("stale segment URL = %d, want 403", rec.Code)
	}
	if rec := hlsGet(r, strip(variant), noToken); rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), su.RawQuery) {
		t.Errorf("variant refetch = %d, want 200 with re-signed segments", rec.Code)
	}

	// Past the manifest's lifetime (plus skew) the redirect target is dead too.
	*clock = start.Add(hlsRedirectTTL + hlsClockSkew + time.Second)
	if rec := hlsGet(r, strip(manifestURL), noToken); rec.Code != http.StatusForbidden {
		t.Errorf("expired manifest URL = %d, want 403", rec.Code)
	}
}

// The segment exp never outlives the manifest that carried it.
func TestHLSURISignerCapsAtManifestExp(t *testing.T) {
	start := time.Unix(1_800_000_000, 0)
	withHLSClock(t, start)
	manifestExp := start.Add(30 * time.Second).Unix()
	u, _ := url.Parse(hlsURISigner(1, manifestExp)("seg1.ts"))
	if got := u.Query().Get("exp"); got != strconv.FormatInt(manifestExp, 10) {
		t.Errorf("segment exp = %s, want capped at %d", got, manifestExp)
	}
}

func TestHLSStreamToken(t *testing.T) {
	start := time.Unix(1_800_000_000, 0)
	withHLSClock(t, start)
	store := fakeHLSStore{srcs: map[int32]string{
		1: "https://streamer.nationcam.com/memfs/abc.m3u8",
		2: "https://example.com/live/external.m3u8",
	}}
	r := chi.NewRouter()
	r.Get("/videos/{id}/stream-token", newHLSStreamToken(store))

	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/videos/1/stream-token", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	if cc := rec.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
	var got map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"video_id", "token", "header", "expires_at", "ttl_seconds", "manifest_url", "signed_manifest_url", "native_ttl_seconds"} {
		if _, ok := got[k]; !ok {
			t.Errorf("response missing %q: %s", k, rec.Body.String())
		}
	}
	if got["video_id"] != float64(1) || got["header"] != hlsTokenHeader || got["ttl_seconds"] != float64(300) ||
		got["manifest_url"] != "/api/hls/1/index.m3u8" || got["expires_at"] != start.Add(hlsTokenTTL).UTC().Format(time.RFC3339) {
		t.Errorf("unexpected token response: %s", rec.Body.String())
	}
	if err := currentHLSSigner().verifyPlayerToken(1, got["token"].(string), start); err != nil {
		t.Errorf("issued token does not verify: %v", err)
	}
	if !strings.HasPrefix(got["signed_manifest_url"].(string), "/api/hls/1/index.m3u8?exp=") {
		t.Errorf("signed_manifest_url = %v", got["signed_manifest_url"])
	}

	for _, target := range []string{"/videos/99/stream-token", "/videos/2/stream-token", "/videos/x/stream-token"} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, target, nil))
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404", target, rec.Code)
		}
	}
}
