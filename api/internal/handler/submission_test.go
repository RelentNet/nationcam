package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestSubmissionValidate(t *testing.T) {
	// A valid submission passes and defaults kind to "contact".
	req := submissionRequest{Name: "  Ada  ", Email: "ada@example.com", Message: "hello"}
	if msg := req.validate(); msg != "" {
		t.Fatalf("valid submission rejected: %q", msg)
	}
	if req.Name != "Ada" {
		t.Errorf("name not trimmed: %q", req.Name)
	}
	if req.Kind != "contact" {
		t.Errorf("kind default = %q, want contact", req.Kind)
	}

	bad := []struct {
		name string
		req  submissionRequest
	}{
		{"empty name", submissionRequest{Email: "a@b.co", Message: "hi"}},
		{"whitespace name", submissionRequest{Name: "   ", Email: "a@b.co", Message: "hi"}},
		{"empty email", submissionRequest{Name: "Ada", Message: "hi"}},
		{"bad email", submissionRequest{Name: "Ada", Email: "not-an-email", Message: "hi"}},
		{"empty message", submissionRequest{Name: "Ada", Email: "a@b.co"}},
		{"oversized name", submissionRequest{Name: strings.Repeat("x", maxNameLen+1), Email: "a@b.co", Message: "hi"}},
		{"oversized email", submissionRequest{Name: "Ada", Email: strings.Repeat("x", maxEmailLen) + "@", Message: "hi"}},
		{"oversized message", submissionRequest{Name: "Ada", Email: "a@b.co", Message: strings.Repeat("x", maxMessageLen+1)}},
	}
	for _, tc := range bad {
		r := tc.req
		if msg := r.validate(); msg == "" {
			t.Errorf("%s: accepted, want rejection", tc.name)
		}
	}
}

// fakeDB is a db.DBTX that records the last Exec/Query and serves canned rows,
// so the submission handlers run end to end without a database.
type fakeDB struct {
	execArgs  []any
	queryArgs []any
	rows      []db.Submission
}

