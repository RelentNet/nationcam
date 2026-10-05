-- name: CreateSubmission :exec
INSERT INTO submissions (name, email, message, kind, company, phone, site_city, site_state, details)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);

-- name: ListSubmissions :many
SELECT submission_id, name, email, message, kind, handled, created_at,
       company, phone, site_city, site_state, details
FROM submissions
ORDER BY created_at DESC
LIMIT 200;

-- name: ListSubmissionsByKind :many
SELECT submission_id, name, email, message, kind, handled, created_at,
       company, phone, site_city, site_state, details
FROM submissions
WHERE kind = ANY(sqlc.arg(kinds)::text[])
ORDER BY created_at DESC
LIMIT 200;

-- name: SetSubmissionHandled :one
UPDATE submissions SET handled = $2
WHERE submission_id = $1
RETURNING submission_id, name, email, message, kind, handled, created_at,
          company, phone, site_city, site_state, details;
