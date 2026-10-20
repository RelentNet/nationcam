package handler

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"path"
	"strconv"

	"github.com/brandon-relentnet/nationcam/api/internal/archive"
	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	mw "github.com/brandon-relentnet/nationcam/api/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Private cameras (DAN-205). A camera or a location has a visibility,
// 'public' (default) or 'private'; a private location hides every camera in
// it. A private camera is absent from every public query (the predicate in
// videos.sql/sublocations.sql/states.sql, events.sql and posts.sql), and its
// live stream, latest still and archived frames are reachable only by someone
// CanViewCamera says yes to:
//
//   - the live stream through GET /videos/{id}/stream-token (private-scope
//     token, see hlssign.go) and the same /hls proxy as a public camera;
//   - the still and the archive through the bearer-authenticated
//     /private/videos/{id}/... routes below.
//
// Only NationCam admins change visibility. No public or account-member
// response carries a private camera's raw Restreamer src or stream id.

const (
	visibilityPublic  = "public"
	visibilityPrivate = "private"

	// privatePathPrefix is the browser-facing base of the private routes.
	privatePathPrefix = "/api/private/videos/"
	// privateStillCacheControl keeps a private still out of shared caches.
	privateStillCacheControl = "private, max-age=60"
	// privateFrameCacheControl: an archived frame never changes, but it must
	// never sit in a shared cache, and a revoked member should not keep it
	// for a year.
	privateFrameCacheControl = "private, max-age=3600"
)

// isPrivateVisibility reports whether a camera with these two visibilities
// (its own, and its sublocation's — "" when it has none) is private.
func isPrivateVisibility(video, sublocation string) bool {
	return video == visibilityPrivate || sublocation == visibilityPrivate
}

// privateStore is what the authenticated private routes need; pgHLSStore
// satisfies it.
type privateStore interface {
	PlayableVideoSource(ctx context.Context, videoID int32) (db.GetPlayableVideoSourceRow, error)
	CameraAccessQuerier
}

// mountPrivateRoutes wires the bearer-authenticated camera routes. They work
// for any camera the caller CanViewCamera (a member or a NationCam admin),
// public or private; everyone else gets 404, so a non-member cannot tell a
// private camera exists. snapshots may be nil (no archive): the frame routes
// then answer empty lists and 404s.
func mountPrivateRoutes(r chi.Router, store privateStore, c *cache.Cache, snapshots *archive.Store, client *http.Client) {
	r.Route("/private/videos/{id}", func(r chi.Router) {
		r.Use(mw.RequireUser)
		r.Get("/snapshot.jpg", privateSnapshot(store, c, client))
		r.Get("/frames", privateFrames(store, snapshots))
		r.Get("/frames/days", privateFrameDays(store, snapshots))
		r.Get("/frames/{day}/{file}", privateFrameFile(store, snapshots))
	})
}

// viewableCamera parses {id} and answers 404 (or 500) itself unless the
// caller can view that camera.
func viewableCamera(w http.ResponseWriter, r *http.Request, store privateStore) (int32, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 32)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "camera not found"})
		return 0, false
	}
	ctx := r.Context()
	ok, err := CanViewCamera(ctx, store, mw.UserID(ctx), mw.IsAdmin(ctx), int32(id))
	if err != nil {
		slog.Warn("private: access check failed", "video_id", id, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "lookup failed"})
		return 0, false
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "camera not found"})
		return 0, false
	}
	return int32(id), true
}

