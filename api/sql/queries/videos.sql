-- name: ListVideos :many
SELECT v.video_id, v.title, v.src, v.type, v.state_id, v.sublocation_id,
       v.status, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.status = 'active'
ORDER BY v.title;

-- name: ListVideosByState :many
SELECT v.video_id, v.title, v.src, v.type, v.state_id, v.sublocation_id,
       v.status, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.state_id = $1 AND v.status = 'active'
ORDER BY v.title;

-- name: ListVideosBySublocation :many
SELECT v.video_id, v.title, v.src, v.type, v.state_id, v.sublocation_id,
       v.status, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.sublocation_id = $1 AND v.status = 'active'
ORDER BY v.title;

-- name: ListVideoSources :many
SELECT DISTINCT src FROM videos;

-- name: GetVideoByID :one
SELECT v.video_id, v.title, v.src, v.type, v.state_id, v.sublocation_id,
       v.status, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.video_id = $1;

-- name: CreateVideo :one
INSERT INTO videos (title, src, type, state_id, sublocation_id, status, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING video_id, title, src, type, state_id, sublocation_id, status, created_by, created_at, updated_at;

-- name: UpdateVideo :exec
UPDATE videos SET title = $2, src = $3, type = $4, state_id = $5, sublocation_id = $6, status = $7 WHERE video_id = $1;

-- name: DeleteVideo :exec
DELETE FROM videos WHERE video_id = $1;

-- name: ListVideosPaginated :many
SELECT v.video_id, v.title, v.src, v.type, v.state_id, v.sublocation_id,
       v.status, v.created_by, v.created_at, v.updated_at,
       s.name AS state_name,
       COALESCE(sub.name, '') AS sublocation_name,
       COUNT(*) OVER()::int AS total_count
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.status = 'active'
ORDER BY v.title
LIMIT $1 OFFSET $2;
