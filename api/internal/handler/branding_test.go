package handler

import "testing"

func TestValidBrandURL(t *testing.T) {
	ok := []string{
		"",
		"https://cdn.example.com/hero.mp4",
		"http://example.com/x.webp",
		"/api/uploads/abc123.webp",
		"/videos/nc_venice-marina_hero.webm",
		"/logos/nc_venice-marina_logo.webp",
		"/buttons/nc_venice-marina_button.webp",
	}
	bad := []string{
		"javascript:alert(1)",
		"data:text/html,<script>",
		"/etc/passwd",
		"/videos/../../secret",
		"ftp://example.com/x",
		"//evil.com/x",
	}
	for _, s := range ok {
		if !validBrandURL(s) {
			t.Errorf("validBrandURL(%q) = false, want true", s)
		}
	}
	for _, s := range bad {
		if validBrandURL(s) {
			t.Errorf("validBrandURL(%q) = true, want false", s)
		}
	}
}

func TestBrandingNormalize(t *testing.T) {
	// Empty hero_kind defaults to video.
	b := brandingInput{}
	if msg := b.normalize(); msg != "" {
		t.Fatalf("empty branding rejected: %q", msg)
	}
	if b.HeroKind != "video" {
		t.Fatalf("hero_kind default = %q, want video", b.HeroKind)
	}

	// Bad hero_kind is rejected.
	if msg := (&brandingInput{HeroKind: "gif"}).normalize(); msg == "" {
		t.Fatal("hero_kind=gif accepted, want rejection")
	}

	// tourism_url must be an outbound http(s) URL: a local asset path is fine
	// for images but not for a link people follow.
	if msg := (&brandingInput{TourismURL: "/logos/x.webp"}).normalize(); msg == "" {
		t.Fatal("local-path tourism_url accepted, want rejection")
	}
	if msg := (&brandingInput{TourismName: "Explore Louisiana", TourismURL: "https://www.explorelouisiana.com"}).normalize(); msg != "" {
		t.Fatalf("valid tourism link rejected: %q", msg)
	}

	// An unsafe URL is rejected.
	if msg := (&brandingInput{HeroURL: "javascript:alert(1)"}).normalize(); msg == "" {
		t.Fatal("javascript hero_url accepted, want rejection")
	}
}
