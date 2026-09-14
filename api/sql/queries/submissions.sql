-- name: CreateSubmission :exec
INSERT INTO submissions (name, email, message, kind)
VALUES ($1, $2, $3, $4);

-- name: ListSubmissions :many
SELECT submission_id, name, email, message, kind, handled, created_at
FROM submissions
ORDER BY created_at DESC
LIMIT 200;

-- name: SetSubmissionHandled :one
UPDATE submissions SET handled = $2
WHERE submission_id = $1
RETURNING submission_id, name, email, message, kind, handled, created_at;
