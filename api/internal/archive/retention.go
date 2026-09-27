package archive

import (
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// Retention windows. A day's frames are all kept for KeepAllDays; after that
// only the day's noon frame survives, and it is dropped after KeepNoonDays.
const (
	KeepAllDays  = 14
	KeepNoonDays = 365
)

// noonMinute is the target the surviving frame is measured against (12:00).
const noonMinute = 12 * 60

// PruneResult reports what one retention pass removed.
type PruneResult struct {
	FramesDeleted int
	DaysDeleted   int
}

// Prune applies retention to the whole tree as of now: days older than
// KeepNoonDays are removed outright; days older than KeepAllDays keep only the
// frame closest to 12:00 local; everything newer is untouched. Empty day and
// camera directories are removed. Errors on one entry are logged and never
// stop the pass.
func (s *Store) Prune(now time.Time) PruneResult {
	var res PruneResult
	today := now.In(Location)
	keepAllFrom := today.AddDate(0, 0, -KeepAllDays).Format(DayLayout)
	keepNoonFrom := today.AddDate(0, 0, -KeepNoonDays).Format(DayLayout)

	cams, err := os.ReadDir(s.Dir)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			slog.Warn("archive prune: read root", "dir", s.Dir, "error", err)
		}
		return res
	}
	for _, cam := range cams {
		if !cam.IsDir() || !idName.MatchString(cam.Name()) {
			continue
		}
		camDir := filepath.Join(s.Dir, cam.Name())
		days, err := os.ReadDir(camDir)
		if err != nil {
			slog.Warn("archive prune: read camera", "dir", camDir, "error", err)
			continue
		}
		for _, day := range days {
			if !day.IsDir() || !dayName.MatchString(day.Name()) {
				continue
			}
			dayDir := filepath.Join(camDir, day.Name())
			switch {
			case day.Name() < keepNoonFrom:
				n, err := removeDay(dayDir)
				res.FramesDeleted += n
				if err != nil {
					slog.Warn("archive prune: remove day", "dir", dayDir, "error", err)
					continue
				}
				res.DaysDeleted++
			case day.Name() < keepAllFrom:
				id, _ := strconv.Atoi(cam.Name())
				names, err := s.frameNames(int32(id), day.Name())
				if err != nil {
					slog.Warn("archive prune: read day", "dir", dayDir, "error", err)
					continue
				}
				keep := NoonFrame(names)
				for _, n := range names {
					if n == keep {
						continue
					}
					if err := os.Remove(filepath.Join(dayDir, n)); err != nil {
						slog.Warn("archive prune: remove frame", "file", n, "dir", dayDir, "error", err)
						continue
					}
					res.FramesDeleted++
				}
				if keep == "" {
					// Nothing to keep: only stray files, or nothing at all.
					if err := os.Remove(dayDir); err == nil {
						res.DaysDeleted++
					}
				}
			}
		}
		// A camera whose archive has been emptied leaves no directory behind
		// (Remove fails harmlessly on a non-empty directory).
		_ = os.Remove(camDir)
	}
	return res
}

// NoonFrame picks, from a day's frame names ("HHMM.jpg"), the one closest to
// 12:00 local. Ties go to the earlier frame. "" when names has no frame.
func NoonFrame(names []string) string {
	best, bestDist := "", -1
	for _, n := range names {
		if !fileName.MatchString(n) {
			continue
		}
		h, _ := strconv.Atoi(n[:2])
		m, _ := strconv.Atoi(n[2:4])
		d := h*60 + m - noonMinute
		if d < 0 {
			d = -d
		}
		if bestDist < 0 || d < bestDist || (d == bestDist && n < best) {
			best, bestDist = n, d
		}
	}
	return best
}

// removeDay deletes a whole day directory, returning how many frames it held.
func removeDay(dir string) (int, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, e := range entries {
		if e.Type().IsRegular() && fileName.MatchString(e.Name()) {
			n++
		}
	}
	return n, os.RemoveAll(dir)
}
