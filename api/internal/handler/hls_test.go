package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type fakeHLSStore struct {
	srcs  map[int32]string // only publicly visible cameras are present
	hosts []string
}

func (f fakeHLSStore) PublicVideoSource(_ context.Context, id int32) (string, error) {
	if s, ok := f.srcs[id]; ok {
		return s, nil
	}
	return "", pgx.ErrNoRows
}

func (f fakeHLSStore) LicensedHostURLs(context.Context) ([]string, error) { return f.hosts, nil }

const testMaster = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\ncam_0.m3u8\n"
const testVariant = "#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MAP:URI=\"init.mp4\"\n#EXTINF:4.0,\nseg1.ts\n#EXTINF:4.0,\n/other/seg2.ts\n#EXTINF:4.0,\nhttps://elsewhere.example/seg3.ts\n"

func hlsTestServer(t *testing.T) (*chi.Mux, *httptest.Server) {
	t.Helper()
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/memfs/cam.m3u8":
			w.Header().Set("Content-Type", "application/x-mpegURL")
			_, _ = w.Write([]byte(testMaster))
		case "/memfs/cam_0.m3u8":
			_, _ = w.Write([]byte(testVariant))
		case "/memfs/seg1.ts":
			w.Header().Set("Content-Type", "video/mp2t")
			_, _ = w.Write([]byte("TSDATA"))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(up.Close)

	store := fakeHLSStore{
		srcs: map[int32]string{
			1: up.URL + "/memfs/cam.m3u8",
			2: "https://example.com/live/external.m3u8", // not Restreamer
		},
		hosts: []string{"https://www.licensed-host.com/rodeo", "ranch.example"},
	}
	manifest, segment, poster := newHLSHandlers(store, nil, up.Client())
	r := chi.NewRouter()
	r.Get("/hls/{video_id}/index.m3u8", manifest)
	r.Get("/hls/{video_id}/poster.jpg", poster)
	r.Get("/hls/{video_id}/{segment}", segment)
	return r, up
}

// hlsGet requests target. Unless hdr names X-HLS-Token itself (an empty value
// sends none), a valid player token for the camera in the path is attached,
// as StreamPlayer does (DAN-242), so these DAN-241 tests keep exercising the
// Referer gate and the rewriting behind the signature check.
func hlsGet(r http.Handler, target string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil)
	if _, ok := hdr[hlsTokenHeader]; !ok {
		if parts := strings.Split(target, "/"); len(parts) > 2 {
			if id, err := strconv.ParseInt(parts[2], 10, 32); err == nil {
				req.Header.Set(hlsTokenHeader, currentHLSSigner().playerToken(int32(id), hlsNow().Add(hlsTokenTTL).Unix()))
			}
		}
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec
}

