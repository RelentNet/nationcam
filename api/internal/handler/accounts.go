package handler

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/brandon-relentnet/nationcam/api/internal/middleware"
	"github.com/go-chi/chi/v5"
)

// Accounts, members and invites (DAN-381). A location and a camera belong to
// an account; members are admins or viewers (see access.go). Members join
// through single-use invite links. Nothing here is Redis-cached; only the
// NationCam-admin assign endpoints change camera or location ownership, and
// they flush the public catalog caches.
//
// Who may do what:
//   - any signed-in user: list their own accounts, accept an invite, leave
//     an account (remove themselves);
//   - an account admin, or a NationCam admin (admin scope): list members,
//     change a member's role or camera selection, remove a member, create an
//     invite;
//   - a NationCam admin only: list every account, create an account, assign
//     an existing camera or location to an account.
//
// An account always keeps at least one admin: removing or demoting the last
// one is a 409. Membership changes run in a transaction that locks the
// account row, so two concurrent demotions cannot both pass that check.

// inviteTTL is how long an invite link stays valid.
const inviteTTL = 7 * 24 * time.Hour

// accountMaxName bounds an account name.
const accountMaxName = 120

var (
	errLastAdmin     = errors.New("an account must keep at least one admin")
	errMemberMissing = errors.New("member not found")
	errAlreadyMember = errors.New("you are already a member of this account")
	errInviteUsed    = errors.New("this invite has already been used")
)

// accountResponse is an account as the API returns it (personal_owner_id as
// a plain string rather than pgtype.Text).
type accountResponse struct {
	AccountID        int32     `json:"account_id"`
	Name             string    `json:"name"`
	Personal         bool      `json:"personal"`
	PersonalOwnerID  string    `json:"personal_owner_id,omitempty"`
	CreatedBy        string    `json:"created_by"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
	MemberCount      int32     `json:"member_count"`
	SublocationCount int32     `json:"sublocation_count"`
	VideoCount       int32     `json:"video_count"`
}

// memberResponse is one member: their Logto sub, role, and (for a
// restricted viewer) the picked camera ids.
type memberResponse struct {
	AccountID  int32     `json:"account_id"`
	UserID     string    `json:"user_id"`
	Role       string    `json:"role"`
	AllCameras bool      `json:"all_cameras"`
	VideoIDs   []int32   `json:"video_ids"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

func toMemberResponse(m db.ListAccountMembersRow) memberResponse {
	ids := m.VideoIds
	if ids == nil {
		ids = []int32{}
	}
	return memberResponse{
		AccountID: m.AccountID, UserID: m.UserID, Role: m.Role, AllCameras: m.AllCameras,
		VideoIDs: ids, CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt,
	}
}

// memberSelection is the role + camera selection carried by a member update
// and by an invite.
type memberSelection struct {
	Role       string  `json:"role"`
	AllCameras *bool   `json:"all_cameras"`
	VideoIDs   []int32 `json:"video_ids"`
}

// normalize validates the selection against the account: role is admin or
// viewer; an admin always has every camera; a viewer defaults to every
// camera; a restricted viewer's picks must all be cameras of the account.
// It returns the effective (allCameras, videoIDs) or a 400 message.
func (s *memberSelection) normalize(ctx context.Context, q ownerQueries, accountID int32) (bool, []int32, string, error) {
	s.Role = strings.TrimSpace(s.Role)
	if s.Role != roleAdmin && s.Role != roleViewer {
		return false, nil, "role must be admin or viewer", nil
	}
	all := s.AllCameras == nil || *s.AllCameras
	if s.Role == roleAdmin {
		if !all {
			return false, nil, "an admin always sees every camera", nil
		}
		return true, []int32{}, "", nil
	}
	if all {
		return true, []int32{}, "", nil
	}
	seen := map[int32]bool{}
	ids := []int32{}
	for _, id := range s.VideoIDs {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	if len(ids) > ownerMaxCameras*10 {
		return false, nil, "too many video_ids", nil
	}
	if len(ids) > 0 {
		n, err := q.CountAccountVideosIn(ctx, db.CountAccountVideosInParams{AccountID: accountID, VideoIds: ids})
		if err != nil {
			return false, nil, "", err
		}
		if int(n) != len(ids) {
			return false, nil, "every video_id must be a camera of this account", nil
		}
	}
	return false, ids, "", nil
}

// ── GET /me/accounts ─────────────────────────────────────────────────

// ListMyAccounts handles GET /me/accounts — every account the caller is a
// member of, with their role and camera selection flag.
func ListMyAccounts(store ownerStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := store.ListMyAccounts(r.Context(), middleware.UserID(r.Context()))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}
}

// ── Members ──────────────────────────────────────────────────────────

// loadManagedAccount resolves {id} to an account the caller may manage (an
// account admin or a NationCam admin), answering 400/404/403 itself.
func loadManagedAccount(w http.ResponseWriter, r *http.Request, store ownerStore) (int32, bool) {
	id, ok := accountIDParam(w, r)
	if !ok {
		return 0, false
	}
	ctx := r.Context()
	if _, err := store.GetAccount(ctx, id); err != nil {
		if isNotFound(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "account not found"})
		} else {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return 0, false
	}
	if middleware.IsAdmin(ctx) {
		return id, true
	}
	if !requireAccountAdmin(w, r, store, &id, "account") {
		return 0, false
	}
	return id, true
}

