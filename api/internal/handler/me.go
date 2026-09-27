package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/brandon-relentnet/nationcam/api/internal/middleware"
	"github.com/brandon-relentnet/nationcam/api/internal/restreamer"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Owner endpoints (DAN-39): everything under /me, mounted behind
// middleware.RequireUser. The token's `sub` is the owner id; every row
// lookup goes through loadOwnedSublocation / loadOwnedVideo, which 403 on
// someone else's row (and 404 on none). Admin-owned legacy rows have
// owner_id '' and are therefore never reachable here — RequireUser
// guarantees a non-empty subject.
//
// Nothing here is Redis-cached (responses are per user), but every write
// flushes the public catalog caches: a sublocation edit changes the public
// page once approved, and every status transition changes what the public
// lists return.

// ── GET /me ──────────────────────────────────────────────────────────

type meLimits struct {
	MaxCameras int `json:"max_cameras"`
	PerDay     int `json:"per_day"`
}

type meCounts struct {
	Sublocations int32 `json:"sublocations"`
	Videos       int32 `json:"videos"`
}

type meResponse struct {
	UserID  string   `json:"user_id"`
	IsAdmin bool     `json:"is_admin"`
	Limits  meLimits `json:"limits"`
	Counts  meCounts `json:"counts"`
}

// GetMe handles GET /me — who the caller is, whether the token carries the
// admin scope, the owner limits, and how many rows they own. Works for
// admins too: their own rows (if any) are counted the same way.
func GetMe(store ownerStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		owner := middleware.UserID(ctx)

		subs, err := store.CountOwnerSublocations(ctx, owner)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		vids, err := store.CountOwnerVideos(ctx, owner)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		writeJSON(w, http.StatusOK, meResponse{
			UserID:  owner,
			IsAdmin: middleware.IsAdmin(ctx),
			Limits:  meLimits{MaxCameras: ownerMaxCameras, PerDay: ownerCamerasPerDay},
			Counts:  meCounts{Sublocations: subs, Videos: vids},
		})
	}
}

// ── Sublocations ─────────────────────────────────────────────────────

// ownerSublocationRequest is the body of POST and PUT /me/sublocations. It is
// the host/visit subset of the admin body — no branding, no editorial copy,
// no conditions overrides; those stay admin-only.
type ownerSublocationRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	StateID     int32  `json:"state_id"`
	hostInput
}

// ownerSublocationMaxName bounds the free-text fields an owner can write.
const (
	ownerSublocationMaxName = 120
	ownerMaxDescription     = 2000
)

func (req *ownerSublocationRequest) normalize() string {
	req.Name = strings.TrimSpace(req.Name)
	req.Description = strings.TrimSpace(req.Description)
	if req.Name == "" || req.StateID == 0 {
		return "name and state_id are required"
	}
	if len(req.Name) > ownerSublocationMaxName {
		return "name must be at most 120 characters"
	}
	if len(req.Description) > ownerMaxDescription {
		return "description must be at most 2000 characters"
	}
	return req.normalizeHost()
}

