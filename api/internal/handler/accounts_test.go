package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/db"
)

// Accounts, members and invites (DAN-381), on the in-memory store.

const (
	userC = "logto-user-c"
	userD = "logto-user-d"
)

func itos(n int32) string { return strconv.Itoa(int(n)) }

// sharedAccount seeds "Acme" with userA as admin, a location with two
// cameras, userB as an all-cameras viewer and userC as a viewer restricted
// to the first camera.
func sharedAccount(h *ownerHarness) (acct, sub, cam1, cam2 int32) {
	acct = h.store.addAccount("Acme", userA)
	sub = h.store.addSub(userA, statusApproved, 1)
	cam1 = h.store.addVid(userA, statusActive, sub, "acme1")
	cam2 = h.store.addVid(userA, statusActive, sub, "acme2")
	h.store.moveSub(sub, acct)
	h.store.addMember(acct, userB, roleViewer, true)
	h.store.addMember(acct, userC, roleViewer, false, cam1)
	return
}

func TestListMyAccountsAndMe(t *testing.T) {
	h := newOwnerHarness(t, true)
	acct, _, _, _ := sharedAccount(h)
	personal := h.store.personal(userA)
	own := h.store.addSub(userA, statusApproved, 1)
	h.store.addVid(userA, statusActive, own, "own1")

	rec := h.do(as(userA, ""), http.MethodGet, "/me/accounts", "")
	wantStatus(t, rec, http.StatusOK)
	got := decode[[]db.ListMyAccountsRow](t, rec)
	if len(got) != 2 || !got[0].Personal || got[0].AccountID != personal || got[0].Role != roleAdmin ||
		got[1].AccountID != acct || got[1].Role != roleAdmin || got[1].VideoCount != 2 {
		t.Fatalf("A accounts = %+v", got)
	}

	rec = h.do(as(userC, ""), http.MethodGet, "/me/accounts", "")
	if got := decode[[]db.ListMyAccountsRow](t, rec); len(got) != 1 || got[0].Role != roleViewer || got[0].AllCameras || got[0].Personal {
		t.Errorf("C accounts = %+v", got)
	}

	// GET /me keeps its old fields (counts = the personal account) and gains
	// personal_account_id + accounts.
	rec = h.do(as(userA, ""), http.MethodGet, "/me", "")
	me := decode[meResponse](t, rec)
	if me.Counts.Sublocations != 1 || me.Counts.Videos != 1 || me.PersonalAccountID == nil || *me.PersonalAccountID != personal || len(me.Accounts) != 2 {
		t.Errorf("me = %+v", me)
	}
	raw := decode[map[string]any](t, rec)
	for _, k := range []string{"user_id", "is_admin", "limits", "counts", "personal_account_id", "accounts"} {
		if _, ok := raw[k]; !ok {
			t.Errorf("GET /me lacks %q", k)
		}
	}
	// A viewer with no personal account: zero counts, null personal account.
	rec = h.do(as(userB, ""), http.MethodGet, "/me", "")
	if me := decode[meResponse](t, rec); me.PersonalAccountID != nil || me.Counts.Videos != 0 || len(me.Accounts) != 1 {
		t.Errorf("viewer me = %+v", me)
	}
}