func accountIDParam(w http.ResponseWriter, r *http.Request) (int32, bool) {
	id, err := strconv.Atoi(chi.URLParam(r, "id"))
	if err != nil || id <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid account id"})
		return 0, false
	}
	return int32(id), true
}

// ListAccountMembers handles GET /accounts/{id}/members.
func ListAccountMembers(store ownerStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := loadManagedAccount(w, r, store)
		if !ok {
			return
		}
		rows, err := store.ListAccountMembers(r.Context(), id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		out := make([]memberResponse, 0, len(rows))
		for _, m := range rows {
			out = append(out, toMemberResponse(m))
		}
		writeJSON(w, http.StatusOK, out)
	}
}

// findMember returns one member with their picks, or errMemberMissing.
func findMember(ctx context.Context, q ownerQueries, accountID int32, userID string) (memberResponse, error) {
	rows, err := q.ListAccountMembers(ctx, accountID)
	if err != nil {
		return memberResponse{}, err
	}
	for _, m := range rows {
		if m.UserID == userID {
			return toMemberResponse(m), nil
		}
	}
	return memberResponse{}, errMemberMissing
}

// UpdateAccountMember handles PUT /accounts/{id}/members/{user_id} —
// `{ role, all_cameras?, video_ids? }`. Demoting the last admin is a 409.
func UpdateAccountMember(store ownerStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		accountID, ok := loadManagedAccount(w, r, store)
		if !ok {
			return
		}
		userID := chi.URLParam(r, "user_id")
		var req memberSelection
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		ctx := r.Context()
		all, ids, msg, err := req.normalize(ctx, store, accountID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}

		err = store.Tx(ctx, func(q ownerQueries) error {
			if _, err := q.LockAccount(ctx, accountID); err != nil {
				return err
			}
			cur, err := q.GetAccountMember(ctx, db.GetAccountMemberParams{AccountID: accountID, UserID: userID})
			if err != nil {
				if isNotFound(err) {
					return errMemberMissing
				}
				return err
			}
			if cur.Role == roleAdmin && req.Role != roleAdmin {
				n, err := q.CountAccountAdmins(ctx, accountID)
				if err != nil {
					return err
				}
				if n <= 1 {
					return errLastAdmin
				}
			}
			if err := q.UpdateAccountMember(ctx, db.UpdateAccountMemberParams{
				AccountID: accountID, UserID: userID, Role: req.Role, AllCameras: all,
			}); err != nil {
				return err
			}
			if err := q.ClearMemberVideos(ctx, db.ClearMemberVideosParams{AccountID: accountID, UserID: userID}); err != nil {
				return err
			}
			if len(ids) > 0 {
				return q.AddMemberVideos(ctx, db.AddMemberVideosParams{AccountID: accountID, UserID: userID, VideoIds: ids})
			}
			return nil
		})
		if writeMemberError(w, err) {
			return
		}
		m, err := findMember(ctx, store, accountID, userID)
		if writeMemberError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, m)
	}
}

