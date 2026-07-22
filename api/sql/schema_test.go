package sql

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
)

// TestVideoSlugs applies the embedded schema to a scratch database and checks the
// camera slug trigger: slugs come from the title, are unique within
// (state_id, sublocation_id), and survive updates.
//
// Set TEST_DATABASE_URL to run it, e.g.
//
//	docker run -d --rm -p 55432:5432 -e POSTGRES_PASSWORD=test --name nc-test postgres:17-alpine
//	TEST_DATABASE_URL='postgres://postgres:test@localhost:55432/postgres' go test ./sql/...
//
// Everything runs in one transaction that is rolled back, so the database is left
// untouched.
func TestVideoSlugs(t *testing.T) {
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

	var stateID int32
	if err := tx.QueryRow(ctx,
		`INSERT INTO states (name) VALUES ('Test State') RETURNING state_id`).Scan(&stateID); err != nil {
		t.Fatalf("insert state: %v", err)
	}
	subA, subB := insertSublocation(t, ctx, tx, stateID, "Downtown"), insertSublocation(t, ctx, tx, stateID, "Harbor")

	insert := func(title string, subID *int32) string {
		t.Helper()
		var slug string
		if err := tx.QueryRow(ctx,
			`INSERT INTO videos (title, src, state_id, sublocation_id) VALUES ($1, 'x', $2, $3) RETURNING slug`,
			title, stateID, subID).Scan(&slug); err != nil {
			t.Fatalf("insert video %q: %v", title, err)
		}
		return slug
	}

	cases := []struct {
		name  string
		title string
		sub   *int32
		want  string
	}{
		{"slug from title", "Main St. Cam #1", &subA, "main-st-cam-1"},
		{"duplicate title in same sublocation gets a suffix", "Main St. Cam #1", &subA, "main-st-cam-1-2"},
		{"third duplicate keeps counting", "Main St. Cam #1", &subA, "main-st-cam-1-3"},
		{"same title in another sublocation keeps the clean slug", "Main St. Cam #1", &subB, "main-st-cam-1"},
		{"sublocation-less cameras are scoped to the state", "Main St. Cam #1", nil, "main-st-cam-1"},
		{"and dedup against each other despite the NULL", "Main St. Cam #1", nil, "main-st-cam-1-2"},
		{"title with no slug-able characters falls back", "!!!", &subA, "camera"},
	}
	for _, tc := range cases {
		if got := insert(tc.title, tc.sub); got != tc.want {
			t.Errorf("%s: got slug %q, want %q", tc.name, got, tc.want)
		}
	}

	// Renaming a camera must not move its URL.
	var slug string
	if err := tx.QueryRow(ctx,
		`UPDATE videos SET title = 'Renamed' WHERE slug = 'main-st-cam-1' AND sublocation_id = $1 RETURNING slug`,
		subA).Scan(&slug); err != nil {
		t.Fatalf("update video: %v", err)
	}
	if slug != "main-st-cam-1" {
		t.Errorf("slug changed on rename: got %q", slug)
	}

	// The unique index is the actual guarantee — the trigger only avoids hitting it.
	if _, err := tx.Exec(ctx,
		`INSERT INTO videos (title, src, slug, state_id, sublocation_id) VALUES ('Dupe', 'x', 'main-st-cam-1', $1, $2)`,
		stateID, subA); err == nil {
		t.Error("expected unique violation for an explicit duplicate slug, got none")
	}
}

func insertSublocation(t *testing.T, ctx context.Context, tx pgx.Tx, stateID int32, name string) int32 {
	t.Helper()
	var id int32
	if err := tx.QueryRow(ctx,
		`INSERT INTO sublocations (name, state_id) VALUES ($1, $2) RETURNING sublocation_id`,
		name, stateID).Scan(&id); err != nil {
		t.Fatalf("insert sublocation: %v", err)
	}
	return id
}
