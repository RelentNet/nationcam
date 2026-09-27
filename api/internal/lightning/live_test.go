package lightning

import (
	"context"
	"os"
	"strconv"
	"testing"
	"time"
)

// TestLiveBucket runs the real job against the real NOAA bucket for a few
// ticks. Skipped unless LIGHTNING_LIVE=<ticks> is set — it needs the
// network and takes a minute per tick — so it never runs in the normal
// suite. Useful as proof that listing, fetching and parsing work on live
// data:
//
//	LIGHTNING_LIVE=3 go test ./internal/lightning -run TestLiveBucket -v
func TestLiveBucket(t *testing.T) {
	ticks, _ := strconv.Atoi(os.Getenv("LIGHTNING_LIVE"))
	if ticks <= 0 {
		t.Skip("set LIGHTNING_LIVE=<ticks> to run against the real bucket")
	}

	s3 := NewS3Client(DefaultBucket)
	store := NewStore()
	job := &Job{
		Store: store, Lister: s3, Fetcher: s3,
		// A throwaway site list — never the production database.
		ListSites: func(context.Context) ([]Site, error) {
			return []Site{
				{Slug: "venice-marina", Lat: veniceLat, Lon: veniceLon},
				{Slug: "miami", Lat: 25.7617, Lon: -80.1918},
				{Slug: "houston", Lat: 29.7604, Lon: -95.3698},
				{Slug: "orlando", Lat: 28.5383, Lon: -81.3792},
			}, nil
		},
	}

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(ticks+1)*time.Minute)
	defer cancel()
	for i := 0; i < ticks; i++ {
		now := time.Now()
		res := job.Tick(ctx, now)
		t.Logf("tick %d: prefixes=%v files=%d failed=%d flashes=%d kept=%d buffered=%d newest_age=%v last_key=%s",
			i+1, res.Prefixes, res.Files, res.Failed, res.Flashes, res.Kept, store.Len(), res.NewestAge.Round(time.Second), store.LastKey())
		for _, site := range store.Sites() {
			st := store.Evaluate(site.Lat, site.Lon, now)
			t.Logf("  %-14s %-8s nearest=%v last=%v 10mi=%d 30mi=%d all_clear=%v",
				site.Slug, st.Status, deref(st.NearestMi), derefT(st.LastStrikeAt), st.Strikes10mi30min, st.Strikes30mi30min, derefT(st.AllClearAt))
		}
		if i == 0 && res.Files == 0 {
			t.Fatal("first tick listed no files — bucket layout or listing is wrong")
		}
		if res.Files > 0 && res.Failed == res.Files {
			t.Fatalf("every file failed: %+v", res)
		}
		// If no storm is near the fixed sites right now, drop a probe site on
		// the newest file's first flash so the next tick exercises the keep
		// filter and the policy on real data (a storm lasts longer than a
		// minute, so the following files will have flashes near it too).
		if i == 0 && res.Kept == 0 && store.LastKey() != "" {
			body, err := s3.Fetch(ctx, store.LastKey())
			if err != nil {
				t.Fatalf("probe fetch: %v", err)
			}
			flashes, err := ParseBytes(body)
			if err != nil {
				t.Fatalf("probe parse: %v", err)
			}
			if len(flashes) > 0 {
				probe := Site{Slug: "storm-probe", Lat: flashes[0].Lat, Lon: flashes[0].Lon}
				sites := append(store.Sites(), probe)
				job.ListSites = func(context.Context) ([]Site, error) { return sites, nil }
				job.sitesAt = time.Time{} // force a refresh on the next tick
				t.Logf("  probe site placed at %.3f, %.3f (first flash of %s)", probe.Lat, probe.Lon, store.LastKey())
			}
		}
		if i < ticks-1 {
			select {
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			case <-time.After(time.Minute):
			}
		}
	}
	if store.UpdatedAt().IsZero() {
		t.Fatal("no successful fetch")
	}
}

func deref(f *float64) any {
	if f == nil {
		return nil
	}
	return *f
}

func derefT(t *time.Time) any {
	if t == nil {
		return nil
	}
	return t.UTC().Format(time.RFC3339)
}