// DeleteAccountMember handles DELETE /accounts/{id}/members/{user_id}. An
// account admin (or NationCam admin) removes anyone; any member may remove
// themselves (leave). Removing the last admin is a 409.
func DeleteAccountMember(store ownerStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		userID := chi.URLParam(r, "user_id")
		var accountID int32
		if userID != "" && userID == middleware.UserID(ctx) {
			id, ok := accountIDParam(w, r)
			if !ok {
				return
			}
			accountID = id
		} else {
			id, ok := loadManagedAccount(w, r, store)
			if !ok {
				return
			}
			accountID = id
		}

		err := store.Tx(ctx, func(q ownerQueries) error {
			if _, err := q.LockAccount(ctx, accountID); err != nil {
				if isNotFound(err) {
					return errMemberMissing
				}
				return err
			}
			cur, err := q.GetAccountMember(ctx, db.GetAccountMemberParams{AccountID: accountID, UserID: userID})
			if err != nil {
				if isNotFound(err) {
					return errMemberMissing
				}
				return err
			}
			if cur.Role == roleAdmin {
				n, err := q.CountAccountAdmins(ctx, accountID)
				if err != nil {
					return err
				}
				if n <= 1 {
					return errLastAdmin
				}
			}
			return q.DeleteAccountMember(ctx, db.DeleteAccountMemberParams{AccountID: accountID, UserID: userID})
		})
		if writeMemberError(w, err) {
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// writeMemberError maps the membership sentinel errors to statuses; it
// reports whether it wrote a response.
func writeMemberError(w http.ResponseWriter, err error) bool {
	switch {
	case err == nil:
		return false
	case errors.Is(err, errMemberMissing):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
	case errors.Is(err, errLastAdmin), errors.Is(err, errAlreadyMember), errors.Is(err, errInviteUsed):
		writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
	default:
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
	}
	return true
}

// ── Invites ──────────────────────────────────────────────────────────

type inviteResponse struct {
	InviteID   int32     `json:"invite_id"`
	AccountID  int32     `json:"account_id"`
	Token      string    `json:"token"`
	Role       string    `json:"role"`
	AllCameras bool      `json:"all_cameras"`
	VideoIDs   []int32   `json:"video_ids"`
	ExpiresAt  time.Time `json:"expires_at"`
}

// newInviteToken returns a fresh random token and the hash that is stored.
func newInviteToken() (token, hash string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, hashInviteToken(token), nil
}

// hashInviteToken is the only form of a token the database ever sees.
func hashInviteToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// CreateInvite handles POST /accounts/{id}/invites — `{ role, all_cameras?,
// video_ids? }`. The response carries the token once; only its SHA-256 is
// stored, so a lost link cannot be shown again (make a new one). The link
// is single-use and expires after 7 days.
func CreateInvite(store ownerStore) http.HandlerFunc {
	return createInvite(store, time.Now)
}

func createInvite(store ownerStore, now func() time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		accountID, ok := loadManagedAccount(w, r, store)
		if !ok {
			return
		}
		var req memberSelection
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		ctx := r.Context()
		all, ids, msg, err := req.normalize(ctx, store, accountID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if msg != "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": msg})
			return
		}
		token, hash, err := newInviteToken()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		expires := now().Add(inviteTTL)
		id, err := store.CreateInvite(ctx, db.CreateInviteParams{
			AccountID: accountID, TokenHash: hash, Role: req.Role, AllCameras: all,
			VideoIds: ids, CreatedBy: middleware.UserID(ctx), ExpiresAt: expires,
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, inviteResponse{
			InviteID: id, AccountID: accountID, Token: token, Role: req.Role,
			AllCameras: all, VideoIDs: ids, ExpiresAt: expires,
		})
	}
}

