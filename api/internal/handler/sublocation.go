package handler

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ListSublocationsByState handles GET /states/{slug}/sublocations.
func ListSublocationsByState(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")

		// First resolve the state to get its ID.
		state, err := db.New(pool).GetStateBySlug(r.Context(), slug)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "state not found"})
			return
		}

		key := "sublocations:state:" + strconv.Itoa(int(state.StateID))
		cachedHandler(c, key, func(w http.ResponseWriter, r *http.Request) {
			rows, err := db.New(pool).ListSublocationsByState(r.Context(), state.StateID)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, rows)
		})(w, r)
	}
}

// GetSublocation handles GET /sublocations/{slug}.
func GetSublocation(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")
		key := "sublocations:slug:" + slug

		cachedHandler(c, key, func(w http.ResponseWriter, r *http.Request) {
			row, err := db.New(pool).GetSublocationBySlug(r.Context(), slug)
			if err != nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "sublocation not found"})
				return
			}
			writeJSON(w, http.StatusOK, row)
		})(w, r)
	}
}

// DeleteSublocation handles DELETE /sublocations/{id} — deletes a sublocation by ID (admin only).
func DeleteSublocation(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		idStr := chi.URLParam(r, "id")
		id, err := strconv.Atoi(idStr)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid sublocation id"})
			return
		}

		if err := db.New(pool).DeleteSublocation(r.Context(), int32(id)); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if err := c.Invalidate(r.Context(), "sublocations:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "sublocations:*", "error", err)
		}
		if err := c.Invalidate(r.Context(), "videos:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "videos:*", "error", err)
		}
		if err := c.Invalidate(r.Context(), "states:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "states:*", "error", err)
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ListSublocationsPaginated handles GET /sublocations?page=1&per_page=20 — paginated list.
func ListSublocationsPaginated(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, offset, page, perPage := parsePagination(r)

		rows, err := db.New(pool).ListSublocationsPaginated(r.Context(), db.ListSublocationsPaginatedParams{
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

type updateSublocationRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	StateID     int32  `json:"state_id"`
	brandingInput
	aboutInput
}

// UpdateSublocation handles PUT /sublocations/{id} — updates a sublocation (admin only).
func UpdateSublocation(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		idStr := chi.URLParam(r, "id")
		id, err := strconv.Atoi(idStr)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid sublocation id"})
			return
		}

		var req updateSublocationRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if req.Name == "" || req.StateID == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and state_id are required"})
			return
		}
		if msg := req.normalize(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}
		if msg := req.normalizeAbout(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}

		if err := db.New(pool).UpdateSublocation(r.Context(), db.UpdateSublocationParams{
			SublocationID: int32(id),
			Name:          req.Name,
			Description:   req.Description,
			StateID:       req.StateID,
			HeroUrl:       req.HeroURL,
			HeroKind:      req.HeroKind,
			LogoUrl:       req.LogoURL,
			SponsorUrl:    req.SponsorURL,
			SponsorLink:   req.SponsorLink,
			About:         req.About,
		}); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		// Re-fetch to return the updated rich type.
		row, err := db.New(pool).GetSublocationByID(r.Context(), int32(id))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if err := c.Invalidate(r.Context(), "sublocations:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "sublocations:*", "error", err)
		}
		if err := c.Invalidate(r.Context(), "states:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "states:*", "error", err)
		}
		writeJSON(w, http.StatusOK, row)
	}
}

type createSublocationRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	StateID     int32  `json:"state_id"`
	brandingInput
	aboutInput
}

// CreateSublocation handles POST /sublocations (admin only).
func CreateSublocation(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createSublocationRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if req.Name == "" || req.StateID == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name and state_id are required"})
			return
		}
		if msg := req.normalize(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}
		if msg := req.normalizeAbout(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}

		created, err := db.New(pool).CreateSublocation(r.Context(), db.CreateSublocationParams{
			Name:        req.Name,
			Description: req.Description,
			StateID:     req.StateID,
			HeroUrl:     req.HeroURL,
			HeroKind:    req.HeroKind,
			LogoUrl:     req.LogoURL,
			SponsorUrl:  req.SponsorURL,
			SponsorLink: req.SponsorLink,
			About:       req.About,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		// Re-fetch with JOINs to return the rich type (includes state_name, video_count).
		row, err := db.New(pool).GetSublocationByID(r.Context(), created.SublocationID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if err := c.Invalidate(r.Context(), "sublocations:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "sublocations:*", "error", err)
		}
		if err := c.Invalidate(r.Context(), "states:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "states:*", "error", err)
		}
		writeJSON(w, http.StatusCreated, row)
	}
}
