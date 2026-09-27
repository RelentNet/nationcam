package archive

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

// touch creates an empty frame file at {dir}/{video}/{day}/{file}.
func touch(t *testing.T, dir, video, day, file string) {
	t.Helper()
	p := filepath.Join(dir, video, day, file)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte("jpeg"), 0o644); err != nil {
		t.Fatal(err)
	}
}

// tree lists every regular file under dir as "video/day/file", sorted.
func tree(t *testing.T, dir string) []string {
	t.Helper()
	var out []string
	err := filepath.WalkDir(dir, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.Type().IsRegular() {
			rel, _ := filepath.Rel(dir, p)
			out = append(out, filepath.ToSlash(rel))
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(out)
	return out
}

func TestNoonFrame(t *testing.T) {
	for name, tc := range map[string]struct {
		names []string
		want  string
	}{
		"exact noon":        {[]string{"0900.jpg", "1200.jpg", "1500.jpg"}, "1200.jpg"},
		"nearest below":     {[]string{"0000.jpg", "1145.jpg", "1230.jpg"}, "1145.jpg"},
		"nearest above":     {[]string{"0600.jpg", "1215.jpg", "2345.jpg"}, "1215.jpg"},
		"tie goes earlier":  {[]string{"1130.jpg", "1230.jpg"}, "1130.jpg"},
		"single frame":      {[]string{"2359.jpg"}, "2359.jpg"},
		"ignores non-frame": {[]string{".tmp-123", "notes.txt", "0700.jpg"}, "0700.jpg"},
		"empty":             {nil, ""},
	} {
		if got := NoonFrame(tc.names); got != tc.want {
			t.Errorf("%s: NoonFrame = %q, want %q", name, got, tc.want)
		}
	}
}

func TestPrune(t *testing.T) {
	dir := t.TempDir()
	s := &Store{Dir: dir}
	now := time.Date(2026, 9, 26, 10, 0, 0, 0, Location)
	day := func(ago int) string { return now.AddDate(0, 0, -ago).Format(DayLayout) }

	// Fresh (all kept).
	touch(t, dir, "1", day(0), "0900.jpg")
	touch(t, dir, "1", day(0), "1200.jpg")
	touch(t, dir, "1", day(13), "0100.jpg")
	touch(t, dir, "1", day(13), "2300.jpg")
	touch(t, dir, "1", day(14), "0100.jpg") // exactly 14 days: still inside the window.
	touch(t, dir, "1", day(14), "2300.jpg")
	// Older than 14 days: only the noon-closest frame survives.
	touch(t, dir, "1", day(15), "0000.jpg")
	touch(t, dir, "1", day(15), "1145.jpg")
	touch(t, dir, "1", day(15), "1230.jpg")
	touch(t, dir, "1", day(15), "2345.jpg")
	touch(t, dir, "2", day(100), "0800.jpg")
	touch(t, dir, "2", day(100), "1600.jpg")
	touch(t, dir, "2", day(365), "1200.jpg") // exactly 365 days: kept.
	// Older than 365 days: gone entirely.
	touch(t, dir, "2", day(366), "1200.jpg")
	touch(t, dir, "3", day(400), "1200.jpg")
	touch(t, dir, "3", day(400), "1300.jpg")
	// Junk that is never touched.
	touch(t, dir, "1", day(15), ".tmp-abc")
	touch(t, dir, "notacam", day(400), "1200.jpg")

	res := s.Prune(now)

	want := []string{
		"1/" + day(0) + "/0900.jpg",
		"1/" + day(0) + "/1200.jpg",
		"1/" + day(13) + "/0100.jpg",
		"1/" + day(13) + "/2300.jpg",
		"1/" + day(14) + "/0100.jpg",
		"1/" + day(14) + "/2300.jpg",
		"1/" + day(15) + "/.tmp-abc",
		"1/" + day(15) + "/1145.jpg",
		"2/" + day(100) + "/0800.jpg",
		"2/" + day(365) + "/1200.jpg",
		"notacam/" + day(400) + "/1200.jpg",
	}
	sort.Strings(want)
	if got := tree(t, dir); !reflect.DeepEqual(got, want) {
		t.Errorf("survivors:\n got %v\nwant %v", got, want)
	}
	if res.FramesDeleted != 3+1+1+2 || res.DaysDeleted != 2 {
		t.Errorf("result = %+v, want 7 frames / 2 days", res)
	}
	if _, err := os.Stat(filepath.Join(dir, "3")); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("emptied camera dir 3 should be removed, stat err = %v", err)
	}
	// A second pass is a no-op.
	if res := s.Prune(now); res.FramesDeleted != 0 || res.DaysDeleted != 0 {
		t.Errorf("second prune removed %+v", res)
	}
}

func TestPruneMissingRoot(t *testing.T) {
	s := &Store{Dir: filepath.Join(t.TempDir(), "nope")}
	if res := s.Prune(time.Now()); res != (PruneResult{}) {
		t.Errorf("prune of missing root = %+v", res)
	}
}

func TestFramesAndDays(t *testing.T) {
	dir := t.TempDir()
	s := &Store{Dir: dir}
	touch(t, dir, "7", "2026-09-25", "1500.jpg")
	touch(t, dir, "7", "2026-09-25", "0015.jpg")
	touch(t, dir, "7", "2026-09-25", ".tmp-partial")
	touch(t, dir, "7", "2026-09-25", "2500.jpg") // not a valid clock
	touch(t, dir, "7", "2026-09-26", "1200.jpg")
	touch(t, dir, "7", "2026-09-20", "1200.jpg")
	touch(t, dir, "7", "junk", "1200.jpg")
	if err := os.MkdirAll(filepath.Join(dir, "7", "2026-09-01"), 0o755); err != nil { // empty day
		t.Fatal(err)
	}

	frames, err := s.Frames(7, "2026-09-25")
	if err != nil {
		t.Fatal(err)
	}
	want := []Frame{
		{Time: "00:15", URL: "/api/snapshots/7/2026-09-25/0015.jpg"},
		{Time: "15:00", URL: "/api/snapshots/7/2026-09-25/1500.jpg"},
	}
	if !reflect.DeepEqual(frames, want) {
		t.Errorf("frames = %+v, want %+v", frames, want)
	}

	days, err := s.Days(7)
	if err != nil {
		t.Fatal(err)
	}
	if wantDays := []string{"2026-09-26", "2026-09-25", "2026-09-20"}; !reflect.DeepEqual(days, wantDays) {
		t.Errorf("days = %v, want %v", days, wantDays)
	}

	// Empty, not nil, for a day and a camera with nothing.
	if f, err := s.Frames(7, "2026-01-01"); err != nil || f == nil || len(f) != 0 {
		t.Errorf("empty day = %v, %v", f, err)
	}
	if d, err := s.Days(99); err != nil || d == nil || len(d) != 0 {
		t.Errorf("unknown camera days = %v, %v", d, err)
	}
	if _, err := s.Frames(7, "2026-13-01"); !errors.Is(err, ErrBadPath) {
		t.Errorf("bad day err = %v", err)
	}
}

func TestParseDay(t *testing.T) {
	for in, ok := range map[string]bool{
		"2026-09-26": true, "2024-02-29": true,
		"2026-9-26": false, "2026-02-30": false, "2026-09-26T00": false, "": false, "../x": false,
	} {
		_, err := ParseDay(in)
		if (err == nil) != ok {
			t.Errorf("ParseDay(%q) err = %v, want ok=%v", in, err, ok)
		}
	}
}

func TestResolve(t *testing.T) {
	s := &Store{Dir: filepath.Join("root")}
	good, err := s.Resolve("12/2026-09-26/1215.jpg")
	if err != nil || good != filepath.Join("root", "12", "2026-09-26", "1215.jpg") {
		t.Errorf("Resolve good = %q, %v", good, err)
	}
	for _, bad := range []string{
		"", "12", "12/2026-09-26", "12/2026-09-26/1215.jpg/x",
		"../2026-09-26/1215.jpg", "12/../1215.jpg", "12/2026-09-26/../1215.jpg",
		"12/2026-09-26/..jpg", "12/2026-09-26/1215.png", "12/2026-09-26/2460.jpg",
		"0/2026-09-26/1215.jpg", "-1/2026-09-26/1215.jpg", "a/2026-09-26/1215.jpg",
		"12/2026-13-01/1215.jpg", "/12/2026-09-26/1215.jpg", "12\\2026-09-26\\1215.jpg",
		"12/2026-09-26/1215.jpg\x00",
	} {
		if _, err := s.Resolve(bad); !errors.Is(err, ErrBadPath) {
			t.Errorf("Resolve(%q) err = %v, want ErrBadPath", bad, err)
		}
	}
}

func TestWriteAndFramePath(t *testing.T) {
	s := &Store{Dir: t.TempDir()}
	// 2026-09-26 17:15 UTC is 12:15 CDT.
	at := time.Date(2026, 9, 26, 17, 15, 0, 0, time.UTC)
	p, err := s.Write(3, at, []byte("jpeg"))
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(s.Dir, "3", "2026-09-26", "1215.jpg"); p != want {
		t.Errorf("path = %q, want %q", p, want)
	}
	// Day boundary: 2026-01-10 05:30 UTC is 23:30 CST on Jan 9.
	if got := s.FramePath(3, time.Date(2026, 1, 10, 5, 30, 0, 0, time.UTC)); !strings.HasSuffix(filepath.ToSlash(got), "/3/2026-01-09/2330.jpg") {
		t.Errorf("winter path = %q", got)
	}
	if got := tree(t, s.Dir); !reflect.DeepEqual(got, []string{"3/2026-09-26/1215.jpg"}) {
		t.Errorf("tree = %v (no temp files should remain)", got)
	}
}

func TestNextTick(t *testing.T) {
	for in, want := range map[string]string{
		"2026-09-26T10:00:00Z": "2026-09-26T10:15:00Z",
		"2026-09-26T10:14:59Z": "2026-09-26T10:15:00Z",
		"2026-09-26T10:15:00Z": "2026-09-26T10:30:00Z",
		"2026-09-26T23:52:00Z": "2026-09-27T00:00:00Z",
	} {
		now, _ := time.Parse(time.RFC3339, in)
		if got := NextTick(now, 15*time.Minute).UTC().Format(time.RFC3339); got != want {
			t.Errorf("NextTick(%s) = %s, want %s", in, got, want)
		}
	}
}

func TestCaptureAllIsolatesFailures(t *testing.T) {
	s := &Store{Dir: t.TempDir()}
	j := &Job{
		Store: s,
		ListSources: func(context.Context) ([]Source, error) {
			return []Source{{1, "ok"}, {2, "fail"}, {3, "skip"}, {4, "ok"}}, nil
		},
		Capture: func(_ context.Context, src string) ([]byte, error) {
			switch src {
			case "fail":
				return nil, errors.New("boom")
			case "skip":
				return nil, ErrSkip
			}
			return []byte("jpeg"), nil
		},
		Concurrency: 2,
	}
	at := time.Date(2026, 9, 26, 17, 30, 0, 0, time.UTC)
	j.CaptureAll(context.Background(), at)
	want := []string{"1/2026-09-26/1230.jpg", "4/2026-09-26/1230.jpg"}
	if got := tree(t, s.Dir); !reflect.DeepEqual(got, want) {
		t.Errorf("tree = %v, want %v", got, want)
	}
}

func TestRunStopsOnCancel(t *testing.T) {
	j := &Job{
		Store:       &Store{Dir: t.TempDir()},
		ListSources: func(context.Context) ([]Source, error) { return nil, nil },
		Capture:     func(context.Context, string) ([]byte, error) { return nil, ErrSkip },
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { j.Run(ctx); close(done) }()
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run did not return after cancel")
	}
}
