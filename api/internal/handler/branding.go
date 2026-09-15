package handler

import "strings"

// brandingInput is the per-location branding an admin can set on a state or a
// sublocation. It is embedded (inline) in both create/update request bodies so
// the two share one shape and one validator.
type brandingInput struct {
	HeroURL     string `json:"hero_url"`
	HeroKind    string `json:"hero_kind"`
	LogoURL     string `json:"logo_url"`
	SponsorURL  string `json:"sponsor_url"`
	SponsorLink string `json:"sponsor_link"`
	TitleURL    string `json:"title_url"`
}

// normalize fills defaults and returns an error message ("" when valid).
// hero_kind defaults to 'video' to match the column default; every URL field
// must be empty, a safe http(s) URL, or a local asset path this app serves.
func (b *brandingInput) normalize() string {
	if b.HeroKind == "" {
		b.HeroKind = "video"
	}
	if b.HeroKind != "image" && b.HeroKind != "video" {
		return "hero_kind must be image or video"
	}
	for _, f := range []struct{ label, val string }{
		{"hero_url", b.HeroURL},
		{"logo_url", b.LogoURL},
		{"sponsor_url", b.SponsorURL},
		{"sponsor_link", b.SponsorLink},
		{"title_url", b.TitleURL},
	} {
		if !validBrandURL(f.val) {
			return f.label + " must be empty, an http(s) URL, or a local /api/uploads, /videos, /logos or /buttons path"
		}
	}
	return ""
}

// validBrandURL accepts an empty value, a safe http(s) URL (reusing the ad
// click-through validator), or a local asset path served by this app. Path
// traversal is rejected outright.
func validBrandURL(s string) bool {
	if s == "" {
		return true
	}
	if isHTTPURL(s) {
		return true
	}
	if strings.Contains(s, "..") {
		return false
	}
	for _, p := range []string{"/api/uploads/", "/videos/", "/logos/", "/buttons/"} {
		if strings.HasPrefix(s, p) {
			return true
		}
	}
	return false
}
