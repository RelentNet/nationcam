package sql

import (
	"context"
	"os"
	"testing"

	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/jackc/pgx/v5"
)

// TestResolveAdCandidates applies the embedded schema to a scratch database and
// walks the most-specific-wins ladder: with a camera ad, a sublocation ad, a state
// ad and a global ad all eligible, only the camera ad may be returned; disable it
// and the sublocation ad takes over, and so on down to no ad at all. It also checks
// that a camera in a different state never sees another state's inventory, and that
// disabled and expired ads are invisible.
//
// Set TEST_DATABASE_URL to run it, e.g.
//
//	docker run -d --rm -p 55432:5432 -e POSTGRES_PASSWORD=test --name nc-test postgres:17-alpine
//	TEST_DATABASE_URL='postgres://postgres:test@localhost:55432/postgres' go test ./sql/...
//
// Everything runs in one transaction that is rolled back, so the database is left
// untouched.
func TestResolveAdCandidates(t *testing.T) {
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
	// Start from empty inventory — TEST_DATABASE_URL may point at a scratch database
	// that already has ads, and a stray global ad would change what is eligible.
	// Rolled back with everything else.
	exec(t, ctx, tx, `DELETE FROM ad_impressions`)
	exec(t, ctx, tx, `DELETE FROM ads`)
	q := db.New(tx)

	// Geography: one state, one sublocation in it, one camera in that sublocation,
	// plus a camera in a second state that no ad below targets.
	stateID := scalar[int32](t, ctx, tx, `INSERT INTO states (name) VALUES ('Testland') RETURNING state_id`)
	otherStateID := scalar[int32](t, ctx, tx, `INSERT INTO states (name) VALUES ('Otherland') RETURNING state_id`)
	subID := scalar[int32](t, ctx, tx,
		`INSERT INTO sublocations (name, state_id) VALUES ('Pier District', $1) RETURNING sublocation_id`, stateID)
	camID := scalar[int32](t, ctx, tx,
		`INSERT INTO videos (title, src, state_id, sublocation_id) VALUES ('Pier Cam', 'x', $1, $2) RETURNING video_id`,
		stateID, subID)
	otherCamID := scalar[int32](t, ctx, tx,
		`INSERT INTO videos (title, src, state_id) VALUES ('Far Cam', 'x', $1) RETURNING video_id`, otherStateID)

	newAd := func(name string, scope string, target *int32) int32 {
		t.Helper()
		col := map[string]string{"camera": "video_id", "sublocation": "sublocation_id", "state": "state_id", "global": ""}[scope]
		if col == "" {
			return scalar[int32](t, ctx, tx,
				`INSERT INTO ads (name, video_url) VALUES ($1, 'https://cdn/x.mp4') RETURNING ad_id`, name)
		}
		return scalar[int32](t, ctx, tx,
			`INSERT INTO ads (name, video_url, `+col+`) VALUES ($1, 'https://cdn/x.mp4', $2) RETURNING ad_id`,
			name, *target)
	}

	globalAd := newAd("house ad", "global", nil)
	stateAd := newAd("state ad", "state", &stateID)
	subAd := newAd("sublocation ad", "sublocation", &subID)
	camAd := newAd("camera ad", "camera", &camID)

	// The ladder: disable the winner, the next-broadest scope takes over.
	for _, step := range []struct {
		disable *int32
		want    []int32
		desc    string
	}{
		{nil, []int32{camAd}, "camera ad beats sublocation, state and global"},
		{&camAd, []int32{subAd}, "sublocation ad wins once the camera ad is disabled"},
		{&subAd, []int32{stateAd}, "state ad wins once the sublocation ad is disabled"},
		{&stateAd, []int32{globalAd}, "global ad is the last resort"},
		{&globalAd, nil, "no eligible ad returns nothing"},
	} {
		if step.disable != nil {
			exec(t, ctx, tx, `UPDATE ads SET enabled = false WHERE ad_id = $1`, *step.disable)
		}
		if got := adIDs(t, ctx, q, camID); !equal(got, step.want) {
			t.Errorf("%s: got ads %v, want %v", step.desc, got, step.want)
		}
	}

	// A camera elsewhere must never inherit another state's inventory.
	exec(t, ctx, tx, `UPDATE ads SET enabled = true`)
	if got := adIDs(t, ctx, q, otherCamID); !equal(got, []int32{globalAd}) {
		t.Errorf("camera in another state: got ads %v, want only the global ad %v", got, globalAd)
	}

	// Within the winning scope, every eligible ad is returned so the caller can
	// roll a weighted pick across all of them.
	subAd2 := newAd("second sublocation ad", "sublocation", &subID)
	exec(t, ctx, tx, `UPDATE ads SET enabled = false WHERE ad_id = $1`, camAd)
	if got := adIDs(t, ctx, q, camID); !equal(got, []int32{subAd, subAd2}) {
		t.Errorf("weighted rotation: got ads %v, want both sublocation ads %v", got, []int32{subAd, subAd2})
	}

	// Active windows. Both sublocation ads step out of their window, so the state
	// ad — a broader scope — must take over rather than the request going empty.
	exec(t, ctx, tx, `UPDATE ads SET ends_at = now() - interval '1 hour' WHERE ad_id = $1`, subAd)
	exec(t, ctx, tx, `UPDATE ads SET starts_at = now() + interval '1 hour' WHERE ad_id = $1`, subAd2)
	if got := adIDs(t, ctx, q, camID); !equal(got, []int32{stateAd}) {
		t.Errorf("expired and not-yet-started ads: got ads %v, want the state ad %v", got, stateAd)
	}

	// An ad may target at most one scope.
	if _, err := tx.Exec(ctx,
		`INSERT INTO ads (name, video_url, state_id, video_id) VALUES ('two scopes', 'https://cdn/x.mp4', $1, $2)`,
		stateID, camID); err == nil {
		t.Error("expected ads_single_scope to reject an ad targeting both a state and a camera")
	}
}

