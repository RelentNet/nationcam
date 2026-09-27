-- Admin review queue (DAN-39): GET /review and the approve/reject cascades.

-- name: ListPendingSublocations :many
SELECT sub.sublocation_id, sub.name, sub.description, sub.state_id, sub.slug,
       sub.status, sub.owner_id, sub.review_note,
       sub.lat, sub.lng, sub.host_name, sub.host_url, sub.host_since, sub.address,
       sub.created_at, sub.updated_at,
       s.name AS state_name, s.slug AS state_slug,
       COUNT(v.video_id)::int AS video_count
FROM sublocations sub
JOIN states s ON s.state_id = sub.state_id
LEFT JOIN videos v ON v.sublocation_id = sub.sublocation_id
WHERE sub.status = 'pending'
GROUP BY sub.sublocation_id, s.name, s.slug
ORDER BY sub.created_at;

-- name: ListPendingVideos :many
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
WHERE v.status = 'pending'
ORDER BY v.created_at;

-- RejectPendingVideosInSublocation is the cascade when a sublocation is
-- rejected: its still-pending cameras are rejected with the same note. The
-- stream ids come back so the handler can stop each Restreamer process.
-- name: RejectPendingVideosInSublocation :many
UPDATE videos SET status = 'rejected', review_note = $2
WHERE sublocation_id = $1 AND status = 'pending'
RETURNING video_id, stream_id;
