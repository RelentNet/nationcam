-- Public visibility (DAN-39): a camera is public when its status is 'active'
-- or 'paused' (a paused camera renders a placeholder, DAN-40) AND its
-- sublocation, if any, is 'approved'. Every query below that feeds a public
-- endpoint — the lists (which also feed the sitemap and the search index),
-- the per-camera page, related cameras, the popular/newest sorts, and via
-- GetVideoBySlug the frames/snapshot/stream endpoints — applies the same
-- predicate, so pending, inactive and rejected rows never leak.

-- name: ListVideos :many
SELECT v.video_id, v.title, v.src, v.type, v.slug, v.state_id, v.sublocation_id,
       v.status, v.about, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.status IN ('active', 'paused')
  AND (v.sublocation_id IS NULL OR sub.status = 'approved')
ORDER BY v.title;

-- name: ListVideosByState :many
SELECT v.video_id, v.title, v.src, v.type, v.slug, v.state_id, v.sublocation_id,
       v.status, v.about, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.state_id = $1
  AND v.status IN ('active', 'paused')
  AND (v.sublocation_id IS NULL OR sub.status = 'approved')
ORDER BY v.title;

-- name: ListVideosBySublocation :many
SELECT v.video_id, v.title, v.src, v.type, v.slug, v.state_id, v.sublocation_id,
       v.status, v.about, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.sublocation_id = $1
  AND v.status IN ('active', 'paused')
  AND sub.status = 'approved'
ORDER BY v.title;

-- GetVideoByID backs the admin create/update responses, so it returns any
-- status and carries the ownership/review columns.
-- name: GetVideoByID :one
SELECT v.video_id, v.title, v.src, v.type, v.slug, v.state_id, v.sublocation_id,
       v.status, v.about, v.owner_id, v.stream_id, v.review_note,
       v.created_by, v.created_at, v.updated_at,
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
       v.status, v.view_count, v.about, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name, s.slug AS state_slug,
       COALESCE(sub.name, '') AS sublocation_name,
       COALESCE(sub.slug, '') AS sublocation_slug
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.status IN ('active', 'paused')
  AND (v.sublocation_id IS NULL OR sub.status = 'approved')
  AND s.slug = sqlc.arg(state_slug)
  AND COALESCE(sub.slug, '') = sqlc.arg(sublocation_slug)
  AND v.slug = sqlc.arg(slug);

-- ListRelatedVideos returns other cameras to show alongside a camera page:
-- same sublocation first, then the rest of the state.
-- name: ListRelatedVideos :many
SELECT v.video_id, v.title, v.src, v.type, v.slug, v.state_id, v.sublocation_id,
       v.status, v.about, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name, s.slug AS state_slug,
       COALESCE(sub.name, '') AS sublocation_name,
       COALESCE(sub.slug, '') AS sublocation_slug
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.status IN ('active', 'paused')
  AND (v.sublocation_id IS NULL OR sub.status = 'approved')
  AND v.video_id <> $1
  AND (v.sublocation_id = $2 OR v.state_id = $3)
ORDER BY (v.sublocation_id IS NOT DISTINCT FROM $2) DESC, v.title
LIMIT 6;

-- ListVideosByViews backs GET /videos?sort=views — the "Most watched" ranking,
-- ties broken by title so the order is stable.
-- name: ListVideosByViews :many
SELECT v.video_id, v.title, v.src, v.type, v.slug, v.state_id, v.sublocation_id,
       v.status, v.view_count, v.about, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.status IN ('active', 'paused')
  AND (v.sublocation_id IS NULL OR sub.status = 'approved')
ORDER BY v.view_count DESC, v.title;

-- ListVideosByCreated backs GET /videos?sort=newest — the "Newest" ranking,
-- ties broken by title so the order is stable.
-- name: ListVideosByCreated :many
SELECT v.video_id, v.title, v.src, v.type, v.slug, v.state_id, v.sublocation_id,
       v.status, v.view_count, v.about, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.status IN ('active', 'paused')
  AND (v.sublocation_id IS NULL OR sub.status = 'approved')
ORDER BY v.created_at DESC, v.title;

-- ListArchiveSources is the snapshot archive's source list: active cameras
-- only. Paused cameras are public (placeholder) but not capturing, and
-- pending/rejected ones must not be archived at all.
-- name: ListArchiveSources :many
SELECT v.video_id, v.src
FROM videos v
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.status = 'active'
  AND (v.sublocation_id IS NULL OR sub.status = 'approved')
ORDER BY v.video_id;

-- name: ListVideoSources :many
SELECT DISTINCT src FROM videos;

-- name: IncrementVideoViews :exec
UPDATE videos SET view_count = view_count + $2 WHERE video_id = $1;

-- name: CreateVideo :one
INSERT INTO videos (title, src, type, state_id, sublocation_id, status, about, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING video_id, title, src, type, slug, state_id, sublocation_id, status, about, created_by, created_at, updated_at;

-- name: UpdateVideo :exec
UPDATE videos SET title = $2, src = $3, type = $4, state_id = $5, sublocation_id = $6, status = $7, about = $8 WHERE video_id = $1;

-- name: DeleteVideo :exec
DELETE FROM videos WHERE video_id = $1;

-- ListVideosPaginated backs the admin dashboard, so it deliberately returns
-- every status — filtering here made deactivated cameras unreachable from the
-- dashboard with no way to reactivate them. Carries owner_id/stream_id/
-- review_note so the admin console can tell owner-submitted cameras apart.
-- name: ListVideosPaginated :many
SELECT v.video_id, v.title, v.src, v.type, v.slug, v.state_id, v.sublocation_id,
       v.status, v.about, v.owner_id, v.stream_id, v.review_note,
       v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name,
       COUNT(*) OVER()::int AS total_count
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
ORDER BY v.title
LIMIT $1 OFFSET $2;

-- GetPublicVideoSource backs the HLS proxy (DAN-241): the stored (raw) src of
-- a camera that is publicly visible — same predicate as GetVideoBySlug — so a
-- pending, inactive or rejected camera never streams. Returns no row otherwise.
-- name: GetPublicVideoSource :one
SELECT v.src
FROM videos v
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.video_id = $1
  AND v.status IN ('active', 'paused')
  AND (v.sublocation_id IS NULL OR sub.status = 'approved');