func TestViewerCannotChangeAccountRows(t *testing.T) {
	h := newOwnerHarness(t, true)
	acct, sub, cam1, _ := sharedAccount(h)
	h.rs.add("acme1")
	sid, vid := itos(sub), itos(cam1)

	for _, viewer := range []string{userB, userC} {
		ctx := as(viewer, "")
		for _, ep := range []struct{ method, path, body string }{
			{http.MethodPut, "/me/sublocations/" + sid, `{"name":"X","state_id":1}`},
			{http.MethodDelete, "/me/sublocations/" + sid, ""},
			{http.MethodPut, "/me/videos/" + vid, `{"title":"X"}`},
			{http.MethodPost, "/me/videos/" + vid + "/pause", ""},
			{http.MethodPost, "/me/videos/" + vid + "/resume", ""},
			{http.MethodDelete, "/me/videos/" + vid, ""},
			{http.MethodPost, "/me/videos", `{"title":"X","rtsp_url":"rtsp://h/x","sublocation_id":` + sid + `}`},
			{http.MethodPost, "/me/sublocations", `{"name":"X","state_id":1,"account_id":` + itos(acct) + `}`},
		} {
			rec := h.do(ctx, ep.method, ep.path, ep.body)
			wantStatus(t, rec, http.StatusForbidden)
			if msg := decode[map[string]string](t, rec)["error"]; !strings.Contains(msg, "viewers") {
				t.Errorf("%s %s as viewer: message %q", ep.method, ep.path, msg)
			}
		}
	}
	if len(h.rs.commandLog()) != 0 || !h.rs.has("acme1") || h.store.video(cam1).Title == "X" {
		t.Error("a viewer request changed something")
	}

	// A second admin of the account can do all of it.
	h.store.addMember(acct, userD, roleAdmin, true)
	ctxD := as(userD, "")
	wantStatus(t, h.do(ctxD, http.MethodPut, "/me/videos/"+vid, `{"title":"Renamed"}`), http.StatusOK)
	wantStatus(t, h.do(ctxD, http.MethodPost, "/me/videos/"+vid+"/pause", ""), http.StatusOK)
	rec := h.do(ctxD, http.MethodPost, "/me/videos", `{"title":"New","rtsp_url":"rtsp://h/x","sublocation_id":`+sid+`}`)
	wantStatus(t, rec, http.StatusCreated)
	if v := decode[db.GetVideoForOwnerRow](t, rec); v.AccountID == nil || *v.AccountID != acct || v.OwnerID != userD {
		t.Errorf("new camera = %+v, want account %d created by D", v, acct)
	}
	rec = h.do(ctxD, http.MethodPost, "/me/sublocations", `{"name":"Second","state_id":1,"account_id":`+itos(acct)+`}`)
	wantStatus(t, rec, http.StatusCreated)
	if s := decode[db.GetSublocationForOwnerRow](t, rec); s.AccountID == nil || *s.AccountID != acct {
		t.Errorf("new sublocation = %+v", s)
	}
	// Someone outside the account keeps the old "not your" 403.
	rec = h.do(as("stranger", ""), http.MethodPut, "/me/videos/"+vid, `{"title":"X"}`)
	wantStatus(t, rec, http.StatusForbidden)
	if msg := decode[map[string]string](t, rec)["error"]; msg != "not your camera" {
		t.Errorf("stranger message = %q", msg)
	}
}

func TestViewerListings(t *testing.T) {
	h := newOwnerHarness(t, true)
	acct, sub, cam1, _ := sharedAccount(h)
	other := h.store.addSub(userA, statusApproved, 2)
	h.store.moveSub(other, acct)

	ids := func(user string) map[int32]bool {
		rec := h.do(as(user, ""), http.MethodGet, "/me/videos", "")
		wantStatus(t, rec, http.StatusOK)
		out := map[int32]bool{}
		for _, v := range decode[[]db.ListOwnerVideosRow](t, rec) {
			out[v.VideoID] = true
		}
		return out
	}
	if got := ids(userB); len(got) != 2 {
		t.Errorf("all-cameras viewer sees %v", got)
	}
	if got := ids(userC); len(got) != 1 || !got[cam1] {
		t.Errorf("restricted viewer sees %v, want only %d", got, cam1)
	}

	// A camera added later: the all-cameras viewer picks it up, the
	// restricted one does not.
	later := h.store.addVid(userA, statusActive, sub, "later")
	h.store.moveSub(sub, acct)
	if got := ids(userB); !got[later] {
		t.Error("all-cameras viewer does not see a camera added later")
	}
	if got := ids(userC); got[later] {
		t.Error("restricted viewer sees a camera that was not picked")
	}

	// Locations: the restricted viewer only sees the one with a pick.
	rec := h.do(as(userC, ""), http.MethodGet, "/me/sublocations", "")
	if got := decode[[]db.ListOwnerSublocationsRow](t, rec); len(got) != 1 || got[0].SublocationID != sub {
		t.Errorf("restricted viewer locations = %+v", got)
	}
	rec = h.do(as(userB, ""), http.MethodGet, "/me/sublocations", "")
	if got := decode[[]db.ListOwnerSublocationsRow](t, rec); len(got) != 2 {
		t.Errorf("all-cameras viewer locations = %+v", got)
	}
}

