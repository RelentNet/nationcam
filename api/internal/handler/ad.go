package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/brandon-relentnet/nationcam/api/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// adsCacheTTL is deliberately shorter than cache.DefaultTTL: /ads/next sits on the
// stream-playback hot path, but ad campaigns start and stop on the minute and an
// ad that is no longer sold must stop serving promptly.
const adsCacheTTL = 60 * time.Second

// AdsNext handles GET /ads/next?video_id=N — returns the ad to play before this
// camera's stream, or 204 when nothing is sold for it.
//
// Caching and weighted rotation coexist because they cache different things: what
// Redis holds is the *candidate set* (the winning scope's eligible ads), which is
// what the expensive query produces and what only changes when an admin edits
// inventory. The weighted draw happens in Go on every request, cache hit or miss,
// so rotation is never frozen by the cache.
func AdsNext(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		videoID, err := strconv.Atoi(r.URL.Query().Get("video_id"))
		if err != nil || videoID <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid video_id"})
			return
		}

		candidates, hit, err := adCandidates(r.Context(), pool, c, int32(videoID))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if hit {
			w.Header().Set("X-Cache", "HIT")
		} else {
			w.Header().Set("X-Cache", "MISS")
		}

		ad := pickWeighted(candidates)
		if ad == nil {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		writeJSON(w, http.StatusOK, ad)
	}
}

func adCandidatesKey(videoID int32) string {
	return "ads:candidates:" + strconv.Itoa(int(videoID))
}

// adCandidates returns the eligible ads at the winning scope for a camera, via
// Redis when possible. Cached rows are re-checked against their active window on
// read, so an ad cannot outlive its end date by up to a TTL. If that leaves the
// cached set empty the query is re-run live, which lets a broader scope take over
// the moment the more specific one expires.
func adCandidates(ctx context.Context, pool *pgxpool.Pool, c *cache.Cache, videoID int32) ([]db.ResolveAdCandidatesRow, bool, error) {
	key := adCandidatesKey(videoID)

	if cached, err := c.Get(ctx, key); err == nil && cached != "" {
		var rows []db.ResolveAdCandidatesRow
		if err := json.Unmarshal([]byte(cached), &rows); err == nil {
			if live := liveAds(rows, time.Now()); len(live) > 0 {
				return live, true, nil
			}
		}
	}

	rows, err := db.New(pool).ResolveAdCandidates(ctx, videoID)
	if err != nil {
		return nil, false, err
	}
	if encoded, err := json.Marshal(rows); err == nil {
		if err := c.Set(ctx, key, string(encoded), adsCacheTTL); err != nil {
			slog.Warn("ad candidate cache write failed", "video_id", videoID, "error", err)
		}
	}
	return rows, false, nil
}

// liveAds drops ads whose active window does not contain now — the same rule the
// SQL applies, re-applied to cached rows.
func liveAds(rows []db.ResolveAdCandidatesRow, now time.Time) []db.ResolveAdCandidatesRow {
	live := rows[:0]
	for _, a := range rows {
		if a.StartsAt.Valid && a.StartsAt.Time.After(now) {
			continue
		}
		if a.EndsAt.Valid && !a.EndsAt.Time.After(now) {
			continue
		}
		live = append(live, a)
	}
	return live
}

// pickWeighted chooses one ad with probability proportional to its weight.
//
// ponytail: uniform weighted draw, no memory of what this viewer saw before.
// Frequency capping (per-viewer or per-session) would go here — it needs a viewer
// identifier the request does not currently carry.
func pickWeighted(rows []db.ResolveAdCandidatesRow) *db.ResolveAdCandidatesRow {
	total := 0
	for _, a := range rows {
		total += int(a.Weight)
	}
	if total <= 0 {
		return nil
	}
	n := rand.IntN(total)
	for i := range rows {
		n -= int(rows[i].Weight)
		if n < 0 {
			return &rows[i]
		}
	}
	return &rows[len(rows)-1]
}

// RecordAdImpression handles POST /ads/{id}/impression?video_id=N.
//
// The row is written straight to Postgres, one INSERT per call, and a failure is
// reported to the caller so it can retry. These counts bill advertisers, so they
// deliberately do NOT use the Redis-buffered counter that backs videos.view_count:
// that one is documented as approximate and can lose or double-count on a crash.
func RecordAdImpression(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		adID, videoID, ok := adEventParams(w, r)
		if !ok {
			return
		}
		if !recordAdEvent(w, r, pool, adID, videoID, "impression") {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// RecordAdClick handles GET /ads/{id}/click?video_id=N — records the click, then
// redirects to the advertiser. A GET redirect means the player can use a plain
// anchor and the click is still counted if JavaScript is blocked.
func RecordAdClick(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		adID, videoID, ok := adEventParams(w, r)
		if !ok {
			return
		}

		ad, err := db.New(pool).GetAd(r.Context(), adID)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "ad not found"})
			return
		}
		// Validated on write, re-checked here so a row predating that validation
		// cannot turn this endpoint into a javascript:/data: redirect.
		if !isHTTPURL(ad.ClickUrl) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "ad has no click-through URL"})
			return
		}

		if !recordAdEvent(w, r, pool, adID, videoID, "click") {
			return
		}
		http.Redirect(w, r, ad.ClickUrl, http.StatusFound)
	}
}

