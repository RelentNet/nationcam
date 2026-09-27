package handler

import (
	"strings"
	"testing"
	"time"
)

func TestEventValidate(t *testing.T) {
	starts := time.Now().Add(24 * time.Hour)

	// A minimal valid event passes.
	req := eventRequest{Title: "  Fall Fishing Tournament  ", StartsAt: &starts, SublocationID: ptr(1)}
	if msg := req.validate(); msg != "" {
		t.Fatalf("valid event rejected: %q", msg)
	}
	if req.Title != "Fall Fishing Tournament" {
		t.Errorf("title not trimmed: %q", req.Title)
	}

	// An end after the start, with a URL, is valid.
	ends := starts.Add(2 * time.Hour)
	req = eventRequest{
		Title:         "Rodeo",
		StartsAt:      &starts,
		EndsAt:        &ends,
		URL:           "https://example.com/rodeo",
		SublocationID: ptr(1),
	}
	if msg := req.validate(); msg != "" {
		t.Fatalf("valid event with end/url rejected: %q", msg)
	}

	bad := []struct {
		name string
		req  eventRequest
	}{
		{"empty title", eventRequest{StartsAt: &starts, SublocationID: ptr(1)}},
		{"whitespace title", eventRequest{Title: "   ", StartsAt: &starts, SublocationID: ptr(1)}},
		{"oversized title", eventRequest{Title: strings.Repeat("x", eventTitleMaxLen+1), StartsAt: &starts, SublocationID: ptr(1)}},
		{"oversized description", eventRequest{Title: "T", StartsAt: &starts, SublocationID: ptr(1), DescriptionMD: strings.Repeat("x", eventDescMaxLen+1)}},
		{"missing starts_at", eventRequest{Title: "T", SublocationID: ptr(1)}},
		{"ends_at before starts_at", eventRequest{Title: "T", StartsAt: &starts, EndsAt: ptrTime(starts.Add(-time.Hour)), SublocationID: ptr(1)}},
		{"ends_at equal starts_at", eventRequest{Title: "T", StartsAt: &starts, EndsAt: &starts, SublocationID: ptr(1)}},
		{"bad url", eventRequest{Title: "T", StartsAt: &starts, SublocationID: ptr(1), URL: "javascript:alert(1)"}},
		{"missing sublocation_id", eventRequest{Title: "T", StartsAt: &starts}},
	}
	for _, tc := range bad {
		r := tc.req
		if msg := r.validate(); msg == "" {
			t.Errorf("%s: accepted, want rejection", tc.name)
		}
	}
}

func ptrTime(t time.Time) *time.Time { return &t }
