package handler

import (
	"bytes"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/brandon-relentnet/nationcam/api/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ListVideos handles GET /videos with optional query params: state_id, sublocation_id.
func ListVideos(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()

		if subIDStr := q.Get("sublocation_id"); subIDStr != "" {
			subID, err := strconv.Atoi(subIDStr)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid sublocation_id"})
				return
			}
			key := "videos:sublocation:" + subIDStr
			cachedHandler(c, key, func(w http.ResponseWriter, r *http.Request) {
				subID32 := int32(subID)
				rows, err := db.New(pool).ListVideosBySublocation(r.Context(), &subID32)
				if err != nil {
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
					return
				}
				writeJSON(w, http.StatusOK, rows)
			})(w, r)
			return
		}

		if stateIDStr := q.Get("state_id"); stateIDStr != "" {
			stateID, err := strconv.Atoi(stateIDStr)
			if err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid state_id"})
				return
			}
			key := "videos:state:" + stateIDStr
			cachedHandler(c, key, func(w http.ResponseWriter, r *http.Request) {
				rows, err := db.New(pool).ListVideosByState(r.Context(), int32(stateID))
				if err != nil {
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
					return
				}
				writeJSON(w, http.StatusOK, rows)
			})(w, r)
			return
		}

		// No filter — return all active videos.
		cachedHandler(c, "videos:all", func(w http.ResponseWriter, r *http.Request) {
			rows, err := db.New(pool).ListVideos(r.Context())
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, rows)
		})(w, r)
	}
}

// viewFlushThreshold is how many buffered views accumulate in Redis before one
// Postgres write drains them.
const viewFlushThreshold = 10

// cameraPage is the payload for a single camera page: the camera itself plus the
// handful of related cameras rendered beside it, so SSR needs one round trip.
type cameraPage struct {
	Camera  db.GetVideoBySlugRow      `json:"camera"`
	Related []db.ListRelatedVideosRow `json:"related"`
}

// GetVideo handles GET /videos/{stateSlug}/{sublocationSlug}/{slug} — the public
// per-camera page. Cameras with no sublocation are not reachable here; the URL
// shape requires a sublocation segment.
func GetVideo(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		params := db.GetVideoBySlugParams{
			StateSlug:       chi.URLParam(r, "stateSlug"),
			SublocationSlug: chi.URLParam(r, "sublocationSlug"),
			Slug:            chi.URLParam(r, "slug"),
		}

		key := "videos:camera:" + params.StateSlug + ":" + params.SublocationSlug + ":" + params.Slug
		handler := cachedHandler(c, key, func(w http.ResponseWriter, r *http.Request) {
			q := db.New(pool)
			camera, err := q.GetVideoBySlug(r.Context(), params)
			if err != nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "camera not found"})
				return
			}

			related, err := q.ListRelatedVideos(r.Context(), db.ListRelatedVideosParams{
				VideoID:       camera.VideoID,
				SublocationID: camera.SublocationID,
				StateID:       camera.StateID,
			})
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}

			writeJSON(w, http.StatusOK, cameraPage{Camera: camera, Related: related})
		})

		// Counted outside cachedHandler so cache hits still register a view, and
		// only on a 200 so requests for slugs that do not exist cannot fill Redis
		// with counter keys. On a cache hit the status is the only signal there is.
		rec := &responseRecorder{ResponseWriter: w, body: &bytes.Buffer{}}
		handler(rec, r)
		if rec.status == http.StatusOK {
			recordView(r, pool, c, params)
		}
	}
}

// recordView buffers one view in Redis and flushes to Postgres every
// viewFlushThreshold views, so the hot path is a single INCR rather than a write.
//
// ponytail: counts raw requests with no bot or repeat-visitor filtering, and the
// flush is not atomic — a crash between the UPDATE and the DecrBy double-counts up
// to viewFlushThreshold views, a Redis flush loses up to that many, and the
// view_count in the response lags by the same amount. Fine for a "views" badge;
// move to a real analytics pipeline if the number ever has to be exact or
// ad-billable.
func recordView(r *http.Request, pool *pgxpool.Pool, c *cache.Cache, params db.GetVideoBySlugParams) {
	ctx := r.Context()
	key := "views:pending:" + params.StateSlug + ":" + params.SublocationSlug + ":" + params.Slug

	pending, err := c.Incr(ctx, key)
	if err != nil {
		slog.Warn("view counter increment failed", "key", key, "error", err)
		return
	}
	if pending < viewFlushThreshold {
		return
	}

	q := db.New(pool)
	camera, err := q.GetVideoBySlug(ctx, params)
	if err != nil {
		return // Unknown slug — nothing to flush to.
	}
	if err := q.IncrementVideoViews(ctx, db.IncrementVideoViewsParams{
		VideoID:   camera.VideoID,
		ViewCount: pending,
	}); err != nil {
		slog.Warn("view counter flush failed", "video_id", camera.VideoID, "error", err)
		return // Leave the buffer intact; the next request retries.
	}
	if err := c.DecrBy(ctx, key, pending); err != nil {
		slog.Warn("view counter drain failed", "key", key, "error", err)
	}
}

