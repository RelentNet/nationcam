package handler

import (
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/archive"
	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

// todayFramesTTL is the cache life of today's frame list — a new still lands
// every 15 minutes, so the default 5-minute TTL would hide it for too long.
const todayFramesTTL = 60 * time.Second

// framesResponse is the body of GET .../frames.
type framesResponse struct {
	Day    string          `json:"day"`
	Frames []archive.Frame `json:"frames"`
}

// ListFrames handles GET /videos/{stateSlug}/{sublocationSlug}/{slug}/frames?day=YYYY-MM-DD
// — the archived stills for one camera on one local (America/Chicago) day,
// sorted by time. A missing day means today; a day with nothing is 200 with an
// empty list; an unknown camera is 404; a malformed day is 400.
func ListFrames(pool *pgxpool.Pool, c *cache.Cache, store *archive.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		day, err := resolveDay(r.URL.Query().Get("day"))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "day must be YYYY-MM-DD"})
			return
		}
		params := cameraParams(r)

		ttl := cache.DefaultTTL
		if day == archive.Today() {
			ttl = todayFramesTTL
		}
		// Under videos: so any camera write invalidates it along with the rest.
		key := "videos:frames:" + params.StateSlug + ":" + params.SublocationSlug + ":" + params.Slug + ":" + day
		cachedHandlerTTL(c, key, ttl, func(w http.ResponseWriter, r *http.Request) {
			camera, err := db.New(pool).GetVideoBySlug(r.Context(), params)
			if err != nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "camera not found"})
				return
			}
			frames, err := store.Frames(camera.VideoID, day)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not read archive"})
				return
			}
			writeJSON(w, http.StatusOK, framesResponse{Day: day, Frames: frames})
		})(w, r)
	}
}

// ListFrameDays handles GET /videos/{stateSlug}/{sublocationSlug}/{slug}/frames/days
// — the local days that hold at least one archived still, newest first.
func ListFrameDays(pool *pgxpool.Pool, c *cache.Cache, store *archive.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		params := cameraParams(r)
		key := "videos:frames-days:" + params.StateSlug + ":" + params.SublocationSlug + ":" + params.Slug
		cachedHandler(c, key, func(w http.ResponseWriter, r *http.Request) {
			camera, err := db.New(pool).GetVideoBySlug(r.Context(), params)
			if err != nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "camera not found"})
				return
			}
			days, err := store.Days(camera.VideoID)
			if err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not read archive"})
				return
			}
			writeJSON(w, http.StatusOK, map[string][]string{"days": days})
		})(w, r)
	}
}

// resolveDay turns the ?day= query into an archive day: today when empty,
// otherwise a validated YYYY-MM-DD.
func resolveDay(q string) (string, error) {
	if q == "" {
		return archive.Today(), nil
	}
	return archive.ParseDay(q)
}

// ServeSnapshots serves archived stills read-only at /snapshots/{video_id}/{day}/{HHMM}.jpg
// (GET/HEAD). Unlike ServeUploads it does not hand the path to http.FileServer:
// the three components are validated against the exact shape the archive
// writes before any file is opened, so traversal cannot reach the filesystem.
// A frame never changes once written, hence the immutable cache header.
func ServeSnapshots(store *archive.Store) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		rel := strings.TrimPrefix(r.URL.Path, "/snapshots/")
		path, err := store.Resolve(rel)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		f, err := os.Open(path)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		http.ServeContent(w, r, info.Name(), info.ModTime(), f)
	})
}
