package handler

import (
	"errors"
	"testing"
)

// TestVideoTransition pins the whole camera status machine: every legal
// (from, action) pair and its destination, and that everything else —
// including every action on the terminal statuses — is errInvalidTransition.
func TestVideoTransition(t *testing.T) {
	statuses := []string{statusPending, statusActive, statusInactive, statusPaused, statusRejected}
	actions := []string{actionApprove, actionReject, actionPause, actionResume}

	legal := map[[2]string]string{
		{statusPending, actionApprove}: statusActive,
		{statusPending, actionReject}:  statusRejected,
		{statusActive, actionPause}:    statusPaused,
		{statusActive, actionReject}:   statusRejected,
		{statusPaused, actionResume}:   statusActive,
		{statusPaused, actionReject}:   statusRejected,
	}

	for _, from := range statuses {
		for _, action := range actions {
			t.Run(from+"/"+action, func(t *testing.T) {
				got, err := videoTransition(from, action)
				want, ok := legal[[2]string{from, action}]
				if !ok {
					if !errors.Is(err, errInvalidTransition) {
						t.Fatalf("videoTransition(%q, %q) = %q, %v; want errInvalidTransition", from, action, got, err)
					}
					return
				}
				if err != nil || got != want {
					t.Fatalf("videoTransition(%q, %q) = %q, %v; want %q", from, action, got, err, want)
				}
			})
		}
	}

	// An unknown status or action is never legal.
	if _, err := videoTransition("bogus", actionApprove); !errors.Is(err, errInvalidTransition) {
		t.Errorf("unknown status accepted: %v", err)
	}
	if _, err := videoTransition(statusPending, "explode"); !errors.Is(err, errInvalidTransition) {
		t.Errorf("unknown action accepted: %v", err)
	}
}

// TestSublocationTransition: a sublocation leaves review exactly once.
func TestSublocationTransition(t *testing.T) {
	cases := []struct {
		from, action, want string
		ok                 bool
	}{
		{statusPending, actionApprove, statusApproved, true},
		{statusPending, actionReject, statusRejected, true},
		{statusApproved, actionApprove, "", false},
		{statusApproved, actionReject, "", false},
		{statusRejected, actionApprove, "", false},
		{statusRejected, actionReject, "", false},
		{statusPending, actionPause, "", false},
		{statusPending, actionResume, "", false},
	}
	for _, tc := range cases {
		got, err := sublocationTransition(tc.from, tc.action)
		if tc.ok {
			if err != nil || got != tc.want {
				t.Errorf("sublocationTransition(%q, %q) = %q, %v; want %q", tc.from, tc.action, got, err, tc.want)
			}
			continue
		}
		if !errors.Is(err, errInvalidTransition) {
			t.Errorf("sublocationTransition(%q, %q) = %q, %v; want errInvalidTransition", tc.from, tc.action, got, err)
		}
	}
}
