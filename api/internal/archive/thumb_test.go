package archive

import (
	"path/filepath"
	"reflect"
	"sort"
	"testing"
	"time"
)

func TestPruneRemovesThumbs(t *testing.T) {
	dir := t.TempDir()
	s := &Store{Dir: dir}
	now := time.Date(2026, 9, 26, 10, 0, 0, 0, Location)
	day := func(ago int) string { return now.AddDate(0, 0, -ago).Format(DayLayout) }

	touch(t, dir, "1", day(0), "0900.jpg")
	touch(t, dir, "1", day(0), "thumbs/0900.w320.jpg") // fresh: kept
	touch(t, dir, "1", day(15), "0000.jpg")
	touch(t, dir, "1", day(15), "1145.jpg")
	touch(t, dir, "1", day(15), "thumbs/0000.w320.jpg") // frame deleted: thumbs go too
	touch(t, dir, "1", day(15), "thumbs/0000.w640.jpg")
	touch(t, dir, "1", day(15), "thumbs/1145.w320.jpg") // noon frame survives with its thumb
	touch(t, dir, "2", day(400), "1200.jpg")
	touch(t, dir, "2", day(400), "thumbs/1200.w640.jpg") // whole day removed

	s.Prune(now)

	want := []string{
		"1/" + day(0) + "/0900.jpg",
		"1/" + day(0) + "/thumbs/0900.w320.jpg",
		"1/" + day(15) + "/1145.jpg",
		"1/" + day(15) + "/thumbs/1145.w320.jpg",
	}
	sort.Strings(want)
	if got := tree(t, dir); !reflect.DeepEqual(got, want) {
		t.Errorf("survivors:\n got %v\nwant %v", got, want)
	}
}

func TestThumbPath(t *testing.T) {
	got := ThumbPath(filepath.Join("d", "7", "2026-09-25", "1215.jpg"), 320)
	want := filepath.Join("d", "7", "2026-09-25", "thumbs", "1215.w320.jpg")
	if got != want {
		t.Errorf("ThumbPath = %q, want %q", got, want)
	}
}
