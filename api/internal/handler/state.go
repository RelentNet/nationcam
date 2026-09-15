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

const statesAllKey = "states:all"

// ListStates handles GET /states — returns all states with video counts (cached).
func ListStates(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return cachedHandler(c, statesAllKey, func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.New(pool).ListStates(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, rows)
	})
}

// GetState handles GET /states/{slug} — returns a single state by slug (cached).
func GetState(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")
		key := "states:slug:" + slug

		cachedHandler(c, key, func(w http.ResponseWriter, r *http.Request) {
			row, err := db.New(pool).GetStateBySlug(r.Context(), slug)
			if err != nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "state not found"})
				return
			}
			writeJSON(w, http.StatusOK, row)
		})(w, r)
	}
}

// DeleteState handles DELETE /states/{slug} — deletes a state and cascades (admin only).
func DeleteState(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")
		if slug == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "slug is required"})
			return
		}

		if err := db.New(pool).DeleteState(r.Context(), slug); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if err := c.Invalidate(r.Context(), "states:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "states:*", "error", err)
		}
		if err := c.Invalidate(r.Context(), "sublocations:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "sublocations:*", "error", err)
		}
		if err := c.Invalidate(r.Context(), "videos:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "videos:*", "error", err)
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ListStatesPaginated handles GET /states?page=1&per_page=20 — paginated list.
func ListStatesPaginated(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		limit, offset, page, perPage := parsePagination(r)

		rows, err := db.New(pool).ListStatesPaginated(r.Context(), db.ListStatesPaginatedParams{
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

type updateStateRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// Upcoming marks a state whose first camera is confirmed but not yet live.
	Upcoming bool `json:"upcoming"`
	brandingInput
	aboutInput
}

// UpdateState handles PUT /states/{id} — updates a state (admin only).
func UpdateState(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		idStr := chi.URLParam(r, "id")
		id, err := strconv.Atoi(idStr)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid state id"})
			return
		}

		var req updateStateRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if req.Name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
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

		if err := db.New(pool).UpdateState(r.Context(), db.UpdateStateParams{
			StateID:     int32(id),
			Name:        req.Name,
			Description: req.Description,
			HeroUrl:     req.HeroURL,
			HeroKind:    req.HeroKind,
			LogoUrl:     req.LogoURL,
			SponsorUrl:  req.SponsorURL,
			SponsorLink: req.SponsorLink,
			TitleUrl:    req.TitleURL,
			TourismName: req.TourismName,
			TourismUrl:  req.TourismURL,
			About:       req.About,
			Upcoming:    req.Upcoming,
		}); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		// Re-fetch to return the updated rich type.
		row, err := db.New(pool).GetStateByID(r.Context(), int32(id))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if err := c.Invalidate(r.Context(), "states:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "states:*", "error", err)
		}
		writeJSON(w, http.StatusOK, row)
	}
}

type createStateRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Upcoming    bool   `json:"upcoming"`
	brandingInput
	aboutInput
}

// CreateState handles POST /states — creates a new state (admin only).
func CreateState(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createStateRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if req.Name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required"})
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

		created, err := db.New(pool).CreateState(r.Context(), db.CreateStateParams{
			Name:        req.Name,
			Description: req.Description,
			HeroUrl:     req.HeroURL,
			HeroKind:    req.HeroKind,
			LogoUrl:     req.LogoURL,
			SponsorUrl:  req.SponsorURL,
			SponsorLink: req.SponsorLink,
			TitleUrl:    req.TitleURL,
			TourismName: req.TourismName,
			TourismUrl:  req.TourismURL,
			About:       req.About,
			Upcoming:    req.Upcoming,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		// Re-fetch with JOINs to return the rich type (includes video_count).
		row, err := db.New(pool).GetStateByID(r.Context(), created.StateID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		if err := c.Invalidate(r.Context(), "states:*"); err != nil {
			slog.Warn("cache invalidation failed", "pattern", "states:*", "error", err)
		}
		writeJSON(w, http.StatusCreated, row)
	}
}
