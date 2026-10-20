package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/archive"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// noPrivateCameras is the ServeSnapshots visibility lookup for tests where
// every camera is public.
func noPrivateCameras(context.Context, int32) (bool, error) { return false, nil }

// privateFixture is one upstream Restreamer, a public camera 1 and a private
// camera 5 that "member" can view, mounted on the HLS proxy, the stream-token
// endpoint and the private routes — the same handlers router.go wires.
type privateFixture struct {
	r     *chi.Mux
	store fakeHLSStore
	dir   string
}

func newPrivateFixture(t *testing.T) *privateFixture {
	t.Helper()
	var still bytes.Buffer
	if err := jpeg.Encode(&still, image.NewRGBA(image.Rect(0, 0, 640, 360)), nil); err != nil {
		t.Fatal(err)
	}
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch path := r.URL.Path; {
		case strings.HasSuffix(path, ".jpg"):
			_, _ = w.Write(still.Bytes())
		case path == "/memfs/pub.m3u8" || path == "/memfs/priv.m3u8":
			_, _ = w.Write([]byte(testMaster))
		case path == "/memfs/cam_0.m3u8":
			_, _ = w.Write([]byte(testVariant))
		case path == "/memfs/seg1.ts":
			_, _ = w.Write([]byte("TSDATA"))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(up.Close)

	dir := t.TempDir()
	for _, id := range []string{"1", "5"} {
		frame := filepath.Join(dir, id, "2026-09-25", "1215.jpg")
		if err := os.MkdirAll(filepath.Dir(frame), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(frame, []byte("\xff\xd8jpeg"+id), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	snapshots := &archive.Store{Dir: dir}

	store := fakeHLSStore{
		srcs:    map[int32]string{1: up.URL + "/memfs/pub.m3u8"},
		private: map[int32]string{5: up.URL + "/memfs/priv.m3u8"},
		members: map[int32][]string{5: {"member"}},
	}
	manifest, segment, poster := newHLSHandlers(store, nil, up.Client())
	r := chi.NewRouter()
	r.Get("/hls/{video_id}/index.m3u8", manifest)
	r.Get("/hls/{video_id}/poster.jpg", poster)
	r.Get("/hls/{video_id}/{segment}", segment)
	r.Get("/videos/{id}/stream-token", newHLSStreamToken(store))
	r.Get("/snapshots/*", ServeSnapshots(snapshots, func(_ context.Context, id int32) (bool, error) {
		_, private := store.private[id]
		return private, nil
	}).ServeHTTP)
	mountPrivateRoutes(r, store, newTestCache(t), snapshots, up.Client())
	return &privateFixture{r: r, store: store, dir: dir}
}

func (f *privateFixture) do(ctx context.Context, target string, hdr map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, target, nil).WithContext(ctx)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	f.r.ServeHTTP(rec, req)
	return rec
}

func TestPrivateStreamToken(t *testing.T) {
	start := time.Unix(1_800_000_000, 0)
	withHLSClock(t, start)
	f := newPrivateFixture(t)

	// Anonymous: 401. A signed-in non-member: 404, the same as a camera that
	// does not exist, so existence does not leak.
	if rec := f.do(context.Background(), "/videos/5/stream-token", nil); rec.Code != http.StatusUnauthorized {
		t.Errorf("anonymous: status = %d, want 401", rec.Code)
	}
	if rec := f.do(as("stranger", ""), "/videos/5/stream-token", nil); rec.Code != http.StatusNotFound {
		t.Errorf("non-member: status = %d, want 404", rec.Code)
	}
	if rec := f.do(as("stranger", ""), "/videos/6/stream-token", nil); rec.Code != http.StatusNotFound {
		t.Errorf("missing camera: status = %d, want 404", rec.Code)
	}
	// A public camera still needs no sign-in.
	if rec := f.do(context.Background(), "/videos/1/stream-token", nil); rec.Code != http.StatusOK {
		t.Errorf("public camera: status = %d, want 200", rec.Code)
	}

	for _, ctx := range []context.Context{as("member", ""), as("support", "admin")} {
		rec := f.do(ctx, "/videos/5/stream-token", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("viewer: status = %d, body %s", rec.Code, rec.Body.String())
		}
		var got hlsStreamTokenResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.ManifestURL != "/api/hls/5/index.m3u8" || strings.Contains(rec.Body.String(), "memfs") {
			t.Errorf("token response leaks or misses the proxy src: %s", rec.Body.String())
		}
		if _, err := currentHLSSigner().verifyPlayerTokenScoped(5, got.Token, start); err != nil {
			t.Errorf("private token does not verify: %v", err)
		}
		if currentHLSSigner().verifyPlayerToken(5, got.Token, start) == nil {
			t.Error("private token verified as a public-scope token")
		}
	}
}

func TestPrivatePlaybackThroughProxy(t *testing.T) {
	start := time.Unix(1_800_000_000, 0)
	withHLSClock(t, start)
	f := newPrivateFixture(t)
	signer := currentHLSSigner()
	ref := "https://nationcam.com/dashboard"
	exp := start.Add(hlsTokenTTL).Unix()

	// The private token plays exactly like a public one: manifest + segment.
	privTok := signer.playerTokenScoped(5, exp, true)
	for _, target := range []string{"/hls/5/index.m3u8", "/hls/5/cam_0.m3u8", "/hls/5/seg1.ts"} {
		rec := f.do(context.Background(), target, map[string]string{"Referer": ref, hlsTokenHeader: privTok})
		if rec.Code != http.StatusOK {
			t.Errorf("%s with private token: status = %d, body %s", target, rec.Code, rec.Body.String())
		}
		if strings.Contains(rec.Body.String(), "memfs") || strings.Contains(rec.Body.String(), "priv.m3u8") {
			t.Errorf("%s leaks the upstream: %s", target, rec.Body.String())
		}
	}

	// A public-scope token (issued while the camera was public) no longer
	// plays it, and a private token never plays a public camera.
	pubTok := signer.playerToken(5, exp)
	if rec := f.do(context.Background(), "/hls/5/index.m3u8", map[string]string{"Referer": ref, hlsTokenHeader: pubTok}); rec.Code != http.StatusNotFound {
		t.Errorf("public token on private camera: status = %d, want 404", rec.Code)
	}
	if rec := f.do(context.Background(), "/hls/1/index.m3u8", map[string]string{"Referer": ref, hlsTokenHeader: signer.playerTokenScoped(1, exp, true)}); rec.Code != http.StatusNotFound {
		t.Errorf("private token on public camera: status = %d, want 404", rec.Code)
	}

	// The private native-HLS URL plays with no Referer and signs its URIs in
	// the private scope.
	manifestURL := strings.Replace(hlsSignedManifestURLScoped(5, hlsNativeTTL, true), "/api", "", 1)
	rec := f.do(context.Background(), manifestURL, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("private signed manifest: status = %d", rec.Code)
	}
	variant := ""
	for _, line := range strings.Split(rec.Body.String(), "\n") {
		if strings.HasPrefix(line, "/api/hls/5/cam_0.m3u8?") {
			variant = line
		}
	}
	if variant == "" {
		t.Fatalf("no signed variant in %q", rec.Body.String())
	}
	if rec := f.do(context.Background(), strings.Replace(variant, "/api", "", 1), nil); rec.Code != http.StatusOK {
		t.Errorf("private signed variant: status = %d", rec.Code)
	}

	// The 12 h public redirect shape is never valid for a private camera:
	// in the public scope it is the wrong scope, in the private scope it is
	// longer than any private URL may live.
	for name, u := range map[string]string{
		"public 12h":  hlsSignedManifestURL(5, hlsRedirectTTL),
		"private 12h": hlsSignedManifestURLScoped(5, hlsRedirectTTL, true),
	} {
		rec := f.do(context.Background(), strings.Replace(u, "/api", "", 1), nil)
		if rec.Code != http.StatusNotFound && rec.Code != http.StatusForbidden {
			t.Errorf("%s: status = %d, want 403/404", name, rec.Code)
		}
	}
}

func TestPrivatePosterAndArchiveAreNotPublic(t *testing.T) {
	f := newPrivateFixture(t)
	if rec := f.do(context.Background(), "/hls/5/poster.jpg", nil); rec.Code != http.StatusNotFound {
		t.Errorf("private poster: status = %d, want 404", rec.Code)
	}
	if rec := f.do(context.Background(), "/hls/1/poster.jpg", nil); rec.Code != http.StatusOK {
		t.Errorf("public poster: status = %d, want 200", rec.Code)
	}
	if rec := f.do(context.Background(), "/snapshots/5/2026-09-25/1215.jpg", nil); rec.Code != http.StatusNotFound {
		t.Errorf("private archive file: status = %d, want 404", rec.Code)
	}
	if rec := f.do(context.Background(), "/snapshots/1/2026-09-25/1215.jpg", nil); rec.Code != http.StatusOK {
		t.Errorf("public archive file: status = %d, want 200", rec.Code)
	}
}

func TestPrivateStillAndFrames(t *testing.T) {
	f := newPrivateFixture(t)
	member := as("member", "")

	// Signed-out: 401 on every route; a non-member: 404 on every route.
	for _, target := range []string{
		"/private/videos/5/snapshot.jpg",
		"/private/videos/5/frames?day=2026-09-25",
		"/private/videos/5/frames/days",
		"/private/videos/5/frames/2026-09-25/1215.jpg",
	} {
		if rec := f.do(context.Background(), target, nil); rec.Code != http.StatusUnauthorized {
			t.Errorf("anonymous %s: status = %d, want 401", target, rec.Code)
		}
		if rec := f.do(as("stranger", ""), target, nil); rec.Code != http.StatusNotFound {
			t.Errorf("non-member %s: status = %d, want 404", target, rec.Code)
		}
	}

	rec := f.do(member, "/private/videos/5/snapshot.jpg", nil)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/jpeg" {
		t.Fatalf("member still: status = %d, type %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	if cc := rec.Header().Get("Cache-Control"); !strings.HasPrefix(cc, "private") {
		t.Errorf("still Cache-Control = %q, want private", cc)
	}
	if _, err := jpeg.Decode(bytes.NewReader(rec.Body.Bytes())); err != nil {
		t.Errorf("still is not a JPEG: %v", err)
	}
	if rec := f.do(member, "/private/videos/5/snapshot.jpg?w=320", nil); rec.Code != http.StatusOK {
		t.Errorf("member thumb: status = %d", rec.Code)
	}
	if rec := f.do(member, "/private/videos/5/snapshot.jpg?w=99", nil); rec.Code != http.StatusBadRequest {
		t.Errorf("bad width: status = %d, want 400", rec.Code)
	}

	rec = f.do(member, "/private/videos/5/frames?day=2026-09-25", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("frames: status = %d", rec.Code)
	}
	var frames framesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &frames); err != nil {
		t.Fatal(err)
	}
	want := "/api/private/videos/5/frames/2026-09-25/1215.jpg"
	if len(frames.Frames) != 1 || frames.Frames[0].URL != want {
		t.Fatalf("frames = %+v, want one at %s", frames.Frames, want)
	}

	rec = f.do(member, "/private/videos/5/frames/days", nil)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "2026-09-25") {
		t.Errorf("days: status = %d, body %s", rec.Code, rec.Body.String())
	}

	rec = f.do(member, strings.TrimPrefix(want, "/api"), nil)
	if rec.Code != http.StatusOK || rec.Body.String() != "\xff\xd8jpeg5" {
		t.Fatalf("frame file: status = %d, body %q", rec.Code, rec.Body.String())
	}
	if cc := rec.Header().Get("Cache-Control"); cc != privateFrameCacheControl {
		t.Errorf("frame Cache-Control = %q", cc)
	}
	for _, bad := range []string{
		"/private/videos/5/frames/2026-09-25/notes.txt",
		"/private/videos/5/frames/2026-9-25/1215.jpg",
		"/private/videos/5/frames/2026-09-25/1216.jpg",
	} {
		if rec := f.do(member, bad, nil); rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404", bad, rec.Code)
		}
	}

	// A NationCam admin may view it for support.
	if rec := f.do(as("support", "admin"), "/private/videos/5/frames/days", nil); rec.Code != http.StatusOK {
		t.Errorf("admin: status = %d", rec.Code)
	}
}

