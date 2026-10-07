package handler

import (
	"bytes"
	"context"
	"github.com/go-chi/chi/v5"
	"image"
	"image/color"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/brandon-relentnet/nationcam/api/internal/archive"
)

// gradientJPEG makes a w x h JPEG: left half red, right half blue.
func gradientJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := color.RGBA{220, 20, 20, 255}
			if x >= w/2 {
				c = color.RGBA{20, 20, 220, 255}
			}
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func decodeSize(t *testing.T, b []byte) image.Point {
	t.Helper()
	img, err := jpeg.Decode(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	return img.Bounds().Size()
}

func TestResizeJPEG(t *testing.T) {
	src := gradientJPEG(t, 1920, 1080)
	for _, w := range []int{320, 640} {
		out, err := resizeJPEG(src, w)
		if err != nil {
			t.Fatal(err)
		}
		got := decodeSize(t, out)
		wantH := 1080 * w / 1920
		if got.X != w || got.Y != wantH {
			t.Errorf("w=%d: size = %v, want %dx%d", w, got, w, wantH)
		}
		if len(out) >= len(src) {
			t.Errorf("w=%d: %d bytes, not smaller than original %d", w, len(out), len(src))
		}
		img, _ := jpeg.Decode(bytes.NewReader(out))
		r, _, b, _ := img.At(w/4, got.Y/2).RGBA()
		if r>>8 < 150 || b>>8 > 100 {
			t.Errorf("w=%d: left half should stay red, got r=%d b=%d", w, r>>8, b>>8)
		}
	}
	// Never upscaled.
	small := gradientJPEG(t, 200, 100)
	out, err := resizeJPEG(small, 320)
	if err != nil {
		t.Fatal(err)
	}
	if got := decodeSize(t, out); got.X != 200 || got.Y != 100 {
		t.Errorf("small image size = %v, want unchanged 200x100", got)
	}
}

func TestParseThumbWidth(t *testing.T) {
	for q, want := range map[string]struct {
		w  int
		ok bool
	}{
		"":         {0, true},
		"?w=320":   {320, true},
		"?w=640":   {640, true},
		"?w=480":   {0, false},
		"?w=0":     {0, false},
		"?w=":      {0, false},
		"?w=abc":   {0, false},
		"?w=-320":  {0, false},
		"?w=320.5": {0, false},
	} {
		r := httptest.NewRequest(http.MethodGet, "/x"+q, nil)
		if w, ok := parseThumbWidth(r); w != want.w || ok != want.ok {
			t.Errorf("%q: got (%d, %v), want (%d, %v)", q, w, ok, want.w, want.ok)
		}
	}
}

func TestServeSnapshotsThumbs(t *testing.T) {
	dir := t.TempDir()
	orig := gradientJPEG(t, 1280, 720)
	frame := filepath.Join(dir, "7", "2026-09-25", "1215.jpg")
	if err := os.MkdirAll(filepath.Dir(frame), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(frame, orig, 0o644); err != nil {
		t.Fatal(err)
	}
	h := ServeSnapshots(&archive.Store{Dir: dir})
	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec
	}

	for _, w := range []string{"320", "640"} {
		rec := get("/snapshots/7/2026-09-25/1215.jpg?w=" + w)
		if rec.Code != http.StatusOK {
			t.Fatalf("w=%s status = %d", w, rec.Code)
		}
		if got := rec.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
			t.Errorf("w=%s Cache-Control = %q", w, got)
		}
		if got := rec.Header().Get("Content-Type"); got != "image/jpeg" {
			t.Errorf("w=%s Content-Type = %q", w, got)
		}
		size := decodeSize(t, rec.Body.Bytes())
		if size.Y*16 != size.X*9 && size.X != 320 && size.X != 640 {
			t.Errorf("w=%s size = %v", w, size)
		}
		want := 320
		if w == "640" {
			want = 640
		}
		if size.X != want || size.Y != want*720/1280 {
			t.Errorf("w=%s size = %v, want %dx%d", w, size, want, want*720/1280)
		}
		cached := filepath.Join(dir, "7", "2026-09-25", "thumbs", "1215.w"+w+".jpg")
		if _, err := os.Stat(cached); err != nil {
			t.Errorf("w=%s thumb not cached on disk: %v", w, err)
		}
	}
	// Original untouched.
	if got, _ := os.ReadFile(frame); !bytes.Equal(got, orig) {
		t.Error("original frame was modified")
	}
	// Second request is served from the cached file with the same header.
	if rec := get("/snapshots/7/2026-09-25/1215.jpg?w=320"); rec.Code != http.StatusOK ||
		rec.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" {
		t.Errorf("cached thumb = %d %q", rec.Code, rec.Header().Get("Cache-Control"))
	}
	// No w: full size, unchanged.
	if rec := get("/snapshots/7/2026-09-25/1215.jpg"); !bytes.Equal(rec.Body.Bytes(), orig) {
		t.Error("no ?w= should serve the original bytes")
	}
	// Bad widths are 400; missing frame with a good width is 404; traversal stays 404.
	for _, w := range []string{"0", "100", "1920", "abc", ""} {
		if rec := get("/snapshots/7/2026-09-25/1215.jpg?w=" + w); rec.Code != http.StatusBadRequest {
			t.Errorf("w=%q status = %d, want 400", w, rec.Code)
		}
	}
	for _, p := range []string{
		"/snapshots/7/2026-09-25/1216.jpg?w=320",
		"/snapshots/7/2026-09-25/thumbs/1215.w320.jpg",
		"/snapshots/7/2026-09-25/thumbs/1215.w320.jpg?w=320",
		"/snapshots/../secret.txt?w=320",
		"/snapshots/7/2026-09-25/../../secret.txt?w=640",
	} {
		if rec := get(p); rec.Code != http.StatusNotFound {
			t.Errorf("%s status = %d, want 404", p, rec.Code)
		}
	}
}

