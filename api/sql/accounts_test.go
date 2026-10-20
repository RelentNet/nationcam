package sql

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/jackc/pgx/v5"
)

// TestAccountsMigration applies the embedded schema to a scratch database and
// checks the DAN-381 migration and account queries: owner_id-only rows (as
// the previous image writes them) get one personal account with an admin
// membership per distinct owner, owner_id is untouched, admin-owned rows get
// no account, re-running the schema changes nothing (it runs on every boot)
// and never resurrects a removed member, and the CHECKs hold.
//
// Set TEST_DATABASE_URL to run it (see TestVideoSlugs). Everything runs in one
// transaction that is rolled back.
func TestAccountsMigration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer tx.Rollback(ctx)

	apply := func() {
		t.Helper()
		if _, err := tx.Exec(ctx, Schema); err != nil {
			t.Fatalf("apply schema: %v", err)
		}
	}
	apply()
	q := db.New(tx)

	// Start from a clean slate inside the transaction: the scratch database
	// may hold rows from elsewhere.
	if _, err := tx.Exec(ctx, `TRUNCATE accounts, account_members, account_member_videos, account_invites CASCADE`); err != nil {
		t.Fatalf("truncate: %v", err)
	}
	var stateID int32
	if err := tx.QueryRow(ctx, `INSERT INTO states (name) VALUES ('Accounts State') RETURNING state_id`).Scan(&stateID); err != nil {
		t.Fatalf("insert state: %v", err)
	}

	// Rows written the pre-accounts way: owner_id only.
	insertSub := func(name, owner string) int32 {
		t.Helper()
		var id int32
		if err := tx.QueryRow(ctx,
			`INSERT INTO sublocations (name, state_id, owner_id) VALUES ($1, $2, $3) RETURNING sublocation_id`,
			name, stateID, owner).Scan(&id); err != nil {
			t.Fatalf("insert sublocation: %v", err)
		}
		return id
	}
	insertVid := func(title string, subID int32, owner string) int32 {
		t.Helper()
		var id int32
		if err := tx.QueryRow(ctx,
			`INSERT INTO videos (title, src, state_id, sublocation_id, owner_id) VALUES ($1, 'x', $2, $3, $4) RETURNING video_id`,
			title, stateID, subID, owner).Scan(&id); err != nil {
			t.Fatalf("insert video: %v", err)
		}
		return id
	}
	sub1 := insertSub("Owner One Place", "mig-owner-1")
	legacySub := insertSub("Legacy Place", "")
	v1a := insertVid("one-a", sub1, "mig-owner-1")
	v1b := insertVid("one-b", sub1, "mig-owner-1")
	v2 := insertVid("two", legacySub, "mig-owner-2") // owner with a camera only
	legacyVid := insertVid("legacy", legacySub, "")

	apply() // the boot that runs the migration

	accountOf := func(table, idCol string, id int32) (*int32, string) {
		t.Helper()
		var acct *int32
		var owner string
		if err := tx.QueryRow(ctx, `SELECT account_id, owner_id FROM `+table+` WHERE `+idCol+` = $1`, id).Scan(&acct, &owner); err != nil {
			t.Fatalf("read %s %d: %v", table, id, err)
		}
		return acct, owner
	}
	p1, err := q.GetPersonalAccountID(ctx, "mig-owner-1")
	if err != nil {
		t.Fatalf("personal account for owner 1: %v", err)
	}
	p2, err := q.GetPersonalAccountID(ctx, "mig-owner-2")
	if err != nil {
		t.Fatalf("personal account for owner 2: %v", err)
	}
	for _, tc := range []struct {
		table, col string
		id         int32
		want       *int32
		owner      string
	}{
		{"sublocations", "sublocation_id", sub1, &p1, "mig-owner-1"},
		{"sublocations", "sublocation_id", legacySub, nil, ""},
		{"videos", "video_id", v1a, &p1, "mig-owner-1"},
		{"videos", "video_id", v1b, &p1, "mig-owner-1"},
		{"videos", "video_id", v2, &p2, "mig-owner-2"},
		{"videos", "video_id", legacyVid, nil, ""},
	} {
		got, owner := accountOf(tc.table, tc.col, tc.id)
		if (got == nil) != (tc.want == nil) || (got != nil && *got != *tc.want) || owner != tc.owner {
			t.Errorf("%s %d: account %v owner %q, want %v %q", tc.table, tc.id, got, owner, tc.want, tc.owner)
		}
	}
	for _, p := range []struct {
		acct  int32
		owner string
	}{{p1, "mig-owner-1"}, {p2, "mig-owner-2"}} {
		m, err := q.GetAccountMember(ctx, db.GetAccountMemberParams{AccountID: p.acct, UserID: p.owner})
		if err != nil || m.Role != "admin" || !m.AllCameras {
			t.Errorf("membership of %s = %+v, %v", p.owner, m, err)
		}
	}
	counts := func() (accounts, members int) {
		t.Helper()
		if err := tx.QueryRow(ctx, `SELECT (SELECT COUNT(*) FROM accounts), (SELECT COUNT(*) FROM account_members)`).Scan(&accounts, &members); err != nil {
			t.Fatalf("count: %v", err)
		}
		return
	}
	if a, m := counts(); a != 2 || m != 2 {
		t.Errorf("after migration: %d accounts, %d members, want 2 and 2", a, m)
	}

	// The owner queries answer as before for a migrated owner.
	if mine, _ := q.ListOwnerVideos(ctx, "mig-owner-1"); len(mine) != 2 {
		t.Errorf("ListOwnerVideos(owner 1) = %d rows, want 2", len(mine))
	}
	if subs, _ := q.ListOwnerSublocations(ctx, "mig-owner-1"); len(subs) != 1 || subs[0].SublocationID != sub1 {
		t.Errorf("ListOwnerSublocations(owner 1) = %+v", subs)
	}
	if n, _ := q.CountAccountVideos(ctx, &p1); n != 2 {
		t.Errorf("CountAccountVideos(p1) = %d", n)
	}

	// Idempotent: a second boot changes nothing.
	apply()
	if a, m := counts(); a != 2 || m != 2 {
		t.Errorf("after re-run: %d accounts, %d members, want 2 and 2", a, m)
	}

	// A member removed from a personal account is not resurrected by a boot.
	if err := q.AddAccountMember(ctx, db.AddAccountMemberParams{AccountID: p1, UserID: "co-admin", Role: "admin", AllCameras: true}); err != nil {
		t.Fatalf("add co-admin: %v", err)
	}
	if err := q.DeleteAccountMember(ctx, db.DeleteAccountMemberParams{AccountID: p1, UserID: "mig-owner-1"}); err != nil {
		t.Fatalf("remove owner: %v", err)
	}
	apply()
	if _, err := q.GetAccountMember(ctx, db.GetAccountMemberParams{AccountID: p1, UserID: "mig-owner-1"}); err == nil {
		t.Error("boot re-added a removed member")
	}
	// Restore for the queries below.
	if err := q.AddAccountMember(ctx, db.AddAccountMemberParams{AccountID: p1, UserID: "mig-owner-1", Role: "admin", AllCameras: true}); err != nil {
		t.Fatalf("re-add owner: %v", err)
	}

	// A row the previous image writes after a rollback is picked up next boot.
	late := insertVid("late", sub1, "mig-owner-1")
	apply()
	if got, _ := accountOf("videos", "video_id", late); got == nil || *got != p1 {
		t.Errorf("late row account = %v, want %d", got, p1)
	}

	// CHECKs.
	for _, bad := range []string{
		`INSERT INTO account_members (account_id, user_id, role) VALUES (` + itoa(p1) + `, 'x', 'owner')`,
		`INSERT INTO account_members (account_id, user_id, role, all_cameras) VALUES (` + itoa(p1) + `, 'y', 'admin', FALSE)`,
		`INSERT INTO account_members (account_id, user_id, role) VALUES (` + itoa(p1) + `, '', 'viewer')`,
		`INSERT INTO accounts (name, personal_owner_id) VALUES ('x', '')`,
		`INSERT INTO accounts (name, personal_owner_id) VALUES ('dup', 'mig-owner-1')`,
		`INSERT INTO account_invites (account_id, token_hash, role, all_cameras, expires_at) VALUES (` + itoa(p1) + `, 'h', 'admin', FALSE, now())`,
	} {
		sp, _ := tx.Begin(ctx)
		if _, err := sp.Exec(ctx, bad); err == nil {
			t.Errorf("accepted: %s", bad)
		}
		_ = sp.Rollback(ctx)
	}

	// Viewer access and listings.
	shared, err := q.CreateAccount(ctx, db.CreateAccountParams{Name: "Shared", CreatedBy: "staff"})
	if err != nil {
		t.Fatalf("create account: %v", err)
	}
	if err := q.AssignVideoAccount(ctx, db.AssignVideoAccountParams{VideoID: v2, AccountID: &shared}); err != nil {
		t.Fatalf("assign: %v", err)
	}
	for _, m := range []db.AddAccountMemberParams{
		{AccountID: shared, UserID: "boss", Role: "admin", AllCameras: true},
		{AccountID: shared, UserID: "all-viewer", Role: "viewer", AllCameras: true},
		{AccountID: shared, UserID: "picky", Role: "viewer", AllCameras: false},
	} {
		if err := q.AddAccountMember(ctx, m); err != nil {
			t.Fatalf("add member %s: %v", m.UserID, err)
		}
	}
	legacyID := legacyVid
	if err := q.AssignVideoAccount(ctx, db.AssignVideoAccountParams{VideoID: legacyID, AccountID: &shared}); err != nil {
		t.Fatalf("assign legacy: %v", err)
	}
	// Picks only take the account's own cameras (v1a is in p1).
	if err := q.AddMemberVideos(ctx, db.AddMemberVideosParams{AccountID: shared, UserID: "picky", VideoIds: []int32{v2, v1a}}); err != nil {
		t.Fatalf("pick: %v", err)
	}
	if n, _ := q.CountAccountVideosIn(ctx, db.CountAccountVideosInParams{AccountID: shared, VideoIds: []int32{v2, v1a}}); n != 1 {
		t.Errorf("CountAccountVideosIn = %d, want 1", n)
	}
	members, _ := q.ListAccountMembers(ctx, shared)
	for _, m := range members {
		if m.UserID == "picky" && (len(m.VideoIds) != 1 || m.VideoIds[0] != v2) {
			t.Errorf("picky picks = %v", m.VideoIds)
		}
	}
	access := func(user string, video int32) (db.GetMemberVideoAccessRow, error) {
		return q.GetMemberVideoAccess(ctx, db.GetMemberVideoAccessParams{VideoID: video, UserID: user})
	}
	if a, err := access("picky", v2); err != nil || !a.Picked || a.AllCameras {
		t.Errorf("picky/v2 = %+v, %v", a, err)
	}
	if a, err := access("picky", legacyVid); err != nil || a.Picked {
		t.Errorf("picky/legacy = %+v, %v", a, err)
	}
	if _, err := access("picky", v1a); err == nil {
		t.Error("access row for a camera of another account")
	}
	if vids, _ := q.ListOwnerVideos(ctx, "picky"); len(vids) != 1 || vids[0].VideoID != v2 {
		t.Errorf("ListOwnerVideos(picky) = %+v", vids)
	}
	if vids, _ := q.ListOwnerVideos(ctx, "all-viewer"); len(vids) != 2 {
		t.Errorf("ListOwnerVideos(all-viewer) = %d rows, want 2", len(vids))
	}
	if n, _ := q.CountAccountAdmins(ctx, shared); n != 1 {
		t.Errorf("CountAccountAdmins = %d", n)
	}
	mine, _ := q.ListMyAccounts(ctx, "mig-owner-1")
	if len(mine) != 1 || !mine[0].Personal || mine[0].Role != "admin" || mine[0].VideoCount != 3 {
		t.Errorf("ListMyAccounts(owner 1) = %+v", mine)
	}

	// Moving v2 back out drops picky's now-stale pick.
	if err := q.AssignVideoAccount(ctx, db.AssignVideoAccountParams{VideoID: v2, AccountID: &p2}); err != nil {
		t.Fatalf("move back: %v", err)
	}
	if err := q.DropStaleVideoPicks(ctx); err != nil {
		t.Fatalf("drop stale: %v", err)
	}
	if a, err := access("picky", v2); err == nil {
		t.Errorf("stale access row survived: %+v", a)
	}

	// Invites are single-use at the SQL level.
	inv, err := q.CreateInvite(ctx, db.CreateInviteParams{
		AccountID: shared, TokenHash: "abc123", Role: "viewer", AllCameras: false,
		VideoIds: []int32{legacyVid}, CreatedBy: "boss", ExpiresAt: time.Now().Add(time.Hour),
	})
	if err != nil {
		t.Fatalf("create invite: %v", err)
	}
	if got, err := q.GetInviteByHash(ctx, "abc123"); err != nil || got.InviteID != inv || len(got.VideoIds) != 1 || got.AcceptedAt.Valid {
		t.Errorf("GetInviteByHash = %+v, %v", got, err)
	}
	if n, _ := q.MarkInviteAccepted(ctx, db.MarkInviteAcceptedParams{InviteID: inv, AcceptedBy: "u1"}); n != 1 {
		t.Errorf("first accept rows = %d", n)
	}
	if n, _ := q.MarkInviteAccepted(ctx, db.MarkInviteAcceptedParams{InviteID: inv, AcceptedBy: "u2"}); n != 0 {
		t.Errorf("second accept rows = %d", n)
	}

	// Deleting an account leaves its rows unowned, never deletes them.
	if _, err := tx.Exec(ctx, `DELETE FROM accounts WHERE account_id = $1`, shared); err != nil {
		t.Fatalf("delete account: %v", err)
	}
	if got, _ := accountOf("videos", "video_id", legacyVid); got != nil {
		t.Errorf("legacy video account after account delete = %v", *got)
	}
}
