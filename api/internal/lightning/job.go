package lightning

import (
	"context"
	"log/slog"
	"sort"
	"sync"
	"time"
)

// Job keeps a Store current from the GLM bucket: every Interval it lists the
// hour prefixes PrefixesToList picks, fetches every file newer than the last
// processed key with bounded concurrency, parses it, files the flashes, and
// mirrors the store. Zero values fall back to the production defaults.
//
// Failure policy: one prefix or file failing is one warn line and never
// stops the rest of the tick; nothing here can crash the server.
type Job struct {
	Store   *Store
	Lister  Lister
	Fetcher Fetcher

	// ListSites returns every sublocation with coordinates. Refreshed every
	// SitesInterval, and on every tick until it first succeeds with a
	// non-empty list (an empty site list keeps nothing).
	ListSites func(ctx context.Context) ([]Site, error)

	// Mirror is written after every tick and may be nil (no persistence).
	Mirror Mirror

	// Interval between ticks; ticks are aligned to multiples of it. Default 60s.
	Interval time.Duration
	// Concurrency bounds in-flight fetches. Default 4.
	Concurrency int
	// Timeout bounds one listing or fetch request. Default 15s.
	Timeout time.Duration
	// SitesInterval is how often ListSites is re-run. Default 10m.
	SitesInterval time.Duration

	// Now is the clock; tests inject it. Default time.Now.
	Now func() time.Time

	sitesAt time.Time
}

// TickResult is what one tick did, for the info line and for tests.
type TickResult struct {
	// Prefixes listed.
	Prefixes []string
	// Files is how many new keys the listings produced; Failed how many of
	// those could not be fetched or parsed.
	Files, Failed int
	// Flashes parsed (all quality-good flashes in every fetched file); Kept
	// is how many of those were near a site and entered the store.
	Flashes, Kept int
	// NewestAge is now minus the observation-window end of the newest file
	// processed this tick — the feed's latency; zero if no file succeeded.
	NewestAge time.Duration
}

func (j *Job) defaults() {
	if j.Interval <= 0 {
		j.Interval = time.Minute
	}
	if j.Concurrency <= 0 {
		j.Concurrency = 4
	}
	if j.Timeout <= 0 {
		j.Timeout = 15 * time.Second
	}
	if j.SitesInterval <= 0 {
		j.SitesInterval = 10 * time.Minute
	}
	if j.Now == nil {
		j.Now = time.Now
	}
}

// Run ticks once immediately (so the status is live seconds after boot, not
// a minute later), then on every aligned Interval until ctx is cancelled.
// Returning means every in-flight fetch has finished.
func (j *Job) Run(ctx context.Context) {
	j.defaults()
	slog.Info("lightning job started", "interval", j.Interval.String(), "concurrency", j.Concurrency)
	j.Tick(ctx, j.Now())
	for {
		next := j.Now().Truncate(j.Interval).Add(j.Interval)
		timer := time.NewTimer(time.Until(next))
		select {
		case <-ctx.Done():
			timer.Stop()
			slog.Info("lightning job stopped")
			return
		case <-timer.C:
		}
		j.Tick(ctx, j.Now())
	}
}

// Tick does one round of list → fetch → parse → store → mirror at `now`.
func (j *Job) Tick(ctx context.Context, now time.Time) TickResult {
	j.defaults()
	j.refreshSites(ctx, now)

	res := TickResult{Prefixes: PrefixesToList(now, j.Store.LastKey())}
	if ctx.Err() != nil {
		return res
	}

	keys := j.listNew(ctx, now, res.Prefixes)
	res.Files = len(keys)

	type outcome struct {
		key     string
		flashes []Flash
		err     error
	}
	outcomes := make([]outcome, len(keys))
	var wg sync.WaitGroup
	sem := make(chan struct{}, j.Concurrency)
	for i, key := range keys {
		if ctx.Err() != nil {
			outcomes[i] = outcome{key: key, err: ctx.Err()}
			continue
		}
		wg.Add(1)
		go func(i int, key string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			flashes, err := j.fetchOne(ctx, key)
			outcomes[i] = outcome{key: key, flashes: flashes, err: err}
		}(i, key)
	}
	wg.Wait()

	newestKey := ""
	for _, o := range outcomes {
		if o.err != nil {
			res.Failed++
			slog.Warn("lightning: file skipped", "key", o.key, "error", o.err)
			continue
		}
		res.Flashes += len(o.flashes)
		res.Kept += j.Store.Add(o.flashes, now)
		if o.key > newestKey {
			newestKey = o.key
		}
	}
	if newestKey != "" {
		j.Store.SetLastKey(newestKey)
		j.Store.MarkFetched(now)
		if _, end, ok := KeyTimes(newestKey); ok {
			res.NewestAge = now.Sub(end)
		}
	}
	j.Store.Prune(now)

	if j.Mirror != nil {
		if err := j.Store.Save(ctx, j.Mirror, now); err != nil {
			slog.Warn("lightning: mirror save failed", "error", err)
		}
	}

	slog.Info("lightning tick",
		"files", res.Files, "failed", res.Failed, "flashes", res.Flashes, "kept", res.Kept,
		"buffered", j.Store.Len(), "newest_age", res.NewestAge.Round(time.Second).String(),
		"prefixes", len(res.Prefixes))
	return res
}

// refreshSites re-runs ListSites when due. A failure keeps the previous list
// (one warn line) and retries next tick.
func (j *Job) refreshSites(ctx context.Context, now time.Time) {
	if j.ListSites == nil {
		return
	}
	due := j.sitesAt.IsZero() || now.Sub(j.sitesAt) >= j.SitesInterval || len(j.Store.Sites()) == 0
	if !due {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, j.Timeout)
	defer cancel()
	sites, err := j.ListSites(ctx)
	if err != nil {
		slog.Warn("lightning: list sites failed", "error", err)
		return
	}
	j.Store.SetSites(sites)
	j.sitesAt = now
}

// listNew lists each prefix and returns, sorted, every key newer than the
// store's last key whose observation window ends inside Retention. One
// prefix failing is one warn line; the others still count.
func (j *Job) listNew(ctx context.Context, now time.Time, prefixes []string) []string {
	lastKey := j.Store.LastKey()
	floor := now.Add(-Retention)
	var keys []string
	for _, prefix := range prefixes {
		lctx, cancel := context.WithTimeout(ctx, j.Timeout)
		objs, err := j.Lister.List(lctx, prefix)
		cancel()
		if err != nil {
			slog.Warn("lightning: list failed", "prefix", prefix, "error", err)
			continue
		}
		for _, o := range objs {
			if o.Key <= lastKey {
				continue
			}
			_, end, ok := KeyTimes(o.Key)
			if !ok || !end.After(floor) {
				continue
			}
			keys = append(keys, o.Key)
		}
	}
	sort.Strings(keys)
	return keys
}

func (j *Job) fetchOne(ctx context.Context, key string) ([]Flash, error) {
	ctx, cancel := context.WithTimeout(ctx, j.Timeout)
	defer cancel()
	body, err := j.Fetcher.Fetch(ctx, key)
	if err != nil {
		return nil, err
	}
	return ParseBytes(body)
}