// TestAdImpressionsAreExact checks the billing guarantee at the storage layer:
// N recorded events are N rows, and they can be attributed to an ad-and-camera
// pair, which is what a monthly advertiser report asks for.
func TestAdImpressionsAreExact(t *testing.T) {
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
	// Start from empty inventory — TEST_DATABASE_URL may point at a scratch database
	// that already has ads, and a stray global ad would change what is eligible.
	// Rolled back with everything else.
	exec(t, ctx, tx, `DELETE FROM ad_impressions`)
	exec(t, ctx, tx, `DELETE FROM ads`)
	q := db.New(tx)

	stateID := scalar[int32](t, ctx, tx, `INSERT INTO states (name) VALUES ('Testland') RETURNING state_id`)
	camA := scalar[int32](t, ctx, tx,
		`INSERT INTO videos (title, src, state_id) VALUES ('Cam A', 'x', $1) RETURNING video_id`, stateID)
	camB := scalar[int32](t, ctx, tx,
		`INSERT INTO videos (title, src, state_id) VALUES ('Cam B', 'x', $1) RETURNING video_id`, stateID)
	adID := scalar[int32](t, ctx, tx,
		`INSERT INTO ads (name, video_url) VALUES ('house ad', 'https://cdn/x.mp4') RETURNING ad_id`)

	const onA, onB, clicks = 37, 5, 3
	for range onA {
		record(t, ctx, q, adID, camA, "impression")
	}
	for range onB {
		record(t, ctx, q, adID, camB, "impression")
	}
	for range clicks {
		record(t, ctx, q, adID, camA, "click")
	}

	// "How many times did this ad run on this camera last month?"
	got := scalar[int64](t, ctx, tx,
		`SELECT count(*) FROM ad_impressions
		 WHERE ad_id = $1 AND video_id = $2 AND kind = 'impression'
		   AND created_at >= now() - interval '1 month'`, adID, camA)
	if got != onA {
		t.Errorf("impressions on camera A: got %d, want %d", got, onA)
	}

	rows, err := q.ListAds(ctx)
	if err != nil {
		t.Fatalf("list ads: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("list ads: got %d rows, want 1", len(rows))
	}
	if rows[0].Impressions != onA+onB || rows[0].Clicks != clicks {
		t.Errorf("report: got %d impressions / %d clicks, want %d / %d",
			rows[0].Impressions, rows[0].Clicks, onA+onB, clicks)
	}

	// Billing history is not collateral damage of a delete.
	if err := q.DeleteAd(ctx, adID); err == nil {
		t.Error("expected deleting an ad with recorded impressions to be rejected")
	}
}

// ── helpers ────────────────────────────────────────────────

func scalar[T any](t *testing.T, ctx context.Context, tx pgx.Tx, sql string, args ...any) T {
	t.Helper()
	var v T
	if err := tx.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
		t.Fatalf("query %q: %v", sql, err)
	}
	return v
}

func exec(t *testing.T, ctx context.Context, tx pgx.Tx, sql string, args ...any) {
	t.Helper()
	if _, err := tx.Exec(ctx, sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func record(t *testing.T, ctx context.Context, q *db.Queries, adID, videoID int32, kind string) {
	t.Helper()
	if err := q.RecordAdEvent(ctx, db.RecordAdEventParams{AdID: adID, VideoID: &videoID, Kind: kind}); err != nil {
		t.Fatalf("record %s: %v", kind, err)
	}
}

func adIDs(t *testing.T, ctx context.Context, q *db.Queries, videoID int32) []int32 {
	t.Helper()
	rows, err := q.ResolveAdCandidates(ctx, videoID)
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	ids := make([]int32, len(rows))
	for i, r := range rows {
		ids[i] = r.AdID
	}
	return ids
}

func equal(a, b []int32) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
