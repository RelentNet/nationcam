package handler

import "strings"

// aboutMaxLen caps the editorial body — long enough for a full page of copy,
// short enough that a paste bomb cannot bloat a row (and, with it, every cached
// list response that carries the column).
const aboutMaxLen = 20000

// aboutInput is the editorial "About this location / camera" copy an admin can
// set on a state, a sublocation or a camera. It is embedded (inline) in all six
// create/update request bodies so the three entities share one shape and one
// validator, the same way brandingInput is shared by states and sublocations.
//
// The copy is rendered as plain text by the frontend (see EditorialText.tsx), so
// there is no markup to sanitize here — length is the only trust-boundary check.
type aboutInput struct {
	About string `json:"about"`
}

// normalizeAbout trims the copy and returns an error message ("" when valid).
// Empty is valid and means "render no About section".
func (a *aboutInput) normalizeAbout() string {
	a.About = strings.TrimSpace(a.About)
	if len(a.About) > aboutMaxLen {
		return "about must be at most 20000 characters"
	}
	return ""
}
