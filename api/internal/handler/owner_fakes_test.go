package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	mw "github.com/brandon-relentnet/nationcam/api/internal/middleware"
	"github.com/brandon-relentnet/nationcam/api/internal/restreamer"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

// ── In-memory ownerStore ─────────────────────────────────────────────

// fakeStore is an in-memory ownerStore: the same row types sqlc generates,
// the same not-found error pgx returns, and the same FK failure Postgres
// raises for an unknown state — so the handlers run unchanged.
type fakeStore struct {
	mu      sync.Mutex
	states  map[int32]string // state_id → name
	subs    map[int32]db.GetSublocationForOwnerRow
	vids    map[int32]db.GetVideoForOwnerRow
	nextSub int32
	nextVid int32
	// txDepth counts nested Tx calls so a test can assert a cascade ran in one.
	txCalls int
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		states: map[int32]string{1: "Louisiana", 2: "Texas"},
		subs:   map[int32]db.GetSublocationForOwnerRow{},
		vids:   map[int32]db.GetVideoForOwnerRow{},
	}
}

func fkViolation() error {
	return &pgconn.PgError{Code: "23503", Message: "foreign key violation"}
}

// addSub seeds a sublocation and returns its id.
func (f *fakeStore) addSub(owner, status string, stateID int32) int32 {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextSub++
	id := f.nextSub
	f.subs[id] = db.GetSublocationForOwnerRow{
		SublocationID: id, Name: fmt.Sprintf("Sub %d", id), Slug: fmt.Sprintf("sub-%d", id),
		StateID: stateID, StateName: f.states[stateID], StateSlug: strings.ToLower(f.states[stateID]),
		Status: status, OwnerID: owner, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	return id
}

// addVid seeds a camera and returns its id. streamID "" means externally hosted.
func (f *fakeStore) addVid(owner, status string, subID int32, streamID string) int32 {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextVid++
	id := f.nextVid
	sub := f.subs[subID]
	sid := subID
	v := db.GetVideoForOwnerRow{
		VideoID: id, Title: fmt.Sprintf("Cam %d", id), Slug: fmt.Sprintf("cam-%d", id),
		Src: "https://streamer.example/memfs/" + streamID + ".m3u8", Type: "application/x-mpegURL",
		StateID: sub.StateID, SublocationID: &sid, Status: status, OwnerID: owner,
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
		StateName: sub.StateName, StateSlug: sub.StateSlug,
		SublocationName: sub.Name, SublocationSlug: sub.Slug, SublocationStatus: sub.Status,
	}
	if streamID != "" {
		v.StreamID = pgtype.Text{String: streamID, Valid: true}
	}
	f.vids[id] = v
	return id
}

func (f *fakeStore) video(id int32) db.GetVideoForOwnerRow {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.vids[id]
}

func (f *fakeStore) sub(id int32) db.GetSublocationForOwnerRow {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.subs[id]
}

// refreshVideo recomputes a camera's denormalized sublocation columns.
func (f *fakeStore) refreshVideoLocked(v db.GetVideoForOwnerRow) db.GetVideoForOwnerRow {
	if v.SublocationID != nil {
		if sub, ok := f.subs[*v.SublocationID]; ok {
			v.SublocationName, v.SublocationSlug, v.SublocationStatus = sub.Name, sub.Slug, sub.Status
		}
	}
	return v
}

func (f *fakeStore) subVideoCountLocked(id int32) int32 {
	var n int32
	for _, v := range f.vids {
		if v.SublocationID != nil && *v.SublocationID == id {
			n++
		}
	}
	return n
}

func (f *fakeStore) Tx(ctx context.Context, fn func(q ownerQueries) error) error {
	f.mu.Lock()
	f.txCalls++
	f.mu.Unlock()
	return fn(f)
}

func (f *fakeStore) CountOwnerSublocations(_ context.Context, owner string) (int32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var n int32
	for _, s := range f.subs {
		if s.OwnerID == owner {
			n++
		}
	}
	return n, nil
}

func (f *fakeStore) CountOwnerVideos(_ context.Context, owner string) (int32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var n int32
	for _, v := range f.vids {
		if v.OwnerID == owner {
			n++
		}
	}
	return n, nil
}

func (f *fakeStore) CountOwnerVideosSince(_ context.Context, arg db.CountOwnerVideosSinceParams) (int32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var n int32
	for _, v := range f.vids {
		if v.OwnerID == arg.OwnerID && v.CreatedAt.After(arg.CreatedAt) {
			n++
		}
	}
	return n, nil
}

func (f *fakeStore) CountVideosInSublocation(_ context.Context, id *int32) (int32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if id == nil {
		return 0, nil
	}
	return f.subVideoCountLocked(*id), nil
}

func (f *fakeStore) ListOwnerSublocations(_ context.Context, owner string) ([]db.ListOwnerSublocationsRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []db.ListOwnerSublocationsRow{}
	for _, s := range f.subs {
		if s.OwnerID == owner {
			s.VideoCount = f.subVideoCountLocked(s.SublocationID)
			out = append(out, db.ListOwnerSublocationsRow(s))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].SublocationID < out[j].SublocationID })
	return out, nil
}