func TestCanViewCamera(t *testing.T) {
	h := newOwnerHarness(t, true)
	acct, sub, cam1, cam2 := sharedAccount(h)
	later := h.store.addVid(userA, statusActive, sub, "later")
	h.store.moveSub(sub, acct)
	elsewhere := h.store.addVid(userD, statusActive, h.store.addSub(userD, statusApproved, 1), "d1")
	adminOwned := h.store.addVid("", statusActive, sub, "")
	h.store.mu.Lock()
	v := h.store.vids[adminOwned]
	v.AccountID = nil
	h.store.vids[adminOwned] = v
	h.store.mu.Unlock()

	for _, tc := range []struct {
		name   string
		user   string
		admin  bool
		video  int32
		expect bool
	}{
		{"nationcam admin, any camera", "staff", true, elsewhere, true},
		{"nationcam admin, admin-owned camera", "staff", true, adminOwned, true},
		{"account admin", userA, false, cam2, true},
		{"account admin, camera added later", userA, false, later, true},
		{"all-cameras viewer", userB, false, cam2, true},
		{"all-cameras viewer, camera added later", userB, false, later, true},
		{"restricted viewer, picked", userC, false, cam1, true},
		{"restricted viewer, not picked", userC, false, cam2, false},
		{"restricted viewer, camera added later", userC, false, later, false},
		{"member of another account", userD, false, cam1, false},
		{"own personal camera", userD, false, elsewhere, true},
		{"viewer, another account's camera", userB, false, elsewhere, false},
		{"stranger", "stranger", false, cam1, false},
		{"anonymous", "", false, cam1, false},
		{"camera with no account", userA, false, adminOwned, false},
		{"unknown camera", userA, false, 999, false},
	} {
		got, err := CanViewCamera(context.Background(), h.store, tc.user, tc.admin, tc.video)
		if err != nil || got != tc.expect {
			t.Errorf("%s: CanViewCamera = %v, %v; want %v", tc.name, got, err, tc.expect)
		}
	}

	// The pure rule, exhaustively.
	for _, tc := range []struct {
		role        string
		all, picked bool
		want        bool
	}{
		{roleAdmin, true, false, true},
		{roleAdmin, false, false, true},
		{roleViewer, true, false, true},
		{roleViewer, false, true, true},
		{roleViewer, false, false, false},
		{"", true, true, false},
		{"owner", true, true, false},
	} {
		if got := memberCanView(tc.role, tc.all, tc.picked); got != tc.want {
			t.Errorf("memberCanView(%q, %v, %v) = %v", tc.role, tc.all, tc.picked, got)
		}
	}
}