// ListMySublocations handles GET /me/sublocations — every sublocation the
// caller owns, any status, with its review note.
func ListMySublocations(store ownerStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := store.ListOwnerSublocations(r.Context(), middleware.UserID(r.Context()))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// CreateMySublocation handles POST /me/sublocations — a new sublocation in
// status pending, owned by the caller.
func CreateMySublocation(store ownerStore, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req ownerSublocationRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if msg := req.normalize(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}

		ctx := r.Context()
		id, err := store.CreateOwnerSublocation(ctx, db.CreateOwnerSublocationParams{
			Name:        req.Name,
			Description: req.Description,
			StateID:     req.StateID,
			Address:     req.Address,
			Lat:         req.Lat,
			Lng:         req.Lng,
			HostName:    req.HostName,
			HostUrl:     req.HostURL,
			HostSince:   req.HostSince,
			OwnerID:     middleware.UserID(ctx),
		})
		if err != nil {
			if isForeignKeyViolation(err) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown state_id"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		row, err := store.GetSublocationForOwner(ctx, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		invalidateCatalog(ctx, c)
		writeJSON(w, http.StatusCreated, row)
	}
}

// UpdateMySublocation handles PUT /me/sublocations/{id} — same fields as
// create; status and review note are left as they are.
func UpdateMySublocation(store ownerStore, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub, ok := loadOwnedSublocation(w, r, store)
		if !ok {
			return
		}
		var req ownerSublocationRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if msg := req.normalize(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}

		ctx := r.Context()
		if err := store.UpdateOwnerSublocation(ctx, db.UpdateOwnerSublocationParams{
			SublocationID: sub.SublocationID,
			Name:          req.Name,
			Description:   req.Description,
			StateID:       req.StateID,
			Address:       req.Address,
			Lat:           req.Lat,
			Lng:           req.Lng,
			HostName:      req.HostName,
			HostUrl:       req.HostURL,
			HostSince:     req.HostSince,
		}); err != nil {
			if isForeignKeyViolation(err) {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown state_id"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		row, err := store.GetSublocationForOwner(ctx, sub.SublocationID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		invalidateCatalog(ctx, c)
		writeJSON(w, http.StatusOK, row)
	}
}

// DeleteMySublocation handles DELETE /me/sublocations/{id} — only while it
// has no cameras (any status); 409 otherwise, so a camera is never orphaned
// or silently detached.
func DeleteMySublocation(store ownerStore, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub, ok := loadOwnedSublocation(w, r, store)
		if !ok {
			return
		}
		ctx := r.Context()
		id := sub.SublocationID
		n, err := store.CountVideosInSublocation(ctx, &id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if n > 0 {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "delete or move its cameras first"})
			return
		}
		if err := store.DeleteSublocation(ctx, id); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		invalidateCatalog(ctx, c)
		w.WriteHeader(http.StatusNoContent)
	}
}

// ── Videos ───────────────────────────────────────────────────────────

type createMyVideoRequest struct {
	Title         string `json:"title"`
	RTSPURL       string `json:"rtsp_url"`
	SublocationID int32  `json:"sublocation_id"`
	aboutInput
}

type updateMyVideoRequest struct {
	Title string `json:"title"`
	aboutInput
}

// ownerVideoMaxTitle bounds a camera title (it becomes the slug too).
const ownerVideoMaxTitle = 120

