package handler

import (
	"context"
	"fmt"
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
// 400 rather than a database error (the columns are unbounded TEXT).
const (
	postTitleMaxLen   = 200
	postExcerptMaxLen = 500
	// Deliberately more generous than about.go's aboutMaxLen — a field note is a
	// full article, not a page blurb.
	postBodyMaxLen = 50000
)

// Pagination defaults for the public listing (GET /posts, no scope filter).
const (
	postsDefaultLimit = 20
	postsMaxLimit     = 100
)

// relatedPostsLimit caps the scoped listings (GET /posts?video_id=|sublocation_id=|state_id=)
// that back the "Field notes" block on a camera/sublocation/state page.
const relatedPostsLimit = 3

type postRequest struct {
	Title         string `json:"title"`
	BodyMD        string `json:"body_md"`
	Excerpt       string `json:"excerpt"`
	CoverURL      string `json:"cover_url"`
	Status        string `json:"status"`
	StateID       *int32 `json:"state_id"`
	SublocationID *int32 `json:"sublocation_id"`
	VideoID       *int32 `json:"video_id"`
}

// validate trims fields, fills defaults and rejects anything the schema would
// otherwise reject with an opaque constraint error — same shape as adRequest.validate.
func (req *postRequest) validate() string {
	req.Title = strings.TrimSpace(req.Title)
	req.Excerpt = strings.TrimSpace(req.Excerpt)

	if req.Title == "" {
		return "title is required"
	}
	if len(req.Title) > postTitleMaxLen {
		return "title is too long"
	}
	if len(req.Excerpt) > postExcerptMaxLen {
		return "excerpt is too long"
	}
	if len(req.BodyMD) > postBodyMaxLen {
		return "body_md is too long"
	}
	// Covers are either an uploaded local path (the dashboard's existing upload
	// flow) or a pasted http(s) URL — reuses the same check as hero/logo/sponsor
	// images on states and sublocations.
	if !validBrandURL(req.CoverURL) {
		return "cover_url must be empty, an http(s) URL, or a local /api/uploads path"
	}
	if req.Status == "" {
		req.Status = "draft"
	}
	if req.Status != "draft" && req.Status != "published" {
		return "status must be draft or published"
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
	return ""
}

// postsPagination reads limit/offset from the query string for the public
// listing. limit defaults to 20 and is capped at 100; offset defaults to 0.
func postsPagination(r *http.Request) (limit, offset int32) {
	limit = postsDefaultLimit
	if l := r.URL.Query().Get("limit"); l != "" {
		if v, err := strconv.Atoi(l); err == nil && v > 0 {
			limit = int32(v)
			if limit > postsMaxLimit {
				limit = postsMaxLimit
			}
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if v, err := strconv.Atoi(o); err == nil && v >= 0 {
			offset = int32(v)
		}
	}
	return limit, offset
}

// postsListResponse wraps the public listing with a has_more flag so /notes
// can paginate without a separate count query.
type postsListResponse struct {
	Data    any  `json:"data"`
	HasMore bool `json:"has_more"`
}

// ListPosts handles GET /posts. With a video_id, sublocation_id or state_id
// query param it returns that scope's published posts (limit 3, for the
// related-notes block); otherwise it returns the full published listing,
// newest published_at first, paginated by limit/offset (default 20).
func ListPosts(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()

		if idStr := q.Get("video_id"); idStr != "" {
			id, ok := parsePositiveInt32(w, idStr, "video_id")
			if !ok {
				return
			}
			key := "posts:by-video:" + idStr
			cachedHandler(c, key, func(w http.ResponseWriter, r *http.Request) {
				rows, err := db.New(pool).ListPublishedPostsByVideo(r.Context(), db.ListPublishedPostsByVideoParams{
					VideoID: &id,
					Limit:   relatedPostsLimit,
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
			key := "posts:by-sublocation:" + idStr
			cachedHandler(c, key, func(w http.ResponseWriter, r *http.Request) {
				rows, err := db.New(pool).ListPublishedPostsBySublocation(r.Context(), db.ListPublishedPostsBySublocationParams{
					SublocationID: &id,
					Limit:         relatedPostsLimit,
				})
				if err != nil {
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
					return
				}
				writeJSON(w, http.StatusOK, rows)
			})(w, r)
			return
		}

		if idStr := q.Get("state_id"); idStr != "" {
			id, ok := parsePositiveInt32(w, idStr, "state_id")
			if !ok {
				return
			}
			key := "posts:by-state:" + idStr
			cachedHandler(c, key, func(w http.ResponseWriter, r *http.Request) {
				rows, err := db.New(pool).ListPublishedPostsByState(r.Context(), db.ListPublishedPostsByStateParams{
					StateID: &id,
					Limit:   relatedPostsLimit,
				})
				if err != nil {
					writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
					return
				}
				writeJSON(w, http.StatusOK, rows)
			})(w, r)
			return
		}

		limit, offset := postsPagination(r)
		key := fmt.Sprintf("posts:list:%d:%d", limit, offset)
		cachedHandler(c, key, func(w http.ResponseWriter, r *http.Request) {
			rows, err := db.New(pool).ListPublishedPosts(r.Context(), db.ListPublishedPostsParams{
				Limit:  limit + 1,
				Offset: offset,
			})
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
				return
			}
			hasMore := len(rows) > int(limit)
			if hasMore {
				rows = rows[:limit]
			}
			writeJSON(w, http.StatusOK, postsListResponse{Data: rows, HasMore: hasMore})
		})(w, r)
	}
}

// parsePositiveInt32 parses a positive int query value, writing a 400 and
// returning ok=false on failure.
func parsePositiveInt32(w http.ResponseWriter, raw, name string) (int32, bool) {
	v, err := strconv.Atoi(raw)
	if err != nil || v <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid " + name})
		return 0, false
	}
	return int32(v), true
}

// GetPostBySlug handles GET /posts/{slug} — published only, 404 otherwise so a
// draft's slug is never reachable from the public site.
func GetPostBySlug(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")
		key := "posts:slug:" + slug

		cachedHandler(c, key, func(w http.ResponseWriter, r *http.Request) {
			row, err := db.New(pool).GetPublishedPostBySlug(r.Context(), slug)
			if err != nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "post not found"})
				return
			}
			writeJSON(w, http.StatusOK, row)
		})(w, r)
	}
}

