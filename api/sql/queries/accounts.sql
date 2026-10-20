-- Accounts, members and invites (DAN-381). Nothing here is Redis-cached.

-- name: GetAccount :one
SELECT account_id, name, personal_owner_id, created_by, created_at, updated_at
FROM accounts WHERE account_id = $1;

-- LockAccount serialises membership changes on one account inside a
-- transaction, so two concurrent demotions cannot both pass the
-- last-admin check.
-- name: LockAccount :one
SELECT account_id FROM accounts WHERE account_id = $1 FOR UPDATE;

-- name: ListAccounts :many
SELECT a.account_id, a.name, a.personal_owner_id, a.created_by, a.created_at, a.updated_at,
       (SELECT COUNT(*) FROM account_members m WHERE m.account_id = a.account_id)::int AS member_count,
       (SELECT COUNT(*) FROM sublocations sub WHERE sub.account_id = a.account_id)::int AS sublocation_count,
       (SELECT COUNT(*) FROM videos v WHERE v.account_id = a.account_id)::int AS video_count
FROM accounts a
ORDER BY a.name, a.account_id;

-- name: CreateAccount :one
INSERT INTO accounts (name, created_by) VALUES ($1, $2)
RETURNING account_id;

-- name: GetPersonalAccountID :one
SELECT account_id FROM accounts WHERE personal_owner_id = sqlc.arg(user_id)::text;

-- CreatePersonalAccount matches no row (pgx.ErrNoRows) when a concurrent
-- request created it first; the caller then reads it with GetPersonalAccountID.
-- name: CreatePersonalAccount :one
INSERT INTO accounts (name, personal_owner_id, created_by)
VALUES ('Personal account', sqlc.arg(user_id)::text, sqlc.arg(user_id)::text)
ON CONFLICT (personal_owner_id) DO NOTHING
RETURNING account_id;

-- ListMyAccounts is every account the user is a member of, with their role.
-- name: ListMyAccounts :many
SELECT a.account_id, a.name, (a.personal_owner_id IS NOT NULL AND a.personal_owner_id = m.user_id)::bool AS personal,
       m.role, m.all_cameras,
       (SELECT COUNT(*) FROM sublocations sub WHERE sub.account_id = a.account_id)::int AS sublocation_count,
       (SELECT COUNT(*) FROM videos v WHERE v.account_id = a.account_id)::int AS video_count
FROM account_members m
JOIN accounts a ON a.account_id = m.account_id
WHERE m.user_id = $1
ORDER BY personal DESC, a.name, a.account_id;

-- name: GetAccountMember :one
SELECT account_id, user_id, role, all_cameras, created_at, updated_at
FROM account_members WHERE account_id = $1 AND user_id = $2;

-- name: ListAccountMembers :many
SELECT m.account_id, m.user_id, m.role, m.all_cameras, m.created_at, m.updated_at,
       COALESCE((SELECT array_agg(mv.video_id ORDER BY mv.video_id) FROM account_member_videos mv
                 WHERE mv.account_id = m.account_id AND mv.user_id = m.user_id), '{}')::int[] AS video_ids
FROM account_members m
WHERE m.account_id = $1
ORDER BY m.created_at, m.user_id;

-- name: CountAccountAdmins :one
SELECT COUNT(*)::int FROM account_members WHERE account_id = $1 AND role = 'admin';

-- name: AddAccountMember :exec
INSERT INTO account_members (account_id, user_id, role, all_cameras)
VALUES ($1, $2, $3, $4);

-- name: UpdateAccountMember :exec
UPDATE account_members SET role = $3, all_cameras = $4
WHERE account_id = $1 AND user_id = $2;

-- name: DeleteAccountMember :exec
DELETE FROM account_members WHERE account_id = $1 AND user_id = $2;

-- name: ClearMemberVideos :exec
DELETE FROM account_member_videos WHERE account_id = $1 AND user_id = $2;

-- AddMemberVideos picks cameras for a restricted viewer. Only cameras that
-- belong to the account are inserted, so a stale id on an old invite (a
-- camera deleted or moved since) is silently dropped.
-- name: AddMemberVideos :exec
INSERT INTO account_member_videos (account_id, user_id, video_id)
SELECT sqlc.arg(account_id)::int, sqlc.arg(user_id)::text, v.video_id
FROM videos v
WHERE v.account_id = sqlc.arg(account_id)::int AND v.video_id = ANY(sqlc.arg(video_ids)::int[])
ON CONFLICT DO NOTHING;

-- name: CountAccountVideosIn :one
SELECT COUNT(*)::int FROM videos
WHERE account_id = sqlc.arg(account_id)::int AND video_id = ANY(sqlc.arg(video_ids)::int[]);

-- GetMemberVideoAccess backs CanViewCamera: the user's membership in the
-- account that owns the camera, and whether the camera is one of their
-- picks. No row = not a member (or the camera has no account).
-- name: GetMemberVideoAccess :one
SELECT m.role, m.all_cameras,
       EXISTS (SELECT 1 FROM account_member_videos mv
               WHERE mv.account_id = m.account_id AND mv.user_id = m.user_id AND mv.video_id = v.video_id)::bool AS picked
FROM videos v
JOIN account_members m ON m.account_id = v.account_id
WHERE v.video_id = $1 AND m.user_id = $2;

-- name: CreateInvite :one
INSERT INTO account_invites (account_id, token_hash, role, all_cameras, video_ids, created_by, expires_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING invite_id;

-- name: GetInviteByHash :one
SELECT invite_id, account_id, token_hash, role, all_cameras, video_ids, created_by,
       expires_at, accepted_by, accepted_at, created_at
FROM account_invites WHERE token_hash = $1;

-- MarkInviteAccepted is the single-use guard: it only matches an invite that
-- has not been accepted yet, so of two concurrent accepts exactly one gets a
-- row count of 1.
-- name: MarkInviteAccepted :execrows
UPDATE account_invites SET accepted_by = sqlc.arg(accepted_by)::text, accepted_at = now()
WHERE invite_id = sqlc.arg(invite_id) AND accepted_at IS NULL;

-- name: AssignVideoAccount :exec
UPDATE videos SET account_id = $2 WHERE video_id = $1;

-- AssignSublocationAccount moves a location; the handler moves its cameras
-- with AssignSublocationVideosAccount in the same transaction.
-- name: AssignSublocationAccount :exec
UPDATE sublocations SET account_id = $2 WHERE sublocation_id = $1;

-- name: AssignSublocationVideosAccount :exec
UPDATE videos SET account_id = $2 WHERE sublocation_id = $1;

-- DropStaleVideoPicks removes picks that point at cameras no longer in the
-- picking member's account (after a camera moved to another account).
-- name: DropStaleVideoPicks :exec
DELETE FROM account_member_videos mv
USING videos v
WHERE v.video_id = mv.video_id AND v.account_id IS DISTINCT FROM mv.account_id;