// AcceptInvite handles POST /invites/accept — `{ token }`, by whoever is
// signed in. The token goes in the body, never the URL, so it does not land
// in access logs. 404 unknown token, 409 already used (or the caller is
// already a member — the invite then stays unused), 410 expired.
func AcceptInvite(store ownerStore) http.HandlerFunc {
	return acceptInvite(store, time.Now)
}

func acceptInvite(store ownerStore, now func() time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Token string `json:"token"`
		}
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		req.Token = strings.TrimSpace(req.Token)
		if req.Token == "" || len(req.Token) > 200 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "token is required"})
			return
		}
		ctx := r.Context()
		user := middleware.UserID(ctx)

		inv, err := store.GetInviteByHash(ctx, hashInviteToken(req.Token))
		if err != nil {
			if isNotFound(err) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "invite not found"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		if inv.AcceptedAt.Valid {
			writeJSON(w, http.StatusConflict, map[string]string{"error": errInviteUsed.Error()})
			return
		}
		if !now().Before(inv.ExpiresAt) {
			writeJSON(w, http.StatusGone, map[string]string{"error": "this invite has expired"})
			return
		}

		err = store.Tx(ctx, func(q ownerQueries) error {
			if _, err := q.LockAccount(ctx, inv.AccountID); err != nil {
				return err
			}
			if _, err := q.GetAccountMember(ctx, db.GetAccountMemberParams{AccountID: inv.AccountID, UserID: user}); err == nil {
				return errAlreadyMember
			} else if !isNotFound(err) {
				return err
			}
			n, err := q.MarkInviteAccepted(ctx, db.MarkInviteAcceptedParams{InviteID: inv.InviteID, AcceptedBy: user})
			if err != nil {
				return err
			}
			if n == 0 {
				return errInviteUsed
			}
			if err := q.AddAccountMember(ctx, db.AddAccountMemberParams{
				AccountID: inv.AccountID, UserID: user, Role: inv.Role, AllCameras: inv.AllCameras,
			}); err != nil {
				return err
			}
			if !inv.AllCameras && len(inv.VideoIds) > 0 {
				return q.AddMemberVideos(ctx, db.AddMemberVideosParams{AccountID: inv.AccountID, UserID: user, VideoIds: inv.VideoIds})
			}
			return nil
		})
		if writeMemberError(w, err) {
			return
		}
		m, err := findMember(ctx, store, inv.AccountID, user)
		if writeMemberError(w, err) {
			return
		}
		writeJSON(w, http.StatusOK, m)
	}
}

// ── NationCam admin ──────────────────────────────────────────────────

func toAccountResponse(a db.ListAccountsRow) accountResponse {
	return accountResponse{
		AccountID: a.AccountID, Name: a.Name,
		Personal: a.PersonalOwnerID.Valid, PersonalOwnerID: a.PersonalOwnerID.String,
		CreatedBy: a.CreatedBy, CreatedAt: a.CreatedAt, UpdatedAt: a.UpdatedAt,
		MemberCount: a.MemberCount, SublocationCount: a.SublocationCount, VideoCount: a.VideoCount,
	}
}

// ListAllAccounts handles GET /accounts — every account (NationCam admin).
func ListAllAccounts(store ownerStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := store.ListAccounts(r.Context())
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		out := make([]accountResponse, 0, len(rows))
		for _, a := range rows {
			out = append(out, toAccountResponse(a))
		}
		writeJSON(w, http.StatusOK, out)
	}
}

// accountByID re-reads one account in the list shape (with counts).
func accountByID(ctx context.Context, q ownerQueries, id int32) (accountResponse, error) {
	rows, err := q.ListAccounts(ctx)
	if err != nil {
		return accountResponse{}, err
	}
	for _, a := range rows {
		if a.AccountID == id {
			return toAccountResponse(a), nil
		}
	}
	return accountResponse{}, errors.New("account vanished")
}

