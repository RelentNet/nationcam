-- name: ListVideos :many
SELECT v.video_id, v.title, v.src, v.type, v.slug, v.state_id, v.sublocation_id,
       v.status, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.status = 'active'
ORDER BY v.title;

-- name: ListVideosByState :many
SELECT v.video_id, v.title, v.src, v.type, v.slug, v.state_id, v.sublocation_id,
       v.status, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.state_id = $1 AND v.status = 'active'
ORDER BY v.title;

-- name: ListVideosBySublocation :many
SELECT v.video_id, v.title, v.src, v.type, v.slug, v.state_id, v.sublocation_id,
       v.status, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.sublocation_id = $1 AND v.status = 'active'
ORDER BY v.title;

-- name: GetVideoByID :one
SELECT v.video_id, v.title, v.src, v.type, v.slug, v.state_id, v.sublocation_id,
       v.status, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.video_id = $1;

-- GetVideoBySlug backs the public per-camera page at
-- /locations/{state_slug}/{sublocation_slug}/{slug}. Cameras with no sublocation
-- match on an empty sublocation_slug.
-- name: GetVideoBySlug :one
SELECT v.video_id, v.title, v.src, v.type, v.slug, v.state_id, v.sublocation_id,
       v.status, v.view_count, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name, s.slug AS state_slug,
       COALESCE(sub.name, '') AS sublocation_name,
       COALESCE(sub.slug, '') AS sublocation_slug
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.status = 'active'
  AND s.slug = sqlc.arg(state_slug)
  AND COALESCE(sub.slug, '') = sqlc.arg(sublocation_slug)
  AND v.slug = sqlc.arg(slug);

-- ListRelatedVideos returns other cameras to show alongside a camera page:
-- same sublocation first, then the rest of the state.
-- name: ListRelatedVideos :many
SELECT v.video_id, v.title, v.src, v.type, v.slug, v.state_id, v.sublocation_id,
       v.status, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name, s.slug AS state_slug,
       COALESCE(sub.name, '') AS sublocation_name,
       COALESCE(sub.slug, '') AS sublocation_slug
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.status = 'active'
  AND v.video_id <> $1
  AND (v.sublocation_id = $2 OR v.state_id = $3)
ORDER BY (v.sublocation_id IS NOT DISTINCT FROM $2) DESC, v.title
LIMIT 6;

-- name: ListVideoSources :many
SELECT DISTINCT src FROM videos;

-- name: IncrementVideoViews :exec
UPDATE videos SET view_count = view_count + $2 WHERE video_id = $1;

-- name: CreateVideo :one
INSERT INTO videos (title, src, type, state_id, sublocation_id, status, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING video_id, title, src, type, slug, state_id, sublocation_id, status, created_by, created_at, updated_at;

-- name: UpdateVideo :exec
UPDATE videos SET title = $2, src = $3, type = $4, state_id = $5, sublocation_id = $6, status = $7 WHERE video_id = $1;

-- name: DeleteVideo :exec
DELETE FROM videos WHERE video_id = $1;

-- ListVideosPaginated backs the admin dashboard, so it deliberately returns
-- inactive cameras too — filtering them out here made deactivated cameras
-- unreachable from the dashboard with no way to reactivate them.
-- name: ListVideosPaginated :many
SELECT v.video_id, v.title, v.src, v.type, v.slug, v.state_id, v.sublocation_id,
       v.status, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name,
       COUNT(*) OVER()::int AS total_count
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
ORDER BY v.title
LIMIT $1 OFFSET $2;
