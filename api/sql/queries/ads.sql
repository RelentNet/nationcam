-- ResolveAds implements most-specific-wins targeting plus the global override,
-- for one creative type at a time (pre-roll video or banner HTML).
--
-- The page scope is whatever context the caller has: a camera (video_id), a
-- sublocation, a state, or nothing (home page → house/global). It is resolved into
-- (ctx_video, ctx_sub, ctx_state): a camera fills in its own sublocation and state,
-- a sublocation fills in its state, a bare state stands alone. Each eligible ad is
-- tagged with a scope rank and only the rows at the highest rank present are
-- returned, so the caller can cache the level and still roll a fresh weighted pick.
--
-- Ranks: override (4) → camera (3) → sublocation (2) → state (1) → global (0).
-- An override is just the top rung — enabled and in-window, it is always a
-- candidate (regardless of its scope columns) and therefore always wins its type.
-- placement, when non-empty, restricts to that banner slot; it is '' for video.
-- name: ResolveAds :many
WITH ctx AS (
  SELECT
    v.video_id AS ctx_video,
    COALESCE(v.sublocation_id, sub.sublocation_id) AS ctx_sub,
    COALESCE(v.state_id, sub.state_id, sqlc.narg('state_id')::int) AS ctx_state
  FROM (SELECT 1) seed
  LEFT JOIN videos v ON v.video_id = sqlc.narg('video_id')::int
  LEFT JOIN sublocations sub
         ON sub.sublocation_id = COALESCE(v.sublocation_id, sqlc.narg('sublocation_id')::int)
), eligible AS (
  SELECT a.ad_id, a.name, a.type, a.video_url, a.html_code, a.placement, a.click_url,
         a.weight, a.starts_at, a.ends_at,
         (CASE
            WHEN a.is_override THEN 4
            WHEN a.video_id IS NOT NULL THEN 3
            WHEN a.sublocation_id IS NOT NULL THEN 2
            WHEN a.state_id IS NOT NULL THEN 1
            ELSE 0
          END)::int AS scope
  FROM ads a, ctx
  WHERE a.type = @ad_type
    AND a.enabled
    AND (a.starts_at IS NULL OR a.starts_at <= now())
    AND (a.ends_at IS NULL OR a.ends_at > now())
    AND (@placement::text = '' OR a.placement = @placement::text)
    AND (
      a.is_override
      OR a.video_id = ctx.ctx_video
      OR a.sublocation_id = ctx.ctx_sub
      OR a.state_id = ctx.ctx_state
      OR num_nonnulls(a.state_id, a.sublocation_id, a.video_id) = 0
    )
)
SELECT ad_id, name, type, video_url, html_code, placement, click_url,
       weight, starts_at, ends_at, scope
FROM eligible
WHERE scope = (SELECT max(scope) FROM eligible)
ORDER BY ad_id;

-- RecordAdEvent appends one impression or click. One row per delivered ad, written
-- synchronously so the caller learns if it failed and can retry. video_id is
-- nullable: a banner may be viewed off a camera page (home/locations) with no
-- specific camera to attribute to.
-- name: RecordAdEvent :exec
INSERT INTO ad_impressions (ad_id, video_id, kind) VALUES ($1, $2, $3);

-- name: GetAd :one
SELECT * FROM ads WHERE ad_id = $1;

-- ListAds backs the admin dashboard and doubles as the billing report — lifetime
-- impression and click counts come straight off ad_impressions.
-- name: ListAds :many
SELECT a.ad_id, a.name, a.type, a.video_url, a.html_code, a.placement, a.click_url,
       a.weight, a.starts_at, a.ends_at, a.enabled, a.is_override,
       a.state_id, a.sublocation_id, a.video_id, a.created_by,
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
INSERT INTO ads (name, type, video_url, html_code, placement, click_url, weight,
                 starts_at, ends_at, enabled, is_override,
                 state_id, sublocation_id, video_id, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
RETURNING *;

-- name: UpdateAd :one
UPDATE ads SET name = $2, type = $3, video_url = $4, html_code = $5, placement = $6,
               click_url = $7, weight = $8, starts_at = $9, ends_at = $10,
               enabled = $11, is_override = $12,
               state_id = $13, sublocation_id = $14, video_id = $15
WHERE ad_id = $1
RETURNING *;

-- name: DeleteAd :exec
DELETE FROM ads WHERE ad_id = $1;
