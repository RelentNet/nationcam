package handler

import (
	"context"
	"net/http"

	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/brandon-relentnet/nationcam/api/internal/middleware"
)

// Account roles (DAN-381). An account admin manages the account's locations,
// cameras, members and invites and always sees every camera; a viewer only
// sees — every camera with all_cameras, or only the picked ones without.
const (
	roleAdmin  = "admin"
	roleViewer = "viewer"
)

// CameraAccessQuerier is what CanViewCamera needs from the database;
// *db.Queries satisfies it.
type CameraAccessQuerier interface {
	GetMemberVideoAccess(ctx context.Context, arg db.GetMemberVideoAccessParams) (db.GetMemberVideoAccessRow, error)
}

// CanViewCamera answers "can this user view this camera":
//
//   - a NationCam admin (the admin scope on the token): always yes;
//   - an admin of the camera's account: yes, every camera;
//   - a viewer on all cameras: yes, every camera of the account, including
//     ones added after they joined;
//   - a restricted viewer: only the cameras picked for them;
//   - anyone else (not a member, an anonymous caller, a camera with no
//     account): no.
//
// It says nothing about public visibility — a public camera is watchable by
// anyone regardless; this is the rule for account-only access (DAN-205 calls
// it from GET /videos/{id}/stream-token).
func CanViewCamera(ctx context.Context, q CameraAccessQuerier, userID string, isNationCamAdmin bool, videoID int32) (bool, error) {
	if isNationCamAdmin {
		return true, nil
	}
	if userID == "" {
		return false, nil
	}
	row, err := q.GetMemberVideoAccess(ctx, db.GetMemberVideoAccessParams{VideoID: videoID, UserID: userID})
	if err != nil {
		if isNotFound(err) {
			return false, nil
		}
		return false, err
	}
	return memberCanView(row.Role, row.AllCameras, row.Picked), nil
}

// memberCanView is the membership half of CanViewCamera, shared with the
// in-memory test store so the two cannot drift.
func memberCanView(role string, allCameras, picked bool) bool {
	switch role {
	case roleAdmin:
		return true
	case roleViewer:
		return allCameras || picked
	}
	return false
}

// accountRole is the caller's role in an account: roleAdmin, roleViewer, or
// "" when they are not a member (or accountID is nil — an admin-owned row).
func accountRole(ctx context.Context, q ownerQueries, accountID *int32, userID string) (string, error) {
	if accountID == nil || userID == "" {
		return "", nil
	}
	m, err := q.GetAccountMember(ctx, db.GetAccountMemberParams{AccountID: *accountID, UserID: userID})
	if err != nil {
		if isNotFound(err) {
			return "", nil
		}
		return "", err
	}
	return m.Role, nil
}

// requireAccountAdmin answers 403 (or 500) itself unless the caller is an
// admin of the account. kind ("sublocation", "camera") shapes the message: a
// non-member gets the same "not your …" as before accounts, a viewer is told
// that viewers cannot change it.
func requireAccountAdmin(w http.ResponseWriter, r *http.Request, store ownerQueries, accountID *int32, kind string) bool {
	role, err := accountRole(r.Context(), store, accountID, middleware.UserID(r.Context()))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return false
	}
	switch role {
	case roleAdmin:
		return true
	case roleViewer:
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "account viewers cannot change this " + kind})
	default:
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "not your " + kind})
	}
	return false
}

// ensurePersonalAccount returns the caller's personal account, creating it
// (with them as its admin) the first time a user with none creates a
// location. A concurrent creation is resolved by re-reading.
func ensurePersonalAccount(ctx context.Context, store ownerStore, userID string) (int32, error) {
	id, err := store.GetPersonalAccountID(ctx, userID)
	if err == nil || !isNotFound(err) {
		return id, err
	}
	err = store.Tx(ctx, func(q ownerQueries) error {
		var cerr error
		id, cerr = q.CreatePersonalAccount(ctx, userID)
		if cerr != nil {
			return cerr
		}
		return q.AddAccountMember(ctx, db.AddAccountMemberParams{
			AccountID: id, UserID: userID, Role: roleAdmin, AllCameras: true,
		})
	})
	if isNotFound(err) {
		return store.GetPersonalAccountID(ctx, userID)
	}
	return id, err
}
