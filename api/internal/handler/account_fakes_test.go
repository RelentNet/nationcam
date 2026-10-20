package handler

import (
	"context"
	"sort"

	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// The account half of the in-memory ownerStore (DAN-381): the same row
// types and not-found errors as the generated queries.

func (f *fakeStore) GetAccount(_ context.Context, id int32) (db.Account, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	a, ok := f.accounts[id]
	if !ok {
		return db.Account{}, pgx.ErrNoRows
	}
	return a, nil
}

func (f *fakeStore) LockAccount(_ context.Context, id int32) (int32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.accounts[id]; !ok {
		return 0, pgx.ErrNoRows
	}
	return id, nil
}

func (f *fakeStore) ListAccounts(context.Context) ([]db.ListAccountsRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []db.ListAccountsRow{}
	for _, a := range f.accounts {
		row := db.ListAccountsRow{
			AccountID: a.AccountID, Name: a.Name, PersonalOwnerID: a.PersonalOwnerID,
			CreatedBy: a.CreatedBy, CreatedAt: a.CreatedAt, UpdatedAt: a.UpdatedAt,
		}
		id := a.AccountID
		for k := range f.members {
			if k.account == id {
				row.MemberCount++
			}
		}
		for _, s := range f.subs {
			if sameAccount(s.AccountID, &id) {
				row.SublocationCount++
			}
		}
		for _, v := range f.vids {
			if sameAccount(v.AccountID, &id) {
				row.VideoCount++
			}
		}
		out = append(out, row)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].AccountID < out[j].AccountID })
	return out, nil
}

func (f *fakeStore) CreateAccount(_ context.Context, arg db.CreateAccountParams) (int32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextAcct++
	f.accounts[f.nextAcct] = db.Account{AccountID: f.nextAcct, Name: arg.Name, CreatedBy: arg.CreatedBy}
	return f.nextAcct, nil
}

func (f *fakeStore) GetPersonalAccountID(_ context.Context, user string) (int32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for id, a := range f.accounts {
		if a.PersonalOwnerID.Valid && a.PersonalOwnerID.String == user {
			return id, nil
		}
	}
	return 0, pgx.ErrNoRows
}

func (f *fakeStore) CreatePersonalAccount(_ context.Context, user string) (int32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, a := range f.accounts {
		if a.PersonalOwnerID.Valid && a.PersonalOwnerID.String == user {
			return 0, pgx.ErrNoRows // ON CONFLICT DO NOTHING
		}
	}
	f.nextAcct++
	f.accounts[f.nextAcct] = db.Account{AccountID: f.nextAcct, Name: "Personal account", PersonalOwnerID: pgtype.Text{String: user, Valid: true}, CreatedBy: user}
	return f.nextAcct, nil
}

func (f *fakeStore) ListMyAccounts(_ context.Context, user string) ([]db.ListMyAccountsRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []db.ListMyAccountsRow{}
	for k, m := range f.members {
		if k.user != user {
			continue
		}
		a := f.accounts[k.account]
		row := db.ListMyAccountsRow{
			AccountID: a.AccountID, Name: a.Name,
			Personal: a.PersonalOwnerID.Valid && a.PersonalOwnerID.String == user,
			Role:     m.Role, AllCameras: m.AllCameras,
		}
		id := a.AccountID
		for _, s := range f.subs {
			if sameAccount(s.AccountID, &id) {
				row.SublocationCount++
			}
		}
		for _, v := range f.vids {
			if sameAccount(v.AccountID, &id) {
				row.VideoCount++
			}
		}
		out = append(out, row)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Personal != out[j].Personal {
			return out[i].Personal
		}
		return out[i].AccountID < out[j].AccountID
	})
	return out, nil
}

func (f *fakeStore) GetAccountMember(_ context.Context, arg db.GetAccountMemberParams) (db.AccountMember, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	m, ok := f.members[memberKey{arg.AccountID, arg.UserID}]
	if !ok {
		return db.AccountMember{}, pgx.ErrNoRows
	}
	return m, nil
}

func (f *fakeStore) ListAccountMembers(_ context.Context, account int32) ([]db.ListAccountMembersRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []db.ListAccountMembersRow{}
	for k, m := range f.members {
		if k.account != account {
			continue
		}
		ids := []int32{}
		for v := range f.picks[k] {
			ids = append(ids, v)
		}
		sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
		out = append(out, db.ListAccountMembersRow{
			AccountID: m.AccountID, UserID: m.UserID, Role: m.Role, AllCameras: m.AllCameras,
			CreatedAt: m.CreatedAt, UpdatedAt: m.UpdatedAt, VideoIds: ids,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	return out, nil
}

func (f *fakeStore) CountAccountAdmins(_ context.Context, account int32) (int32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var n int32
	for k, m := range f.members {
		if k.account == account && m.Role == roleAdmin {
			n++
		}
	}
	return n, nil
}

func (f *fakeStore) AddAccountMember(_ context.Context, arg db.AddAccountMemberParams) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	k := memberKey{arg.AccountID, arg.UserID}
	if _, ok := f.members[k]; ok {
		return &pgconn.PgError{Code: "23505", Message: "duplicate key"}
	}
	f.members[k] = db.AccountMember{AccountID: arg.AccountID, UserID: arg.UserID, Role: arg.Role, AllCameras: arg.AllCameras, CreatedAt: f.tickLocked()}
	return nil
}

func (f *fakeStore) UpdateAccountMember(_ context.Context, arg db.UpdateAccountMemberParams) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	k := memberKey{arg.AccountID, arg.UserID}
	m, ok := f.members[k]
	if !ok {
		return nil
	}
	m.Role, m.AllCameras = arg.Role, arg.AllCameras
	f.members[k] = m
	return nil
}

func (f *fakeStore) DeleteAccountMember(_ context.Context, arg db.DeleteAccountMemberParams) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	k := memberKey{arg.AccountID, arg.UserID}
	delete(f.members, k)
	delete(f.picks, k)
	return nil
}

