package handler

import (
	"context"
	"errors"
	"fmt"

	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ownerQueries is the slice of the sqlc query set that the owner (/me/*) and
// admin review handlers use. *db.Queries satisfies it as generated; the
// handler tests substitute an in-memory fake, which is what lets every
// status transition, ownership check and cascade run without Postgres.
type ownerQueries interface {
	CountAccountVideos(ctx context.Context, accountID *int32) (int32, error)
	CountAccountVideosSince(ctx context.Context, arg db.CountAccountVideosSinceParams) (int32, error)
	CountVideosInSublocation(ctx context.Context, sublocationID *int32) (int32, error)

	ListOwnerSublocations(ctx context.Context, userID string) ([]db.ListOwnerSublocationsRow, error)
	GetSublocationForOwner(ctx context.Context, sublocationID int32) (db.GetSublocationForOwnerRow, error)
	CreateOwnerSublocation(ctx context.Context, arg db.CreateOwnerSublocationParams) (int32, error)
	UpdateOwnerSublocation(ctx context.Context, arg db.UpdateOwnerSublocationParams) error
	DeleteSublocation(ctx context.Context, sublocationID int32) error
	SetSublocationStatus(ctx context.Context, arg db.SetSublocationStatusParams) error

	ListOwnerVideos(ctx context.Context, userID string) ([]db.ListOwnerVideosRow, error)
	GetVideoForOwner(ctx context.Context, videoID int32) (db.GetVideoForOwnerRow, error)
	CreateOwnerVideo(ctx context.Context, arg db.CreateOwnerVideoParams) (int32, error)
	UpdateOwnerVideo(ctx context.Context, arg db.UpdateOwnerVideoParams) error
	DeleteVideo(ctx context.Context, videoID int32) error
	SetVideoStatus(ctx context.Context, arg db.SetVideoStatusParams) error

	ListPendingSublocations(ctx context.Context) ([]db.ListPendingSublocationsRow, error)
	ListPendingVideos(ctx context.Context) ([]db.ListPendingVideosRow, error)
	RejectPendingVideosInSublocation(ctx context.Context, arg db.RejectPendingVideosInSublocationParams) ([]db.RejectPendingVideosInSublocationRow, error)

	// Accounts, members and invites (DAN-381).
	GetAccount(ctx context.Context, accountID int32) (db.Account, error)
	LockAccount(ctx context.Context, accountID int32) (int32, error)
	ListAccounts(ctx context.Context) ([]db.ListAccountsRow, error)
	CreateAccount(ctx context.Context, arg db.CreateAccountParams) (int32, error)
	GetPersonalAccountID(ctx context.Context, userID string) (int32, error)
	CreatePersonalAccount(ctx context.Context, userID string) (int32, error)
	ListMyAccounts(ctx context.Context, userID string) ([]db.ListMyAccountsRow, error)
	GetAccountMember(ctx context.Context, arg db.GetAccountMemberParams) (db.AccountMember, error)
	ListAccountMembers(ctx context.Context, accountID int32) ([]db.ListAccountMembersRow, error)
	CountAccountAdmins(ctx context.Context, accountID int32) (int32, error)
	AddAccountMember(ctx context.Context, arg db.AddAccountMemberParams) error
	UpdateAccountMember(ctx context.Context, arg db.UpdateAccountMemberParams) error
	DeleteAccountMember(ctx context.Context, arg db.DeleteAccountMemberParams) error
	ClearMemberVideos(ctx context.Context, arg db.ClearMemberVideosParams) error
	AddMemberVideos(ctx context.Context, arg db.AddMemberVideosParams) error
	CountAccountVideosIn(ctx context.Context, arg db.CountAccountVideosInParams) (int32, error)
	GetMemberVideoAccess(ctx context.Context, arg db.GetMemberVideoAccessParams) (db.GetMemberVideoAccessRow, error)
	CreateInvite(ctx context.Context, arg db.CreateInviteParams) (int32, error)
	GetInviteByHash(ctx context.Context, tokenHash string) (db.AccountInvite, error)
	MarkInviteAccepted(ctx context.Context, arg db.MarkInviteAcceptedParams) (int64, error)
	AssignVideoAccount(ctx context.Context, arg db.AssignVideoAccountParams) error
	AssignSublocationAccount(ctx context.Context, arg db.AssignSublocationAccountParams) error
	AssignSublocationVideosAccount(ctx context.Context, arg db.AssignSublocationVideosAccountParams) error
	DropStaleVideoPicks(ctx context.Context) error
}

// ownerStore is ownerQueries plus a transaction runner, for the writes that
// must land together (approving a camera approves its pending sublocation;
// rejecting a sublocation rejects its pending cameras).
type ownerStore interface {
	ownerQueries
	// Tx runs fn against one transaction and commits when it returns nil.
	Tx(ctx context.Context, fn func(q ownerQueries) error) error
}

// pgOwnerStore is the production ownerStore over a pgx pool.
type pgOwnerStore struct {
	*db.Queries
	pool *pgxpool.Pool
}

// newOwnerStore wraps pool as an ownerStore.
func newOwnerStore(pool *pgxpool.Pool) ownerStore {
	return &pgOwnerStore{Queries: db.New(pool), pool: pool}
}

func (s *pgOwnerStore) Tx(ctx context.Context, fn func(q ownerQueries) error) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after Commit
	if err := fn(s.Queries.WithTx(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// isNotFound reports a sqlc :one query that matched no row.
func isNotFound(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}

// isForeignKeyViolation reports an insert/update that referenced a row that
// does not exist (e.g. an unknown state_id) — a 400 for the caller, not a 500.
func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}