func TestAccountMembers(t *testing.T) {
	h := newOwnerHarness(t, true)
	acct, _, cam1, cam2 := sharedAccount(h)
	base := "/accounts/" + itos(acct) + "/members"
	ctxA := as(userA, "")

	// List: admin and NationCam admin yes; viewer and stranger no.
	rec := h.do(ctxA, http.MethodGet, base, "")
	wantStatus(t, rec, http.StatusOK)
	members := decode[[]memberResponse](t, rec)
	if len(members) != 3 || members[0].UserID != userA || members[2].UserID != userC || len(members[2].VideoIDs) != 1 || members[2].VideoIDs[0] != cam1 {
		t.Fatalf("members = %+v", members)
	}
	wantStatus(t, h.do(adminCtx, http.MethodGet, base, ""), http.StatusOK)
	wantStatus(t, h.do(as(userB, ""), http.MethodGet, base, ""), http.StatusForbidden)
	wantStatus(t, h.do(as("stranger", ""), http.MethodGet, base, ""), http.StatusForbidden)
	wantStatus(t, h.do(ctxA, http.MethodGet, "/accounts/999/members", ""), http.StatusNotFound)
	wantStatus(t, h.do(as("", ""), http.MethodGet, base, ""), http.StatusUnauthorized)

	// Change a restricted viewer's selection.
	rec = h.do(ctxA, http.MethodPut, base+"/"+userC, `{"role":"viewer","all_cameras":false,"video_ids":[`+itos(cam2)+`,`+itos(cam2)+`]}`)
	wantStatus(t, rec, http.StatusOK)
	if m := decode[memberResponse](t, rec); m.AllCameras || len(m.VideoIDs) != 1 || m.VideoIDs[0] != cam2 {
		t.Errorf("after reselect = %+v", m)
	}
	if ok, _ := CanViewCamera(context.Background(), h.store, userC, false, cam1); ok {
		t.Error("old pick still grants access")
	}
	// Picks must be the account's cameras; role must be valid; admin cannot be restricted.
	other := h.store.addVid(userD, statusActive, h.store.addSub(userD, statusApproved, 1), "d1")
	for _, bad := range []string{
		`{"role":"viewer","all_cameras":false,"video_ids":[` + itos(other) + `]}`,
		`{"role":"owner"}`,
		`{"role":"admin","all_cameras":false}`,
		`nope`,
	} {
		wantStatus(t, h.do(ctxA, http.MethodPut, base+"/"+userC, bad), http.StatusBadRequest)
	}
	wantStatus(t, h.do(ctxA, http.MethodPut, base+"/nobody", `{"role":"viewer"}`), http.StatusNotFound)
	// Back to all cameras clears the picks.
	rec = h.do(ctxA, http.MethodPut, base+"/"+userC, `{"role":"viewer"}`)
	if m := decode[memberResponse](t, rec); !m.AllCameras || len(m.VideoIDs) != 0 {
		t.Errorf("after all-cameras = %+v", m)
	}

	// A viewer cannot change members.
	wantStatus(t, h.do(as(userB, ""), http.MethodPut, base+"/"+userC, `{"role":"admin"}`), http.StatusForbidden)

	// The last admin cannot be demoted or removed: 409.
	rec = h.do(ctxA, http.MethodPut, base+"/"+userA, `{"role":"viewer"}`)
	wantStatus(t, rec, http.StatusConflict)
	wantStatus(t, h.do(ctxA, http.MethodDelete, base+"/"+userA, ""), http.StatusConflict)
	wantStatus(t, h.do(adminCtx, http.MethodDelete, base+"/"+userA, ""), http.StatusConflict)

	// Promote B; now A may step down, and B is the last admin.
	rec = h.do(ctxA, http.MethodPut, base+"/"+userB, `{"role":"admin"}`)
	wantStatus(t, rec, http.StatusOK)
	wantStatus(t, h.do(ctxA, http.MethodPut, base+"/"+userA, `{"role":"viewer"}`), http.StatusOK)
	wantStatus(t, h.do(as(userB, ""), http.MethodPut, base+"/"+userB, `{"role":"viewer"}`), http.StatusConflict)

	// Remove a member; any member may also leave by themselves.
	wantStatus(t, h.do(as(userB, ""), http.MethodDelete, base+"/"+userC, ""), http.StatusNoContent)
	wantStatus(t, h.do(as(userA, ""), http.MethodDelete, base+"/"+userA, ""), http.StatusNoContent)
	wantStatus(t, h.do(as(userB, ""), http.MethodDelete, base+"/"+userC, ""), http.StatusNotFound)
	wantStatus(t, h.do(as(userB, ""), http.MethodDelete, base+"/"+userB, ""), http.StatusConflict)
	rec = h.do(as(userB, ""), http.MethodGet, base, "")
	if got := decode[[]memberResponse](t, rec); len(got) != 1 || got[0].UserID != userB || got[0].Role != roleAdmin {
		t.Errorf("members after removals = %+v", got)
	}
	// A removed member lost access.
	if ok, _ := CanViewCamera(context.Background(), h.store, userA, false, cam1); ok {
		t.Error("removed member can still view")
	}
}