type fakeVisibilityStore struct {
	videos, subs map[int32]string
}

func (f fakeVisibilityStore) SetVideoVisibility(_ context.Context, arg db.SetVideoVisibilityParams) (int64, error) {
	if _, ok := f.videos[arg.VideoID]; !ok {
		return 0, nil
	}
	f.videos[arg.VideoID] = arg.Visibility
	return 1, nil
}

func (f fakeVisibilityStore) SetSublocationVisibility(_ context.Context, arg db.SetSublocationVisibilityParams) (int64, error) {
	if _, ok := f.subs[arg.SublocationID]; !ok {
		return 0, nil
	}
	f.subs[arg.SublocationID] = arg.Visibility
	return 1, nil
}

func TestSetVisibility(t *testing.T) {
	store := fakeVisibilityStore{videos: map[int32]string{1: "public"}, subs: map[int32]string{2: "public"}}
	c := newTestCache(t)
	r := chi.NewRouter()
	r.Put("/videos/{id}/visibility", SetVideoVisibility(store, c))
	r.Put("/sublocations/{id}/visibility", SetSublocationVisibility(store, c))
	put := func(target, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodPut, target, strings.NewReader(body)))
		return rec
	}
	// The flush itself is invalidateCatalog (videos:*, sublocations:*,
	// states:*), shared with every owner/review write; the fake Redis has no
	// SCAN, so it is not asserted here.
	rec := put("/videos/1/visibility", `{"visibility":"private"}`)
	if rec.Code != http.StatusOK || store.videos[1] != "private" {
		t.Fatalf("set camera private: status = %d, stored %q", rec.Code, store.videos[1])
	}
	if rec := put("/sublocations/2/visibility", `{"visibility":"private"}`); rec.Code != http.StatusOK || store.subs[2] != "private" {
		t.Errorf("set location private: status = %d", rec.Code)
	}
	if rec := put("/videos/1/visibility", `{"visibility":"public"}`); rec.Code != http.StatusOK || store.videos[1] != "public" {
		t.Errorf("set camera public: status = %d", rec.Code)
	}
	for target, want := range map[string]int{
		"/videos/9/visibility":       http.StatusNotFound,
		"/sublocations/9/visibility": http.StatusNotFound,
		"/videos/x/visibility":       http.StatusNotFound,
	} {
		if rec := put(target, `{"visibility":"private"}`); rec.Code != want {
			t.Errorf("%s: status = %d, want %d", target, rec.Code, want)
		}
	}
	for _, body := range []string{`{"visibility":"hidden"}`, `{}`, `nope`} {
		if rec := put("/videos/1/visibility", body); rec.Code != http.StatusBadRequest {
			t.Errorf("body %s: status = %d, want 400", body, rec.Code)
		}
	}
}