func (f *fakeDB) Exec(_ context.Context, _ string, args ...any) (pgconn.CommandTag, error) {
	f.execArgs = args
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (f *fakeDB) Query(_ context.Context, _ string, args ...any) (pgx.Rows, error) {
	f.queryArgs = args
	return &fakeRows{rows: f.rows, idx: -1}, nil
}

func (f *fakeDB) QueryRow(context.Context, string, ...any) pgx.Row { return nil }

type fakeRows struct {
	rows []db.Submission
	idx  int
}

func (r *fakeRows) Close()                                       {}
func (r *fakeRows) Err() error                                   { return nil }
func (r *fakeRows) CommandTag() pgconn.CommandTag                { return pgconn.CommandTag{} }
func (r *fakeRows) FieldDescriptions() []pgconn.FieldDescription { return nil }
func (r *fakeRows) Next() bool                                   { r.idx++; return r.idx < len(r.rows) }
func (r *fakeRows) Values() ([]any, error)                       { return nil, nil }
func (r *fakeRows) RawValues() [][]byte                          { return nil }
func (r *fakeRows) Conn() *pgx.Conn                              { return nil }
func (r *fakeRows) Scan(dest ...any) error {
	s := r.rows[r.idx]
	*(dest[0].(*int64)) = s.SubmissionID
	*(dest[1].(*string)) = s.Name
	*(dest[2].(*string)) = s.Email
	*(dest[3].(*string)) = s.Message
	*(dest[4].(*string)) = s.Kind
	*(dest[5].(*bool)) = s.Handled
	*(dest[6].(*time.Time)) = s.CreatedAt
	*(dest[7].(*string)) = s.Company
	*(dest[8].(*string)) = s.Phone
	*(dest[9].(*string)) = s.SiteCity
	*(dest[10].(*string)) = s.SiteState
	*(dest[11].(*json.RawMessage)) = s.Details
	return nil
}

func postSubmission(f *fakeDB, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/submissions", strings.NewReader(body))
	rec := httptest.NewRecorder()
	CreateSubmission(f)(rec, req)
	return rec
}

func TestCreateSubmissionStructured(t *testing.T) {
	f := &fakeDB{}
	rec := postSubmission(f, `{"name":"Ada","email":"ada@example.com","message":"hi","kind":"construction",
		"company":" Acme ","phone":"555-0100","site_city":"Austin","site_state":"Texas",
		"details":{"plan":"Standard","cameras":2,"forever_video":true,"est_monthly":199.5,"features":["a","b"]}}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	// args: name, email, message, kind, company, phone, city, state, details
	if len(f.execArgs) != 9 {
		t.Fatalf("exec args = %d, want 9", len(f.execArgs))
	}
	if f.execArgs[4] != "Acme" || f.execArgs[5] != "555-0100" || f.execArgs[6] != "Austin" || f.execArgs[7] != "Texas" {
		t.Errorf("structured columns wrong: %v", f.execArgs[4:8])
	}
	var got map[string]any
	if err := json.Unmarshal(f.execArgs[8].(json.RawMessage), &got); err != nil {
		t.Fatalf("details not JSON: %v", err)
	}
	if got["plan"] != "Standard" || got["cameras"] != float64(2) || got["forever_video"] != true || got["est_monthly"] != 199.5 {
		t.Errorf("details = %v", got)
	}
}

func TestCreateSubmissionOldStyle(t *testing.T) {
	f := &fakeDB{}
	rec := postSubmission(f, `{"name":"Ada","email":"ada@example.com","message":"hi"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if f.execArgs[3] != "contact" || f.execArgs[4] != "" || f.execArgs[7] != "" {
		t.Errorf("defaults wrong: %v", f.execArgs)
	}
	if string(f.execArgs[8].(json.RawMessage)) != "{}" {
		t.Errorf("details = %s, want {}", f.execArgs[8])
	}
}

func TestCreateSubmissionRejections(t *testing.T) {
	base := `"name":"Ada","email":"a@b.co","message":"hi",`
	long := func(n int) string { return strings.Repeat("x", n) }
	manyKeys := `{`
	for i := 0; i < 31; i++ {
		if i > 0 {
			manyKeys += ","
		}
		manyKeys += `"k` + strconv.Itoa(i) + `":1`
	}
	manyKeys += `}`
	items := `[` + strings.TrimSuffix(strings.Repeat(`"a",`, 21), ",") + `]`
	cases := map[string]string{
		"company too long":    `{` + base + `"company":"` + long(201) + `"}`,
		"phone too long":      `{` + base + `"phone":"` + long(41) + `"}`,
		"city too long":       `{` + base + `"site_city":"` + long(101) + `"}`,
		"state too long":      `{` + base + `"site_state":"` + long(61) + `"}`,
		"details not object":  `{` + base + `"details":"x"}`,
		"details array":       `{` + base + `"details":[1]}`,
		"too many keys":       `{` + base + `"details":` + manyKeys + `}`,
		"key too long":        `{` + base + `"details":{"` + long(41) + `":1}}`,
		"key bad chars":       `{` + base + `"details":{"Bad-Key":1}}`,
		"nested object":       `{` + base + `"details":{"a":{"b":1}}}`,
		"null value":          `{` + base + `"details":{"a":null}}`,
		"string too long":     `{` + base + `"details":{"a":"` + long(501) + `"}}`,
		"array too long":      `{` + base + `"details":{"a":` + items + `}}`,
		"array item too long": `{` + base + `"details":{"a":["` + long(101) + `"]}}`,
		"array of numbers":    `{` + base + `"details":{"a":[1,2]}}`,
		"bad email unchanged": `{"name":"Ada","email":"nope","message":"hi"}`,
	}
	for name, body := range cases {
		f := &fakeDB{}
		rec := postSubmission(f, body)
		if rec.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d, want 400 (%s)", name, rec.Code, rec.Body)
		}
		if f.execArgs != nil {
			t.Errorf("%s: row was inserted", name)
		}
	}
	// Boundary values are accepted.
	f := &fakeDB{}
	ok := `{` + base + `"company":"` + long(200) + `","phone":"` + long(40) + `","site_city":"` + long(100) +
		`","site_state":"` + long(60) + `","details":{"` + long(40) + `":"` + long(500) + `"}}`
	if rec := postSubmission(f, ok); rec.Code != http.StatusCreated {
		t.Errorf("boundary: status %d: %s", rec.Code, rec.Body)
	}
}

func TestListSubmissionsKindFilter(t *testing.T) {
	rows := []db.Submission{{SubmissionID: 1, Name: "A", Kind: "construction", CreatedAt: time.Now(), Details: json.RawMessage(`{"plan":"Standard"}`)}}

	// No filter: the unfiltered query (no arguments), unchanged behaviour.
	f := &fakeDB{rows: rows}
	rec := httptest.NewRecorder()
	ListSubmissions(f)(rec, httptest.NewRequest(http.MethodGet, "/submissions", nil))
	if rec.Code != http.StatusOK || len(f.queryArgs) != 0 {
		t.Fatalf("unfiltered: status %d args %v", rec.Code, f.queryArgs)
	}
	var out []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil || len(out) != 1 {
		t.Fatalf("body: %v %s", err, rec.Body)
	}
	if d, _ := out[0]["details"].(map[string]any); d["plan"] != "Standard" {
		t.Errorf("details not a JSON object in response: %s", rec.Body)
	}
	for _, k := range []string{"company", "phone", "site_city", "site_state"} {
		if _, ok := out[0][k]; !ok {
			t.Errorf("response missing %s", k)
		}
	}

	// Filter: kinds are split and passed as one array argument.
	f = &fakeDB{rows: rows}
	rec = httptest.NewRecorder()
	ListSubmissions(f)(rec, httptest.NewRequest(http.MethodGet, "/submissions?kind=contact,%20camera", nil))
	if rec.Code != http.StatusOK || len(f.queryArgs) != 1 {
		t.Fatalf("filtered: status %d args %v", rec.Code, f.queryArgs)
	}
	if got := f.queryArgs[0].([]string); len(got) != 2 || got[0] != "contact" || got[1] != "camera" {
		t.Errorf("kinds = %v", got)
	}

	// Invalid kinds are 400.
	for _, q := range []string{"a,,b", strings.Repeat("x", 41), "a,b,c,d,e,f,g,h,i,j,k"} {
		rec = httptest.NewRecorder()
		ListSubmissions(&fakeDB{})(rec, httptest.NewRequest(http.MethodGet, "/submissions?kind="+q, nil))
		if rec.Code != http.StatusBadRequest {
			t.Errorf("kind=%q: status %d, want 400", q, rec.Code)
		}
	}
}