// ListMyVideos handles GET /me/videos — every camera the caller owns, any
// status, with its review note and sublocation.
func ListMyVideos(store ownerStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := store.ListOwnerVideos(r.Context(), middleware.UserID(r.Context()))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// CreateMyVideo handles POST /me/videos — validates the RTSP URL, creates
// the Restreamer ingest (same process config as POST /streams), and stores
// the camera in status pending with its stream id and HLS URL. The two
// owner limits are checked first so no process is created for a request
// that will be refused. rc may be nil (Restreamer not configured): 503.
func CreateMyVideo(store ownerStore, c *cache.Cache, rc *restreamer.Client) http.HandlerFunc {
	return createMyVideo(store, c, rc, time.Now)
}

func createMyVideo(store ownerStore, c *cache.Cache, rc *restreamer.Client, now func() time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if rc == nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "stream management is not configured"})
			return
		}

		var req createMyVideoRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		req.Title = strings.TrimSpace(req.Title)
		if req.Title == "" || req.SublocationID == 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title and sublocation_id are required"})
			return
		}
		if len(req.Title) > ownerVideoMaxTitle {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title must be at most 120 characters"})
			return
		}
		if err := restreamer.ValidateRTSPURL(req.RTSPURL); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		if msg := req.normalizeAbout(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}

		ctx := r.Context()
		owner := middleware.UserID(ctx)

		// The sublocation must be the caller's own — a camera can only be
		// filed under a place they submitted (or that was approved for them).
		sub, err := store.GetSublocationForOwner(ctx, req.SublocationID)
		if err != nil {
			if isNotFound(err) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "sublocation not found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if sub.OwnerID != owner {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "not your sublocation"})
			return
		}
		if sub.Status == statusRejected {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "this sublocation was rejected"})
			return
		}

		// Limits, before anything is created on Restreamer.
		total, err := store.CountOwnerVideos(ctx, owner)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if total >= ownerMaxCameras {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{
				"error": "camera limit reached: an account may have at most " + strconv.Itoa(ownerMaxCameras) + " cameras",
			})
			return
		}
		today, err := store.CountOwnerVideosSince(ctx, db.CountOwnerVideosSinceParams{
			OwnerID:   owner,
			CreatedAt: now().Add(-24 * time.Hour),
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if today >= ownerCamerasPerDay {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{
				"error": "daily limit reached: at most " + strconv.Itoa(ownerCamerasPerDay) + " cameras may be added per 24 hours",
			})
			return
		}

		streamID, err := createIngestStream(ctx, rc, req.Title, req.RTSPURL)
		if err != nil {
			status, msg := mapRestreamerError(err)
			writeJSON(w, status, map[string]string{"error": msg})
			return
		}

		subID := sub.SublocationID
		id, err := store.CreateOwnerVideo(ctx, db.CreateOwnerVideoParams{
			Title:         req.Title,
			Src:           rc.HLSURL(streamID),
			Type:          "application/x-mpegURL",
			StateID:       sub.StateID,
			SublocationID: &subID,
			About:         req.About,
			OwnerID:       owner,
			StreamID:      pgtype.Text{String: streamID, Valid: true},
			CreatedBy:     owner,
		})
		if err != nil {
			// The row failed after the process was created: take the process
			// back down so it does not run unowned.
			if derr := deleteIngestStream(ctx, rc, streamID); derr != nil {
				slog.Error("orphaned stream after failed camera insert", "stream_id", streamID, "error", derr)
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		row, err := store.GetVideoForOwner(ctx, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		invalidateCatalog(ctx, c)
		writeJSON(w, http.StatusCreated, row)
	}
}

// UpdateMyVideo handles PUT /me/videos/{id} — title and about only. The
// source, sublocation and status are not the owner's to change here.
func UpdateMyVideo(store ownerStore, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, ok := loadOwnedVideo(w, r, store)
		if !ok {
			return
		}
		var req updateMyVideoRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		req.Title = strings.TrimSpace(req.Title)
		if req.Title == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title is required"})
			return
		}
		if len(req.Title) > ownerVideoMaxTitle {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "title must be at most 120 characters"})
			return
		}
		if msg := req.normalizeAbout(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}

		ctx := r.Context()
		if err := store.UpdateOwnerVideo(ctx, db.UpdateOwnerVideoParams{
			VideoID: v.VideoID, Title: req.Title, About: req.About,
		}); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		row, err := store.GetVideoForOwner(ctx, v.VideoID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		invalidateCatalog(ctx, c)
		writeJSON(w, http.StatusOK, row)
	}
}

// PauseMyVideo handles POST /me/videos/{id}/pause — active → paused, and
// the Restreamer process is stopped. The camera stays public with a
// placeholder (DAN-40).
func PauseMyVideo(store ownerStore, c *cache.Cache, rc *restreamer.Client) http.HandlerFunc {
	return ownerVideoAction(store, c, rc, actionPause, "stop")
}

// ResumeMyVideo handles POST /me/videos/{id}/resume — paused → active, and
// the Restreamer process is started again.
func ResumeMyVideo(store ownerStore, c *cache.Cache, rc *restreamer.Client) http.HandlerFunc {
	return ownerVideoAction(store, c, rc, actionResume, "start")
}

// ownerVideoAction is pause/resume: check the transition, drive the process
// (the command must succeed before the row changes, so the row never claims
// a state Restreamer is not in), then update the row.
func ownerVideoAction(store ownerStore, c *cache.Cache, rc *restreamer.Client, action, command string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, ok := loadOwnedVideo(w, r, store)
		if !ok {
			return
		}
		to, err := videoTransition(v.Status, action)
		if err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}

		ctx := r.Context()
		if v.StreamID.Valid {
			if rc == nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "stream management is not configured"})
				return
			}
			if err := rc.CommandProcess(ctx, restreamer.IngestProcessID(v.StreamID.String), command); err != nil {
				status, msg := mapRestreamerError(err)
				slog.Error("owner video action: restreamer command failed",
					"video_id", v.VideoID, "stream_id", v.StreamID.String, "command", command, "error", err)
				writeJSON(w, status, map[string]string{"error": msg})
				return
			}
		}

		if err := store.SetVideoStatus(ctx, db.SetVideoStatusParams{VideoID: v.VideoID, Status: to, ReviewNote: v.ReviewNote}); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		row, err := store.GetVideoForOwner(ctx, v.VideoID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		invalidateCatalog(ctx, c)
		writeJSON(w, http.StatusOK, row)
	}
}