// CreateAccount handles POST /accounts — `{ name, admin_user_id? }`
// (NationCam admin). The account starts with one admin member:
// admin_user_id (a Logto sub) when given, else the calling NationCam admin,
// who can then invite the customer and step out.
func CreateAccount(store ownerStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Name        string `json:"name"`
			AdminUserID string `json:"admin_user_id"`
		}
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}
		req.Name = strings.TrimSpace(req.Name)
		req.AdminUserID = strings.TrimSpace(req.AdminUserID)
		if req.Name == "" || len(req.Name) > accountMaxName {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name is required (at most 120 characters)"})
			return
		}
		ctx := r.Context()
		admin := req.AdminUserID
		if admin == "" {
			admin = middleware.UserID(ctx)
		}
		if admin == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "admin_user_id is required"})
			return
		}
		var id int32
		err := store.Tx(ctx, func(q ownerQueries) error {
			var err error
			id, err = q.CreateAccount(ctx, db.CreateAccountParams{Name: req.Name, CreatedBy: middleware.UserID(ctx)})
			if err != nil {
				return err
			}
			return q.AddAccountMember(ctx, db.AddAccountMemberParams{AccountID: id, UserID: admin, Role: roleAdmin, AllCameras: true})
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		a, err := accountByID(ctx, store, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, a)
	}
}

// readAssignTarget reads `{ account_id }` and checks the account exists.
func readAssignTarget(w http.ResponseWriter, r *http.Request, store ownerStore) (int32, bool) {
	var req struct {
		AccountID int32 `json:"account_id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return 0, false
	}
	if req.AccountID <= 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "account_id is required"})
		return 0, false
	}
	if _, err := store.GetAccount(r.Context(), req.AccountID); err != nil {
		if isNotFound(err) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown account_id"})
		} else {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return 0, false
	}
	return req.AccountID, true
}

// AssignVideoAccount handles PUT /videos/{id}/account — `{ account_id }`
// (NationCam admin): an existing camera (admin-owned or another account's)
// now belongs to that account. owner_id is left as it was. Picks of the
// camera by viewers of its old account are dropped.
func AssignVideoAccount(store ownerStore, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := reviewID(w, r, "video")
		if !ok {
			return
		}
		ctx := r.Context()
		if _, err := store.GetVideoForOwner(ctx, id); err != nil {
			writeReviewError(w, err, "camera")
			return
		}
		accountID, ok := readAssignTarget(w, r, store)
		if !ok {
			return
		}
		err := store.Tx(ctx, func(q ownerQueries) error {
			if err := q.AssignVideoAccount(ctx, db.AssignVideoAccountParams{VideoID: id, AccountID: &accountID}); err != nil {
				return err
			}
			return q.DropStaleVideoPicks(ctx)
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		row, err := store.GetVideoForOwner(ctx, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		invalidateCatalog(ctx, c)
		writeJSON(w, http.StatusOK, row)
	}
}

// AssignSublocationAccount handles PUT /sublocations/{id}/account —
// `{ account_id }` (NationCam admin): the location and every camera in it
// now belong to that account, in one transaction.
func AssignSublocationAccount(store ownerStore, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, ok := reviewID(w, r, "sublocation")
		if !ok {
			return
		}
		ctx := r.Context()
		if _, err := store.GetSublocationForOwner(ctx, id); err != nil {
			writeReviewError(w, err, "sublocation")
			return
		}
		accountID, ok := readAssignTarget(w, r, store)
		if !ok {
			return
		}
		err := store.Tx(ctx, func(q ownerQueries) error {
			if err := q.AssignSublocationAccount(ctx, db.AssignSublocationAccountParams{SublocationID: id, AccountID: &accountID}); err != nil {
				return err
			}
			sid := id
			if err := q.AssignSublocationVideosAccount(ctx, db.AssignSublocationVideosAccountParams{SublocationID: &sid, AccountID: &accountID}); err != nil {
				return err
			}
			return q.DropStaleVideoPicks(ctx)
		})
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		row, err := store.GetSublocationForOwner(ctx, id)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
			return
		}
		invalidateCatalog(ctx, c)
		writeJSON(w, http.StatusOK, row)
	}
}