func TestRedactOwnerVideo(t *testing.T) {
	raw := "https://streamer.nationcam.com/memfs/abc-123.m3u8"
	sid := pgtype.Text{String: "abc-123", Valid: true}
	for _, tc := range []struct {
		video, sub string
		private    bool
	}{
		{"public", "public", false},
		{"public", "", false},
		{"private", "public", true},
		{"public", "private", true},
	} {
		got := redactOwnerVideo(db.GetVideoForOwnerRow{VideoID: 7, Src: raw, StreamID: sid, Visibility: tc.video, SublocationVisibility: tc.sub})
		rows := redactOwnerVideos([]db.ListOwnerVideosRow{{VideoID: 7, Src: raw, StreamID: sid, Visibility: tc.video, SublocationVisibility: tc.sub}})
		if tc.private {
			if got.Src != "/api/hls/7/index.m3u8" || got.StreamID.Valid || rows[0].Src != "/api/hls/7/index.m3u8" || rows[0].StreamID.Valid {
				t.Errorf("%+v: private camera not redacted: %+v / %+v", tc, got, rows[0])
			}
		} else if got.Src != raw || !got.StreamID.Valid || rows[0].Src != raw {
			t.Errorf("%+v: public camera changed: %+v", tc, got)
		}
	}
}

