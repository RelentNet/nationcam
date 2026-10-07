// Package archive keeps a per-camera archive of watermarked stills on local
// disk and prunes it on a fixed retention schedule.
//
// Layout: {Dir}/{video_id}/{YYYY-MM-DD}/{HHMM}.jpg, with the day and time in
// America/Chicago. The tree is the only index — listing a camera's days or a
// day's frames is a directory read, so no database table backs it.
//
// ponytail: host-local disk (a Docker volume), same as uploads. Ceiling: one
// host, not backed up, not shared across replicas. Upgrade path: put the same
// layout on object storage behind the same /snapshots URL.
package archive

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // America/Chicago must resolve even on a runtime image without tzdata.
)

const (
	// DayLayout is the directory name of one local day.
	DayLayout = "2006-01-02"
	// FileLayout is the file name of one frame (local time, no separator).
	FileLayout = "1504.jpg"

	// URLPrefix is where the frames are fetched from, as the browser sees it
	// through the web-next /api proxy (same convention as /api/uploads/).
	URLPrefix = "/api/snapshots/"
)

var (
	dayName  = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	fileName = regexp.MustCompile(`^([01]\d|2[0-3])[0-5]\d\.jpg$`)
	idName   = regexp.MustCompile(`^[1-9]\d{0,9}$`)
)

// ErrBadPath is returned for any archive path component that is not exactly
// the shape the archive writes. It makes traversal impossible by construction:
// only "{digits}/{YYYY-MM-DD}/{HHMM}.jpg" ever reaches the filesystem.
var ErrBadPath = errors.New("archive: malformed path")

// Location is the archive's wall clock. Day boundaries, file names and the
// "noon" retention pick all use it.
var Location = mustLoad("America/Chicago")

func mustLoad(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(fmt.Sprintf("archive: load %s: %v", name, err))
	}
	return loc
}

// Frame is one archived still.
type Frame struct {
	// Time is the local capture time, "HH:MM".
	Time string `json:"time"`
	// URL is the public path the browser fetches the JPEG from.
	URL string `json:"url"`
}

// Store is a root directory of archived frames.
type Store struct {
	Dir string
}

// ResolveDir returns a writable archive directory, creating it if needed. It
// uses `configured` (env SNAPSHOTS_DIR, default /app/data/snapshots) when that
// can be created; otherwise ./snapshots for local dev where /app/data does not
// exist. Mirrors handler.ResolveUploadsDir.
func ResolveDir(configured string) string {
	if configured == "" {
		configured = "/app/data/snapshots"
	}
	if err := os.MkdirAll(configured, 0o755); err == nil {
		return configured
	}
	_ = os.MkdirAll("snapshots", 0o755)
	return "snapshots"
}

// Day returns the archive day that t falls in.
func Day(t time.Time) string { return t.In(Location).Format(DayLayout) }

// Today returns the current archive day.
func Today() string { return Day(time.Now()) }

// ParseDay validates a YYYY-MM-DD day string (a real calendar date).
func ParseDay(s string) (string, error) {
	t, err := time.ParseInLocation(DayLayout, s, Location)
	if err != nil || t.Format(DayLayout) != s {
		return "", ErrBadPath
	}
	return s, nil
}

// FramePath is where the still for camera videoID taken at t lives.
func (s *Store) FramePath(videoID int32, t time.Time) string {
	local := t.In(Location)
	return filepath.Join(s.Dir, strconv.Itoa(int(videoID)), local.Format(DayLayout), local.Format(FileLayout))
}

// Write stores a still for videoID at t and returns its path. The write is
// atomic (temp file + rename) so a reader never sees a half-written JPEG.
func (s *Store) Write(videoID int32, t time.Time, jpeg []byte) (string, error) {
	path := s.FramePath(videoID, t)
	if err := WriteAtomic(path, jpeg); err != nil {
		return "", err
	}
	return path, nil
}

// WriteAtomic writes data to path via a temp file in the same directory and a
// rename, creating parent directories as needed.
func WriteAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		_ = os.Remove(tmp.Name())
		return err
	}
	if err := tmp.Close(); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	if err := os.Rename(tmp.Name(), path); err != nil {
		_ = os.Remove(tmp.Name())
		return err
	}
	return nil
}

// ThumbsDir is the per-day directory holding resized copies of that day's
// frames, a sibling of the originals: {day}/thumbs/{HHMM}.w{width}.jpg.
const ThumbsDir = "thumbs"

// ThumbPath is where the width-w copy of the frame at framePath lives.
func ThumbPath(framePath string, w int) string {
	dir, file := filepath.Split(framePath)
	return filepath.Join(dir, ThumbsDir, strings.TrimSuffix(file, ".jpg")+".w"+strconv.Itoa(w)+".jpg")
}

// Days lists the days that hold at least one frame for videoID, newest first.
// A camera with no archive yields an empty (non-nil) slice.
func (s *Store) Days(videoID int32) ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(s.Dir, strconv.Itoa(int(videoID))))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []string{}, nil
		}
		return nil, err
	}
	days := []string{}
	for _, e := range entries {
		if !e.IsDir() || !dayName.MatchString(e.Name()) {
			continue
		}
		names, err := s.frameNames(videoID, e.Name())
		if err != nil || len(names) == 0 {
			continue
		}
		days = append(days, e.Name())
	}
	sort.Sort(sort.Reverse(sort.StringSlice(days)))
	return days, nil
}

// Frames lists the frames for videoID on day, sorted by time. A day with no
// frames yields an empty (non-nil) slice; a malformed day is ErrBadPath.
func (s *Store) Frames(videoID int32, day string) ([]Frame, error) {
	if _, err := ParseDay(day); err != nil {
		return nil, err
	}
	names, err := s.frameNames(videoID, day)
	if err != nil {
		return nil, err
	}
	id := strconv.Itoa(int(videoID))
	frames := make([]Frame, 0, len(names))
	for _, n := range names {
		frames = append(frames, Frame{
			Time: n[:2] + ":" + n[2:4],
			URL:  URLPrefix + id + "/" + day + "/" + n,
		})
	}
	return frames, nil
}

// frameNames returns the sorted frame file names ("HHMM.jpg") for one day,
// ignoring anything that is not a frame (temp files, stray entries).
func (s *Store) frameNames(videoID int32, day string) ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(s.Dir, strconv.Itoa(int(videoID)), day))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []string{}, nil
		}
		return nil, err
	}
	names := []string{}
	for _, e := range entries {
		if e.Type().IsRegular() && fileName.MatchString(e.Name()) {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// Resolve maps a request path "{video_id}/{YYYY-MM-DD}/{HHMM}.jpg" to a file
// under Dir. Every component is matched against the exact shape the archive
// writes, so "..", absolute paths, encoded slashes and anything else is
// ErrBadPath before the filesystem is touched.
func (s *Store) Resolve(rel string) (string, error) {
	parts := strings.Split(rel, "/")
	if len(parts) != 3 {
		return "", ErrBadPath
	}
	id, day, file := parts[0], parts[1], parts[2]
	if !idName.MatchString(id) || !fileName.MatchString(file) {
		return "", ErrBadPath
	}
	if _, err := ParseDay(day); err != nil {
		return "", ErrBadPath
	}
	return filepath.Join(s.Dir, id, day, file), nil
}
