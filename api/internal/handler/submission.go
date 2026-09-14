package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// maxSubmissionBytes caps the request body of a public submission. The largest
// field (message) is capped at 5000 chars; 16KB leaves generous room for the
// other fields and JSON overhead while stopping an abuser from streaming a
// huge body.
const maxSubmissionBytes = 16 << 10

// Field length caps, enforced before the insert so oversized input is a clean
// 400 rather than a database error (the columns are unbounded TEXT).
const (
	maxNameLen    = 200
	maxEmailLen   = 320
	maxMessageLen = 5000
	maxKindLen    = 40
)

type submissionRequest struct {
	Name    string `json:"name"`
	Email   string `json:"email"`
	Message string `json:"message"`
	Kind    string `json:"kind"`
}

// validate trims and checks the public-submitted fields, returning a readable
// error message ("" when valid). name/email/message are required; email gets a
// basic sanity check (must contain "@"); every field is length-capped.
func (req *submissionRequest) validate() string {
	req.Name = strings.TrimSpace(req.Name)
	req.Email = strings.TrimSpace(req.Email)
	req.Message = strings.TrimSpace(req.Message)
	req.Kind = strings.TrimSpace(req.Kind)

	switch {
	case req.Name == "":
		return "name is required"
	case len(req.Name) > maxNameLen:
		return "name is too long"
	case req.Email == "":
		return "email is required"
	case len(req.Email) > maxEmailLen:
		return "email is too long"
	case !strings.Contains(req.Email, "@"):
		return "email is invalid"
	case req.Message == "":
		return "message is required"
	case len(req.Message) > maxMessageLen:
		return "message is too long"
	case len(req.Kind) > maxKindLen:
		return "kind is too long"
	}
	if req.Kind == "" {
		req.Kind = "contact"
	}
	return ""
}

// CreateSubmission handles POST /submissions — the public contact / "Add Your
// Camera" form endpoint. Rate-limited (see router) and body-capped; validates and
// stores as data only. Never echoes the stored row back to the public.
func CreateSubmission(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxSubmissionBytes)

		var req submissionRequest
		if err := readJSON(r, &req); err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "submission too large"})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		if msg := req.validate(); msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}

		if err := db.New(pool).CreateSubmission(r.Context(), db.CreateSubmissionParams{
			Name:    req.Name,
			Email:   req.Email,
			Message: req.Message,
			Kind:    req.Kind,
		}); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
	}
}

// ListSubmissions handles GET /submissions — newest-first, latest 200 (admin only).
func ListSubmissions(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := db.New(pool).ListSubmissions(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

type handleSubmissionRequest struct {
	Handled bool `json:"handled"`
}

// UpdateSubmission handles PATCH /submissions/{id} — sets the handled flag (admin only).
func UpdateSubmission(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid submission id"})
			return
		}

		var req handleSubmissionRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}

		row, err := db.New(pool).SetSubmissionHandled(r.Context(), db.SetSubmissionHandledParams{
			SubmissionID: id,
			Handled:      req.Handled,
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "submission not found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		writeJSON(w, http.StatusOK, row)
	}
}
