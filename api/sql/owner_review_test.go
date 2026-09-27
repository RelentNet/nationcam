package sql

import (
	"context"
	"errors"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// TestOwnerReviewVisibility applies the embedded schema to a scratch database
// and checks the DAN-39 contract at the SQL level: the widened status CHECKs,
// and that every public query hides pending/inactive/rejected cameras and
// pending/rejected sublocations while the owner and review queries see them.
//
// Set TEST_DATABASE_URL to run it (see TestVideoSlugs). Everything runs in one
// transaction that is rolled back.
func TestOwnerReviewVisibility(t *testing.T) {
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

	if _, err := tx.Exec(ctx, Schema); err != nil {
		t.Fatalf("apply schema: %v", err)
	}
	q := db.New(tx)

	var stateID int32
	if err := tx.QueryRow(ctx,
		`INSERT INTO states (name) VALUES ('Owner State') RETURNING state_id`).Scan(&stateID); err != nil {
		t.Fatalf("insert state: %v", err)
	}
	// A legacy sublocation takes the 'approved' default; the owner one is pending.
	approvedSub := insertSublocation(t, ctx, tx, stateID, "Approved Place")
	pendingSub, err := q.CreateOwnerSublocation(ctx, db.CreateOwnerSublocationParams{
		Name: "Pending Place", StateID: stateID, OwnerID: "owner-1",
	})
	if err != nil {
		t.Fatalf("create owner sublocation: %v", err)
	}

	insertVideo := func(title, status string, subID int32, owner string) int32 {
		t.Helper()
		var id int32
		if err := tx.QueryRow(ctx,
			`INSERT INTO videos (title, src, state_id, sublocation_id, status, owner_id, stream_id)
			 VALUES ($1, 'https://s.example/memfs/'||$1||'.m3u8', $2, $3, $4, $5, $1) RETURNING video_id`,
			title, stateID, subID, status, owner).Scan(&id); err != nil {
			t.Fatalf("insert video %q (%s): %v", title, status, err)
		}
		return id
	}
	active := insertVideo("active", "active", approvedSub, "")
	paused := insertVideo("paused", "paused", approvedSub, "owner-1")
	pending := insertVideo("pending", "pending", approvedSub, "owner-1")
	insertVideo("rejected", "rejected", approvedSub, "owner-1")
	insertVideo("inactive", "inactive", approvedSub, "")
	hidden := insertVideo("hidden", "active", pendingSub, "owner-1") // active, but its place is pending

	// The widened CHECKs accept the new statuses and nothing else.
	for _, bad := range []string{
		`INSERT INTO videos (title, src, state_id, status) VALUES ('x', 'x', ` + itoa(stateID) + `, 'bogus')`,
		`INSERT INTO sublocations (name, state_id, status) VALUES ('x', ` + itoa(stateID) + `, 'active')`,
	} {
		sp, _ := tx.Begin(ctx)
		if _, err := sp.Exec(ctx, bad); err == nil {
			t.Errorf("accepted: %s", bad)
		}
		_ = sp.Rollback(ctx)
	}

	// ── Public queries: active + paused in an approved place, nothing else ──
	publicIDs := func(name string, ids []int32) {
		t.Helper()
		want := map[int32]bool{active: true, paused: true}
		if len(ids) != len(want) {
			t.Errorf("%s returned %v, want exactly active+paused (%d, %d)", name, ids, active, paused)
			return
		}
		for _, id := range ids {
			if !want[id] {
				t.Errorf("%s leaked video %d", name, id)
			}
		}
	}
	all, _ := q.ListVideos(ctx)
	publicIDs("ListVideos", videoIDs(all, func(r db.ListVideosRow) int32 { return r.VideoID }))
	byState, _ := q.ListVideosByState(ctx, stateID)
	publicIDs("ListVideosByState", videoIDs(byState, func(r db.ListVideosByStateRow) int32 { return r.VideoID }))
	bySub, _ := q.ListVideosBySublocation(ctx, &approvedSub)
	publicIDs("ListVideosBySublocation", videoIDs(bySub, func(r db.ListVideosBySublocationRow) int32 { return r.VideoID }))
	byViews, _ := q.ListVideosByViews(ctx)
	publicIDs("ListVideosByViews", videoIDs(byViews, func(r db.ListVideosByViewsRow) int32 { return r.VideoID }))
	byCreated, _ := q.ListVideosByCreated(ctx)
	publicIDs("ListVideosByCreated", videoIDs(byCreated, func(r db.ListVideosByCreatedRow) int32 { return r.VideoID }))
	related, _ := q.ListRelatedVideos(ctx, db.ListRelatedVideosParams{VideoID: -1, SublocationID: &approvedSub, StateID: stateID})
	publicIDs("ListRelatedVideos", videoIDs(related, func(r db.ListRelatedVideosRow) int32 { return r.VideoID }))
	if hiddenSub, _ := q.ListVideosBySublocation(ctx, &pendingSub); len(hiddenSub) != 0 {
		t.Errorf("ListVideosBySublocation(pending place) = %d rows, want 0", len(hiddenSub))
	}

	// The per-camera lookup (camera page, frames, snapshot, stream redirect).
	slugOf := func(id int32) string {
		var s string
		_ = tx.QueryRow(ctx, `SELECT slug FROM videos WHERE video_id = $1`, id).Scan(&s)
		return s
	}
	for _, tc := range []struct {
		id     int32
		sub    string
		public bool
	}{
		{active, "approved-place", true},
		{paused, "approved-place", true},
		{pending, "approved-place", false},
		{hidden, "pending-place", false},
	} {
		_, err := q.GetVideoBySlug(ctx, db.GetVideoBySlugParams{StateSlug: "owner-state", SublocationSlug: tc.sub, Slug: slugOf(tc.id)})
		if tc.public && err != nil {
			t.Errorf("GetVideoBySlug(%d) = %v, want a row", tc.id, err)
		}
		if !tc.public && !errors.Is(err, pgx.ErrNoRows) {
			t.Errorf("GetVideoBySlug(%d) = %v, want ErrNoRows", tc.id, err)
		}
	}

	// The archive captures active cameras in approved places only.
	sources, _ := q.ListArchiveSources(ctx)
	if len(sources) != 1 || sources[0].VideoID != active {
		t.Errorf("ListArchiveSources = %+v, want only video %d", sources, active)
	}

	// Sublocations: public queries return approved rows only; counts are active-only.
	subs, _ := q.ListSublocationsByState(ctx, stateID)
	if len(subs) != 1 || subs[0].SublocationID != approvedSub {
		t.Errorf("ListSublocationsByState = %+v, want only the approved place", subs)
	} else if subs[0].VideoCount != 1 {
		t.Errorf("approved place video_count = %d, want 1 (active only, not paused)", subs[0].VideoCount)
	}
	if _, err := q.GetSublocationBySlug(ctx, "pending-place"); !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("GetSublocationBySlug(pending) = %v, want ErrNoRows", err)
	}
	if _, err := q.GetSublocationBySlug(ctx, "approved-place"); err != nil {
		t.Errorf("GetSublocationBySlug(approved) = %v", err)
	}
	// Admin/owner lookups see every status.
	if row, err := q.GetSublocationByID(ctx, pendingSub); err != nil || row.Status != "pending" || row.OwnerID != "owner-1" {
		t.Errorf("GetSublocationByID(pending) = %+v, %v", row, err)
	}

	// ── Owner and review queries ──
	mine, _ := q.ListOwnerVideos(ctx, "owner-1")
	if len(mine) != 4 {
		t.Errorf("ListOwnerVideos = %d rows, want 4 (paused, pending, rejected, hidden)", len(mine))
	}
	if n, _ := q.CountOwnerVideos(ctx, "owner-1"); n != 4 {
		t.Errorf("CountOwnerVideos = %d, want 4", n)
	}
	if n, _ := q.CountOwnerVideosSince(ctx, db.CountOwnerVideosSinceParams{OwnerID: "owner-1", CreatedAt: time.Now().Add(-time.Hour)}); n != 4 {
		t.Errorf("CountOwnerVideosSince(1h) = %d, want 4", n)
	}
	if n, _ := q.CountOwnerVideosSince(ctx, db.CountOwnerVideosSinceParams{OwnerID: "owner-1", CreatedAt: time.Now().Add(time.Hour)}); n != 0 {
		t.Errorf("CountOwnerVideosSince(future) = %d, want 0", n)
	}
	if n, _ := q.CountVideosInSublocation(ctx, &pendingSub); n != 1 {
		t.Errorf("CountVideosInSublocation(pending place) = %d, want 1", n)
	}
	queueSubs, _ := q.ListPendingSublocations(ctx)
	if len(queueSubs) != 1 || queueSubs[0].SublocationID != pendingSub || queueSubs[0].VideoCount != 1 {
		t.Errorf("ListPendingSublocations = %+v", queueSubs)
	}
	queueVids, _ := q.ListPendingVideos(ctx)
	if len(queueVids) != 1 || queueVids[0].VideoID != pending || queueVids[0].SublocationStatus != "approved" {
		t.Errorf("ListPendingVideos = %+v", queueVids)
	}

	// Approve flips the row and the public lists follow.
	if err := q.SetVideoStatus(ctx, db.SetVideoStatusParams{VideoID: pending, Status: "active"}); err != nil {
		t.Fatalf("SetVideoStatus: %v", err)
	}
	if err := q.SetSublocationStatus(ctx, db.SetSublocationStatusParams{SublocationID: pendingSub, Status: "approved"}); err != nil {
		t.Fatalf("SetSublocationStatus: %v", err)
	}
	if all, _ := q.ListVideos(ctx); len(all) != 4 {
		t.Errorf("after approvals ListVideos = %d rows, want 4 (active, paused, pending→active, hidden)", len(all))
	}

	// Rejecting a place cascades to its pending cameras only and returns their stream ids.
	cascadeSub, _ := q.CreateOwnerSublocation(ctx, db.CreateOwnerSublocationParams{Name: "Cascade Place", StateID: stateID, OwnerID: "owner-2"})
	cp := insertVideo("cascade-pending", "pending", cascadeSub, "owner-2")
	ca := insertVideo("cascade-active", "active", cascadeSub, "owner-2")
	rejected, err := q.RejectPendingVideosInSublocation(ctx, db.RejectPendingVideosInSublocationParams{SublocationID: &cascadeSub, ReviewNote: "no"})
	if err != nil || len(rejected) != 1 || rejected[0].VideoID != cp || rejected[0].StreamID != (pgtype.Text{String: "cascade-pending", Valid: true}) {
		t.Errorf("RejectPendingVideosInSublocation = %+v, %v", rejected, err)
	}
	if v, _ := q.GetVideoForOwner(ctx, ca); v.Status != "active" {
		t.Errorf("active camera touched by cascade: %+v", v)
	}
	if v, _ := q.GetVideoForOwner(ctx, cp); v.Status != "rejected" || v.ReviewNote != "no" {
		t.Errorf("cascaded camera = %+v", v)
	}
}

func videoIDs[T any](rows []T, id func(T) int32) []int32 {
	out := make([]int32, 0, len(rows))
	for _, r := range rows {
		out = append(out, id(r))
	}
	return out
}

func itoa(n int32) string {
	return strconv.Itoa(int(n))
}
