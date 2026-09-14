package handler

import (
	"strings"
	"testing"
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