func (f *fakeStore) GetSublocationForOwner(_ context.Context, id int32) (db.GetSublocationForOwnerRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.subs[id]
	if !ok {
		return db.GetSublocationForOwnerRow{}, pgx.ErrNoRows
	}
	s.VideoCount = f.subVideoCountLocked(id)
	return s, nil
}

func (f *fakeStore) CreateOwnerSublocation(_ context.Context, arg db.CreateOwnerSublocationParams) (int32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	name, ok := f.states[arg.StateID]
	if !ok {
		return 0, fkViolation()
	}
	f.nextSub++
	id := f.nextSub
	f.subs[id] = db.GetSublocationForOwnerRow{
		SublocationID: id, Name: arg.Name, Description: arg.Description, Slug: strings.ToLower(strings.ReplaceAll(arg.Name, " ", "-")),
		StateID: arg.StateID, StateName: name, StateSlug: strings.ToLower(name),
		Status: statusPending, OwnerID: arg.OwnerID,
		Lat: arg.Lat, Lng: arg.Lng, HostName: arg.HostName, HostUrl: arg.HostUrl, HostSince: arg.HostSince, Address: arg.Address,
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	return id, nil
}

func (f *fakeStore) UpdateOwnerSublocation(_ context.Context, arg db.UpdateOwnerSublocationParams) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.subs[arg.SublocationID]
	if !ok {
		return nil
	}
	name, ok := f.states[arg.StateID]
	if !ok {
		return fkViolation()
	}
	s.Name, s.Description, s.StateID, s.StateName = arg.Name, arg.Description, arg.StateID, name
	s.Address, s.Lat, s.Lng, s.HostName, s.HostUrl, s.HostSince = arg.Address, arg.Lat, arg.Lng, arg.HostName, arg.HostUrl, arg.HostSince
	f.subs[arg.SublocationID] = s
	return nil
}

func (f *fakeStore) DeleteSublocation(_ context.Context, id int32) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.subs, id)
	return nil
}

func (f *fakeStore) SetSublocationStatus(_ context.Context, arg db.SetSublocationStatusParams) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.subs[arg.SublocationID]
	if !ok {
		return nil
	}
	s.Status, s.ReviewNote = arg.Status, arg.ReviewNote
	f.subs[arg.SublocationID] = s
	return nil
}

func (f *fakeStore) ListOwnerVideos(_ context.Context, owner string) ([]db.ListOwnerVideosRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []db.ListOwnerVideosRow{}
	for _, v := range f.vids {
		if v.OwnerID == owner {
			out = append(out, db.ListOwnerVideosRow(f.refreshVideoLocked(v)))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].VideoID < out[j].VideoID })
	return out, nil
}

func (f *fakeStore) GetVideoForOwner(_ context.Context, id int32) (db.GetVideoForOwnerRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	v, ok := f.vids[id]
	if !ok {
		return db.GetVideoForOwnerRow{}, pgx.ErrNoRows
	}
	return f.refreshVideoLocked(v), nil
}

func (f *fakeStore) CreateOwnerVideo(_ context.Context, arg db.CreateOwnerVideoParams) (int32, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextVid++
	id := f.nextVid
	f.vids[id] = f.refreshVideoLocked(db.GetVideoForOwnerRow{
		VideoID: id, Title: arg.Title, Slug: strings.ToLower(strings.ReplaceAll(arg.Title, " ", "-")),
		Src: arg.Src, Type: arg.Type, StateID: arg.StateID, SublocationID: arg.SublocationID,
		Status: statusPending, OwnerID: arg.OwnerID, StreamID: arg.StreamID, About: arg.About,
		CreatedAt: time.Now(), UpdatedAt: time.Now(), StateName: f.states[arg.StateID],
	})
	return id, nil
}

