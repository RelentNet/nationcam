package sql

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/jackc/pgx/v5"
)

// TestPrivateVisibility applies the embedded schema to a scratch database and
// checks the DAN-205 contract at the SQL level: the visibility CHECKs, that a
// private camera and every camera in a private location are absent from every
// public query (lists, slug lookups, counts, first_src, the public HLS
// source, events and posts), that the playable-source and admin queries still
// see them, and that the snapshot archive keeps capturing them.
//
// Set TEST_DATABASE_URL to run it (see TestVideoSlugs). Everything runs in one
// transaction that is rolled back.
func TestPrivateVisibility(t *testing.T) {
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
	// Re-applying is a no-op (the schema runs on every boot).
	if _, err := tx.Exec(ctx, Schema); err != nil {
		t.Fatalf("re-apply schema: %v", err)
	}
	q := db.New(tx)

	var stateID int32
	if err := tx.QueryRow(ctx,
		`INSERT INTO states (name) VALUES ('Private State') RETURNING state_id`).Scan(&stateID); err != nil {
		t.Fatalf("insert state: %v", err)
	}
	openSub := insertSublocation(t, ctx, tx, stateID, "Open Place")
	closedSub := insertSublocation(t, ctx, tx, stateID, "Closed Place")

	insertVideo := func(title string, subID int32) int32 {
		t.Helper()
		var id int32
		if err := tx.QueryRow(ctx,
			`INSERT INTO videos (title, src, state_id, sublocation_id, status)
			 VALUES ($1, 'https://s.example/memfs/'||$1||'.m3u8', $2, $3, 'active') RETURNING video_id`,
			title, stateID, subID).Scan(&id); err != nil {
			t.Fatalf("insert video %q: %v", title, err)
		}
		return id
	}
	pub := insertVideo("pub", openSub)
	priv := insertVideo("priv", openSub)
	inClosed := insertVideo("inclosed", closedSub)

	// Existing rows default to public.
	var vis string
	if err := tx.QueryRow(ctx, `SELECT visibility FROM videos WHERE video_id = $1`, pub).Scan(&vis); err != nil || vis != "public" {
		t.Fatalf("default video visibility = %q, %v", vis, err)
	}

	if n, err := q.SetVideoVisibility(ctx, db.SetVideoVisibilityParams{VideoID: priv, Visibility: "private"}); err != nil || n != 1 {
		t.Fatalf("SetVideoVisibility = %d, %v", n, err)
	}
	if n, err := q.SetSublocationVisibility(ctx, db.SetSublocationVisibilityParams{SublocationID: closedSub, Visibility: "private"}); err != nil || n != 1 {
		t.Fatalf("SetSublocationVisibility = %d, %v", n, err)
	}
	if n, _ := q.SetVideoVisibility(ctx, db.SetVideoVisibilityParams{VideoID: -1, Visibility: "private"}); n != 0 {
		t.Errorf("SetVideoVisibility(missing) = %d rows, want 0", n)
	}

	// The CHECKs accept public/private and nothing else.
	for _, bad := range []string{
		`UPDATE videos SET visibility = 'secret' WHERE video_id = ` + itoa(pub),
		`UPDATE sublocations SET visibility = 'hidden' WHERE sublocation_id = ` + itoa(openSub),
	} {
		sp, _ := tx.Begin(ctx)
		if _, err := sp.Exec(ctx, bad); err == nil {
			t.Errorf("accepted: %s", bad)
		}
		_ = sp.Rollback(ctx)
	}

	// ── Public lists: only pub ──
	onlyPub := func(name string, ids []int32) {
		t.Helper()
		for _, id := range ids {
			if id == priv || id == inClosed {
				t.Errorf("%s leaked private video %d", name, id)
			}
		}
		found := false
		for _, id := range ids {
			found = found || id == pub
		}
		if !found {
			t.Errorf("%s lost the public video %d", name, pub)
		}
	}
	all, _ := q.ListVideos(ctx)
	onlyPub("ListVideos", videoIDs(all, func(r db.ListVideosRow) int32 { return r.VideoID }))
	byState, _ := q.ListVideosByState(ctx, stateID)
	onlyPub("ListVideosByState", videoIDs(byState, func(r db.ListVideosByStateRow) int32 { return r.VideoID }))
	bySub, _ := q.ListVideosBySublocation(ctx, &openSub)
	onlyPub("ListVideosBySublocation", videoIDs(bySub, func(r db.ListVideosBySublocationRow) int32 { return r.VideoID }))
	byViews, _ := q.ListVideosByViews(ctx)
	onlyPub("ListVideosByViews", videoIDs(byViews, func(r db.ListVideosByViewsRow) int32 { return r.VideoID }))
	byCreated, _ := q.ListVideosByCreated(ctx)
	onlyPub("ListVideosByCreated", videoIDs(byCreated, func(r db.ListVideosByCreatedRow) int32 { return r.VideoID }))
	related, _ := q.ListRelatedVideos(ctx, db.ListRelatedVideosParams{VideoID: -1, SublocationID: &openSub, StateID: stateID})
	onlyPub("ListRelatedVideos", videoIDs(related, func(r db.ListRelatedVideosRow) int32 { return r.VideoID }))
	if rows, _ := q.ListVideosBySublocation(ctx, &closedSub); len(rows) != 0 {
		t.Errorf("ListVideosBySublocation(private place) = %d rows, want 0", len(rows))
	}

	// ── Per-camera lookups ──
	slugOf := func(id int32) string {
		var s string
		_ = tx.QueryRow(ctx, `SELECT slug FROM videos WHERE video_id = $1`, id).Scan(&s)
		return s
	}
	for _, tc := range []struct {
		id      int32
		sub     string
		private bool
	}{
		{pub, "open-place", false},
		{priv, "open-place", true},
		{inClosed, "closed-place", true},
	} {
		_, err := q.GetVideoBySlug(ctx, db.GetVideoBySlugParams{StateSlug: "private-state", SublocationSlug: tc.sub, Slug: slugOf(tc.id)})
		if tc.private != errors.Is(err, pgx.ErrNoRows) {
			t.Errorf("GetVideoBySlug(%d) = %v, private %v", tc.id, err, tc.private)
		}
		_, err = q.GetPublicVideoSource(ctx, tc.id)
		if tc.private != errors.Is(err, pgx.ErrNoRows) {
			t.Errorf("GetPublicVideoSource(%d) = %v, private %v", tc.id, err, tc.private)
		}
		src, err := q.GetPlayableVideoSource(ctx, tc.id)
		if err != nil || src.Private != tc.private {
			t.Errorf("GetPlayableVideoSource(%d) = %+v, %v; want private %v", tc.id, src, err, tc.private)
		}
		p, err := q.IsVideoPrivate(ctx, tc.id)
		if err != nil || p != tc.private {
			t.Errorf("IsVideoPrivate(%d) = %v, %v; want %v", tc.id, p, err, tc.private)
		}
	}

	// ── The archive keeps capturing private cameras ──
	sources, _ := q.ListArchiveSources(ctx)
	captured := map[int32]bool{}
	for _, s := range sources {
		captured[s.VideoID] = true
	}
	for _, id := range []int32{pub, priv, inClosed} {
		if !captured[id] {
			t.Errorf("ListArchiveSources missing video %d", id)
		}
	}

	// ── Sublocations and states: the private place 404s; counts skip private ──
	subs, _ := q.ListSublocationsByState(ctx, stateID)
	if len(subs) != 1 || subs[0].SublocationID != openSub {
		t.Errorf("ListSublocationsByState = %+v, want only the open place", subs)
	} else if subs[0].VideoCount != 1 || subs[0].FirstSrc != "https://s.example/memfs/pub.m3u8" {
		t.Errorf("open place video_count = %d first_src = %q, want 1 and pub's src", subs[0].VideoCount, subs[0].FirstSrc)
	}
	if _, err := q.GetSublocationBySlug(ctx, "closed-place"); !errors.Is(err, pgx.ErrNoRows) {
		t.Errorf("GetSublocationBySlug(private) = %v, want ErrNoRows", err)
	}
	if st, err := q.GetStateBySlug(ctx, "private-state"); err != nil || st.VideoCount != 1 {
		t.Errorf("GetStateBySlug video_count = %d, %v; want 1", st.VideoCount, err)
	}
	states, _ := q.ListStates(ctx)
	for _, s := range states {
		if s.StateID == stateID && s.VideoCount != 1 {
			t.Errorf("ListStates video_count = %d, want 1", s.VideoCount)
		}
	}

	// ── Admin list sees everything, with visibility ──
	page, _ := q.ListVideosPaginated(ctx, db.ListVideosPaginatedParams{Limit: 1000, Offset: 0})
	seen := map[int32]db.ListVideosPaginatedRow{}
	for _, r := range page {
		seen[r.VideoID] = r
	}
	if seen[priv].Visibility != "private" || seen[inClosed].SublocationVisibility != "private" || seen[pub].Visibility != "public" {
		t.Errorf("ListVideosPaginated visibility: priv %+v, inClosed %+v", seen[priv], seen[inClosed])
	}

	// ── Events and posts never name or link a private camera/place ──
	soon := time.Now().Add(24 * time.Hour)
	var closedEvent, openEvent int32
	if err := tx.QueryRow(ctx, `INSERT INTO events (title, starts_at, sublocation_id) VALUES ('closed', $1, $2) RETURNING event_id`,
		soon, closedSub).Scan(&closedEvent); err != nil {
		t.Fatalf("insert event: %v", err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO events (title, starts_at, sublocation_id, video_id) VALUES ('open', $1, $2, $3) RETURNING event_id`,
		soon, openSub, priv).Scan(&openEvent); err != nil {
		t.Fatalf("insert event: %v", err)
	}
	events, _ := q.ListUpcomingEvents(ctx)
	for _, e := range events {
		if e.EventID == closedEvent {
			t.Error("ListUpcomingEvents leaked an event in a private place")
		}
		if e.EventID == openEvent && (e.VideoSlug != "" || e.VideoTitle != "") {
			t.Errorf("ListUpcomingEvents names a private camera: %+v", e)
		}
	}
	if rows, _ := q.ListUpcomingEventsBySublocation(ctx, db.ListUpcomingEventsBySublocationParams{SublocationID: closedSub, Limit: 3}); len(rows) != 0 {
		t.Errorf("ListUpcomingEventsBySublocation(private place) = %d rows, want 0", len(rows))
	}

	var postID int32
	if err := tx.QueryRow(ctx,
		`INSERT INTO posts (title, slug, video_id, status, published_at) VALUES ('Private note', 'private-note-dan205', $1, 'published', now()) RETURNING post_id`,
		priv).Scan(&postID); err != nil {
		t.Fatalf("insert post: %v", err)
	}
	posts, _ := q.ListPublishedPosts(ctx, db.ListPublishedPostsParams{Limit: 1000, Offset: 0})
	for _, p := range posts {
		if p.PostID == postID && (p.VideoSlug != "" || p.VideoTitle != "" || p.SublocationSlug != "") {
			t.Errorf("ListPublishedPosts names a private camera: %+v", p)
		}
	}
}