// DeleteVideo handles DELETE /videos/{id} — deletes a video by ID (admin only).
func DeleteVideo(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		idStr := chi.URLParam(r, "id")
		id, err := strconv.Atoi(idStr)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid video id"})
			return
		}

		if err := db.New(pool).DeleteVideo(r.Context(), int32(id)); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if err := c.Invalidate(r.Context(), "videos:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "videos:*", "error", err)
		}
		if err := c.Invalidate(r.Context(), "states:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "states:*", "error", err)
		}
		if err := c.Invalidate(r.Context(), "sublocations:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "sublocations:*", "error", err)
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ListVideosPaginated handles GET /videos/paginated?page=1&per_page=20 — paginated list.
func ListVideosPaginated(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, offset, page, perPage := parsePagination(r)

		rows, err := db.New(pool).ListVideosPaginated(r.Context(), db.ListVideosPaginatedParams{
			Limit:  limit,
			Offset: offset,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		var total int32
		if len(rows) > 0 {
			total = rows[0].TotalCount
		}

		writeJSON(w, http.StatusOK, paginatedResponse{
			Data:    rows,
			Total:   total,
			Page:    page,
			PerPage: perPage,
		})
	}
}

type updateVideoRequest struct {
	Title         string `json:"title"`
	Src           string `json:"src"`
	Type          string `json:"type"`
	StateID       int32  `json:"state_id"`
	SublocationID *int32 `json:"sublocation_id"`
	Status        string `json:"status"`
}

// UpdateVideo handles PUT /videos/{id} — updates a video (admin only).
func UpdateVideo(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		idStr := chi.URLParam(r, "id")
		id, err := strconv.Atoi(idStr)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid video id"})
			return
		}

		var req updateVideoRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if req.Title == "" || req.Src == "" || req.StateID == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title, src, and state_id are required"})
			return
		}
		if req.Type == "" {
			req.Type = "application/x-mpegURL"
		}
		if req.Status == "" {
			req.Status = "active"
		}

		if err := db.New(pool).UpdateVideo(r.Context(), db.UpdateVideoParams{
			VideoID:       int32(id),
			Title:         req.Title,
			Src:           req.Src,
			Type:          req.Type,
			StateID:       req.StateID,
			SublocationID: req.SublocationID,
			Status:        req.Status,
		}); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		// Re-fetch to return the updated rich type.
		row, err := db.New(pool).GetVideoByID(r.Context(), int32(id))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if err := c.Invalidate(r.Context(), "videos:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "videos:*", "error", err)
		}
		if err := c.Invalidate(r.Context(), "states:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "states:*", "error", err)
		}
		writeJSON(w, http.StatusOK, row)
	}
}

type createVideoRequest struct {
	Title         string `json:"title"`
	Src           string `json:"src"`
	Type          string `json:"type"`
	StateID       int32  `json:"state_id"`
	SublocationID *int32 `json:"sublocation_id"`
	Status        string `json:"status"`
}

// CreateVideo handles POST /videos (admin only).
func CreateVideo(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createVideoRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if req.Title == "" || req.Src == "" || req.StateID == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title, src, and state_id are required"})
			return
		}
		if req.Type == "" {
			req.Type = "application/x-mpegURL"
		}
		if req.Status == "" {
			req.Status = "active"
		}

		created, err := db.New(pool).CreateVideo(r.Context(), db.CreateVideoParams{
			Title:         req.Title,
			Src:           req.Src,
			Type:          req.Type,
			StateID:       req.StateID,
			SublocationID: req.SublocationID,
			Status:        req.Status,
			CreatedBy:     middleware.UserID(r.Context()),
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		// Re-fetch with JOINs to return the rich type (includes state_name, sublocation_name).
		row, err := db.New(pool).GetVideoByID(r.Context(), created.VideoID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if err := c.Invalidate(r.Context(), "videos:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "videos:*", "error", err)
		}
		if err := c.Invalidate(r.Context(), "states:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "states:*", "error", err)
		}
		writeJSON(w, http.StatusCreated, row)
	}
}
