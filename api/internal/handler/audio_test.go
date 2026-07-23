package handler

import "testing"

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
