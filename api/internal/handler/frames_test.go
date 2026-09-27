package handler

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/archive"
)

// TestArchiveCapturePipeline runs the real capture path end to end minus the
// database: a fake Restreamer serves a still, SnapshotForSource watermarks it,
// archive.Job files it, and the frames listing + static serving find it.
func TestArchiveCapturePipeline(t *testing.T) {
	// Fake Restreamer: a gray 1280x720 JPEG at /memfs/{id}.jpg.
	frame := image.NewRGBA(image.Rect(0, 0, 1280, 720))
	draw.Draw(frame, frame.Bounds(), image.NewUniform(color.RGBA{128, 128, 128, 255}), image.Point{}, draw.Src)
	var raw bytes.Buffer
	if err := jpeg.Encode(&raw, frame, nil); err != nil {
		t.Fatal(err)
	}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/memfs/cam-a.jpg" {
			w.Header().Set("Content-Type", "image/jpeg")
			_, _ = w.Write(raw.Bytes())
			return
		}
		http.NotFound(w, r)
	}))
	defer upstream.Close()

	client := NewSnapshotClient()
	if _, err := SnapshotForSource(context.Background(), client, "https://example.com/live/x.m3u8"); !errors.Is(err, archive.ErrSkip) {
		t.Errorf("non-memfs source err = %v, want ErrSkip", err)
	}

	store := &archive.Store{Dir: t.TempDir()}
	job := &archive.Job{
		Store: store,
		ListSources: func(context.Context) ([]archive.Source, error) {
			return []archive.Source{
				{VideoID: 1, Src: upstream.URL + "/memfs/cam-a.m3u8"},
				{VideoID: 2, Src: upstream.URL + "/memfs/missing.m3u8"}, // 404 upstream: logged, not fatal
				{VideoID: 3, Src: "https://example.com/plain.mp4"},      // skipped
			}, nil
		},
		Capture: func(ctx context.Context, src string) ([]byte, error) {
			return SnapshotForSource(ctx, client, src)
		},
	}
	// Two ticks 15 minutes apart, 2026-09-25 17:00/17:15 UTC = 12:00/12:15 CDT.
	t1 := time.Date(2026, 9, 25, 17, 0, 0, 0, time.UTC)
	job.CaptureAll(context.Background(), t1)
	job.CaptureAll(context.Background(), t1.Add(15*time.Minute))

	frames, err := store.Frames(1, "2026-09-25")
	if err != nil {
		t.Fatal(err)
	}
	if len(frames) != 2 || frames[0].Time != "12:00" || frames[1].Time != "12:15" ||
		frames[1].URL != "/api/snapshots/1/2026-09-25/1215.jpg" {
		t.Fatalf("frames = %+v", frames)
	}
	if days, _ := store.Days(1); len(days) != 1 || days[0] != "2026-09-25" {
		t.Errorf("days = %v", days)
	}
	for _, id := range []int32{2, 3} {
		if f, _ := store.Frames(id, "2026-09-25"); len(f) != 0 {
			t.Errorf("camera %d should have no frames, got %v", id, f)
		}
	}

	// The served file is a JPEG of the right size with the watermark stamped.
	rec := httptest.NewRecorder()
	ServeSnapshots(store).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/snapshots/1/2026-09-25/1215.jpg", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("serve status = %d", rec.Code)
	}
	out, err := jpeg.Decode(bytes.NewReader(rec.Body.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	if out.Bounds() != frame.Bounds() {
		t.Fatalf("bounds = %v", out.Bounds())
	}
	if r, _, _, _ := out.At(1280-21-5, 720-21-50).RGBA(); r>>8 > 100 {
		t.Errorf("bottom-right not watermarked: red = %d", r>>8)
	}
	r, _, _, _ := out.At(10, 10).RGBA()
	if d := int(r>>8) - 128; d < -4 || d > 4 {
		t.Errorf("top-left changed: red = %d", r>>8)
	}
}

func TestResolveDay(t *testing.T) {
	if got, err := resolveDay(""); err != nil || got != archive.Today() {
		t.Errorf("resolveDay(\"\") = %q, %v; want today", got, err)
	}
	if got, err := resolveDay("2026-09-25"); err != nil || got != "2026-09-25" {
		t.Errorf("resolveDay(valid) = %q, %v", got, err)
	}
	for _, bad := range []string{"2026-9-5", "yesterday", "2026-02-30", "2026-09-25/../x"} {
		if _, err := resolveDay(bad); err == nil {
			t.Errorf("resolveDay(%q) accepted", bad)
		}
	}
}

func TestServeSnapshots(t *testing.T) {
	dir := t.TempDir()
	frame := filepath.Join(dir, "7", "2026-09-25", "1215.jpg")
	if err := os.MkdirAll(filepath.Dir(frame), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(frame, []byte("\xff\xd8jpeg"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A secret outside the tree, and a non-frame inside it, must be unreachable.
	if err := os.WriteFile(filepath.Join(dir, "secret.txt"), []byte("nope"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "7", "2026-09-25", "notes.txt"), []byte("nope"), 0o644); err != nil {
		t.Fatal(err)
	}
	h := ServeSnapshots(&archive.Store{Dir: dir})

	get := func(method, path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
		return rec
	}

	rec := get(http.MethodGet, "/snapshots/7/2026-09-25/1215.jpg")
	if rec.Code != http.StatusOK {
		t.Fatalf("frame status = %d, body %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Errorf("Cache-Control = %q", got)
	}
	if got := rec.Header().Get("Content-Type"); got != "image/jpeg" {
		t.Errorf("Content-Type = %q", got)
	}
	if rec.Body.String() != "\xff\xd8jpeg" {
		t.Errorf("body = %q", rec.Body.String())
	}
	if rec := get(http.MethodHead, "/snapshots/7/2026-09-25/1215.jpg"); rec.Code != http.StatusOK || rec.Body.Len() != 0 {
		t.Errorf("HEAD = %d, %d bytes", rec.Code, rec.Body.Len())
	}
	if rec := get(http.MethodPost, "/snapshots/7/2026-09-25/1215.jpg"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST = %d", rec.Code)
	}

	for _, p := range []string{
		"/snapshots/7/2026-09-25/1216.jpg",         // no such frame
		"/snapshots/8/2026-09-25/1215.jpg",         // no such camera
		"/snapshots/7/2026-09-25/notes.txt",        // not a frame name
		"/snapshots/7/2026-09-25/",                 // directory
		"/snapshots/7/2026-09-25",                  // directory
		"/snapshots/secret.txt",                    // outside the frame shape
		"/snapshots/../secret.txt",                 // traversal
		"/snapshots/7/../secret.txt",               // traversal
		"/snapshots/7/2026-09-25/../../secret.txt", // traversal
		"/snapshots/7/2026-09-25/%2e%2e/1215.jpg",  // encoded traversal
		"/snapshots/7/2026-09-25/1215.jpg/",        // trailing slash
		"/snapshots/07/2026-09-25/1215.jpg",        // not the canonical id
	} {
		if rec := get(http.MethodGet, p); rec.Code != http.StatusNotFound {
			t.Errorf("GET %s = %d, want 404", p, rec.Code)
		}
	}
}