func (f *fakeStore) UpdateOwnerVideo(_ context.Context, arg db.UpdateOwnerVideoParams) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	v, ok := f.vids[arg.VideoID]
	if !ok {
		return nil
	}
	v.Title, v.About = arg.Title, arg.About
	f.vids[arg.VideoID] = v
	return nil
}

func (f *fakeStore) DeleteVideo(_ context.Context, id int32) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.vids, id)
	return nil
}

func (f *fakeStore) SetVideoStatus(_ context.Context, arg db.SetVideoStatusParams) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	v, ok := f.vids[arg.VideoID]
	if !ok {
		return nil
	}
	v.Status, v.ReviewNote = arg.Status, arg.ReviewNote
	f.vids[arg.VideoID] = v
	return nil
}

func (f *fakeStore) ListPendingSublocations(context.Context) ([]db.ListPendingSublocationsRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []db.ListPendingSublocationsRow{}
	for _, s := range f.subs {
		if s.Status == statusPending {
			s.VideoCount = f.subVideoCountLocked(s.SublocationID)
			out = append(out, db.ListPendingSublocationsRow(s))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].SublocationID < out[j].SublocationID })
	return out, nil
}

func (f *fakeStore) ListPendingVideos(context.Context) ([]db.ListPendingVideosRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []db.ListPendingVideosRow{}
	for _, v := range f.vids {
		if v.Status == statusPending {
			out = append(out, db.ListPendingVideosRow(f.refreshVideoLocked(v)))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].VideoID < out[j].VideoID })
	return out, nil
}

func (f *fakeStore) RejectPendingVideosInSublocation(_ context.Context, arg db.RejectPendingVideosInSublocationParams) ([]db.RejectPendingVideosInSublocationRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := []db.RejectPendingVideosInSublocationRow{}
	for id, v := range f.vids {
		if v.SublocationID != nil && arg.SublocationID != nil && *v.SublocationID == *arg.SublocationID && v.Status == statusPending {
			v.Status, v.ReviewNote = statusRejected, arg.ReviewNote
			f.vids[id] = v
			out = append(out, db.RejectPendingVideosInSublocationRow{VideoID: id, StreamID: v.StreamID})
		}
	}
	return out, nil
}

// ── Fake Restreamer ──────────────────────────────────────────────────

// fakeRestreamer is the slice of the Restreamer Core API the owner and
// review handlers touch: login, create process, set metadata, command,
// delete. It records what was asked of it.
type fakeRestreamer struct {
	srv       *httptest.Server
	mu        sync.Mutex
	processes map[string]restreamer.ProcessConfig
	commands  []string // "<process id> <command>"
	deleted   []string
	metadata  []string
}

