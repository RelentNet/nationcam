package handler

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/middleware"
	"github.com/brandon-relentnet/nationcam/api/internal/restreamer"
)

// GET /me/videos/status (DAN-207): the command center's per-tile badge.
//
// One entry per camera the caller can view (the ListOwnerVideos rule, so the
// list always matches GET /me/videos). The state comes from the row where it
// can and from Restreamer's process state where it must:
//
//	pending            → pending     (not approved yet; nothing runs)
//	paused             → paused      (the owner stopped it)
//	rejected/inactive  → offline     (stopped by review / admin switch-off)
//	active + stream_id → live | offline  (Restreamer exec state)
//	active, no stream_id, no Restreamer, or Restreamer unreachable → unknown
//
// One Restreamer failure only makes that camera `unknown`; it never fails the
// list.

const (
	videoStateLive    = "live"
	videoStateOffline = "offline"
	videoStatePaused  = "paused"
	videoStatePending = "pending"
	videoStateUnknown = "unknown"
)

const (
	// statusProbeTTL is how long a probed stream state is reused. It is per
	// stream, not per caller, so a wall of 16 cameras polled every 30 s by
	// several members asks Restreamer about each stream at most every 15 s.
	statusProbeTTL = 15 * time.Second
	// statusProbeConcurrency bounds simultaneous Restreamer calls per request.
	statusProbeConcurrency = 5
	// statusProbeTimeout bounds one process-state call.
	statusProbeTimeout = 5 * time.Second
)

type videoStatus struct {
	VideoID int32  `json:"video_id"`
	State   string `json:"state"`
}

type probeEntry struct {
	state string
	at    time.Time
}

// streamStateCache remembers the last probed state per Restreamer stream id.
type streamStateCache struct {
	mu  sync.Mutex
	m   map[string]probeEntry
	now func() time.Time
}

func newStreamStateCache(now func() time.Time) *streamStateCache {
	return &streamStateCache{m: map[string]probeEntry{}, now: now}
}

func (c *streamStateCache) get(streamID string) (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[streamID]
	if !ok || c.now().Sub(e.at) >= statusProbeTTL {
		return "", false
	}
	return e.state, true
}

func (c *streamStateCache) put(streamID, state string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := c.now()
	// Drop stale entries so the map cannot grow without bound.
	for k, e := range c.m {
		if now.Sub(e.at) >= statusProbeTTL {
			delete(c.m, k)
		}
	}
	c.m[streamID] = probeEntry{state: state, at: now}
}

// ListMyVideoStatus handles GET /me/videos/status. rc may be nil (Restreamer
// not configured): active cameras are then `unknown`.
func ListMyVideoStatus(store ownerStore, rc *restreamer.Client) http.HandlerFunc {
	return listMyVideoStatus(store, rc, time.Now)
}

func listMyVideoStatus(store ownerStore, rc *restreamer.Client, now func() time.Time) http.HandlerFunc {
	cache := newStreamStateCache(now)
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		// Unredacted rows on purpose: stream_id is blanked in /me/videos for
		// private cameras, and it never leaves this function.
		rows, err := store.ListOwnerVideos(ctx, middleware.UserID(ctx))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		out := make([]videoStatus, len(rows))
		sem := make(chan struct{}, statusProbeConcurrency)
		var wg sync.WaitGroup
		for i, v := range rows {
			out[i].VideoID = v.VideoID
			switch v.Status {
			case statusPending:
				out[i].State = videoStatePending
			case statusPaused:
				out[i].State = videoStatePaused
			case statusActive:
				if rc == nil || !v.StreamID.Valid {
					out[i].State = videoStateUnknown
					continue
				}
				streamID := v.StreamID.String
				if state, ok := cache.get(streamID); ok {
					out[i].State = state
					continue
				}
				wg.Add(1)
				sem <- struct{}{}
				go func(i int, streamID string, videoID int32) {
					defer wg.Done()
					defer func() { <-sem }()
					state := probeStreamState(ctx, rc, streamID, videoID)
					cache.put(streamID, state)
					out[i].State = state
				}(i, streamID, v.VideoID)
			default: // rejected, inactive
				out[i].State = videoStateOffline
			}
		}
		wg.Wait()
		writeJSON(w, http.StatusOK, out)
	}
}

// probeStreamState asks Restreamer for a process's exec state. Anything it
// cannot answer (unreachable, timeout, unknown process) is `unknown`.
func probeStreamState(ctx context.Context, rc *restreamer.Client, streamID string, videoID int32) string {
	ctx, cancel := context.WithTimeout(ctx, statusProbeTimeout)
	defer cancel()
	st, err := rc.GetProcessState(ctx, restreamer.IngestProcessID(streamID))
	if err != nil {
		slog.Warn("camera status: restreamer state failed", "video_id", videoID, "error", err)
		return videoStateUnknown
	}
	if st.Exec == "running" {
		return videoStateLive
	}
	return videoStateOffline
}