func TestInvites(t *testing.T) {
	h := newOwnerHarness(t, true)
	acct, _, cam1, cam2 := sharedAccount(h)
	path := "/accounts/" + itos(acct) + "/invites"

	// Only account admins (and NationCam admins) create invites.
	wantStatus(t, h.do(as(userB, ""), http.MethodPost, path, `{"role":"viewer"}`), http.StatusForbidden)
	wantStatus(t, h.do(as(userA, ""), http.MethodPost, path, `{"role":"boss"}`), http.StatusBadRequest)
	wantStatus(t, h.do(adminCtx, http.MethodPost, path, `{"role":"viewer"}`), http.StatusCreated)

	rec := h.do(as(userA, ""), http.MethodPost, path, `{"role":"viewer","all_cameras":false,"video_ids":[`+itos(cam2)+`]}`)
	wantStatus(t, rec, http.StatusCreated)
	inv := decode[inviteResponse](t, rec)
	if len(inv.Token) < 40 || inv.Role != roleViewer || inv.AllCameras || len(inv.VideoIDs) != 1 {
		t.Fatalf("invite = %+v", inv)
	}
	if d := time.Until(inv.ExpiresAt); d < 7*24*time.Hour-time.Minute || d > 7*24*time.Hour+time.Minute {
		t.Errorf("expires in %v, want 7 days", d)
	}
	// Only the hash is stored.
	h.store.mu.Lock()
	stored := h.store.invites[inv.InviteID]
	h.store.mu.Unlock()
	if stored.TokenHash == inv.Token || stored.TokenHash != hashInviteToken(inv.Token) || len(stored.TokenHash) != 64 {
		t.Errorf("stored token_hash %q is not the SHA-256 of the token", stored.TokenHash)
	}

	accept := func(user, token string) *httptest.ResponseRecorder {
		return h.do(as(user, ""), http.MethodPost, "/invites/accept", `{"token":"`+token+`"}`)
	}

	// Accepting applies role and camera selection.
	rec = accept(userD, inv.Token)
	wantStatus(t, rec, http.StatusOK)
	if m := decode[memberResponse](t, rec); m.UserID != userD || m.Role != roleViewer || m.AllCameras || len(m.VideoIDs) != 1 || m.VideoIDs[0] != cam2 {
		t.Errorf("accepted member = %+v", m)
	}
	if ok, _ := CanViewCamera(context.Background(), h.store, userD, false, cam2); !ok {
		t.Error("invitee cannot view the picked camera")
	}
	if ok, _ := CanViewCamera(context.Background(), h.store, userD, false, cam1); ok {
		t.Error("invitee can view a camera that was not picked")
	}

	// A second accept — by anyone — is rejected.
	wantStatus(t, accept("someone-else", inv.Token), http.StatusConflict)
	wantStatus(t, accept(userD, inv.Token), http.StatusConflict)

	// Unknown token: 404; missing: 400; anonymous: 401.
	wantStatus(t, accept(userD, "not-a-real-token"), http.StatusNotFound)
	wantStatus(t, h.do(as(userD, ""), http.MethodPost, "/invites/accept", `{}`), http.StatusBadRequest)
	wantStatus(t, h.do(as("", ""), http.MethodPost, "/invites/accept", `{"token":"x"}`), http.StatusUnauthorized)

	// An expired invite is rejected and adds no one.
	rec = h.do(as(userA, ""), http.MethodPost, path, `{"role":"admin"}`)
	expired := decode[inviteResponse](t, rec)
	h.store.mu.Lock()
	e := h.store.invites[expired.InviteID]
	e.ExpiresAt = time.Now().Add(-time.Minute)
	h.store.invites[expired.InviteID] = e
	h.store.mu.Unlock()
	wantStatus(t, accept("late-user", expired.Token), http.StatusGone)
	if _, err := h.store.GetAccountMember(context.Background(), db.GetAccountMemberParams{AccountID: acct, UserID: "late-user"}); err == nil {
		t.Error("expired invite added a member")
	}

	// An admin invite makes an admin; an existing member cannot accept (and
	// the invite stays usable).
	rec = h.do(as(userA, ""), http.MethodPost, path, `{"role":"admin"}`)
	adminInv := decode[inviteResponse](t, rec)
	wantStatus(t, accept(userB, adminInv.Token), http.StatusConflict)
	rec = accept("new-admin", adminInv.Token)
	wantStatus(t, rec, http.StatusOK)
	if m := decode[memberResponse](t, rec); m.Role != roleAdmin || !m.AllCameras {
		t.Errorf("admin invitee = %+v", m)
	}
}

