-- Audio stations (DAN-47) — admin-managed radio stations merged with the
-- AzuraCast list at GET /audio/stations. Scope is optional and single-level:
-- NULL/NULL is sitewide, state_id or sublocation_id narrows it. There is no
-- per-camera scope.

-- name: ListAudioStations :many
-- Every station for the admin panel, with the scope's display name joined in.
SELECT a.audio_station_id, a.name, a.stream_url, a.enabled, a.sort_order,
       a.state_id, a.sublocation_id, a.created_at, a.updated_at,
       COALESCE(st.name, '') AS state_name,
       COALESCE(sub.name, '') AS sublocation_name
FROM audio_stations a
LEFT JOIN states st ON st.state_id = a.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = a.sublocation_id
ORDER BY a.sort_order, a.name;

-- ListPublicAudioStations resolves the camera's own state/sublocation (if any)
-- through the ctx CTE and returns every enabled station that is unscoped or
-- matches. When video_id is omitted (or unknown), ctx has no row, so only
-- unscoped stations match.
-- name: ListPublicAudioStations :many
WITH ctx AS (
  SELECT state_id AS ctx_state, sublocation_id AS ctx_sub
  FROM videos WHERE video_id = sqlc.narg('video_id')::int
)
SELECT a.audio_station_id, a.name, a.stream_url
FROM audio_stations a
LEFT JOIN ctx ON true
WHERE a.enabled
  AND (
    (a.state_id IS NULL AND a.sublocation_id IS NULL)
    OR a.state_id = ctx.ctx_state
    OR a.sublocation_id = ctx.ctx_sub
  )
ORDER BY a.sort_order, a.name;

-- name: CreateAudioStation :one
INSERT INTO audio_stations (name, stream_url, enabled, sort_order, state_id, sublocation_id)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: UpdateAudioStation :one
UPDATE audio_stations
SET name = $2, stream_url = $3, enabled = $4, sort_order = $5,
    state_id = $6, sublocation_id = $7
WHERE audio_station_id = $1
RETURNING *;

-- name: DeleteAudioStation :exec
DELETE FROM audio_stations WHERE audio_station_id = $1;