// ────────────────────────────────────────────────
// Admin CRUD
// ────────────────────────────────────────────────

// ListAllPosts handles GET /posts/all — every post regardless of status
// (admin only). Not cached: the dashboard list must always show the latest
// draft/publish state.
func ListAllPosts(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.New(pool).ListAllPosts(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// publishedAtFor decides the published_at to persist: filling it with now()
// the first time a post transitions to published, and otherwise leaving
// whatever the row already had — draft, or a previous publish date. This is
// the "publishing sets published_at when empty" rule from the spec.
func publishedAtFor(status string, existing pgtype.Timestamptz) pgtype.Timestamptz {
	if status == "published" && !existing.Valid {
		return pgtype.Timestamptz{Time: time.Now(), Valid: true}
	}
	return existing
}

// CreatePost handles POST /posts (admin only).
func CreatePost(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req postRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if msg := req.validate(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}

		publishedAt := publishedAtFor(req.Status, pgtype.Timestamptz{})

		created, err := db.New(pool).CreatePost(r.Context(), db.CreatePostParams{
			Title:         req.Title,
			BodyMd:        req.BodyMD,
			Excerpt:       req.Excerpt,
			CoverUrl:      req.CoverURL,
			StateID:       req.StateID,
			SublocationID: req.SublocationID,
			VideoID:       req.VideoID,
			Status:        req.Status,
			PublishedAt:   publishedAt,
			CreatedBy:     middleware.UserID(r.Context()),
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		invalidatePosts(r.Context(), c)
		writeJSON(w, http.StatusCreated, created)
	}
}

// UpdatePost handles PUT /posts/{id} (admin only).
func UpdatePost(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(chi.URLParam(r, "id"))
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid post id"})
			return
		}

		var req postRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if msg := req.validate(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}

		existing, err := db.New(pool).GetPost(r.Context(), int32(id))
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "post not found"})
			return
		}
		publishedAt := publishedAtFor(req.Status, existing.PublishedAt)

		updated, err := db.New(pool).UpdatePost(r.Context(), db.UpdatePostParams{
			PostID:        int32(id),
			Title:         req.Title,
			BodyMd:        req.BodyMD,
			Excerpt:       req.Excerpt,
			CoverUrl:      req.CoverURL,
			StateID:       req.StateID,
			SublocationID: req.SublocationID,
			VideoID:       req.VideoID,
			Status:        req.Status,
			PublishedAt:   publishedAt,
		})
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "post not found"})
			return
		}

		invalidatePosts(r.Context(), c)
		writeJSON(w, http.StatusOK, updated)
	}
}

// DeletePost handles DELETE /posts/{id} (admin only).
func DeletePost(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.Atoi(chi.URLParam(r, "id"))
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid post id"})
			return
		}

		if err := db.New(pool).DeletePost(r.Context(), int32(id)); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		invalidatePosts(r.Context(), c)
		w.WriteHeader(http.StatusNoContent)
	}
}

// invalidatePosts clears every cached posts response — lists, scoped
// listings and individual slugs alike. Post writes are rare and admin-driven,
// so a blanket flush is cheaper than tracking which keys a given post touches.
func invalidatePosts(ctx context.Context, c *cache.Cache) {
	if err := c.Invalidate(ctx, "posts:*"); err != nil {
		slog.Warn("cache invalidation failed", "pattern", "posts:*", "error", err)
	}
}
