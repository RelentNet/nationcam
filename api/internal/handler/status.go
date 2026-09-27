package handler

import (
	"errors"
	"fmt"
)

// Owner-account limits (DAN-39). The one place they live; GET /me reports
// them so the dashboard can show "3 of 10 cameras" without hardcoding.
const (
	// ownerMaxCameras caps how many cameras one owner may have at once, any
	// status. Deleting one frees a slot.
	ownerMaxCameras = 10
	// ownerCamerasPerDay caps how many cameras one owner may create in any
	// rolling 24-hour window (anti-abuse; the per-IP limiter still applies).
	ownerCamerasPerDay = 5
)

// Row statuses. Videos also keep the pre-existing 'inactive', an admin-only
// switch-off that no owner or review action ever produces.
const (
	statusPending  = "pending"
	statusActive   = "active"
	statusInactive = "inactive"
	statusPaused   = "paused"
	statusRejected = "rejected"
	statusApproved = "approved"
)

// Actions that move a row between statuses.
const (
	actionApprove = "approve"
	actionReject  = "reject"
	actionPause   = "pause"
	actionResume  = "resume"
)

// errInvalidTransition is returned by videoTransition and
// sublocationTransition for an action the row's current status does not
// allow; handlers answer 409 with its message.
var errInvalidTransition = errors.New("invalid status transition")

// videoTransition is the whole video status machine — every legal
// (from, action) pair and the status it leads to. Anything not listed is a
// 409. Kept as one table so the diagram in AGENTS.md and the table-driven
// test both read straight off it:
//
//	pending ──approve──▶ active ◀──resume── paused
//	   │                   │  └──pause──▶ paused
//	   └──reject──▶ rejected ◀──reject── active | paused
//
// 'inactive' (admin switch-off via PUT /videos/{id}) and 'rejected' are
// terminal for these actions; an admin can still edit the row directly.
var videoTransitions = map[[2]string]string{
	{statusPending, actionApprove}: statusActive,
	{statusPending, actionReject}:  statusRejected,
	{statusActive, actionPause}:    statusPaused,
	{statusActive, actionReject}:   statusRejected,
	{statusPaused, actionResume}:   statusActive,
	{statusPaused, actionReject}:   statusRejected,
}

// sublocationTransition's table: a sublocation only ever leaves review once.
//
//	pending ──approve──▶ approved
//	   └──────reject───▶ rejected
var sublocationTransitions = map[[2]string]string{
	{statusPending, actionApprove}: statusApproved,
	{statusPending, actionReject}:  statusRejected,
}

// videoTransition returns the status a video in `from` moves to on `action`,
// or errInvalidTransition (wrapped with the specifics) when it may not.
func videoTransition(from, action string) (string, error) {
	return transition(videoTransitions, "camera", from, action)
}

// sublocationTransition is videoTransition for sublocations.
func sublocationTransition(from, action string) (string, error) {
	return transition(sublocationTransitions, "sublocation", from, action)
}

func transition(table map[[2]string]string, kind, from, action string) (string, error) {
	to, ok := table[[2]string{from, action}]
	if !ok {
		return "", fmt.Errorf("%w: cannot %s a %s %s", errInvalidTransition, action, from, kind)
	}
	return to, nil
}