func adEventParams(w http.ResponseWriter, r *http.Request) (adID int32, videoID *int32, ok bool) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid ad id"})
		return 0, nil, false
	}
	// video_id is what makes per-camera billing reports possible, so it is required.
	v, err := strconv.Atoi(r.URL.Query().Get("video_id"))
	if err != nil || v <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid video_id"})
		return 0, nil, false
	}
	v32 := int32(v)
	return int32(id), &v32, true
}

// recordAdEvent writes the event row, reporting failures rather than swallowing
// them. Unknown ad or camera IDs fail the foreign keys and come back as 400.
func recordAdEvent(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, adID int32, videoID *int32, kind string) bool {
	if err := db.New(pool).RecordAdEvent(r.Context(), db.RecordAdEventParams{
		AdID:    adID,
		VideoID: videoID,
		Kind:    kind,
	}); err != nil {
		slog.Warn("ad event write failed", "ad_id", adID, "kind", kind, "error", err)
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown ad or camera"})
		return false
	}
	return true
}

// ────────────────────────────────────────────────
// Admin CRUD
// ────────────────────────────────────────────────

// ListAds handles GET /ads — every ad with its lifetime impression and click
// counts (admin only). Not cached: it is the billing report.
func ListAds(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.New(pool).ListAds(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

type adRequest struct {
	Name          string     `json:"name"`
	VideoURL      string     `json:"video_url"`
	ClickURL      string     `json:"click_url"`
	Weight        int32      `json:"weight"`
	StartsAt      *time.Time `json:"starts_at"`
	EndsAt        *time.Time `json:"ends_at"`
	Enabled       *bool      `json:"enabled"`
	StateID       *int32     `json:"state_id"`
	SublocationID *int32     `json:"sublocation_id"`
	VideoID       *int32     `json:"video_id"`
}

// validate normalises defaults and rejects anything the schema would reject, so
// callers get a readable error instead of a constraint violation.
func (req *adRequest) validate() string {
	if req.Name == "" || req.VideoURL == "" {
		return "name and video_url are required"
	}
	if !isHTTPURL(req.VideoURL) {
		return "video_url must be an http(s) URL"
	}
	if req.ClickURL != "" && !isHTTPURL(req.ClickURL) {
		return "click_url must be an http(s) URL"
	}
	if req.Weight == 0 {
		req.Weight = 1
	}
	if req.Weight < 0 {
		return "weight must be positive"
	}
	if req.Enabled == nil {
		enabled := true
		req.Enabled = &enabled
	}
	scopes := 0
	for _, id := range []*int32{req.StateID, req.SublocationID, req.VideoID} {
		if id != nil {
			scopes++
		}
	}
	if scopes > 1 {
		return "set at most one of state_id, sublocation_id, video_id"
	}
	if req.StartsAt != nil && req.EndsAt != nil && !req.EndsAt.After(*req.StartsAt) {
		return "ends_at must be after starts_at"
	}
	return ""
}

func isHTTPURL(s string) bool {
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func timestamptz(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

// CreateAd handles POST /ads (admin only).
func CreateAd(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req adRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if msg := req.validate(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}

		ad, err := db.New(pool).CreateAd(r.Context(), db.CreateAdParams{
			Name:          req.Name,
			VideoUrl:      req.VideoURL,
			ClickUrl:      req.ClickURL,
			Weight:        req.Weight,
			StartsAt:      timestamptz(req.StartsAt),
			EndsAt:        timestamptz(req.EndsAt),
			Enabled:       *req.Enabled,
			StateID:       req.StateID,
			SublocationID: req.SublocationID,
			VideoID:       req.VideoID,
			CreatedBy:     middleware.UserID(r.Context()),
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		invalidateAds(r.Context(), c)
		writeJSON(w, http.StatusCreated, ad)
	}
}

// UpdateAd handles PUT /ads/{id} (admin only).
func UpdateAd(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(chi.URLParam(r, "id"))
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid ad id"})
			return
		}

		var req adRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if msg := req.validate(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}

		ad, err := db.New(pool).UpdateAd(r.Context(), db.UpdateAdParams{
			AdID:          int32(id),
			Name:          req.Name,
			VideoUrl:      req.VideoURL,
			ClickUrl:      req.ClickURL,
			Weight:        req.Weight,
			StartsAt:      timestamptz(req.StartsAt),
			EndsAt:        timestamptz(req.EndsAt),
			Enabled:       *req.Enabled,
			StateID:       req.StateID,
			SublocationID: req.SublocationID,
			VideoID:       req.VideoID,
		})
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "ad not found"})
			return
		}

		invalidateAds(r.Context(), c)
		writeJSON(w, http.StatusOK, ad)
	}
}

// DeleteAd handles DELETE /ads/{id} (admin only). An ad that has already served
// cannot be deleted — its impressions are billing records — so this returns 409
// and the admin disables it instead.
func DeleteAd(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(chi.URLParam(r, "id"))
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid ad id"})
			return
		}

		if err := db.New(pool).DeleteAd(r.Context(), int32(id)); err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23503" {
				writeJSON(w, http.StatusConflict, map[string]string{
					"error": "ad has recorded impressions and cannot be deleted; disable it instead",
				})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		invalidateAds(r.Context(), c)
		w.WriteHeader(http.StatusNoContent)
	}
}

// invalidateAds clears every cached candidate set. Ad inventory changes are rare
// and admin-driven, so a blanket flush is cheaper than tracking which cameras a
// given ad's scope covers.
func invalidateAds(ctx context.Context, c *cache.Cache) {
	if err := c.Invalidate(ctx, "ads:*"); err != nil {
		slog.Warn("cache invalidation failed", "pattern", "ads:*", "error", err)
	}
}
