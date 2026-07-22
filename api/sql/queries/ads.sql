-- ResolveAdCandidates implements most-specific-wins targeting for one camera.
-- It collects every ad eligible for that camera (right scope, enabled, inside its
-- active window), tags each with a scope rank, and returns only the rows at the
-- highest rank present: camera (3) → sublocation (2) → state (1) → global (0).
-- No eligible ad at any level returns no rows.
--
-- It returns the whole winning level rather than one winner so the caller can
-- cache the level and still roll a fresh weighted pick on every request.
-- name: ResolveAdCandidates :many
WITH cam AS (
  SELECT v.video_id, v.state_id, v.sublocation_id FROM videos v WHERE v.video_id = $1
), eligible AS (
  SELECT a.ad_id, a.name, a.video_url, a.click_url, a.weight, a.starts_at, a.ends_at,
         (CASE
            WHEN a.video_id IS NOT NULL THEN 3
            WHEN a.sublocation_id IS NOT NULL THEN 2
            WHEN a.state_id IS NOT NULL THEN 1
            ELSE 0
          END)::int AS scope
  FROM ads a
  JOIN cam ON a.video_id = cam.video_id
           OR a.sublocation_id = cam.sublocation_id
           OR a.state_id = cam.state_id
           OR num_nonnulls(a.state_id, a.sublocation_id, a.video_id) = 0
  WHERE a.enabled
    AND (a.starts_at IS NULL OR a.starts_at <= now())
    AND (a.ends_at IS NULL OR a.ends_at > now())
)
SELECT ad_id, name, video_url, click_url, weight, starts_at, ends_at, scope
FROM eligible
WHERE scope = (SELECT max(scope) FROM eligible)
ORDER BY ad_id;

-- RecordAdEvent appends one impression or click. One row per delivered ad, written
-- synchronously so the caller learns if it failed and can retry.
-- name: RecordAdEvent :exec
INSERT INTO ad_impressions (ad_id, video_id, kind) VALUES ($1, $2, $3);

-- name: GetAd :one
SELECT * FROM ads WHERE ad_id = $1;

-- ListAds backs the admin dashboard and doubles as the billing report — lifetime
-- impression and click counts come straight off ad_impressions.
-- name: ListAds :many
SELECT a.ad_id, a.name, a.video_url, a.click_url, a.weight, a.starts_at, a.ends_at,
       a.enabled, a.state_id, a.sublocation_id, a.video_id, a.created_by,
       a.created_at, a.updated_at,
       COALESCE(st.name, '') AS state_name,
       COALESCE(sub.name, '') AS sublocation_name,
       COALESCE(v.title, '') AS video_title,
       COUNT(i.impression_id) FILTER (WHERE i.kind = 'impression') AS impressions,
       COUNT(i.impression_id) FILTER (WHERE i.kind = 'click') AS clicks
FROM ads a
LEFT JOIN states st ON st.state_id = a.state_id
LEFT JOIN sublocations sub ON sub.sublocation_id = a.sublocation_id
LEFT JOIN videos v ON v.video_id = a.video_id
LEFT JOIN ad_impressions i ON i.ad_id = a.ad_id
GROUP BY a.ad_id, st.name, sub.name, v.title
ORDER BY a.ad_id;

-- name: CreateAd :one
INSERT INTO ads (name, video_url, click_url, weight, starts_at, ends_at, enabled,
                 state_id, sublocation_id, video_id, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: UpdateAd :one
UPDATE ads SET name = $2, video_url = $3, click_url = $4, weight = $5,
               starts_at = $6, ends_at = $7, enabled = $8,
               state_id = $9, sublocation_id = $10, video_id = $11
WHERE ad_id = $1
RETURNING *;

-- name: DeleteAd :exec
DELETE FROM ads WHERE ad_id = $1;
