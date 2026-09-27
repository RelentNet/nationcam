package handler

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/brandon-relentnet/nationcam/api/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Field length caps, enforced before the insert so oversized input is a clean
// 400 rather than a database error — same reasoning as post.go.
const (
	eventTitleMaxLen = 200
	// Same cap as about.go's aboutMaxLen — an event description is editorial
	// copy of about that size, not a full article.
	eventDescMaxLen = 20000
)

// eventRelatedLimit caps the scoped listings (GET /events?sublocation_id=|video_id=)
// that back the "Upcoming" block on a sublocation/camera page.
const eventRelatedLimit = 3

type eventRequest struct {
	Title         string     `json:"title"`
	DescriptionMD string     `json:"description_md"`
	StartsAt      *time.Time `json:"starts_at"`
	EndsAt        *time.Time `json:"ends_at"`
	URL           string     `json:"url"`
	SublocationID *int32     `json:"sublocation_id"`
	VideoID       *int32     `json:"video_id"`
}

// validate trims fields and rejects anything the schema would otherwise
// reject with an opaque constraint error — same shape as postRequest.validate.
// It does not check that video_id actually belongs to sublocation_id: that
// needs a database lookup, done separately by the handler.
func (req *eventRequest) validate() string {
	req.Title = strings.TrimSpace(req.Title)
	req.URL = strings.TrimSpace(req.URL)

	if req.Title == "" {
		return "title is required"
	}
	if len(req.Title) > eventTitleMaxLen {
		return "title is too long"
	}
	if len(req.DescriptionMD) > eventDescMaxLen {
		return "description_md is too long"
	}
	if req.StartsAt == nil {
		return "starts_at is required"
	}
	if req.EndsAt != nil && !req.EndsAt.After(*req.StartsAt) {
		return "ends_at must be after starts_at"
	}
	if req.URL != "" && !isHTTPURL(req.URL) {
		return "url must be an http(s) URL"
	}
	if req.SublocationID == nil {
		return "sublocation_id is required"
	}
	return ""
}

// eventVideoBelongsToSublocation checks that, when a video_id is set, it
// actually belongs to the chosen sublocation_id — a camera at a different
// sublocation would make the "Watch here" link on the event nonsensical.
// Returns "" when there is no video_id to check, or when it checks out.
func eventVideoBelongsToSublocation(ctx context.Context, pool *pgxpool.Pool, videoID, sublocationID int32) string {
	video, err := db.New(pool).GetVideoByID(ctx, videoID)
	if err != nil {
		return "video not found"
	}
	if video.SublocationID == nil || *video.SublocationID != sublocationID {
		return "video_id does not belong to the selected sublocation"
	}
	return ""
}

func nullTimestamptz(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

func nullText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

// ────────────────────────────────────────────────
// Public
// ────────────────────────────────────────────────

// ListEvents handles GET /events. With a video_id or sublocation_id query
// param it returns that scope's upcoming events (limit 3, for the "Upcoming"
// block on a camera/sublocation page); otherwise (including ?upcoming=1) it
// returns every upcoming event sitewide, soonest first, limit 50 — the
// /events page. There is no public "all events including past" listing.
func ListEvents(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()

		if idStr := q.Get("video_id"); idStr != "" {
			id, ok := parsePositiveInt32(w, idStr, "video_id")
			if !ok {
				return
			}
			key := "events:by-video:" + idStr
			cachedHandler(c, key, func(w http.ResponseWriter, r *http.Request) {
				v32 := id
				rows, err := db.New(pool).ListUpcomingEventsByVideo(r.Context(), db.ListUpcomingEventsByVideoParams{
					VideoID: &v32,
					Limit:   eventRelatedLimit,
				})
				if err != nil {
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
					return
				}
				writeJSON(w, http.StatusOK, rows)
			})(w, r)
			return
		}

		if idStr := q.Get("sublocation_id"); idStr != "" {
			id, ok := parsePositiveInt32(w, idStr, "sublocation_id")
			if !ok {
				return
			}
			key := "events:by-sublocation:" + idStr
			cachedHandler(c, key, func(w http.ResponseWriter, r *http.Request) {
				rows, err := db.New(pool).ListUpcomingEventsBySublocation(r.Context(), db.ListUpcomingEventsBySublocationParams{
					SublocationID: id,
					Limit:         eventRelatedLimit,
				})
				if err != nil {
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
					return
				}
				writeJSON(w, http.StatusOK, rows)
			})(w, r)
			return
		}

		cachedHandler(c, "events:upcoming", func(w http.ResponseWriter, r *http.Request) {
			rows, err := db.New(pool).ListUpcomingEvents(r.Context())
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, rows)
		})(w, r)
	}
}

// ────────────────────────────────────────────────
// Admin CRUD
// ────────────────────────────────────────────────

// ListAllEvents handles GET /events/all — every event regardless of whether
// it's upcoming or past (admin only). Not cached: the dashboard list must
// always show the latest state.
func ListAllEvents(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.New(pool).ListAllEvents(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// CreateEvent handles POST /events (admin only).
func CreateEvent(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req eventRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if msg := req.validate(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}
		if req.VideoID != nil {
			if msg := eventVideoBelongsToSublocation(r.Context(), pool, *req.VideoID, *req.SublocationID); msg != "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
				return
			}
		}

		created, err := db.New(pool).CreateEvent(r.Context(), db.CreateEventParams{
			Title:         req.Title,
			DescriptionMd: req.DescriptionMD,
			StartsAt:      *req.StartsAt,
			EndsAt:        nullTimestamptz(req.EndsAt),
			Url:           nullText(req.URL),
			SublocationID: *req.SublocationID,
			VideoID:       req.VideoID,
			CreatedBy:     middleware.UserID(r.Context()),
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		invalidateEvents(r.Context(), c)
		writeJSON(w, http.StatusCreated, created)
	}
}

// UpdateEvent handles PUT /events/{id} (admin only).
func UpdateEvent(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(chi.URLParam(r, "id"))
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid event id"})
			return
		}

		var req eventRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if msg := req.validate(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}
		if req.VideoID != nil {
			if msg := eventVideoBelongsToSublocation(r.Context(), pool, *req.VideoID, *req.SublocationID); msg != "" {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
				return
			}
		}

		updated, err := db.New(pool).UpdateEvent(r.Context(), db.UpdateEventParams{
			EventID:       int32(id),
			Title:         req.Title,
			DescriptionMd: req.DescriptionMD,
			StartsAt:      *req.StartsAt,
			EndsAt:        nullTimestamptz(req.EndsAt),
			Url:           nullText(req.URL),
			SublocationID: *req.SublocationID,
			VideoID:       req.VideoID,
		})
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "event not found"})
			return
		}

		invalidateEvents(r.Context(), c)
		writeJSON(w, http.StatusOK, updated)
	}
}

// DeleteEvent handles DELETE /events/{id} (admin only).
func DeleteEvent(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(chi.URLParam(r, "id"))
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid event id"})
			return
		}

		if err := db.New(pool).DeleteEvent(r.Context(), int32(id)); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		invalidateEvents(r.Context(), c)
		w.WriteHeader(http.StatusNoContent)
	}
}

// invalidateEvents clears every cached events response — the sitewide
// listing and both scoped listings alike. Event writes are rare and
// admin-driven, so a blanket flush is cheaper than tracking which keys a
// given event touches.
func invalidateEvents(ctx context.Context, c *cache.Cache) {
	if err := c.Invalidate(ctx, "events:*"); err != nil {
		slog.Warn("cache invalidation failed", "pattern", "events:*", "error", err)
	}
}
