-- Field notes (posts) queries.
--
-- Scope is whichever of state_id/sublocation_id/video_id is set on the row
-- (same pattern as ads); all three NULL is an unscoped post shown only at
-- /notes. Every public-facing query filters status = 'published' so a draft
-- is never reachable outside the admin listing.

-- name: GetPost :one
SELECT * FROM posts WHERE post_id = $1;

-- ListPublishedPosts backs GET /posts (no scope filter) — newest published
-- first, paginated. The handler requests limit+1 rows to detect a next page
-- without a separate count query. state_name/state_slug and
-- sublocation_name/sublocation_slug are resolved from whichever attachment is
-- actually set, so the list and article pages can link straight to the
-- camera/sublocation/state without a second round trip:
--   state scope       -> st   (the post's own state_id)
--   sublocation scope  -> sub for the sublocation itself, substate for its
--                         parent state (a post has no direct state_id here)
--   camera scope       -> v for the title/slug, vsub/vstate for the camera's
--                         own sublocation/state (a post has neither directly)
-- name: ListPublishedPosts :many
SELECT p.post_id, p.title, p.slug, p.body_md, p.excerpt, p.cover_url,
       p.state_id, p.sublocation_id, p.video_id, p.status, p.published_at,
       p.created_by, p.created_at, p.updated_at,
       COALESCE(st.name, substate.name, vstate.name, '') AS state_name,
       COALESCE(st.slug, substate.slug, vstate.slug, '') AS state_slug,
       COALESCE(sub.name, vsub.name, '') AS sublocation_name,
       COALESCE(sub.slug, vsub.slug, '') AS sublocation_slug,
       COALESCE(v.title, '') AS video_title,
       COALESCE(v.slug, '') AS video_slug
FROM posts p
LEFT JOIN states st ON st.state_id = p.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = p.sublocation_id
LEFT JOIN states substate ON substate.state_id = sub.state_id
LEFT JOIN videos v ON v.video_id = p.video_id
LEFT JOIN sublocations vsub ON vsub.sublocation_id = v.sublocation_id
LEFT JOIN states vstate ON vstate.state_id = v.state_id
WHERE p.status = 'published'
ORDER BY p.published_at DESC
LIMIT $1 OFFSET $2;

-- GetPublishedPostBySlug backs GET /posts/{slug} — same scope-name shape as
-- ListPublishedPosts, published only (else the handler returns 404).
-- name: GetPublishedPostBySlug :one
SELECT p.post_id, p.title, p.slug, p.body_md, p.excerpt, p.cover_url,
       p.state_id, p.sublocation_id, p.video_id, p.status, p.published_at,
       p.created_by, p.created_at, p.updated_at,
       COALESCE(st.name, substate.name, vstate.name, '') AS state_name,
       COALESCE(st.slug, substate.slug, vstate.slug, '') AS state_slug,
       COALESCE(sub.name, vsub.name, '') AS sublocation_name,
       COALESCE(sub.slug, vsub.slug, '') AS sublocation_slug,
       COALESCE(v.title, '') AS video_title,
       COALESCE(v.slug, '') AS video_slug
FROM posts p
LEFT JOIN states st ON st.state_id = p.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = p.sublocation_id
LEFT JOIN states substate ON substate.state_id = sub.state_id
LEFT JOIN videos v ON v.video_id = p.video_id
LEFT JOIN sublocations vsub ON vsub.sublocation_id = v.sublocation_id
LEFT JOIN states vstate ON vstate.state_id = v.state_id
WHERE p.slug = $1 AND p.status = 'published';

-- The three ByX queries back the related-notes block on a state/sublocation/
-- camera page (limit 3) — plain Post rows are enough there since the caller
-- already knows the scope it asked for.

-- name: ListPublishedPostsByState :many
SELECT * FROM posts
WHERE status = 'published' AND state_id = $1
ORDER BY published_at DESC
LIMIT $2;

-- name: ListPublishedPostsBySublocation :many
SELECT * FROM posts
WHERE status = 'published' AND sublocation_id = $1
ORDER BY published_at DESC
LIMIT $2;

-- name: ListPublishedPostsByVideo :many
SELECT * FROM posts
WHERE status = 'published' AND video_id = $1
ORDER BY published_at DESC
LIMIT $2;

-- ListAllPosts backs the admin dashboard — every post regardless of status,
-- newest first, with the scope names the list row displays.
-- name: ListAllPosts :many
SELECT p.post_id, p.title, p.slug, p.body_md, p.excerpt, p.cover_url,
       p.state_id, p.sublocation_id, p.video_id, p.status, p.published_at,
       p.created_by, p.created_at, p.updated_at,
       COALESCE(st.name, '') AS state_name,
       COALESCE(sub.name, '') AS sublocation_name,
       COALESCE(v.title, '') AS video_title
FROM posts p
LEFT JOIN states st ON st.state_id = p.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = p.sublocation_id
LEFT JOIN videos v ON v.video_id = p.video_id
ORDER BY p.created_at DESC;

-- name: CreatePost :one
INSERT INTO posts (title, body_md, excerpt, cover_url, state_id, sublocation_id,
                    video_id, status, published_at, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: UpdatePost :one
UPDATE posts SET title = $2, body_md = $3, excerpt = $4, cover_url = $5,
                 state_id = $6, sublocation_id = $7, video_id = $8,
                 status = $9, published_at = $10
WHERE post_id = $1
RETURNING *;

-- name: DeletePost :exec
DELETE FROM posts WHERE post_id = $1;
