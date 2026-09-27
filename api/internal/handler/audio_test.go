package handler

import (
	"strings"
	"testing"
)

func TestRewriteStreamURL(t *testing.T) {
	base := "https://phoenix3.fnit.us"

	// The real FNIT station: internal LAN mount must become a public HTTPS URL.
	fnit := azuraStation{
		Name:      "FNIT",
		Shortcode: "fnit",
		ListenURL: "http://192.168.1.182:8383/listen/fnit/radio.mp3",
		Mounts: []struct {
			URL       string `json:"url"`
			Format    string `json:"format"`
			IsDefault bool   `json:"is_default"`
		}{
			{URL: "http://192.168.1.182:8383/listen/fnit/radio.mp3", Format: "aac", IsDefault: true},
		},
	}
	if got, want := rewriteStreamURL(base, fnit), "https://phoenix3.fnit.us/listen/fnit/radio.mp3"; got != want {
		t.Fatalf("fnit rewrite = %q, want %q", got, want)
	}

	// Prefer an mp3 mount over the default when both exist.
	multi := azuraStation{
		ListenURL: "http://10.0.0.1/listen/x/radio.aac",
		Mounts: []struct {
			URL       string `json:"url"`
			Format    string `json:"format"`
			IsDefault bool   `json:"is_default"`
		}{
			{URL: "http://10.0.0.1/listen/x/radio.aac", Format: "aac", IsDefault: true},
			{URL: "http://10.0.0.1/listen/x/radio.mp3", Format: "mp3"},
		},
	}
	if got, want := rewriteStreamURL(base, multi), "https://phoenix3.fnit.us/listen/x/radio.mp3"; got != want {
		t.Fatalf("mp3-preference rewrite = %q, want %q", got, want)
	}

	// No mounts → fall back to listen_url path.
	nomounts := azuraStation{ListenURL: "http://10.0.0.1:8000/listen/y/radio.mp3"}
	if got, want := rewriteStreamURL(base, nomounts), "https://phoenix3.fnit.us/listen/y/radio.mp3"; got != want {
		t.Fatalf("listen_url fallback = %q, want %q", got, want)
	}

	// Nothing usable → empty (station gets skipped).
	if got := rewriteStreamURL(base, azuraStation{}); got != "" {
		t.Fatalf("empty station rewrite = %q, want empty", got)
	}
}

func TestAudioStationRequestValidate(t *testing.T) {
	// A minimal valid station passes and enabled defaults to true.
	req := audioStationRequest{Name: "  FNIT  ", StreamURL: "https://phoenix3.fnit.us/listen/fnit/radio.mp3"}
	if msg := req.validate(); msg != "" {
		t.Fatalf("valid station rejected: %q", msg)
	}
	if req.Name != "FNIT" {
		t.Errorf("name not trimmed: %q", req.Name)
	}
	if req.Enabled == nil || !*req.Enabled {
		t.Errorf("enabled did not default to true")
	}

	// A single scope (state or sublocation, not both) is fine.
	req = audioStationRequest{Name: "State station", StreamURL: "https://example.com/radio.mp3", StateID: ptr(1)}
	if msg := req.validate(); msg != "" {
		t.Fatalf("state-scoped station rejected: %q", msg)
	}

	bad := []struct {
		name string
		req  audioStationRequest
	}{
		{"empty name", audioStationRequest{StreamURL: "https://example.com/radio.mp3"}},
		{"whitespace name", audioStationRequest{Name: "   ", StreamURL: "https://example.com/radio.mp3"}},
		{"oversized name", audioStationRequest{Name: strings.Repeat("x", 81), StreamURL: "https://example.com/radio.mp3"}},
		{"missing stream_url", audioStationRequest{Name: "T"}},
		{"http stream_url (mixed content)", audioStationRequest{Name: "T", StreamURL: "http://example.com/radio.mp3"}},
		{"non-http scheme", audioStationRequest{Name: "T", StreamURL: "javascript:alert(1)"}},
		{"both scopes set", audioStationRequest{Name: "T", StreamURL: "https://example.com/radio.mp3", StateID: ptr(1), SublocationID: ptr(2)}},
	}
	for _, tc := range bad {
		r := tc.req
		if msg := r.validate(); msg == "" {
			t.Errorf("%s: accepted, want rejection", tc.name)
		}
	}
}

func TestIsHTTPSURL(t *testing.T) {
	if !isHTTPSURL("https://example.com/stream.mp3") {
		t.Error("valid https URL rejected")
	}
	for _, bad := range []string{"http://example.com/stream.mp3", "ftp://example.com", "not-a-url", ""} {
		if isHTTPSURL(bad) {
			t.Errorf("%q accepted as https URL", bad)
		}
	}
}