func (f *fakeStore) ClearMemberVideos(_ context.Context, arg db.ClearMemberVideosParams) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.picks, memberKey{arg.AccountID, arg.UserID})
	return nil
}

func (f *fakeStore) AddMemberVideos(_ context.Context, arg db.AddMemberVideosParams) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	k := memberKey{arg.AccountID, arg.UserID}
	for _, id := range arg.VideoIds {
		v, ok := f.vids[id]
		if !ok || !sameAccount(v.AccountID, &arg.AccountID) {
			continue // only the account's own cameras, as in SQL
		}
		if f.picks[k] == nil {
			f.picks[k] = map[int32]bool{}
		}
		f.picks[k][id] = true
	}
	return nil
}

func (f *fakeStore) CountAccountVideosIn(_ context.Context, arg db.CountAccountVideosInParams) (int32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var n int32
	for _, id := range arg.VideoIds {
		if v, ok := f.vids[id]; ok && sameAccount(v.AccountID, &arg.AccountID) {
			n++
		}
	}
	return n, nil
}

func (f *fakeStore) GetMemberVideoAccess(_ context.Context, arg db.GetMemberVideoAccessParams) (db.GetMemberVideoAccessRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	v, ok := f.vids[arg.VideoID]
	if !ok {
		return db.GetMemberVideoAccessRow{}, pgx.ErrNoRows
	}
	m, ok := f.memberLocked(v.AccountID, arg.UserID)
	if !ok {
		return db.GetMemberVideoAccessRow{}, pgx.ErrNoRows
	}
	return db.GetMemberVideoAccessRow{
		Role: m.Role, AllCameras: m.AllCameras,
		Picked: f.picks[memberKey{m.AccountID, arg.UserID}][arg.VideoID],
	}, nil
}

func (f *fakeStore) CreateInvite(_ context.Context, arg db.CreateInviteParams) (int32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextInvite++
	f.invites[f.nextInvite] = db.AccountInvite{
		InviteID: f.nextInvite, AccountID: arg.AccountID, TokenHash: arg.TokenHash, Role: arg.Role,
		AllCameras: arg.AllCameras, VideoIds: arg.VideoIds, CreatedBy: arg.CreatedBy, ExpiresAt: arg.ExpiresAt,
	}
	return f.nextInvite, nil
}

func (f *fakeStore) GetInviteByHash(_ context.Context, hash string) (db.AccountInvite, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, inv := range f.invites {
		if inv.TokenHash == hash {
			return inv, nil
		}
	}
	return db.AccountInvite{}, pgx.ErrNoRows
}

func (f *fakeStore) MarkInviteAccepted(_ context.Context, arg db.MarkInviteAcceptedParams) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	inv, ok := f.invites[arg.InviteID]
	if !ok || inv.AcceptedAt.Valid {
		return 0, nil
	}
	inv.AcceptedBy = pgtype.Text{String: arg.AcceptedBy, Valid: true}
	inv.AcceptedAt = pgtype.Timestamptz{Time: f.tickLocked(), Valid: true}
	f.invites[arg.InviteID] = inv
	return 1, nil
}

func (f *fakeStore) AssignVideoAccount(_ context.Context, arg db.AssignVideoAccountParams) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if v, ok := f.vids[arg.VideoID]; ok {
		v.AccountID = arg.AccountID
		f.vids[arg.VideoID] = v
	}
	return nil
}

func (f *fakeStore) AssignSublocationAccount(_ context.Context, arg db.AssignSublocationAccountParams) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if s, ok := f.subs[arg.SublocationID]; ok {
		s.AccountID = arg.AccountID
		f.subs[arg.SublocationID] = s
	}
	return nil
}

func (f *fakeStore) AssignSublocationVideosAccount(_ context.Context, arg db.AssignSublocationVideosAccountParams) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for id, v := range f.vids {
		if v.SublocationID != nil && arg.SublocationID != nil && *v.SublocationID == *arg.SublocationID {
			v.AccountID = arg.AccountID
			f.vids[id] = v
		}
	}
	return nil
}

func (f *fakeStore) DropStaleVideoPicks(context.Context) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for k, p := range f.picks {
		for id := range p {
			if v, ok := f.vids[id]; !ok || !sameAccount(v.AccountID, &k.account) {
				delete(p, id)
			}
		}
	}
	return nil
}