func TestNationCamAdminAccounts(t *testing.T) {
	h := newOwnerHarness(t, true)

	// Admin-only.
	wantStatus(t, h.do(as(userA, ""), http.MethodPost, "/accounts", `{"name":"Acme"}`), http.StatusForbidden)
	wantStatus(t, h.do(as(userA, ""), http.MethodGet, "/accounts", ""), http.StatusForbidden)
	wantStatus(t, h.do(adminCtx, http.MethodPost, "/accounts", `{"name":""}`), http.StatusBadRequest)

	// Create with a named first admin.
	rec := h.do(adminCtx, http.MethodPost, "/accounts", `{"name":"Acme Construction","admin_user_id":"`+userA+`"}`)
	wantStatus(t, rec, http.StatusCreated)
	acct := decode[accountResponse](t, rec)
	if acct.Name != "Acme Construction" || acct.Personal || acct.MemberCount != 1 {
		t.Fatalf("account = %+v", acct)
	}
	if m, err := h.store.GetAccountMember(context.Background(), db.GetAccountMemberParams{AccountID: acct.AccountID, UserID: userA}); err != nil || m.Role != roleAdmin {
		t.Errorf("first admin = %+v, %v", m, err)
	}
	// Without admin_user_id the calling NationCam admin is the first admin.
	rec = h.do(adminCtx, http.MethodPost, "/accounts", `{"name":"Staff"}`)
	wantStatus(t, rec, http.StatusCreated)
	staff := decode[accountResponse](t, rec)
	if _, err := h.store.GetAccountMember(context.Background(), db.GetAccountMemberParams{AccountID: staff.AccountID, UserID: "admin-user"}); err != nil {
		t.Errorf("caller not admin of new account: %v", err)
	}

	// Assign an admin-owned camera and an owner's location (with its cameras).
	legacySub := h.store.addSub("", statusApproved, 1)
	legacyCam := h.store.addVid("", statusActive, legacySub, "")
	ownerSub := h.store.addSub(userB, statusApproved, 1)
	ownerCam := h.store.addVid(userB, statusActive, ownerSub, "b1")
	personalB := h.store.personal(userB)
	h.store.addMember(personalB, "b-viewer", roleViewer, false, ownerCam)

	wantStatus(t, h.do(as(userA, ""), http.MethodPut, "/videos/"+itos(legacyCam)+"/account", `{"account_id":`+itos(acct.AccountID)+`}`), http.StatusForbidden)
	wantStatus(t, h.do(adminCtx, http.MethodPut, "/videos/"+itos(legacyCam)+"/account", `{"account_id":999}`), http.StatusBadRequest)
	wantStatus(t, h.do(adminCtx, http.MethodPut, "/videos/999/account", `{"account_id":`+itos(acct.AccountID)+`}`), http.StatusNotFound)

	rec = h.do(adminCtx, http.MethodPut, "/videos/"+itos(legacyCam)+"/account", `{"account_id":`+itos(acct.AccountID)+`}`)
	wantStatus(t, rec, http.StatusOK)
	if v := decode[db.GetVideoForOwnerRow](t, rec); v.AccountID == nil || *v.AccountID != acct.AccountID || v.OwnerID != "" {
		t.Errorf("assigned camera = %+v (owner_id must be untouched)", v)
	}
	// The account's admin now manages it.
	wantStatus(t, h.do(as(userA, ""), http.MethodPut, "/me/videos/"+itos(legacyCam), `{"title":"Gate"}`), http.StatusOK)

	rec = h.do(adminCtx, http.MethodPut, "/sublocations/"+itos(ownerSub)+"/account", `{"account_id":`+itos(acct.AccountID)+`}`)
	wantStatus(t, rec, http.StatusOK)
	if s := decode[db.GetSublocationForOwnerRow](t, rec); s.AccountID == nil || *s.AccountID != acct.AccountID || s.OwnerID != userB {
		t.Errorf("assigned sublocation = %+v", s)
	}
	if v := h.store.video(ownerCam); v.AccountID == nil || *v.AccountID != acct.AccountID || v.OwnerID != userB {
		t.Errorf("camera did not move with its location: %+v", v)
	}
	// The old owner and their old account's viewer lost it; the new admin has it.
	wantStatus(t, h.do(as(userB, ""), http.MethodPost, "/me/videos/"+itos(ownerCam)+"/pause", ""), http.StatusForbidden)
	if ok, _ := CanViewCamera(context.Background(), h.store, "b-viewer", false, ownerCam); ok {
		t.Error("old account's viewer can still view a moved camera")
	}
	if ok, _ := CanViewCamera(context.Background(), h.store, userA, false, ownerCam); !ok {
		t.Error("new account admin cannot view the moved camera")
	}

	rec = h.do(adminCtx, http.MethodGet, "/accounts", "")
	wantStatus(t, rec, http.StatusOK)
	var found bool
	for _, a := range decode[[]accountResponse](t, rec) {
		if a.AccountID == acct.AccountID {
			found = true
			if a.VideoCount != 2 || a.SublocationCount != 1 {
				t.Errorf("listed account = %+v", a)
			}
		}
	}
	if !found {
		t.Error("new account not listed")
	}
}

