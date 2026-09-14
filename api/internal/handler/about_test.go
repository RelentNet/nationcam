package handler

import (
	"strings"
	"testing"
)

func TestAboutNormalize(t *testing.T) {
	// Empty is valid — it means "render no About section".
	a := aboutInput{}
	if msg := a.normalizeAbout(); msg != "" {
		t.Fatalf("empty about rejected: %q", msg)
	}

	// Surrounding whitespace is trimmed.
	a = aboutInput{About: "  ## Venice\n\nThe end of the road.  \n"}
	if msg := a.normalizeAbout(); msg != "" {
		t.Fatalf("about rejected: %q", msg)
	}
	if a.About != "## Venice\n\nThe end of the road." {
		t.Fatalf("about not trimmed: %q", a.About)
	}

	// Exactly at the cap is accepted; one byte over is not.
	a = aboutInput{About: strings.Repeat("x", aboutMaxLen)}
	if msg := a.normalizeAbout(); msg != "" {
		t.Fatalf("about of exactly %d chars rejected: %q", aboutMaxLen, msg)
	}
	a = aboutInput{About: strings.Repeat("x", aboutMaxLen+1)}
	if msg := a.normalizeAbout(); msg == "" {
		t.Fatalf("about of %d chars accepted, want rejection", aboutMaxLen+1)
	}

	// Trimming happens before the cap, so padding whitespace cannot trip it.
	a = aboutInput{About: "  " + strings.Repeat("x", aboutMaxLen) + "  "}
	if msg := a.normalizeAbout(); msg != "" {
		t.Fatalf("padded about of exactly %d chars rejected: %q", aboutMaxLen, msg)
	}
}