func newFakeRestreamer(t *testing.T) *fakeRestreamer {
	t.Helper()
	fr := &fakeRestreamer{processes: map[string]restreamer.ProcessConfig{}}
	mux := http.NewServeMux()
	token := func() string {
		payload := base64.RawURLEncoding.EncodeToString([]byte(fmt.Sprintf(`{"exp":%d}`, time.Now().Add(time.Hour).Unix())))
		return "h." + payload + ".s"
	}
	mux.HandleFunc("POST /api/login", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"access_token": token(), "refresh_token": token()})
	})
	mux.HandleFunc("POST /api/v3/process", func(w http.ResponseWriter, r *http.Request) {
		var cfg restreamer.ProcessConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		fr.mu.Lock()
		fr.processes[cfg.ID] = cfg
		fr.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]string{"id": cfg.ID, "reference": cfg.Reference})
	})
	mux.HandleFunc("PUT /api/v3/process/{id}/metadata/{key}", func(w http.ResponseWriter, r *http.Request) {
		fr.mu.Lock()
		fr.metadata = append(fr.metadata, r.PathValue("id"))
		fr.mu.Unlock()
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("PUT /api/v3/process/{id}/command", func(w http.ResponseWriter, r *http.Request) {
		var cmd restreamer.CommandRequest
		_ = json.NewDecoder(r.Body).Decode(&cmd)
		fr.mu.Lock()
		defer fr.mu.Unlock()
		if _, ok := fr.processes[r.PathValue("id")]; !ok {
			http.Error(w, `{"message":"unknown process"}`, http.StatusNotFound)
			return
		}
		fr.commands = append(fr.commands, r.PathValue("id")+" "+cmd.Command)
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("DELETE /api/v3/process/{id}", func(w http.ResponseWriter, r *http.Request) {
		fr.mu.Lock()
		defer fr.mu.Unlock()
		id := r.PathValue("id")
		if _, ok := fr.processes[id]; !ok {
			http.Error(w, `{"message":"unknown process"}`, http.StatusNotFound)
			return
		}
		delete(fr.processes, id)
		fr.deleted = append(fr.deleted, id)
		w.WriteHeader(http.StatusOK)
	})
	fr.srv = httptest.NewServer(mux)
	t.Cleanup(fr.srv.Close)
	return fr
}

func (fr *fakeRestreamer) client() *restreamer.Client {
	return restreamer.NewClient(fr.srv.URL, "admin", "secret")
}

// add seeds a running process for a stream id.
func (fr *fakeRestreamer) add(streamID string) {
	fr.mu.Lock()
	defer fr.mu.Unlock()
	fr.processes[restreamer.IngestProcessID(streamID)] = restreamer.ProcessConfig{ID: restreamer.IngestProcessID(streamID), Reference: streamID}
}

func (fr *fakeRestreamer) has(streamID string) bool {
	fr.mu.Lock()
	defer fr.mu.Unlock()
	_, ok := fr.processes[restreamer.IngestProcessID(streamID)]
	return ok
}

func (fr *fakeRestreamer) commandLog() []string {
	fr.mu.Lock()
	defer fr.mu.Unlock()
	return append([]string(nil), fr.commands...)
}

// ingestConfigs returns every ingest process created through the API, so a
// test can assert on the FFmpeg config the owner path produced.
func (fr *fakeRestreamer) ingestConfigs() []restreamer.ProcessConfig {
	fr.mu.Lock()
	defer fr.mu.Unlock()
	var out []restreamer.ProcessConfig
	for _, cfg := range fr.processes {
		if len(cfg.Input) > 0 {
			out = append(out, cfg)
		}
	}
	return out
}

// ── Test harness ─────────────────────────────────────────────────────

type ownerHarness struct {
	t     *testing.T
	store *fakeStore
	rs    *fakeRestreamer
	h     http.Handler
	cache *cache.Cache
}

// newOwnerHarness mounts the /me and review routes on a fake store, the fake
// Restreamer and the fake Redis. withRestreamer=false leaves rc nil, as when
// RESTREAMER_URL is unset.
func newOwnerHarness(t *testing.T, withRestreamer bool) *ownerHarness {
	t.Helper()
	store := newFakeStore()
	c := newTestCache(t)
	r := chi.NewRouter()
	var rc *restreamer.Client
	var rs *fakeRestreamer
	if withRestreamer {
		rs = newFakeRestreamer(t)
		rc = rs.client()
	}
	mountOwnerRoutes(r, store, c, rc)
	return &ownerHarness{t: t, store: store, rs: rs, h: r, cache: c}
}

// as returns a request context for the given user (and scopes), as
// Authenticate would set it. user "" is anonymous.
func as(user, scopes string) context.Context {
	ctx := context.Background()
	if user != "" {
		ctx = context.WithValue(ctx, mw.UserIDKey, user)
	}
	if scopes != "" {
		ctx = mw.WithScopes(ctx, scopes)
	}
	return ctx
}

func (h *ownerHarness) do(ctx context.Context, method, path, body string) *httptest.ResponseRecorder {
	h.t.Helper()
	var rd *strings.Reader
	if body != "" {
		rd = strings.NewReader(body)
	} else {
		rd = strings.NewReader("")
	}
	req := httptest.NewRequest(method, path, rd).WithContext(ctx)
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	rec := httptest.NewRecorder()
	h.h.ServeHTTP(rec, req)
	return rec
}

// decode unmarshals a JSON body, failing the test on a bad body.
func decode[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	var v T
	if err := json.Unmarshal(rec.Body.Bytes(), &v); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return v
}

func wantStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, want, rec.Body.String())
	}
}