// DeleteMyVideo handles DELETE /me/videos/{id} — removes the Restreamer
// process when the camera has one (a 404 from Restreamer means it is
// already gone and is fine), then the row.
func DeleteMyVideo(store ownerStore, c *cache.Cache, rc *restreamer.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		v, ok := loadOwnedVideo(w, r, store)
		if !ok {
			return
		}
		ctx := r.Context()
		if v.StreamID.Valid {
			if rc == nil {
				writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "stream management is not configured"})
				return
			}
			if err := deleteIngestStream(ctx, rc, v.StreamID.String); err != nil {
				status, msg := mapRestreamerError(err)
				writeJSON(w, status, map[string]string{"error": msg})
				return
			}
		}
		if err := store.DeleteVideo(ctx, v.VideoID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		invalidateCatalog(ctx, c)
		w.WriteHeader(http.StatusNoContent)
	}
}

// ── Helpers ──────────────────────────────────────────────────────────

// loadOwnedSublocation resolves {id} to a sublocation the caller owns,
// answering 400/404/403 itself when it cannot.
func loadOwnedSublocation(w http.ResponseWriter, r *http.Request, store ownerStore) (db.GetSublocationForOwnerRow, bool) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid sublocation id"})
		return db.GetSublocationForOwnerRow{}, false
	}
	row, err := store.GetSublocationForOwner(r.Context(), int32(id))
	if err != nil {
		if isNotFound(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "sublocation not found"})
		} else {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return db.GetSublocationForOwnerRow{}, false
	}
	if row.OwnerID != middleware.UserID(r.Context()) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not your sublocation"})
		return db.GetSublocationForOwnerRow{}, false
	}
	return row, true
}

// loadOwnedVideo is loadOwnedSublocation for cameras.
func loadOwnedVideo(w http.ResponseWriter, r *http.Request, store ownerStore) (db.GetVideoForOwnerRow, bool) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid video id"})
		return db.GetVideoForOwnerRow{}, false
	}
	row, err := store.GetVideoForOwner(r.Context(), int32(id))
	if err != nil {
		if isNotFound(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "camera not found"})
		} else {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return db.GetVideoForOwnerRow{}, false
	}
	if row.OwnerID != middleware.UserID(r.Context()) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not your camera"})
		return db.GetVideoForOwnerRow{}, false
	}
	return row, true
}

// deleteIngestStream removes a camera's Restreamer process (and its
// snapshot sidecar, best-effort). A 404 means it is already gone — not an
// error for a delete.
func deleteIngestStream(ctx context.Context, rc *restreamer.Client, streamID string) error {
	processID := restreamer.IngestProcessID(streamID)
	if err := rc.DeleteProcess(ctx, processID); err != nil {
		var re *restreamer.Error
		if !(errors.As(err, &re) && re.StatusCode == http.StatusNotFound) {
			return err
		}
	}
	_ = rc.DeleteProcess(ctx, processID+"_snapshot")
	return nil
}

// stopIngestStream stops a camera's Restreamer process on a best-effort
// basis — used by reject, where the moderation decision must land even if
// Restreamer is down; the failure is logged, and the process (if any) keeps
// running until someone deletes it. rc may be nil.
func stopIngestStream(ctx context.Context, rc *restreamer.Client, videoID int32, streamID pgtype.Text) {
	if !streamID.Valid {
		return
	}
	if rc == nil {
		slog.Warn("cannot stop stream: restreamer not configured", "video_id", videoID, "stream_id", streamID.String)
		return
	}
	if err := rc.CommandProcess(ctx, restreamer.IngestProcessID(streamID.String), "stop"); err != nil {
		slog.Warn("stop stream failed", "video_id", videoID, "stream_id", streamID.String, "error", err)
	}
}

// invalidateCatalog flushes every public cache an ownership or status change
// can affect: the video lists (all sorts, per state/sublocation, the camera
// page, frames, snapshots), the sublocation pages, and the state counts.
func invalidateCatalog(ctx context.Context, c *cache.Cache) {
	for _, pattern := range []string{"videos:*", "sublocations:*", "states:*"} {
		if err := c.Invalidate(ctx, pattern); err != nil {
			slog.Warn("cache invalidation failed", "pattern", pattern, "error", err)
		}
	}
}
