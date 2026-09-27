package lightning

import (
	"context"
	"encoding/json"
	"sync"
	"time"
)

// MaxFlashes is a hard cap on the buffer, independent of Retention, so a
// runaway storm over every site at once can never grow memory without bound.
// 100 km around a site during a violent storm is a few thousand flashes an
// hour; this is far above that.
const MaxFlashes = 200_000

// Store is the in-memory buffer of recent flashes near the sites the API
// knows about: a time-bounded ring of the last Retention, filtered to
// KeepRadiusKm of any site on the way in. Safe for concurrent use — the job
// writes on its tick, handlers read on every request.
type Store struct {
	mu        sync.RWMutex
	sites     []Site
	flashes   []Flash // insertion order; pruned by age on every write
	updatedAt time.Time
	lastKey   string
}

// NewStore returns an empty store with no sites (so nothing is kept until
// SetSites is called).
func NewStore() *Store { return &Store{} }

// SetSites replaces the sublocations whose surroundings are kept.
func (s *Store) SetSites(sites []Site) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sites = append([]Site(nil), sites...)
}

// Sites returns a copy of the current site list.
func (s *Store) Sites() []Site {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]Site(nil), s.sites...)
}

// Add files the flashes that are within KeepRadiusKm of any site and not yet
// Retention old, prunes what has aged out, and returns how many were kept.
func (s *Store) Add(flashes []Flash, now time.Time) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := now.Add(-Retention)
	kept := 0
	for _, f := range flashes {
		if !f.Time.After(cutoff) {
			continue
		}
		if !s.nearAnySiteLocked(f) {
			continue
		}
		s.flashes = append(s.flashes, f)
		kept++
	}
	s.pruneLocked(now)
	return kept
}

func (s *Store) nearAnySiteLocked(f Flash) bool {
	for _, site := range s.sites {
		if DistanceKm(site.Lat, site.Lon, f.Lat, f.Lon) <= KeepRadiusKm {
			return true
		}
	}
	return false
}

// Prune drops flashes older than Retention.
func (s *Store) Prune(now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pruneLocked(now)
}

func (s *Store) pruneLocked(now time.Time) {
	cutoff := now.Add(-Retention)
	kept := s.flashes[:0]
	for _, f := range s.flashes {
		if f.Time.After(cutoff) {
			kept = append(kept, f)
		}
	}
	// Zero the tail so dropped entries are not retained by the backing array.
	for i := len(kept); i < len(s.flashes); i++ {
		s.flashes[i] = Flash{}
	}
	s.flashes = kept
	if len(s.flashes) > MaxFlashes {
		// Oldest first in insertion order, so cutting the head drops the oldest.
		s.flashes = append([]Flash(nil), s.flashes[len(s.flashes)-MaxFlashes:]...)
	}
}

// Len is the number of buffered flashes.
func (s *Store) Len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.flashes)
}

// Flashes returns a copy of the buffer.
func (s *Store) Flashes() []Flash {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]Flash(nil), s.flashes...)
}

// Evaluate applies the policy for a point against the buffer.
func (s *Store) Evaluate(lat, lon float64, now time.Time) Status {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return Evaluate(s.flashes, lat, lon, now)
}

// MarkFetched records a successful fetch at t (the newest wins).
func (s *Store) MarkFetched(t time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t.After(s.updatedAt) {
		s.updatedAt = t
	}
}

// UpdatedAt is the time of the newest successful fetch; zero if none yet.
func (s *Store) UpdatedAt() time.Time {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.updatedAt
}

// Stale reports whether the newest successful fetch is missing or older than
// StaleAfter — the handler's 503 condition.
func (s *Store) Stale(now time.Time) bool {
	u := s.UpdatedAt()
	return u.IsZero() || now.Sub(u) > StaleAfter
}

// SetLastKey records the newest S3 key processed; LastKey returns it.
func (s *Store) SetLastKey(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if key > s.lastKey {
		s.lastKey = key
	}
}

// LastKey is the newest S3 key processed, or "" before the first fetch.
func (s *Store) LastKey() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastKey
}

/* ──── Redis mirror ──── */

// Mirror is the slice of cache.Cache the store needs to survive a restart.
type Mirror interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key string, value string, ttl time.Duration) error
}

const (
	// MirrorKey is the one Redis key the whole buffer is mirrored to.
	MirrorKey = "lightning:store"
	// MirrorTTL is a little over Retention so a restart within the hour
	// always finds it and a long outage does not resurrect stale flashes.
	MirrorTTL = 65 * time.Minute
)

type mirrorPayload struct {
	Flashes   []Flash   `json:"flashes"`
	UpdatedAt time.Time `json:"updated_at"`
	LastKey   string    `json:"last_key"`
	SavedAt   time.Time `json:"saved_at"`
}

// Save writes the buffer, the last-fetch time and the last key to the
// mirror as one JSON value.
func (s *Store) Save(ctx context.Context, m Mirror, now time.Time) error {
	s.mu.RLock()
	p := mirrorPayload{
		Flashes:   s.flashes,
		UpdatedAt: s.updatedAt,
		LastKey:   s.lastKey,
		SavedAt:   now,
	}
	body, err := json.Marshal(p)
	s.mu.RUnlock()
	if err != nil {
		return err
	}
	return m.Set(ctx, MirrorKey, string(body), MirrorTTL)
}

// Load restores a mirror written by Save into an empty-or-older store,
// pruning what has aged out. It returns the number of flashes loaded; a
// missing key loads nothing and is not an error. It never moves updatedAt
// or lastKey backwards.
func (s *Store) Load(ctx context.Context, m Mirror, now time.Time) (int, error) {
	raw, err := m.Get(ctx, MirrorKey)
	if err != nil || raw == "" {
		return 0, err
	}
	var p mirrorPayload
	if err := json.Unmarshal([]byte(raw), &p); err != nil {
		return 0, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	cutoff := now.Add(-Retention)
	n := 0
	for _, f := range p.Flashes {
		if f.Time.After(cutoff) {
			s.flashes = append(s.flashes, f)
			n++
		}
	}
	if p.UpdatedAt.After(s.updatedAt) {
		s.updatedAt = p.UpdatedAt
	}
	if p.LastKey > s.lastKey {
		s.lastKey = p.LastKey
	}
	s.pruneLocked(now)
	return n, nil
}
