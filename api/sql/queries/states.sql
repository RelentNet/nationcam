-- name: ListStates :many
SELECT s.state_id, s.name, s.description, s.slug,
       s.hero_url, s.hero_kind, s.logo_url, s.sponsor_url, s.sponsor_link, s.about,
       s.created_at, s.updated_at,
       COUNT(v.video_id)::int AS video_count
FROM states s
LEFT JOIN videos v ON v.state_id = s.state_id AND v.status = 'active'
GROUP BY s.state_id
ORDER BY s.name;

-- name: GetStateBySlug :one
SELECT s.state_id, s.name, s.description, s.slug,
       s.hero_url, s.hero_kind, s.logo_url, s.sponsor_url, s.sponsor_link, s.about,
       s.created_at, s.updated_at,
       COUNT(v.video_id)::int AS video_count
FROM states s
LEFT JOIN videos v ON v.state_id = s.state_id AND v.status = 'active'
WHERE s.slug = $1
GROUP BY s.state_id;

-- name: GetStateByID :one
SELECT s.state_id, s.name, s.description, s.slug,
       s.hero_url, s.hero_kind, s.logo_url, s.sponsor_url, s.sponsor_link, s.about,
       s.created_at, s.updated_at,
       COUNT(v.video_id)::int AS video_count
FROM states s
LEFT JOIN videos v ON v.state_id = s.state_id AND v.status = 'active'
WHERE s.state_id = $1
GROUP BY s.state_id;

-- name: CreateState :one
INSERT INTO states (name, description, hero_url, hero_kind, logo_url, sponsor_url, sponsor_link, about)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING state_id, name, description, slug,
          hero_url, hero_kind, logo_url, sponsor_url, sponsor_link, about,
          created_at, updated_at;

-- name: UpdateState :exec
UPDATE states SET name = $2, description = $3,
       hero_url = $4, hero_kind = $5, logo_url = $6, sponsor_url = $7, sponsor_link = $8,
       about = $9
WHERE state_id = $1;

-- name: DeleteState :exec
DELETE FROM states WHERE slug = $1;

-- name: ListStatesPaginated :many
SELECT s.state_id, s.name, s.description, s.slug,
       s.hero_url, s.hero_kind, s.logo_url, s.sponsor_url, s.sponsor_link, s.about,
       s.created_at, s.updated_at,
       COUNT(v.video_id)::int AS video_count,
       COUNT(*) OVER()::int AS total_count
FROM states s
LEFT JOIN videos v ON v.state_id = s.state_id AND v.status = 'active'
GROUP BY s.state_id
ORDER BY s.name
LIMIT $1 OFFSET $2;
