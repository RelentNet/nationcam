package handler

import (
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func ptr(i int32) *int32 { return &i }

func TestPostValidate(t *testing.T) {
	// A minimal valid post passes and defaults status to draft.
	req := postRequest{Title: "  Fog rolls in  "}
	if msg := req.validate(); msg != "" {
		t.Fatalf("valid post rejected: %q", msg)
	}
	if req.Title != "Fog rolls in" {
		t.Errorf("title not trimmed: %q", req.Title)
	}
	if req.Status != "draft" {
		t.Errorf("status default = %q, want draft", req.Status)
	}

	// A cover uploaded through the existing upload flow is a local path, not an
	// http(s) URL — it must be accepted.
	req = postRequest{Title: "Sunrise", CoverURL: "/api/uploads/abc123.jpg"}
	if msg := req.validate(); msg != "" {
		t.Fatalf("local upload cover rejected: %q", msg)
	}

	bad := []struct {
		name string
		req  postRequest
	}{
		{"empty title", postRequest{}},
		{"whitespace title", postRequest{Title: "   "}},
		{"oversized title", postRequest{Title: strings.Repeat("x", postTitleMaxLen+1)}},
		{"oversized excerpt", postRequest{Title: "T", Excerpt: strings.Repeat("x", postExcerptMaxLen+1)}},
		{"oversized body", postRequest{Title: "T", BodyMD: strings.Repeat("x", postBodyMaxLen+1)}},
		{"bad cover url", postRequest{Title: "T", CoverURL: "javascript:alert(1)"}},
		{"bad status", postRequest{Title: "T", Status: "archived"}},
		{"two scopes", postRequest{Title: "T", StateID: ptr(1), SublocationID: ptr(2)}},
		{"three scopes", postRequest{Title: "T", StateID: ptr(1), SublocationID: ptr(2), VideoID: ptr(3)}},
	}
	for _, tc := range bad {
		r := tc.req
		if msg := r.validate(); msg == "" {
			t.Errorf("%s: accepted, want rejection", tc.name)
		}
	}

	// Exactly one scope set is valid.
	for _, tc := range []postRequest{
		{Title: "T", StateID: ptr(1)},
		{Title: "T", SublocationID: ptr(1)},
		{Title: "T", VideoID: ptr(1)},
	} {
		r := tc
		if msg := r.validate(); msg != "" {
			t.Errorf("single scope rejected: %q", msg)
		}
	}
}

func TestPublishedAtFor(t *testing.T) {
	unset := pgtype.Timestamptz{}
	past := pgtype.Timestamptz{Time: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC), Valid: true}

	// Draft never gets a published_at, regardless of what it had before.
	if got := publishedAtFor("draft", unset); got.Valid {
		t.Errorf("draft with unset published_at: got %+v, want invalid", got)
	}
	if got := publishedAtFor("draft", past); !got.Valid || !got.Time.Equal(past.Time) {
		t.Errorf("draft must not clear an existing published_at: got %+v", got)
	}

	// Publishing for the first time fills published_at with now.
	before := time.Now()
	got := publishedAtFor("published", unset)
	if !got.Valid || got.Time.Before(before) {
		t.Errorf("publishing an unset post: got %+v, want now-ish", got)
	}

	// Re-publishing (or saving while already published) keeps the original date.
	if got := publishedAtFor("published", past); !got.Valid || !got.Time.Equal(past.Time) {
		t.Errorf("re-publishing must keep the original published_at: got %+v, want %+v", got, past)
	}
}
