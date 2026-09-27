-- Events queries.
--
-- Unlike ads/posts, sublocation_id is required (an event always belongs to
-- one place) and video_id is an optional, additional "watch here" pointer to
-- a specific camera within that sublocation — the handler checks the two
-- agree before writing. Every listing here joins the sublocation and its
-- parent state so the frontend can link straight to the camera/sublocation
-- page without a second round trip.

-- name: GetEvent :one
SELECT * FROM events WHERE event_id = $1;

-- ListUpcomingEvents backs GET /events?upcoming=1 (the sitewide /events page)
-- — every event across every sublocation, soonest first. An event counts as
-- "upcoming" until it ends (or, with no end time, until it starts), so an
-- event already in progress still shows.
-- name: ListUpcomingEvents :many
SELECT e.event_id, e.title, e.description_md, e.starts_at, e.ends_at, e.url,
       e.sublocation_id, e.video_id, e.created_by, e.created_at, e.updated_at,
       sub.name AS sublocation_name, sub.slug AS sublocation_slug,
       st.name AS state_name, st.slug AS state_slug,
       COALESCE(v.title, '') AS video_title, COALESCE(v.slug, '') AS video_slug
FROM events e
JOIN sublocations sub ON sub.sublocation_id = e.sublocation_id
JOIN states st ON st.state_id = sub.state_id
LEFT JOIN videos v ON v.video_id = e.video_id
WHERE COALESCE(e.ends_at, e.starts_at) >= now()
ORDER BY e.starts_at ASC
LIMIT 50;

-- ListUpcomingEventsBySublocation and ListUpcomingEventsByVideo back the
-- "Upcoming" block on a sublocation/camera page (limit 3) — same upcoming
-- filter and ordering as ListUpcomingEvents, scoped to one place/camera.

-- name: ListUpcomingEventsBySublocation :many
SELECT e.event_id, e.title, e.description_md, e.starts_at, e.ends_at, e.url,
       e.sublocation_id, e.video_id, e.created_by, e.created_at, e.updated_at,
       sub.name AS sublocation_name, sub.slug AS sublocation_slug,
       st.name AS state_name, st.slug AS state_slug,
       COALESCE(v.title, '') AS video_title, COALESCE(v.slug, '') AS video_slug
FROM events e
JOIN sublocations sub ON sub.sublocation_id = e.sublocation_id
JOIN states st ON st.state_id = sub.state_id
LEFT JOIN videos v ON v.video_id = e.video_id
WHERE e.sublocation_id = $1 AND COALESCE(e.ends_at, e.starts_at) >= now()
ORDER BY e.starts_at ASC
LIMIT $2;

-- name: ListUpcomingEventsByVideo :many
SELECT e.event_id, e.title, e.description_md, e.starts_at, e.ends_at, e.url,
       e.sublocation_id, e.video_id, e.created_by, e.created_at, e.updated_at,
       sub.name AS sublocation_name, sub.slug AS sublocation_slug,
       st.name AS state_name, st.slug AS state_slug,
       COALESCE(v.title, '') AS video_title, COALESCE(v.slug, '') AS video_slug
FROM events e
JOIN sublocations sub ON sub.sublocation_id = e.sublocation_id
JOIN states st ON st.state_id = sub.state_id
LEFT JOIN videos v ON v.video_id = e.video_id
WHERE e.video_id = $1 AND COALESCE(e.ends_at, e.starts_at) >= now()
ORDER BY e.starts_at ASC
LIMIT $2;

-- ListAllEvents backs the admin dashboard — every event regardless of
-- whether it's upcoming or past, newest starts_at first.
-- name: ListAllEvents :many
SELECT e.event_id, e.title, e.description_md, e.starts_at, e.ends_at, e.url,
       e.sublocation_id, e.video_id, e.created_by, e.created_at, e.updated_at,
       sub.name AS sublocation_name, sub.slug AS sublocation_slug,
       st.name AS state_name, st.slug AS state_slug,
       COALESCE(v.title, '') AS video_title, COALESCE(v.slug, '') AS video_slug
FROM events e
JOIN sublocations sub ON sub.sublocation_id = e.sublocation_id
JOIN states st ON st.state_id = sub.state_id
LEFT JOIN videos v ON v.video_id = e.video_id
ORDER BY e.starts_at DESC;

-- name: CreateEvent :one
INSERT INTO events (title, description_md, starts_at, ends_at, url, sublocation_id, video_id, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: UpdateEvent :one
UPDATE events SET title = $2, description_md = $3, starts_at = $4, ends_at = $5,
                  url = $6, sublocation_id = $7, video_id = $8
WHERE event_id = $1
RETURNING *;

-- name: DeleteEvent :exec
DELETE FROM events WHERE event_id = $1;
