-- Owner endpoints (DAN-39): everything under /me. Rows carry owner_id so the
-- handler can enforce ownership (403 on someone else's row); the two
-- Get*ForOwner queries take no owner filter on purpose so a foreign row is a
-- 403, not a 404. Nothing here is Redis-cached (responses are per user).

-- name: CountOwnerSublocations :one
SELECT COUNT(*)::int FROM sublocations WHERE owner_id = $1;

-- name: CountOwnerVideos :one
SELECT COUNT(*)::int FROM videos WHERE owner_id = $1;

-- CountOwnerVideosSince backs the per-day creation limit. It counts rows that
-- still exist, so a delete frees a slot; the limit is anti-abuse, not billing.
-- name: CountOwnerVideosSince :one
SELECT COUNT(*)::int FROM videos WHERE owner_id = $1 AND created_at > $2;

-- name: ListOwnerSublocations :many
SELECT sub.sublocation_id, sub.name, sub.description, sub.state_id, sub.slug,
       sub.status, sub.owner_id, sub.review_note,
       sub.lat, sub.lng, sub.host_name, sub.host_url, sub.host_since, sub.address,
       sub.created_at, sub.updated_at,
       s.name AS state_name, s.slug AS state_slug,
       COUNT(v.video_id)::int AS video_count
FROM sublocations sub
JOIN states s ON s.state_id = sub.state_id
LEFT JOIN videos v ON v.sublocation_id = sub.sublocation_id
WHERE sub.owner_id = $1
GROUP BY sub.sublocation_id, s.name, s.slug
ORDER BY sub.name;

-- name: GetSublocationForOwner :one
SELECT sub.sublocation_id, sub.name, sub.description, sub.state_id, sub.slug,
       sub.status, sub.owner_id, sub.review_note,
       sub.lat, sub.lng, sub.host_name, sub.host_url, sub.host_since, sub.address,
       sub.created_at, sub.updated_at,
       s.name AS state_name, s.slug AS state_slug,
       COUNT(v.video_id)::int AS video_count
FROM sublocations sub
JOIN states s ON s.state_id = sub.state_id
LEFT JOIN videos v ON v.sublocation_id = sub.sublocation_id
WHERE sub.sublocation_id = $1
GROUP BY sub.sublocation_id, s.name, s.slug;

-- name: CreateOwnerSublocation :one
INSERT INTO sublocations (name, description, state_id, address, lat, lng, host_name, host_url, host_since, owner_id, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
RETURNING sublocation_id;

-- UpdateOwnerSublocation leaves status alone: an owner edit never re-enters
-- or leaves review by itself.
-- name: UpdateOwnerSublocation :exec
UPDATE sublocations SET name = $2, description = $3, state_id = $4,
       address = $5, lat = $6, lng = $7, host_name = $8, host_url = $9, host_since = $10
WHERE sublocation_id = $1;

-- name: ListOwnerVideos :many
SELECT v.video_id, v.title, v.slug, v.src, v.type, v.state_id, v.sublocation_id,
       v.status, v.owner_id, v.stream_id, v.review_note, v.about,
       v.created_at, v.updated_at,
       s.name AS state_name, s.slug AS state_slug,
       COALESCE(sub.name, '') AS sublocation_name,
       COALESCE(sub.slug, '') AS sublocation_slug,
       COALESCE(sub.status, '') AS sublocation_status
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.owner_id = $1
ORDER BY v.title;

-- name: GetVideoForOwner :one
SELECT v.video_id, v.title, v.slug, v.src, v.type, v.state_id, v.sublocation_id,
       v.status, v.owner_id, v.stream_id, v.review_note, v.about,
       v.created_at, v.updated_at,
       s.name AS state_name, s.slug AS state_slug,
       COALESCE(sub.name, '') AS sublocation_name,
       COALESCE(sub.slug, '') AS sublocation_slug,
       COALESCE(sub.status, '') AS sublocation_status
FROM videos v
JOIN states s ON s.state_id = v.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = v.sublocation_id
WHERE v.video_id = $1;

-- name: CreateOwnerVideo :one
INSERT INTO videos (title, src, type, state_id, sublocation_id, about, owner_id, stream_id, created_by, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
RETURNING video_id;

-- name: UpdateOwnerVideo :exec
UPDATE videos SET title = $2, about = $3 WHERE video_id = $1;

-- SetVideoStatus is the one write every status transition goes through
-- (pause, resume, approve, reject). The handler decides whether the
-- transition is legal — see videoTransition in handler/status.go.
-- name: SetVideoStatus :exec
UPDATE videos SET status = $2, review_note = $3 WHERE video_id = $1;

-- name: SetSublocationStatus :exec
UPDATE sublocations SET status = $2, review_note = $3 WHERE sublocation_id = $1;

-- name: CountVideosInSublocation :one
SELECT COUNT(*)::int FROM videos WHERE sublocation_id = $1;