func TestPersonalAccountCreatedOnFirstLocation(t *testing.T) {
	h := newOwnerHarness(t, true)
	if _, err := h.store.GetPersonalAccountID(context.Background(), "newcomer"); err == nil {
		t.Fatal("newcomer already has an account")
	}
	rec := h.do(as("newcomer", ""), http.MethodPost, "/me/sublocations", `{"name":"Home","state_id":1}`)
	wantStatus(t, rec, http.StatusCreated)
	s := decode[db.GetSublocationForOwnerRow](t, rec)
	id, err := h.store.GetPersonalAccountID(context.Background(), "newcomer")
	if err != nil || s.AccountID == nil || *s.AccountID != id || s.OwnerID != "newcomer" {
		t.Fatalf("sublocation = %+v, personal = %d, %v", s, id, err)
	}
	if m, _ := h.store.GetAccountMember(context.Background(), db.GetAccountMemberParams{AccountID: id, UserID: "newcomer"}); m.Role != roleAdmin {
		t.Errorf("newcomer is %q of their personal account", m.Role)
	}
	// A second location reuses it.
	wantStatus(t, h.do(as("newcomer", ""), http.MethodPost, "/me/sublocations", `{"name":"Cabin","state_id":1}`), http.StatusCreated)
	if n := len(h.store.accounts); n != 1 {
		t.Errorf("accounts = %d, want 1", n)
	}
	// Filing into an account the caller does not administer is a 403.
	other := h.store.addAccount("Other", userB)
	wantStatus(t, h.do(as("newcomer", ""), http.MethodPost, "/me/sublocations", `{"name":"X","state_id":1,"account_id":`+itos(other)+`}`), http.StatusForbidden)
}

func TestLimitsPerAccount(t *testing.T) {
	h := newOwnerHarness(t, true)
	acct := h.store.addAccount("Acme", userA)
	h.store.addMember(acct, userB, roleAdmin, true)
	sub := h.store.addSub(userA, statusApproved, 1)
	h.store.moveSub(sub, acct)
	body := `{"title":"Cam","rtsp_url":"rtsp://h/x","sublocation_id":` + itos(sub) + `}`

	// Two admins share the account's daily allowance.
	for i := 0; i < ownerCamerasPerDay; i++ {
		user := userA
		if i%2 == 1 {
			user = userB
		}
		wantStatus(t, h.do(as(user, ""), http.MethodPost, "/me/videos", body), http.StatusCreated)
	}
	rec := h.do(as(userB, ""), http.MethodPost, "/me/videos", body)
	wantStatus(t, rec, http.StatusTooManyRequests)
	if msg := decode[map[string]string](t, rec)["error"]; !strings.Contains(msg, "daily limit") {
		t.Errorf("per-day message = %q", msg)
	}

	// userA's personal account has its own allowance.
	own := h.store.addSub(userA, statusApproved, 1)
	wantStatus(t, h.do(as(userA, ""), http.MethodPost, "/me/videos",
		`{"title":"Mine","rtsp_url":"rtsp://h/x","sublocation_id":`+itos(own)+`}`), http.StatusCreated)

	// The total cap counts every camera of the account, whoever created it,
	// including ones a NationCam admin assigned.
	h.store.mu.Lock()
	for id, v := range h.store.vids {
		v.CreatedAt = time.Now().Add(-48 * time.Hour)
		h.store.vids[id] = v
	}
	h.store.mu.Unlock()
	for n, _ := h.store.CountAccountVideos(context.Background(), &acct); n < ownerMaxCameras; n, _ = h.store.CountAccountVideos(context.Background(), &acct) {
		h.store.addVid("", statusActive, sub, "")
		h.store.moveSub(sub, acct)
	}
	rec = h.do(as(userA, ""), http.MethodPost, "/me/videos", body)
	wantStatus(t, rec, http.StatusTooManyRequests)
	if msg := decode[map[string]string](t, rec)["error"]; !strings.Contains(msg, "camera limit") {
		t.Errorf("max message = %q", msg)
	}
}
