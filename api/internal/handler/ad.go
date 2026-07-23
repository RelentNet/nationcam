package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

// AdsNext handles GET /ads/next?video_id=N — returns the pre-roll video ad to play
// before this camera's stream, or 204 when nothing is sold for it. It resolves only
// preroll_video ads and honours the global override (an enabled, in-window video
// override beats the whole camera→sublocation→state→house ladder).
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

		v32 := int32(videoID)
		serveAd(w, r, pool, c, db.ResolveAdsParams{AdType: "preroll_video", VideoID: &v32})
	}
}

// AdsBanner handles GET /ads/banner — returns the banner (HTML creative) to render
// for a page slot, or 204 when nothing is sold. The page scope is whatever context
// the caller has: video_id (camera page), sublocation_id, state_id, or none (home
// → house/global). placement selects the slot (left|right|mobile); omit it to match
// any. Same override→ladder resolution as video, on banner_html ads only.
func AdsBanner(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		videoID, ok := queryInt32(w, r, "video_id")
		if !ok {
			return
		}
		subID, ok := queryInt32(w, r, "sublocation_id")
		if !ok {
			return
		}
		stateID, ok := queryInt32(w, r, "state_id")
		if !ok {
			return
		}
		placement := r.URL.Query().Get("placement")
		if placement != "" && placement != "left" && placement != "right" && placement != "mobile" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "placement must be left, right or mobile"})
			return
		}

		serveAd(w, r, pool, c, db.ResolveAdsParams{
			AdType:        "banner_html",
			VideoID:       videoID,
			SublocationID: subID,
			StateID:       stateID,
			Placement:     placement,
		})
	}
}

// serveAd resolves the candidate set for the given params, sets the cache header,
// rolls a weighted pick and writes the ad (or 204). Shared by video and banner.
func serveAd(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, c *cache.Cache, params db.ResolveAdsParams) {
	candidates, hit, err := adCandidates(r.Context(), pool, c, params)
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

// adCandidatesKey scopes the cache entry by everything that changes the result:
// creative type, page scope, and banner placement.
func adCandidatesKey(p db.ResolveAdsParams) string {
	return fmt.Sprintf("ads:candidates:%s:%d:%d:%d:%s",
		p.AdType, deref(p.VideoID), deref(p.SublocationID), deref(p.StateID), p.Placement)
}

func deref(p *int32) int32 {
	if p == nil {
		return 0
	}
	return *p
}

// adCandidates returns the eligible ads at the winning scope for a page context, via
// Redis when possible. Cached rows are re-checked against their active window on
// read, so an ad cannot outlive its end date by up to a TTL. If that leaves the
// cached set empty the query is re-run live, which lets a broader scope take over
// the moment the more specific one expires.
func adCandidates(ctx context.Context, pool *pgxpool.Pool, c *cache.Cache, params db.ResolveAdsParams) ([]db.ResolveAdsRow, bool, error) {
	key := adCandidatesKey(params)

	if cached, err := c.Get(ctx, key); err == nil && cached != "" {
		var rows []db.ResolveAdsRow
		if err := json.Unmarshal([]byte(cached), &rows); err == nil {
			if live := liveAds(rows, time.Now()); len(live) > 0 {
				return live, true, nil
			}
		}
	}

	rows, err := db.New(pool).ResolveAds(ctx, params)
	if err != nil {
		return nil, false, err
	}
	if encoded, err := json.Marshal(rows); err == nil {
		if err := c.Set(ctx, key, string(encoded), adsCacheTTL); err != nil {
			slog.Warn("ad candidate cache write failed", "key", key, "error", err)
		}
	}
	return rows, false, nil
}

// liveAds drops ads whose active window does not contain now — the same rule the
// SQL applies, re-applied to cached rows.
func liveAds(rows []db.ResolveAdsRow, now time.Time) []db.ResolveAdsRow {
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
func pickWeighted(rows []db.ResolveAdsRow) *db.ResolveAdsRow {
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
	// video_id makes per-camera billing reports possible for pre-roll ads, so a
	// camera-page player still sends it. Banners can be viewed off a camera page
	// (home/locations), so it is optional here: absent → recorded as NULL, still an
	// exact per-ad row. A present-but-garbage value is rejected rather than dropped.
	v, ok := queryInt32(w, r, "video_id")
	if !ok {
		return 0, nil, false
	}
	return int32(id), v, true
}

// queryInt32 reads an optional positive int query param. Empty → (nil, true).
// Present and valid → (&v, true). Present but unparseable or non-positive →
// writes a 400 and returns (nil, false).
func queryInt32(w http.ResponseWriter, r *http.Request, name string) (*int32, bool) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return nil, true
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid " + name})
		return nil, false
	}
	v32 := int32(v)
	return &v32, true
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
	Type          string     `json:"type"`
	VideoURL      string     `json:"video_url"`
	HTMLCode      string     `json:"html_code"`
	Placement     string     `json:"placement"`
	ClickURL      string     `json:"click_url"`
	Weight        int32      `json:"weight"`
	StartsAt      *time.Time `json:"starts_at"`
	EndsAt        *time.Time `json:"ends_at"`
	Enabled       *bool      `json:"enabled"`
	IsOverride    *bool      `json:"is_override"`
	StateID       *int32     `json:"state_id"`
	SublocationID *int32     `json:"sublocation_id"`
	VideoID       *int32     `json:"video_id"`
}

// validate normalises defaults and rejects anything the schema would reject, so
// callers get a readable error instead of a constraint violation. It also clears
// the fields that do not belong to the chosen type, so a video ad can never smuggle
// in banner HTML and vice versa (matching the ads_type_fields CHECK).
func (req *adRequest) validate() string {
	if req.Name == "" {
		return "name is required"
	}
	if req.Type == "" {
		req.Type = "preroll_video"
	}
	switch req.Type {
	case "preroll_video":
		if req.VideoURL == "" {
			return "video_url is required for a preroll_video ad"
		}
		if !isHTTPURL(req.VideoURL) {
			return "video_url must be an http(s) URL"
		}
		req.HTMLCode = ""
		req.Placement = ""
	case "banner_html":
		if req.HTMLCode == "" {
			return "html_code is required for a banner_html ad"
		}
		if req.Placement != "left" && req.Placement != "right" && req.Placement != "mobile" {
			return "placement must be left, right or mobile for a banner_html ad"
		}
		req.VideoURL = ""
	default:
		return "type must be preroll_video or banner_html"
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
	if req.IsOverride == nil {
		override := false
		req.IsOverride = &override
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
			Type:          req.Type,
			VideoUrl:      req.VideoURL,
			HtmlCode:      req.HTMLCode,
			Placement:     req.Placement,
			ClickUrl:      req.ClickURL,
			Weight:        req.Weight,
			StartsAt:      timestamptz(req.StartsAt),
			EndsAt:        timestamptz(req.EndsAt),
			Enabled:       *req.Enabled,
			IsOverride:    *req.IsOverride,
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
			Type:          req.Type,
			VideoUrl:      req.VideoURL,
			HtmlCode:      req.HTMLCode,
			Placement:     req.Placement,
			ClickUrl:      req.ClickURL,
			Weight:        req.Weight,
			StartsAt:      timestamptz(req.StartsAt),
			EndsAt:        timestamptz(req.EndsAt),
			Enabled:       *req.Enabled,
			IsOverride:    *req.IsOverride,
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
