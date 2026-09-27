package handler

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/brandon-relentnet/nationcam/api/internal/restreamer"
	"github.com/go-chi/chi/v5"
)

// Admin review (DAN-39): the queue and the approve/reject actions, all
// mounted behind middleware.RequireAdmin. Transitions are decided by the
// tables in status.go; the writes that must land together run in one
// transaction through ownerStore.Tx.

// reviewQueue is the body of GET /review.
type reviewQueue struct {
	Sublocations []db.ListPendingSublocationsRow `json:"sublocations"`
	Videos       []db.ListPendingVideosRow       `json:"videos"`
}

// ReviewQueue handles GET /review — every pending sublocation and camera,
// oldest first, with owner ids so the console can group by submitter.
func ReviewQueue(store ownerStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		subs, err := store.ListPendingSublocations(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		vids, err := store.ListPendingVideos(ctx)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, reviewQueue{Sublocations: subs, Videos: vids})
	}
}

// reviewNoteMaxLen bounds the note an admin attaches to a rejection.
const reviewNoteMaxLen = 2000

type rejectRequest struct {
	Note string `json:"note"`
}

// readRejectNote reads the optional {note} body of a reject call. An empty
// body is a rejection with no note.
func readRejectNote(w http.ResponseWriter, r *http.Request) (string, bool) {
	var req rejectRequest
	if err := readJSON(r, &req); err != nil && !errors.Is(err, io.EOF) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return "", false
	}
	req.Note = strings.TrimSpace(req.Note)
	if len(req.Note) > reviewNoteMaxLen {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "note must be at most 2000 characters"})
		return "", false
	}
	return req.Note, true
}

// errSublocationRejected is ApproveVideo's refusal to approve a camera filed
// under a rejected sublocation — the place has to be re-reviewed first.
var errSublocationRejected = errors.New("its sublocation was rejected; the camera cannot be approved")

// writeReviewError maps the errors a review action can return.
func writeReviewError(w http.ResponseWriter, err error, kind string) {
	switch {
	case isNotFound(err):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": kind + " not found"})
	case errors.Is(err, errInvalidTransition), errors.Is(err, errSublocationRejected):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
}

func reviewID(w http.ResponseWriter, r *http.Request, kind string) (int32, bool) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid " + kind + " id"})
		return 0, false
	}
	return int32(id), true
}

// ── Videos ───────────────────────────────────────────────────────────

// ApproveVideo handles POST /videos/{id}/approve — pending → active. If the
// camera's sublocation is itself still pending it is approved in the same
// transaction, so an approved camera is never filed under an invisible
// place. A camera in a rejected sublocation cannot be approved (409).
func ApproveVideo(store ownerStore, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := reviewID(w, r, "video")
		if !ok {
			return
		}
		ctx := r.Context()
		err := store.Tx(ctx, func(q ownerQueries) error {
			v, err := q.GetVideoForOwner(ctx, id)
			if err != nil {
				return err
			}
			to, err := videoTransition(v.Status, actionApprove)
			if err != nil {
				return err
			}
			if v.SublocationID != nil {
				switch v.SublocationStatus {
				case statusPending:
					if err := q.SetSublocationStatus(ctx, db.SetSublocationStatusParams{
						SublocationID: *v.SublocationID, Status: statusApproved,
					}); err != nil {
						return err
					}
				case statusRejected:
					return errSublocationRejected
				}
			}
			return q.SetVideoStatus(ctx, db.SetVideoStatusParams{VideoID: id, Status: to})
		})
		if err != nil {
			writeReviewError(w, err, "camera")
			return
		}
		row, err := store.GetVideoForOwner(ctx, id)
		if err != nil {
			writeReviewError(w, err, "camera")
			return
		}
		invalidateCatalog(ctx, c)
		writeJSON(w, http.StatusOK, row)
	}
}

// RejectVideo handles POST /videos/{id}/reject {note} — pending, active or
// paused → rejected. The Restreamer process is stopped, not deleted, so the
// owner's delete (or an admin cleanup) can still find it.
func RejectVideo(store ownerStore, c *cache.Cache, rc *restreamer.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := reviewID(w, r, "video")
		if !ok {
			return
		}
		note, ok := readRejectNote(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		v, err := store.GetVideoForOwner(ctx, id)
		if err != nil {
			writeReviewError(w, err, "camera")
			return
		}
		to, err := videoTransition(v.Status, actionReject)
		if err != nil {
			writeReviewError(w, err, "camera")
			return
		}
		if err := store.SetVideoStatus(ctx, db.SetVideoStatusParams{VideoID: id, Status: to, ReviewNote: note}); err != nil {
			writeReviewError(w, err, "camera")
			return
		}
		stopIngestStream(ctx, rc, v.VideoID, v.StreamID)

		row, err := store.GetVideoForOwner(ctx, id)
		if err != nil {
			writeReviewError(w, err, "camera")
			return
		}
		invalidateCatalog(ctx, c)
		writeJSON(w, http.StatusOK, row)
	}
}

// ── Sublocations ─────────────────────────────────────────────────────

// ApproveSublocation handles POST /sublocations/{id}/approve — pending →
// approved. Its cameras stay pending; each is approved on its own.
func ApproveSublocation(store ownerStore, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := reviewID(w, r, "sublocation")
		if !ok {
			return
		}
		ctx := r.Context()
		sub, err := store.GetSublocationForOwner(ctx, id)
		if err != nil {
			writeReviewError(w, err, "sublocation")
			return
		}
		to, err := sublocationTransition(sub.Status, actionApprove)
		if err != nil {
			writeReviewError(w, err, "sublocation")
			return
		}
		if err := store.SetSublocationStatus(ctx, db.SetSublocationStatusParams{SublocationID: id, Status: to}); err != nil {
			writeReviewError(w, err, "sublocation")
			return
		}
		row, err := store.GetSublocationForOwner(ctx, id)
		if err != nil {
			writeReviewError(w, err, "sublocation")
			return
		}
		invalidateCatalog(ctx, c)
		writeJSON(w, http.StatusOK, row)
	}
}

// RejectSublocation handles POST /sublocations/{id}/reject {note} — pending
// → rejected, and every still-pending camera in it is rejected with the same
// note in the same transaction; their Restreamer processes are then stopped.
func RejectSublocation(store ownerStore, c *cache.Cache, rc *restreamer.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := reviewID(w, r, "sublocation")
		if !ok {
			return
		}
		note, ok := readRejectNote(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		var cascaded []db.RejectPendingVideosInSublocationRow
		err := store.Tx(ctx, func(q ownerQueries) error {
			sub, err := q.GetSublocationForOwner(ctx, id)
			if err != nil {
				return err
			}
			to, err := sublocationTransition(sub.Status, actionReject)
			if err != nil {
				return err
			}
			if err := q.SetSublocationStatus(ctx, db.SetSublocationStatusParams{SublocationID: id, Status: to, ReviewNote: note}); err != nil {
				return err
			}
			subID := id
			cascaded, err = q.RejectPendingVideosInSublocation(ctx, db.RejectPendingVideosInSublocationParams{
				SublocationID: &subID, ReviewNote: note,
			})
			return err
		})
		if err != nil {
			writeReviewError(w, err, "sublocation")
			return
		}
		for _, v := range cascaded {
			stopIngestStream(ctx, rc, v.VideoID, v.StreamID)
		}

		row, err := store.GetSublocationForOwner(ctx, id)
		if err != nil {
			writeReviewError(w, err, "sublocation")
			return
		}
		invalidateCatalog(ctx, c)
		writeJSON(w, http.StatusOK, row)
	}
}
