package lightning

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// fakeBucket is an in-memory Lister + Fetcher.
type fakeBucket struct {
	mu       sync.Mutex
	objects  map[string][]Object // prefix → listing
	files    map[string][]byte   // key → body
	failKeys map[string]bool     // keys whose fetch errors
	failList bool
	listed   []string
	fetched  []string
}

func newFakeBucket() *fakeBucket {
	return &fakeBucket{objects: map[string][]Object{}, files: map[string][]byte{}, failKeys: map[string]bool{}}
}

func (b *fakeBucket) put(key string, body []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	prefix := HourPrefix(mustStart(key))
	b.objects[prefix] = append(b.objects[prefix], Object{Key: key, Size: int64(len(body))})
	b.files[key] = body
}

func mustStart(key string) time.Time {
	s, _, ok := KeyTimes(key)
	if !ok {
		panic("bad key " + key)
	}
	return s
}

func (b *fakeBucket) List(_ context.Context, prefix string) ([]Object, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.listed = append(b.listed, prefix)
	if b.failList {
		return nil, errors.New("s3 down")
	}
	return append([]Object(nil), b.objects[prefix]...), nil
}

func (b *fakeBucket) Fetch(ctx context.Context, key string) ([]byte, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.fetched = append(b.fetched, key)
	if b.failKeys[key] {
		return nil, errors.New("fetch failed")
	}
	body, ok := b.files[key]
	if !ok {
		return nil, errors.New("no such key")
	}
	return body, nil
}

func TestJobTick(t *testing.T) {
	body := fixtureBytes(t)
	flashes, err := ParseBytes(body)
	if err != nil || len(flashes) == 0 {
		t.Fatalf("fixture parse: %d, %v", len(flashes), err)
	}
	// One site right where the fixture's first flash was, so at least that
	// flash is kept.
	site := Site{Slug: "storm", Lat: flashes[0].Lat, Lon: flashes[0].Lon}

	// The fixture is the 17:01:40–17:02:00 window; a second "file" for the
	// next window reuses its bytes but fails to fetch on the first tick.
	keyOK := fixtureKey
	keyBad := keyAt(utc(17, 2, 0))
	bucket := newFakeBucket()
	bucket.put(keyOK, body)
	bucket.put(keyBad, body)
	bucket.failKeys[keyBad] = true

	store := NewStore()
	mirror := newFakeMirror()
	var sitesCalls int
	job := &Job{
		Store: store, Lister: bucket, Fetcher: bucket, Mirror: mirror,
		ListSites: func(context.Context) ([]Site, error) {
			sitesCalls++
			return []Site{site}, nil
		},
	}

	// Tick 1, cold start at 17:03: lists the whole retention window (hours
	// 16 and 17), fetches both files, one fails.
	now := utc(17, 3, 0)
	res := job.Tick(context.Background(), now)
	if len(res.Prefixes) != 2 || res.Prefixes[0] != "GLM-L2-LCFA/2026/270/16/" {
		t.Fatalf("prefixes = %v", res.Prefixes)
	}
	if res.Files != 2 || res.Failed != 1 {
		t.Fatalf("files/failed = %d/%d, want 2/1", res.Files, res.Failed)
	}
	if res.Flashes != len(flashes) || res.Kept < 1 || res.Kept > len(flashes) {
		t.Fatalf("flashes/kept = %d/%d (fixture has %d)", res.Flashes, res.Kept, len(flashes))
	}
	if store.LastKey() != keyOK {
		t.Fatalf("LastKey = %q, want the one successful key", store.LastKey())
	}
	if !store.UpdatedAt().Equal(now) || store.Stale(now) {
		t.Fatalf("UpdatedAt = %v", store.UpdatedAt())
	}
	if res.NewestAge != time.Minute {
		t.Fatalf("NewestAge = %v, want 1m (17:03 − window end 17:02)", res.NewestAge)
	}
	if mirror.vals[MirrorKey] == "" {
		t.Fatal("mirror not written")
	}
	if got := store.Evaluate(site.Lat, site.Lon, now); got.Status != StatusAlert {
		t.Fatalf("site status = %+v, want alert", got)
	}
	if sitesCalls != 1 {
		t.Fatalf("ListSites called %d times", sitesCalls)
	}

	// Tick 2 a minute later: only the current hour is listed (last key is
	// recent), the failed key is newer than the last key so it is retried
	// and fails again; nothing else is new.
	bucket.fetched = nil
	res = job.Tick(context.Background(), now.Add(time.Minute))
	if len(res.Prefixes) != 1 || res.Files != 1 || res.Failed != 1 || res.Kept != 0 {
		t.Fatalf("tick 2 = %+v", res)
	}
	if len(bucket.fetched) != 1 || bucket.fetched[0] != keyBad {
		t.Fatalf("tick 2 fetched %v", bucket.fetched)
	}
	if sitesCalls != 1 {
		t.Fatalf("ListSites re-run early: %d calls", sitesCalls)
	}

	// Tick 3: the fetch works now, the key is consumed and nothing is left.
	bucket.failKeys[keyBad] = false
	res = job.Tick(context.Background(), now.Add(2*time.Minute))
	if res.Files != 1 || res.Failed != 0 || res.Kept < 1 || store.LastKey() != keyBad {
		t.Fatalf("tick 3 = %+v, LastKey %q", res, store.LastKey())
	}
	res = job.Tick(context.Background(), now.Add(3*time.Minute))
	if res.Files != 0 || res.Failed != 0 {
		t.Fatalf("tick 4 = %+v, want nothing new", res)
	}

	// Ten minutes on, the site list is refreshed.
	job.Tick(context.Background(), now.Add(11*time.Minute))
	if sitesCalls != 2 {
		t.Fatalf("ListSites after 11 min: %d calls, want 2", sitesCalls)
	}
}

func TestJobTickSurvivesListingFailure(t *testing.T) {
	bucket := newFakeBucket()
	bucket.failList = true
	store := NewStore()
	job := &Job{Store: store, Lister: bucket, Fetcher: bucket,
		ListSites: func(context.Context) ([]Site, error) { return nil, errors.New("db down") }}
	res := job.Tick(context.Background(), utc(17, 3, 0))
	if res.Files != 0 || res.Failed != 0 || store.LastKey() != "" || !store.UpdatedAt().IsZero() {
		t.Fatalf("res = %+v, store LastKey=%q UpdatedAt=%v", res, store.LastKey(), store.UpdatedAt())
	}
	if !store.Stale(utc(17, 3, 0)) {
		t.Fatal("a store that never fetched must be stale")
	}
}

func TestJobRunStopsOnCancel(t *testing.T) {
	bucket := newFakeBucket()
	job := &Job{Store: NewStore(), Lister: bucket, Fetcher: bucket, Interval: 20 * time.Millisecond}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		job.Run(ctx)
		close(done)
	}()
	time.Sleep(70 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after cancel")
	}
	bucket.mu.Lock()
	n := len(bucket.listed)
	bucket.mu.Unlock()
	if n < 2 {
		t.Fatalf("expected the immediate tick plus at least one aligned tick, got %d listings", n)
	}
}
