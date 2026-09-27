package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// azuraStation is the slice of AzuraCast's /api/stations we care about.
type azuraStation struct {
	Name      string `json:"name"`
	Shortcode string `json:"shortcode"`
	ListenURL string `json:"listen_url"`
	Mounts    []struct {
		URL       string `json:"url"`
		Format    string `json:"format"`
		IsDefault bool   `json:"is_default"`
	} `json:"mounts"`
}

// audioStation is what we return to the viewer: a slim, publicly-playable station.
type audioStation struct {
	Name      string `json:"name"`
	Shortcode string `json:"shortcode"`
	StreamURL string `json:"stream_url"`
}

var azuraClient = &http.Client{Timeout: 5 * time.Second}

// AudioStations handles GET /audio/stations?video_id=N — DB-backed stations
// (DAN-47) first, then the AzuraCast station list, same flat JSON shape as
// before so the player's picker doesn't need to know which source a station
// came from. DB rows are shortcode "db-<id>"; scope (unscoped, or matching
// the camera's state/sublocation) is resolved in SQL — see
// ListPublicAudioStations.
//
// The cache key includes video_id so a scoped result never leaks into an
// unscoped or differently-scoped request. The feature degrades gracefully at
// every layer and never 5xxs: no video_id → DB unscoped rows only; AzuraCast
// unset/unreachable/junk → DB rows only; DB query failing → AzuraCast rows
// only (or [] if both are down) — the player simply shows a smaller picker.
func AudioStations(pool *pgxpool.Pool, c *cache.Cache, azuracastURL string) http.HandlerFunc {
	base := strings.TrimRight(azuracastURL, "/")
	return func(w http.ResponseWriter, r *http.Request) {
		videoID, ok := queryInt32(w, r, "video_id")
		if !ok {
			return
		}
		ctx := r.Context()
		key := fmt.Sprintf("audio:stations:v%d", deref(videoID))

		if cached, err := c.Get(ctx, key); err == nil && cached != "" {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Cache", "HIT")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(cached))
			return
		}

		out := make([]audioStation, 0, 8)
		dbRows, err := db.New(pool).ListPublicAudioStations(ctx, videoID)
		if err != nil {
			slog.Warn("audio stations: db query failed", "error", err)
		}
		for _, s := range dbRows {
			out = append(out, audioStation{
				Name:      s.Name,
				Shortcode: fmt.Sprintf("db-%d", s.AudioStationID),
				StreamURL: s.StreamUrl,
			})
		}
		out = append(out, fetchAzuraStations(ctx, base)...)

		encoded, err := json.Marshal(out)
		if err != nil {
			writeJSON(w, http.StatusOK, out)
			return
		}
		if err := c.Set(ctx, key, string(encoded), cache.DefaultTTL); err != nil {
			slog.Warn("audio stations cache write failed", "key", key, "error", err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Cache", "MISS")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(encoded)
	}
}

// fetchAzuraStations fetches and rewrites the AzuraCast station list. Returns
// nil (never an error) if azuracastURL is unset, AzuraCast is unreachable, or
// it returns junk — AudioStations degrades to DB rows only.
func fetchAzuraStations(ctx context.Context, base string) []audioStation {
	if base == "" {
		return nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/stations", nil)
	if err != nil {
		slog.Error("audio stations: build request", "error", err)
		return nil
	}

	resp, err := azuraClient.Do(req)
	if err != nil {
		slog.Warn("audio stations: AzuraCast unreachable", "error", err)
		return nil
	}
	defer resp.Body.Close()

	var raw []azuraStation
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		slog.Warn("audio stations: decode failed", "status", resp.StatusCode, "error", err)
		return nil
	}

	out := make([]audioStation, 0, len(raw))
	for _, s := range raw {
		streamURL := rewriteStreamURL(base, s)
		if streamURL == "" {
			continue
		}
		out = append(out, audioStation{Name: s.Name, Shortcode: s.Shortcode, StreamURL: streamURL})
	}
	return out
}

// rewriteStreamURL turns AzuraCast's internal LAN address (e.g.
// http://192.168.1.182:8383/listen/fnit/radio.mp3) into a public HTTPS URL by
// keeping only the path and prepending base. Returns "" if no usable mount.
func rewriteStreamURL(base string, s azuraStation) string {
	src := pickMountURL(s)
	if src == "" {
		return ""
	}
	u, err := url.Parse(src)
	if err != nil || u.Path == "" {
		return ""
	}
	rewritten := base + u.Path
	if u.RawQuery != "" {
		rewritten += "?" + u.RawQuery
	}
	return rewritten
}

// pickMountURL prefers an mp3 mount, then the default mount, then the first
// mount, then the station's listen_url. (The current single mount is labeled
// MP3 but served as audio/aac — the <audio> element plays it fine, so we don't
// hard-require format=="mp3".)
func pickMountURL(s azuraStation) string {
	var first, def string
	for _, m := range s.Mounts {
		if m.URL == "" {
			continue
		}
		if strings.EqualFold(m.Format, "mp3") {
			return m.URL
		}
		if first == "" {
			first = m.URL
		}
		if m.IsDefault && def == "" {
			def = m.URL
		}
	}
	switch {
	case def != "":
		return def
	case first != "":
		return first
	default:
		return s.ListenURL
	}
}

// ────────────────────────────────────────────────
// Admin CRUD (DAN-47)
// ────────────────────────────────────────────────

// ListAudioStations handles GET /audio/stations/all — every DB-backed station,
// any state, for the admin panel (admin only). AzuraCast stations are not
// editable here, so they are not part of this listing.
func ListAudioStations(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.New(pool).ListAudioStations(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

type audioStationRequest struct {
	Name          string `json:"name"`
	StreamURL     string `json:"stream_url"`
	Enabled       *bool  `json:"enabled"`
	SortOrder     int32  `json:"sort_order"`
	StateID       *int32 `json:"state_id"`
	SublocationID *int32 `json:"sublocation_id"`
}

// validate normalises defaults and rejects anything the schema would reject,
// matching the audio_stations_single_scope CHECK.
func (req *audioStationRequest) validate() string {
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		return "name is required"
	}
	if len(req.Name) > 80 {
		return "name must be 80 characters or fewer"
	}
	if !isHTTPSURL(req.StreamURL) {
		return "stream_url must be an https URL"
	}
	if req.Enabled == nil {
		enabled := true
		req.Enabled = &enabled
	}
	if req.StateID != nil && req.SublocationID != nil {
		return "set at most one of state_id, sublocation_id"
	}
	return ""
}

// isHTTPSURL requires https specifically (not http): the site is served over
// https, so an http stream would be mixed content and get blocked by the
// browser.
func isHTTPSURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && u.Scheme == "https" && u.Host != ""
}

// CreateAudioStation handles POST /audio/stations (admin only).
func CreateAudioStation(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req audioStationRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if msg := req.validate(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}

		station, err := db.New(pool).CreateAudioStation(r.Context(), db.CreateAudioStationParams{
			Name:          req.Name,
			StreamUrl:     req.StreamURL,
			Enabled:       *req.Enabled,
			SortOrder:     req.SortOrder,
			StateID:       req.StateID,
			SublocationID: req.SublocationID,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		invalidateAudio(r.Context(), c)
		writeJSON(w, http.StatusCreated, station)
	}
}

// UpdateAudioStation handles PUT /audio/stations/{id} (admin only).
func UpdateAudioStation(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(chi.URLParam(r, "id"))
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid audio station id"})
			return
		}

		var req audioStationRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if msg := req.validate(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}

		station, err := db.New(pool).UpdateAudioStation(r.Context(), db.UpdateAudioStationParams{
			AudioStationID: int32(id),
			Name:           req.Name,
			StreamUrl:      req.StreamURL,
			Enabled:        *req.Enabled,
			SortOrder:      req.SortOrder,
			StateID:        req.StateID,
			SublocationID:  req.SublocationID,
		})
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "audio station not found"})
			return
		}

		invalidateAudio(r.Context(), c)
		writeJSON(w, http.StatusOK, station)
	}
}

// DeleteAudioStation handles DELETE /audio/stations/{id} (admin only).
func DeleteAudioStation(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(chi.URLParam(r, "id"))
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid audio station id"})
			return
		}

		if err := db.New(pool).DeleteAudioStation(r.Context(), int32(id)); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		invalidateAudio(r.Context(), c)
		w.WriteHeader(http.StatusNoContent)
	}
}

// invalidateAudio clears every cached /audio/stations response (every
// video_id-scoped key), the same blanket-flush-on-rare-admin-write pattern as
// ads and posts.
func invalidateAudio(ctx context.Context, c *cache.Cache) {
	if err := c.Invalidate(ctx, "audio:*"); err != nil {
		slog.Warn("cache invalidation failed", "pattern", "audio:*", "error", err)
	}
}