func TestCameraSnapshotThumbFromCache(t *testing.T) {
	c := newTestCache(t)
	full := gradientJPEG(t, 1920, 1080)
	key := "videos:snapshot:a:b:c"
	if err := c.Set(context.Background(), key, string(full), snapshotTTL); err != nil {
		t.Fatal(err)
	}
	// The full still is already cached, so the nil pool is never reached.
	h := CameraSnapshot(nil, c)
	get := func(q string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/videos/a/b/c/snapshot.jpg"+q, nil)
		rctx := chi.NewRouteContext()
		rctx.URLParams.Add("stateSlug", "a")
		rctx.URLParams.Add("sublocationSlug", "b")
		rctx.URLParams.Add("slug", "c")
		req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
		h.ServeHTTP(rec, req)
		return rec
	}
	for _, w := range []int{320, 640} {
		rec := get("?w=" + strconv.Itoa(w))
		if rec.Code != http.StatusOK {
			t.Fatalf("w=%d status = %d", w, rec.Code)
		}
		if got := decodeSize(t, rec.Body.Bytes()); got.X != w || got.Y != w*1080/1920 {
			t.Errorf("w=%d size = %v", w, got)
		}
		if got := rec.Header().Get("Cache-Control"); got != "public, max-age=60" {
			t.Errorf("w=%d Cache-Control = %q", w, got)
		}
		if v, _ := c.Get(context.Background(), key+":w"+strconv.Itoa(w)); v == "" {
			t.Errorf("w=%d thumb not cached under its own key", w)
		}
	}
	if rec := get(""); !bytes.Equal(rec.Body.Bytes(), full) {
		t.Error("no ?w= should serve the full-size still unchanged")
	}
}

func TestCameraSnapshotRejectsBadWidth(t *testing.T) {
	// The width is checked before the database or cache is touched.
	h := CameraSnapshot(nil, nil)
	for _, w := range []string{"100", "0", "abc", "1280"} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/videos/a/b/c/snapshot.jpg?w="+w, nil))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("w=%s status = %d, want 400", w, rec.Code)
		}
	}
}
