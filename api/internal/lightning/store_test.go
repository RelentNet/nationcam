package lightning

import (
	"context"
	"testing"
	"time"
)

// fakeMirror is a one-key map standing in for Redis.
type fakeMirror struct {
	vals map[string]string
	ttl  time.Duration
}

func newFakeMirror() *fakeMirror { return &fakeMirror{vals: map[string]string{}} }

func (m *fakeMirror) Get(_ context.Context, key string) (string, error) { return m.vals[key], nil }
func (m *fakeMirror) Set(_ context.Context, key, value string, ttl time.Duration) error {
	m.vals[key] = value
	m.ttl = ttl
	return nil
}

func TestStoreAddFiltersBySiteAndAge(t *testing.T) {
	now := utc(20, 0, 0)
	s := NewStore()
	// No sites yet: nothing is kept.
	if kept := s.Add([]Flash{north(veniceLat, veniceLon, 1, now)}, now); kept != 0 || s.Len() != 0 {
		t.Fatalf("kept %d with no sites", kept)
	}

	s.SetSites([]Site{{Slug: "venice-marina", Lat: veniceLat, Lon: veniceLon}})
	kept := s.Add([]Flash{
		north(veniceLat, veniceLon, 1, now),                      // near, fresh
		north(veniceLat, veniceLon, KmToMi(99), now),             // inside 100 km
		north(veniceLat, veniceLon, KmToMi(101), now),            // outside 100 km
		north(veniceLat, veniceLon, 1, now.Add(-59*time.Minute)), // near, still inside retention
		north(veniceLat, veniceLon, 1, now.Add(-60*time.Minute)), // aged out exactly
		{Lat: -34, Lon: -60, Time: now},                          // South America
	}, now)
	if kept != 3 || s.Len() != 3 {
		t.Fatalf("kept %d (len %d), want 3", kept, s.Len())
	}

	// Ten minutes later the 59-minute-old flash has aged out.
	s.Prune(now.Add(10 * time.Minute))
	if s.Len() != 2 {
		t.Fatalf("after prune len = %d, want 2", s.Len())
	}
	if got := s.Evaluate(veniceLat, veniceLon, now.Add(10*time.Minute)); got.Status != StatusAlert || got.Strikes30mi30min != 1 {
		t.Fatalf("Evaluate = %+v", got)
	}
}

func TestStoreFetchBookkeeping(t *testing.T) {
	s := NewStore()
	now := utc(20, 0, 0)
	if !s.Stale(now) {
		t.Fatal("a fresh store must be stale")
	}
	s.MarkFetched(now)
	if s.Stale(now.Add(5 * time.Minute)) {
		t.Fatal("exactly StaleAfter old is still fresh")
	}
	if !s.Stale(now.Add(5*time.Minute + time.Second)) {
		t.Fatal("past StaleAfter must be stale")
	}
	// The newest fetch wins; going backwards is ignored.
	s.MarkFetched(now.Add(-time.Hour))
	if !s.UpdatedAt().Equal(now) {
		t.Fatalf("UpdatedAt = %v, want %v", s.UpdatedAt(), now)
	}
	s.SetLastKey("b")
	s.SetLastKey("a")
	if s.LastKey() != "b" {
		t.Fatalf("LastKey = %q, want b", s.LastKey())
	}
}

func TestStoreMirrorRoundTrip(t *testing.T) {
	now := utc(20, 0, 0)
	m := newFakeMirror()

	src := NewStore()
	src.SetSites([]Site{{Slug: "venice-marina", Lat: veniceLat, Lon: veniceLon}})
	src.Add([]Flash{
		north(veniceLat, veniceLon, 3, now.Add(-2*time.Minute)),
		north(veniceLat, veniceLon, 5, now.Add(-50*time.Minute)),
	}, now)
	src.MarkFetched(now)
	src.SetLastKey(fixtureKey)
	if err := src.Save(context.Background(), m, now); err != nil {
		t.Fatal(err)
	}
	if m.ttl != MirrorTTL {
		t.Fatalf("ttl = %v, want %v", m.ttl, MirrorTTL)
	}

	// A restart 15 minutes later: the 50-minute-old flash has aged out, the
	// 2-minute-old one survives, and the fetch time / last key come back.
	later := now.Add(15 * time.Minute)
	dst := NewStore()
	n, err := dst.Load(context.Background(), m, later)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 || dst.Len() != 1 {
		t.Fatalf("loaded %d (len %d), want 1", n, dst.Len())
	}
	if !dst.UpdatedAt().Equal(now) || dst.LastKey() != fixtureKey {
		t.Fatalf("UpdatedAt=%v LastKey=%q", dst.UpdatedAt(), dst.LastKey())
	}
	if got := dst.Evaluate(veniceLat, veniceLon, later); got.Status != StatusAlert {
		t.Fatalf("after load status = %q, want alert", got.Status)
	}

	// An empty mirror loads nothing and is not an error.
	empty := NewStore()
	if n, err := empty.Load(context.Background(), newFakeMirror(), later); n != 0 || err != nil {
		t.Fatalf("empty mirror: %d, %v", n, err)
	}
}