func TestHLSVerifyScoped(t *testing.T) {
	s := &hlsSigner{key: []byte("test-key-0123456789abcdef0123456789")}
	now := time.Unix(1_800_000_000, 0)
	exp := now.Add(time.Minute).Unix()
	pub := s.sign(3, "seg1.ts", exp)
	priv := s.sign(3, hlsScoped("seg1.ts", true), exp)
	if p, err := s.verifyScoped(3, "seg1.ts", exp, pub, now); err != nil || p {
		t.Errorf("public sig: private=%v err=%v", p, err)
	}
	if p, err := s.verifyScoped(3, "seg1.ts", exp, priv, now); err != nil || !p {
		t.Errorf("private sig: private=%v err=%v", p, err)
	}
	if _, err := s.verifyScoped(3, "seg2.ts", exp, priv, now); err == nil {
		t.Error("private sig accepted for another file")
	}
	late := now.Add(2 * time.Hour).Unix()
	if _, err := s.verifyScoped(3, "seg1.ts", late, s.sign(3, hlsScoped("seg1.ts", true), late), now); err == nil {
		t.Error("private sig accepted beyond hlsPrivateMaxLifetime")
	}
	if _, err := s.verifyScoped(3, "seg1.ts", late, s.sign(3, "seg1.ts", late), now); err != nil {
		t.Errorf("public 2h sig rejected: %v", err)
	}
	// url.Values encoding keeps the signature intact through a URL.
	u, _ := url.Parse(s.signedURLScoped(3, "seg1.ts", exp, true))
	if p, err := s.verifyScoped(3, "seg1.ts", exp, u.Query().Get("sig"), now); err != nil || !p {
		t.Errorf("signedURLScoped round trip: private=%v err=%v", p, err)
	}
}
