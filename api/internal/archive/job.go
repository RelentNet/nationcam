package archive

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

// Source is one camera the job captures.
type Source struct {
	VideoID int32
	Src     string
}

// ErrSkip is returned by a Capture func for cameras that have no still to
// archive (e.g. a source that is not a Restreamer HLS stream). It is counted
// but not logged as a failure.
var ErrSkip = errors.New("archive: no snapshot for this source")

// Job captures one still per active camera on a fixed cadence and prunes the
// archive hourly. Zero values fall back to the production defaults.
type Job struct {
	Store *Store

	// ListSources returns the cameras to capture (active videos).
	ListSources func(ctx context.Context) ([]Source, error)
	// Capture returns the watermarked JPEG for one camera source.
	Capture func(ctx context.Context, src string) ([]byte, error)

	// Interval between captures; ticks are aligned to multiples of it
	// (15 minutes → :00/:15/:30/:45). Default 15m.
	Interval time.Duration
	// Concurrency bounds in-flight captures. Default 4.
	Concurrency int
	// Timeout bounds one camera's capture. Default 20s.
	Timeout time.Duration
	// PruneInterval is how often retention runs. Default 1h.
	PruneInterval time.Duration
}

func (j *Job) defaults() {
	if j.Interval <= 0 {
		j.Interval = 15 * time.Minute
	}
	if j.Concurrency <= 0 {
		j.Concurrency = 4
	}
	if j.Timeout <= 0 {
		j.Timeout = 20 * time.Second
	}
	if j.PruneInterval <= 0 {
		j.PruneInterval = time.Hour
	}
}

// Run blocks until ctx is cancelled, capturing on every aligned tick and
// pruning on every PruneInterval. Returning means every in-flight capture has
// finished, so the caller can wait on it for a clean shutdown.
func (j *Job) Run(ctx context.Context) {
	j.defaults()
	slog.Info("snapshot archive started",
		"dir", j.Store.Dir, "interval", j.Interval.String(), "concurrency", j.Concurrency)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		j.captureLoop(ctx)
	}()
	go func() {
		defer wg.Done()
		j.pruneLoop(ctx)
	}()
	wg.Wait()
	slog.Info("snapshot archive stopped")
}

func (j *Job) captureLoop(ctx context.Context) {
	for {
		tick := NextTick(time.Now(), j.Interval)
		if !sleepUntil(ctx, tick) {
			return
		}
		j.CaptureAll(ctx, tick)
	}
}

func (j *Job) pruneLoop(ctx context.Context) {
	// Prune once shortly after boot so a long-stopped instance catches up, then
	// on the hourly cadence.
	timer := time.NewTimer(time.Minute)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		res := j.Store.Prune(time.Now())
		slog.Info("snapshot archive pruned", "frames_deleted", res.FramesDeleted, "days_deleted", res.DaysDeleted)
		timer.Reset(j.PruneInterval)
	}
}

// NextTick is the first multiple of interval strictly after now. Because
// Chicago's UTC offset is a whole number of hours, aligning on absolute time
// aligns on the local quarter-hour too.
func NextTick(now time.Time, interval time.Duration) time.Time {
	return now.Truncate(interval).Add(interval)
}

// sleepUntil waits for t; false if ctx ended first.
func sleepUntil(ctx context.Context, t time.Time) bool {
	timer := time.NewTimer(time.Until(t))
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

// CaptureAll takes one still per source and files each under `at`. One camera
// failing is logged and never stops the rest; at most Concurrency captures run
// at once and each is bounded by Timeout.
func (j *Job) CaptureAll(ctx context.Context, at time.Time) {
	j.defaults()
	sources, err := j.ListSources(ctx)
	if err != nil {
		slog.Warn("snapshot archive: list sources", "error", err)
		return
	}

	var (
		wg               sync.WaitGroup
		sem              = make(chan struct{}, j.Concurrency)
		mu               sync.Mutex
		ok, bad, skipped int
	)
	for _, s := range sources {
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		go func(s Source) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			err := j.captureOne(ctx, s, at)
			mu.Lock()
			defer mu.Unlock()
			switch {
			case err == nil:
				ok++
			case errors.Is(err, ErrSkip):
				skipped++
			default:
				bad++
				slog.Warn("snapshot archive: capture failed", "video_id", s.VideoID, "error", err)
			}
		}(s)
	}
	wg.Wait()
	slog.Info("snapshot archive tick",
		"at", at.In(Location).Format("2006-01-02 15:04"), "ok", ok, "failed", bad, "skipped", skipped)
}

func (j *Job) captureOne(ctx context.Context, s Source, at time.Time) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	ctx, cancel := context.WithTimeout(ctx, j.Timeout)
	defer cancel()
	jpeg, err := j.Capture(ctx, s.Src)
	if err != nil {
		return err
	}
	_, err = j.Store.Write(s.VideoID, at, jpeg)
	return err
}