// privateSnapshot handles GET /private/videos/{id}/snapshot.jpg — the
// camera's latest watermarked still, same pipeline and ?w= widths as the
// public snapshot.jpg. Cached in Redis under its own key (never the public
// poster's), checked for access before the cache is read.
func privateSnapshot(store privateStore, c *cache.Cache, client *http.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := viewableCamera(w, r, store)
		if !ok {
			return
		}
		tw, ok := parseThumbWidth(r)
		if !ok {
			badWidth(w)
			return
		}
		ctx := r.Context()
		key := fmt.Sprintf("videos:private-snapshot:%d", id)
		thumbKey := key + ":w" + strconv.Itoa(tw)
		if tw != 0 {
			if img := cacheGet(ctx, c, thumbKey); img != "" {
				writePrivateStill(w, img)
				return
			}
		}
		img := cacheGet(ctx, c, key)
		if img == "" {
			src, err := store.PlayableVideoSource(ctx, id)
			if err != nil || !memfsHLS.MatchString(src.Src) {
				if err != nil && !errors.Is(err, pgx.ErrNoRows) {
					slog.Warn("private: source lookup failed", "video_id", id, "err", err)
				}
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "no snapshot for this camera"})
				return
			}
			b, err := SnapshotForSource(ctx, client, src.Src)
			if err != nil {
				slog.Warn("private snapshot fetch failed", "video_id", id, "error", err)
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": "snapshot unavailable"})
				return
			}
			img = string(b)
			cacheSet(ctx, c, key, img)
		}
		if tw != 0 {
			b, err := resizeJPEG([]byte(img), tw)
			if err != nil {
				slog.Warn("private snapshot resize failed", "video_id", id, "error", err)
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": "snapshot unavailable"})
				return
			}
			img = string(b)
			cacheSet(ctx, c, thumbKey, img)
		}
		writePrivateStill(w, img)
	}
}

func writePrivateStill(w http.ResponseWriter, img string) {
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", privateStillCacheControl)
	_, _ = w.Write([]byte(img))
}

func cacheGet(ctx context.Context, c *cache.Cache, key string) string {
	if c == nil {
		return ""
	}
	v, _ := c.Get(ctx, key)
	return v
}

func cacheSet(ctx context.Context, c *cache.Cache, key, val string) {
	if c != nil {
		_ = c.Set(ctx, key, val, snapshotTTL)
	}
}

// privateFrameURL is the browser-facing URL of one archived frame on the
// private route.
func privateFrameURL(videoID int32, day, file string) string {
	return fmt.Sprintf("%s%d/frames/%s/%s", privatePathPrefix, videoID, day, file)
}

// privateFrames handles GET /private/videos/{id}/frames?day= — the same body
// as the public frames listing, with every URL on the private file route.
// Not cached (per caller, and a directory read is cheap).
func privateFrames(store privateStore, snapshots *archive.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := viewableCamera(w, r, store)
		if !ok {
			return
		}
		day, err := resolveDay(r.URL.Query().Get("day"))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "day must be YYYY-MM-DD"})
			return
		}
		frames := []archive.Frame{}
		if snapshots != nil {
			frames, err = snapshots.Frames(id, day)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not read archive"})
				return
			}
		}
		for i := range frames {
			frames[i].URL = privateFrameURL(id, day, path.Base(frames[i].URL))
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, framesResponse{Day: day, Frames: frames})
	}
}

// privateFrameDays handles GET /private/videos/{id}/frames/days.
func privateFrameDays(store privateStore, snapshots *archive.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := viewableCamera(w, r, store)
		if !ok {
			return
		}
		days := []string{}
		if snapshots != nil {
			var err error
			days, err = snapshots.Days(id)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not read archive"})
				return
			}
		}
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, http.StatusOK, map[string][]string{"days": days})
	}
}

// privateFrameFile handles GET /private/videos/{id}/frames/{day}/{HHMM}.jpg
// (and ?w=320|640) — one archived frame, validated by the same
// archive.Resolve as the public /snapshots route.
func privateFrameFile(store privateStore, snapshots *archive.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := viewableCamera(w, r, store)
		if !ok {
			return
		}
		if snapshots == nil {
			http.NotFound(w, r)
			return
		}
		rel := fmt.Sprintf("%d/%s/%s", id, chi.URLParam(r, "day"), chi.URLParam(r, "file"))
		serveArchiveFile(w, r, snapshots, rel, privateFrameCacheControl)
	}
}