func TestHLSRefererGate(t *testing.T) {
	r, _ := hlsTestServer(t)
	const path = "/hls/1/index.m3u8"

	for name, hdr := range map[string]map[string]string{
		"no headers":      nil,
		"foreign referer": {"Referer": "https://evil.example/page"},
		"foreign origin":  {"Origin": "https://evil.example"},
		"lookalike":       {"Referer": "https://nationcam.com.evil.example/"},
		"origin null":     {"Origin": "null"},
		"ok referer, bad origin": {
			"Referer": "https://nationcam.com/x", "Origin": "https://evil.example",
		},
	} {
		if rec := hlsGet(r, path, hdr); rec.Code != http.StatusForbidden {
			t.Errorf("%s: status = %d, want 403", name, rec.Code)
		}
	}

	for name, hdr := range map[string]map[string]string{
		"nationcam referer": {"Referer": "https://nationcam.com/locations/x"},
		"www nationcam":     {"Referer": "https://www.nationcam.com/"},
		"origin only":       {"Origin": "https://nationcam.com"},
		"localhost dev":     {"Referer": "http://localhost:3131/embed/x"},
		"licensed host":     {"Referer": "https://licensed-host.com/rodeo/page"},
		"licensed www":      {"Referer": "https://www.licensed-host.com/"},
		"licensed (no www)": {"Origin": "https://ranch.example"},
	} {
		if rec := hlsGet(r, path, hdr); rec.Code != http.StatusOK {
			t.Errorf("%s: status = %d, want 200", name, rec.Code)
		}
	}

	// Segments are gated the same way.
	if rec := hlsGet(r, "/hls/1/seg1.ts", nil); rec.Code != http.StatusForbidden {
		t.Errorf("segment without referer = %d, want 403", rec.Code)
	}
	rec := hlsGet(r, "/hls/1/seg1.ts", map[string]string{"Referer": "https://nationcam.com/"})
	if rec.Code != http.StatusOK || rec.Body.String() != "TSDATA" {
		t.Errorf("segment = %d %q, want 200 TSDATA", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "video/mp2t" {
		t.Errorf("segment content-type = %q", ct)
	}
}

func TestHLSManifestRewriting(t *testing.T) {
	r, _ := hlsTestServer(t)
	hdr := map[string]string{"Referer": "https://nationcam.com/"}

	rec := hlsGet(r, "/hls/1/index.m3u8", hdr)
	if got := rec.Body.String(); !strings.Contains(got, "\n/api/hls/1/cam_0.m3u8\n") {
		t.Errorf("master not rewritten:\n%s", got)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/vnd.apple.mpegurl" {
		t.Errorf("manifest content-type = %q", ct)
	}

	rec = hlsGet(r, "/hls/1/cam_0.m3u8", hdr)
	got := rec.Body.String()
	for _, want := range []string{
		`URI="/api/hls/1/init.mp4"`,
		"\n/api/hls/1/seg1.ts\n",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("variant missing %q:\n%s", want, got)
		}
	}
	// Absolute-path URI in another directory and a foreign host are not
	// fetchable around the proxy.
	for _, bad := range []string{"seg2.ts", "elsewhere.example", "http://"} {
		if strings.Contains(got, bad) {
			t.Errorf("variant still references %q:\n%s", bad, got)
		}
	}
}

func TestHLSInvisibleOrUnsupportedVideo(t *testing.T) {
	r, _ := hlsTestServer(t)
	hdr := map[string]string{"Referer": "https://nationcam.com/"}
	for _, target := range []string{
		"/hls/99/index.m3u8",    // not publicly visible (pending/rejected/missing)
		"/hls/99/seg1.ts",       // same, segment route
		"/hls/2/index.m3u8",     // visible but not Restreamer-backed
		"/hls/abc/index.m3u8",   // bad id
		"/hls/1/..%2Fsecret.ts", // traversal
		"/hls/1/seg1.exe",       // extension not allowed
		"/hls/1/missing.ts",     // upstream 404
	} {
		if rec := hlsGet(r, target, hdr); rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404", target, rec.Code)
		}
	}
}

func TestHLSPublicSrc(t *testing.T) {
	if got := hlsPublicSrc(7, "https://streamer.nationcam.com/memfs/abc.m3u8"); got != "/api/hls/7/index.m3u8" {
		t.Errorf("restreamer src = %q", got)
	}
	ext := "https://example.com/live/stream.m3u8"
	if got := hlsPublicSrc(7, ext); got != ext {
		t.Errorf("external src = %q, want unchanged", got)
	}
	if !hlsProxySrc.MatchString("/api/hls/7/index.m3u8") || hlsProxySrc.MatchString(ext) {
		t.Error("hlsProxySrc mismatch")
	}
}

func TestHostFromURLish(t *testing.T) {
	for in, want := range map[string]string{
		"https://www.Example.com/a?b=1": "example.com",
		"example.com/path":              "example.com",
		"":                              "",
		"http://host.example:8080":      "host.example",
	} {
		if got := hostFromURLish(in); got != want {
			t.Errorf("hostFromURLish(%q) = %q, want %q", in, got, want)
		}
	}
	_ = url.URL{}
}
