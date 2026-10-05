package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

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

// Caps for the structured fields (DAN-226), counted in characters.
const (
	maxCompanyLen       = 200
	maxPhoneLen         = 40
	maxSiteCityLen      = 100
	maxSiteStateLen     = 60
	maxDetailKeys       = 30
	maxDetailKeyLen     = 40
	maxDetailStringLen  = 500
	maxDetailArrayItems = 20
	maxDetailItemLen    = 100
	maxKindFilter       = 10
)

var detailKeyRE = regexp.MustCompile(`^[a-z0-9_]+$`)

type submissionRequest struct {
	Name      string          `json:"name"`
	Email     string          `json:"email"`
	Message   string          `json:"message"`
	Kind      string          `json:"kind"`
	Company   string          `json:"company"`
	Phone     string          `json:"phone"`
	SiteCity  string          `json:"site_city"`
	SiteState string          `json:"site_state"`
	Details   json.RawMessage `json:"details"`
}

// validateDetails checks that raw is a flat JSON object (<= 30 keys, keys
// matching ^[a-z0-9_]{1,40}$) whose values are strings (<= 500 chars), numbers,
// booleans, or arrays of <= 20 strings (<= 100 chars each). It returns the
// canonical JSON to store ("{}" for absent/null) or a readable error message.
func validateDetails(raw json.RawMessage) ([]byte, string) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return []byte("{}"), ""
	}
	if trimmed[0] != '{' {
		return nil, "details must be a JSON object"
	}
	dec := json.NewDecoder(bytes.NewReader(trimmed))
	dec.UseNumber()
	var m map[string]any
	if err := dec.Decode(&m); err != nil {
		return nil, "details must be a JSON object"
	}
	if len(m) > maxDetailKeys {
		return nil, "details has too many keys (max 30)"
	}
	for k, v := range m {
		if k == "" || utf8.RuneCountInString(k) > maxDetailKeyLen || !detailKeyRE.MatchString(k) {
			return nil, "details key " + strconv.Quote(k) + " is invalid (lowercase letters, digits and underscores, max 40 characters)"
		}
		switch val := v.(type) {
		case string:
			if utf8.RuneCountInString(val) > maxDetailStringLen {
				return nil, "details value for " + k + " is too long (max 500 characters)"
			}
		case json.Number, bool:
		case []any:
			if len(val) > maxDetailArrayItems {
				return nil, "details list for " + k + " has too many items (max 20)"
			}
			for _, item := range val {
				s, ok := item.(string)
				if !ok {
					return nil, "details list for " + k + " may only contain strings"
				}
				if utf8.RuneCountInString(s) > maxDetailItemLen {
					return nil, "details list item for " + k + " is too long (max 100 characters)"
				}
			}
		default:
			return nil, "details value for " + k + " must be a string, number, boolean or list of strings"
		}
	}
	out, err := json.Marshal(m)
	if err != nil {
		return nil, "details must be a JSON object"
	}
	return out, ""
}

// parseKindFilter splits a comma-separated ?kind= value. It returns nil when
// the filter is absent, or an error message when any kind is empty or too long.
func parseKindFilter(raw string) ([]string, string) {
	if strings.TrimSpace(raw) == "" {
		return nil, ""
	}
	parts := strings.Split(raw, ",")
	if len(parts) > maxKindFilter {
		return nil, "too many kinds"
	}
	kinds := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			return nil, "kind is empty"
		}
		if len(p) > maxKindLen {
			return nil, "kind is too long"
		}
		kinds = append(kinds, p)
	}
	return kinds, ""
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

	req.Company = strings.TrimSpace(req.Company)
	req.Phone = strings.TrimSpace(req.Phone)
	req.SiteCity = strings.TrimSpace(req.SiteCity)
	req.SiteState = strings.TrimSpace(req.SiteState)
	switch {
	case utf8.RuneCountInString(req.Company) > maxCompanyLen:
		return "company is too long"
	case utf8.RuneCountInString(req.Phone) > maxPhoneLen:
		return "phone is too long"
	case utf8.RuneCountInString(req.SiteCity) > maxSiteCityLen:
		return "site_city is too long"
	case utf8.RuneCountInString(req.SiteState) > maxSiteStateLen:
		return "site_state is too long"
	}
	details, msg := validateDetails(req.Details)
	if msg != "" {
		return msg
	}
	req.Details = details
	return ""
}

// CreateSubmission handles POST /submissions — the public contact / "Add Your
// Camera" form endpoint. Rate-limited (see router) and body-capped; validates and
// stores as data only. Never echoes the stored row back to the public.
func CreateSubmission(pool db.DBTX) http.HandlerFunc {
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

			Company:   req.Company,
			Phone:     req.Phone,
			SiteCity:  req.SiteCity,
			SiteState: req.SiteState,
			Details:   req.Details,
		}); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}

		writeJSON(w, http.StatusCreated, map[string]bool{"ok": true})
	}
}

// ListSubmissions handles GET /submissions — newest-first, latest 200 (admin only).
// An optional ?kind=a,b limits it to those kinds (still the latest 200 of them).
func ListSubmissions(pool db.DBTX) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kinds, msg := parseKindFilter(r.URL.Query().Get("kind"))
		if msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}
		var (
			rows []db.Submission
			err  error
		)
		if kinds == nil {
			rows, err = db.New(pool).ListSubmissions(r.Context())
		} else {
			rows, err = db.New(pool).ListSubmissionsByKind(r.Context(), kinds)
		}
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