// VideoPrivacy is the visibility lookup behind the public /snapshots route:
// true for a private camera or a camera in a private location, false for an
// unknown id.
func VideoPrivacy(pool *pgxpool.Pool) func(ctx context.Context, videoID int32) (bool, error) {
	return func(ctx context.Context, videoID int32) (bool, error) {
		private, err := db.New(pool).IsVideoPrivate(ctx, videoID)
		if isNotFound(err) {
			return false, nil
		}
		return private, err
	}
}

// ── Admin visibility switch ───────────────────────────────────────

// visibilityStore is the slice of the queries the two admin switches need;
// *db.Queries satisfies it.
type visibilityStore interface {
	SetVideoVisibility(ctx context.Context, arg db.SetVideoVisibilityParams) (int64, error)
	SetSublocationVisibility(ctx context.Context, arg db.SetSublocationVisibilityParams) (int64, error)
}

type visibilityRequest struct {
	Visibility string `json:"visibility"`
}

// readVisibility parses {id} and the body, answering 404/400 itself.
func readVisibility(w http.ResponseWriter, r *http.Request, kind string) (int32, string, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 32)
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": kind + " not found"})
		return 0, "", false
	}
	var req visibilityRequest
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return 0, "", false
	}
	if req.Visibility != visibilityPublic && req.Visibility != visibilityPrivate {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "visibility must be public or private"})
		return 0, "", false
	}
	return int32(id), req.Visibility, true
}

// SetVideoVisibility handles PUT /videos/{id}/visibility — { visibility:
// public|private }, NationCam admin only. Flushes the catalog caches so the
// camera leaves (or joins) every public list at once.
func SetVideoVisibility(store visibilityStore, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, vis, ok := readVisibility(w, r, "camera")
		if !ok {
			return
		}
		n, err := store.SetVideoVisibility(r.Context(), db.SetVideoVisibilityParams{VideoID: id, Visibility: vis})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if n == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "camera not found"})
			return
		}
		invalidateCatalog(r.Context(), c)
		writeJSON(w, http.StatusOK, map[string]any{"video_id": id, "visibility": vis})
	}
}

// SetSublocationVisibility handles PUT /sublocations/{id}/visibility — a
// private location hides itself and every camera in it.
func SetSublocationVisibility(store visibilityStore, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, vis, ok := readVisibility(w, r, "sublocation")
		if !ok {
			return
		}
		n, err := store.SetSublocationVisibility(r.Context(), db.SetSublocationVisibilityParams{SublocationID: id, Visibility: vis})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if n == 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "sublocation not found"})
			return
		}
		invalidateCatalog(r.Context(), c)
		writeJSON(w, http.StatusOK, map[string]any{"sublocation_id": id, "visibility": vis})
	}
}

// ── Member responses ──────────────────────────────────────────────

// redactOwnerVideo hides a private camera's raw Restreamer src and stream id
// from an account-member response: the src becomes the /api/hls proxy form
// (played with a stream token), the stream id null. Public cameras are
// returned unchanged.
func redactOwnerVideo(v db.GetVideoForOwnerRow) db.GetVideoForOwnerRow {
	if isPrivateVisibility(v.Visibility, v.SublocationVisibility) {
		v.Src = hlsPublicSrc(v.VideoID, v.Src)
		v.StreamID = pgtype.Text{}
	}
	return v
}

func redactOwnerVideos(rows []db.ListOwnerVideosRow) []db.ListOwnerVideosRow {
	for i := range rows {
		if isPrivateVisibility(rows[i].Visibility, rows[i].SublocationVisibility) {
			rows[i].Src = hlsPublicSrc(rows[i].VideoID, rows[i].Src)
			rows[i].StreamID = pgtype.Text{}
		}
	}
	return rows
}
