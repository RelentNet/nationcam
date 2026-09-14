-- name: ListSublocationsByState :many
SELECT sub.sublocation_id, sub.name, sub.description, sub.state_id, sub.slug,
       sub.hero_url, sub.hero_kind, sub.logo_url, sub.sponsor_url, sub.sponsor_link, sub.about,
       sub.lat, sub.lng, sub.host_name, sub.host_url, sub.host_since, sub.address,
       sub.created_at, sub.updated_at,
       s.name AS state_name,
       COALESCE((SELECT v2.src FROM videos v2
                 WHERE v2.sublocation_id = sub.sublocation_id AND v2.status = 'active'
                 ORDER BY v2.video_id LIMIT 1), '')::text AS first_src,
       COUNT(v.video_id)::int AS video_count
FROM sublocations sub
JOIN states s ON s.state_id = sub.state_id
LEFT JOIN videos v ON v.sublocation_id = sub.sublocation_id AND v.status = 'active'
WHERE sub.state_id = $1
GROUP BY sub.sublocation_id, s.name
ORDER BY sub.name;

-- name: GetSublocationBySlug :one
SELECT sub.sublocation_id, sub.name, sub.description, sub.state_id, sub.slug,
       sub.hero_url, sub.hero_kind, sub.logo_url, sub.sponsor_url, sub.sponsor_link, sub.about,
       sub.lat, sub.lng, sub.host_name, sub.host_url, sub.host_since, sub.address,
       sub.created_at, sub.updated_at,
       s.name AS state_name,
       COALESCE((SELECT v2.src FROM videos v2
                 WHERE v2.sublocation_id = sub.sublocation_id AND v2.status = 'active'
                 ORDER BY v2.video_id LIMIT 1), '')::text AS first_src,
       COUNT(v.video_id)::int AS video_count
FROM sublocations sub
JOIN states s ON s.state_id = sub.state_id
LEFT JOIN videos v ON v.sublocation_id = sub.sublocation_id AND v.status = 'active'
WHERE sub.slug = $1
GROUP BY sub.sublocation_id, s.name;

-- name: GetSublocationByID :one
SELECT sub.sublocation_id, sub.name, sub.description, sub.state_id, sub.slug,
       sub.hero_url, sub.hero_kind, sub.logo_url, sub.sponsor_url, sub.sponsor_link, sub.about,
       sub.lat, sub.lng, sub.host_name, sub.host_url, sub.host_since, sub.address,
       sub.created_at, sub.updated_at,
       s.name AS state_name,
       COALESCE((SELECT v2.src FROM videos v2
                 WHERE v2.sublocation_id = sub.sublocation_id AND v2.status = 'active'
                 ORDER BY v2.video_id LIMIT 1), '')::text AS first_src,
       COUNT(v.video_id)::int AS video_count
FROM sublocations sub
JOIN states s ON s.state_id = sub.state_id
LEFT JOIN videos v ON v.sublocation_id = sub.sublocation_id AND v.status = 'active'
WHERE sub.sublocation_id = $1
GROUP BY sub.sublocation_id, s.name;

-- name: CreateSublocation :one
INSERT INTO sublocations (name, description, state_id, hero_url, hero_kind, logo_url, sponsor_url, sponsor_link, about,
                          lat, lng, host_name, host_url, host_since, address)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
RETURNING sublocation_id, name, description, state_id, slug,
          hero_url, hero_kind, logo_url, sponsor_url, sponsor_link, about,
          lat, lng, host_name, host_url, host_since, address,
          created_at, updated_at;

-- name: UpdateSublocation :exec
UPDATE sublocations SET name = $2, description = $3, state_id = $4,
       hero_url = $5, hero_kind = $6, logo_url = $7, sponsor_url = $8, sponsor_link = $9,
       about = $10,
       lat = $11, lng = $12, host_name = $13, host_url = $14, host_since = $15, address = $16
WHERE sublocation_id = $1;

-- name: DeleteSublocation :exec
DELETE FROM sublocations WHERE sublocation_id = $1;

-- name: ListSublocationsPaginated :many
SELECT sub.sublocation_id, sub.name, sub.description, sub.state_id, sub.slug,
       sub.hero_url, sub.hero_kind, sub.logo_url, sub.sponsor_url, sub.sponsor_link, sub.about,
       sub.lat, sub.lng, sub.host_name, sub.host_url, sub.host_since, sub.address,
       sub.created_at, sub.updated_at,
       s.name AS state_name,
       COALESCE((SELECT v2.src FROM videos v2
                 WHERE v2.sublocation_id = sub.sublocation_id AND v2.status = 'active'
                 ORDER BY v2.video_id LIMIT 1), '')::text AS first_src,
       COUNT(v.video_id)::int AS video_count,
       COUNT(*) OVER()::int AS total_count
FROM sublocations sub
JOIN states s ON s.state_id = sub.state_id
LEFT JOIN videos v ON v.sublocation_id = sub.sublocation_id AND v.status = 'active'
GROUP BY sub.sublocation_id, s.name
ORDER BY sub.name
LIMIT $1 OFFSET $2;
