package handler

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/db"
)

const (
	userA = "logto-user-a"
	userB = "logto-user-b"
)

func TestMeRequiresUser(t *testing.T) {
	h := newOwnerHarness(t, true)

	// Anonymous and subject-less tokens are 401 everywhere under /me.
	for _, ctx := range []context.Context{as("", ""), as("", "admin")} {
		for _, ep := range []struct{ method, path string }{
			{http.MethodGet, "/me"},
			{http.MethodGet, "/me/sublocations"},
			{http.MethodPost, "/me/videos"},
			{http.MethodDelete, "/me/videos/1"},
		} {
			wantStatus(t, h.do(ctx, ep.method, ep.path, ""), http.StatusUnauthorized)
		}
	}

	// Review is admin-only: a plain user is 403, no one is 403 too.
	for _, ctx := range []context.Context{as(userA, ""), as("", "")} {
		wantStatus(t, h.do(ctx, http.MethodGet, "/review", ""), http.StatusForbidden)
		wantStatus(t, h.do(ctx, http.MethodPost, "/videos/1/approve", ""), http.StatusForbidden)
		wantStatus(t, h.do(ctx, http.MethodPost, "/sublocations/1/reject", ""), http.StatusForbidden)
	}
}

func TestGetMe(t *testing.T) {
	h := newOwnerHarness(t, true)
	sub := h.store.addSub(userA, statusApproved, 1)
	h.store.addVid(userA, statusActive, sub, "s1")
	h.store.addVid(userA, statusPending, sub, "s2")
	h.store.addVid(userB, statusActive, h.store.addSub(userB, statusApproved, 1), "s3")

	rec := h.do(as(userA, ""), http.MethodGet, "/me", "")
	wantStatus(t, rec, http.StatusOK)
	me := decode[meResponse](t, rec)
	if me.UserID != userA || me.IsAdmin {
		t.Errorf("me = %+v, want user %s non-admin", me, userA)
	}
	if me.Limits.MaxCameras != ownerMaxCameras || me.Limits.PerDay != ownerCamerasPerDay {
		t.Errorf("limits = %+v", me.Limits)
	}
	if me.Counts.Sublocations != 1 || me.Counts.Videos != 2 {
		t.Errorf("counts = %+v, want 1 sublocation, 2 videos", me.Counts)
	}

	// An admin token works too and reports is_admin from the scope claim.
	rec = h.do(as("admin-user", "openid admin"), http.MethodGet, "/me", "")
	wantStatus(t, rec, http.StatusOK)
	if me := decode[meResponse](t, rec); !me.IsAdmin || me.Counts.Videos != 0 {
		t.Errorf("admin me = %+v", me)
	}
}

func TestOwnerSublocationLifecycle(t *testing.T) {
	h := newOwnerHarness(t, true)
	ctxA, ctxB := as(userA, ""), as(userB, "")

	// Create → pending, owned by the caller.
	rec := h.do(ctxA, http.MethodPost, "/me/sublocations",
		`{"name":"Venice Marina","description":"Docks","state_id":1,"address":"1 Marina Rd","lat":29.277,"lng":-89.354,"host_name":"Venice Marina","host_url":"https://venicemarina.example"}`)
	wantStatus(t, rec, http.StatusCreated)
	created := decode[db.GetSublocationForOwnerRow](t, rec)
	if created.Status != statusPending || created.OwnerID != userA || created.StateName != "Louisiana" {
		t.Fatalf("created = %+v", created)
	}
	id := strconv.Itoa(int(created.SublocationID))

	// Validation.
	wantStatus(t, h.do(ctxA, http.MethodPost, "/me/sublocations", `{"name":"","state_id":1}`), http.StatusBadRequest)
	wantStatus(t, h.do(ctxA, http.MethodPost, "/me/sublocations", `{"name":"X","state_id":999}`), http.StatusBadRequest)
	wantStatus(t, h.do(ctxA, http.MethodPost, "/me/sublocations", `{"name":"X","state_id":1,"lat":95,"lng":0}`), http.StatusBadRequest)
	wantStatus(t, h.do(ctxA, http.MethodPost, "/me/sublocations", `not json`), http.StatusBadRequest)

	// Listed for its owner only.
	rec = h.do(ctxA, http.MethodGet, "/me/sublocations", "")
	wantStatus(t, rec, http.StatusOK)
	if got := decode[[]db.ListOwnerSublocationsRow](t, rec); len(got) != 1 || got[0].Name != "Venice Marina" {
		t.Errorf("list = %+v", got)
	}
	rec = h.do(ctxB, http.MethodGet, "/me/sublocations", "")
	if got := decode[[]db.ListOwnerSublocationsRow](t, rec); len(got) != 0 {
		t.Errorf("B sees A's sublocations: %+v", got)
	}

	// Someone else's row: 403 on update and delete; unknown: 404; bad id: 400.
	wantStatus(t, h.do(ctxB, http.MethodPut, "/me/sublocations/"+id, `{"name":"Stolen","state_id":1}`), http.StatusForbidden)
	wantStatus(t, h.do(ctxB, http.MethodDelete, "/me/sublocations/"+id, ""), http.StatusForbidden)
	wantStatus(t, h.do(ctxA, http.MethodPut, "/me/sublocations/999", `{"name":"X","state_id":1}`), http.StatusNotFound)
	wantStatus(t, h.do(ctxA, http.MethodDelete, "/me/sublocations/abc", ""), http.StatusBadRequest)

	// Owner update: fields change, status does not.
	h.store.mu.Lock()
	s := h.store.subs[created.SublocationID]
	s.Status = statusApproved
	h.store.subs[created.SublocationID] = s
	h.store.mu.Unlock()
	rec = h.do(ctxA, http.MethodPut, "/me/sublocations/"+id, `{"name":"Venice Marina South","description":"","state_id":2}`)
	wantStatus(t, rec, http.StatusOK)
	updated := decode[db.GetSublocationForOwnerRow](t, rec)
	if updated.Name != "Venice Marina South" || updated.StateID != 2 || updated.Status != statusApproved {
		t.Errorf("updated = %+v", updated)
	}

	// Delete refuses while cameras exist, then succeeds once they are gone.
	vid := h.store.addVid(userA, statusPending, created.SublocationID, "")
	wantStatus(t, h.do(ctxA, http.MethodDelete, "/me/sublocations/"+id, ""), http.StatusConflict)
	_ = h.store.DeleteVideo(context.Background(), vid)
	wantStatus(t, h.do(ctxA, http.MethodDelete, "/me/sublocations/"+id, ""), http.StatusNoContent)
	if _, err := h.store.GetSublocationForOwner(context.Background(), created.SublocationID); err == nil {
		t.Error("sublocation still exists after delete")
	}
}

func TestOwnerCreateVideo(t *testing.T) {
	h := newOwnerHarness(t, true)
	ctxA := as(userA, "")
	subA := h.store.addSub(userA, statusPending, 1)
	subB := h.store.addSub(userB, statusApproved, 1)

	body := func(sub int32) string {
		return `{"title":"Dock Cam","rtsp_url":"rtsp://user:pw@10.0.0.5:554/stream1","sublocation_id":` + strconv.Itoa(int(sub)) + `,"about":"Looking east"}`
	}

	rec := h.do(ctxA, http.MethodPost, "/me/videos", body(subA))
	wantStatus(t, rec, http.StatusCreated)
	v := decode[db.GetVideoForOwnerRow](t, rec)
	if v.Status != statusPending || v.OwnerID != userA || v.Type != "application/x-mpegURL" || v.StateID != 1 || v.About != "Looking east" {
		t.Fatalf("created = %+v", v)
	}
	if !v.StreamID.Valid || v.StreamID.String == "" {
		t.Fatalf("no stream id stored: %+v", v)
	}
	if want := h.rs.srv.URL + "/memfs/" + v.StreamID.String + ".m3u8"; v.Src != want {
		t.Errorf("src = %q, want %q (the Restreamer client's HLS URL)", v.Src, want)
	}
	if !h.rs.has(v.StreamID.String) {
		t.Error("no ingest process created on Restreamer")
	}
	// Same process config as POST /streams: passthrough codec + reconnect.
	cfgs := h.rs.ingestConfigs()
	if len(cfgs) != 1 {
		t.Fatalf("ingest processes = %d, want 1", len(cfgs))
	}
	cfg := cfgs[0]
	opts := strings.Join(cfg.Output[0].Options, " ")
	if !cfg.Reconnect || cfg.ReconnectDelaySeconds != 15 || !cfg.Autostart {
		t.Errorf("process config not the CreateStream shape: %+v", cfg)
	}
	if !strings.Contains(opts, "-codec:v copy") || !strings.Contains(opts, "-codec:a copy") {
		t.Errorf("output options not passthrough: %s", opts)
	}
	if cfg.Input[0].Address != "rtsp://user:pw@10.0.0.5:554/stream1" {
		t.Errorf("input address = %q", cfg.Input[0].Address)
	}

	// Ownership of the sublocation is required; unknown is 404.
	wantStatus(t, h.do(ctxA, http.MethodPost, "/me/videos", body(subB)), http.StatusForbidden)
	wantStatus(t, h.do(ctxA, http.MethodPost, "/me/videos", body(999)), http.StatusNotFound)

	// RTSP validation runs before anything is created.
	before := len(h.rs.ingestConfigs())
	for _, bad := range []string{
		`{"title":"X","rtsp_url":"http://example.com/x.m3u8","sublocation_id":` + strconv.Itoa(int(subA)) + `}`,
		`{"title":"X","rtsp_url":"rtsp://h/x;rm -rf /","sublocation_id":` + strconv.Itoa(int(subA)) + `}`,
		`{"title":"","rtsp_url":"rtsp://h/x","sublocation_id":` + strconv.Itoa(int(subA)) + `}`,
		`{"title":"X","rtsp_url":"rtsp://h/x"}`,
	} {
		wantStatus(t, h.do(ctxA, http.MethodPost, "/me/videos", bad), http.StatusBadRequest)
	}
	if got := len(h.rs.ingestConfigs()); got != before {
		t.Errorf("rejected requests created processes: %d → %d", before, got)
	}

	// A rejected sublocation cannot take new cameras.
	subR := h.store.addSub(userA, statusRejected, 1)
	wantStatus(t, h.do(ctxA, http.MethodPost, "/me/videos", body(subR)), http.StatusConflict)

	// Listed for its owner, with the sublocation's status alongside.
	rec = h.do(ctxA, http.MethodGet, "/me/videos", "")
	wantStatus(t, rec, http.StatusOK)
	if got := decode[[]db.ListOwnerVideosRow](t, rec); len(got) != 1 || got[0].SublocationStatus != statusPending {
		t.Errorf("list = %+v", got)
	}
}

func TestOwnerCreateVideoWithoutRestreamer(t *testing.T) {
	h := newOwnerHarness(t, false)
	sub := h.store.addSub(userA, statusPending, 1)
	rec := h.do(as(userA, ""), http.MethodPost, "/me/videos",
		`{"title":"X","rtsp_url":"rtsp://h/x","sublocation_id":`+strconv.Itoa(int(sub))+`}`)
	wantStatus(t, rec, http.StatusServiceUnavailable)
}

func TestOwnerVideoLimits(t *testing.T) {
	h := newOwnerHarness(t, true)
	ctxA := as(userA, "")
	sub := h.store.addSub(userA, statusApproved, 1)
	body := `{"title":"Cam","rtsp_url":"rtsp://h/x","sublocation_id":` + strconv.Itoa(int(sub)) + `}`

	// Per-day: 5 created in the last 24h → the 6th is 429 with a clear message.
	for i := 0; i < ownerCamerasPerDay; i++ {
		wantStatus(t, h.do(ctxA, http.MethodPost, "/me/videos", body), http.StatusCreated)
	}
	rec := h.do(ctxA, http.MethodPost, "/me/videos", body)
	wantStatus(t, rec, http.StatusTooManyRequests)
	if msg := decode[map[string]string](t, rec)["error"]; !strings.Contains(msg, "daily limit") {
		t.Errorf("per-day message = %q", msg)
	}
	if got := len(h.rs.ingestConfigs()); got != ownerCamerasPerDay {
		t.Errorf("processes = %d, want %d (none for the refused request)", got, ownerCamerasPerDay)
	}

	// Age the rows out of the window: per-day no longer applies, but the
	// total cap does once the owner holds ownerMaxCameras.
	h.store.mu.Lock()
	for id, v := range h.store.vids {
		v.CreatedAt = time.Now().Add(-48 * time.Hour)
		h.store.vids[id] = v
	}
	h.store.mu.Unlock()
	for len(h.store.vids) < ownerMaxCameras {
		h.store.addVid(userA, statusActive, sub, "seed-"+strconv.Itoa(len(h.store.vids)))
	}
	rec = h.do(ctxA, http.MethodPost, "/me/videos", body)
	wantStatus(t, rec, http.StatusTooManyRequests)
	if msg := decode[map[string]string](t, rec)["error"]; !strings.Contains(msg, "camera limit") {
		t.Errorf("max message = %q", msg)
	}

	// Another owner's cameras never count against this one.
	wantStatus(t, h.do(as(userB, ""), http.MethodPost, "/me/videos",
		`{"title":"Cam","rtsp_url":"rtsp://h/x","sublocation_id":`+strconv.Itoa(int(h.store.addSub(userB, statusApproved, 1)))+`}`),
		http.StatusCreated)
}

func TestOwnerVideoUpdate(t *testing.T) {
	h := newOwnerHarness(t, true)
	sub := h.store.addSub(userA, statusApproved, 1)
	vid := h.store.addVid(userA, statusActive, sub, "s1")
	id := strconv.Itoa(int(vid))

	rec := h.do(as(userA, ""), http.MethodPut, "/me/videos/"+id, `{"title":"  New title ","about":"Facing the pass"}`)
	wantStatus(t, rec, http.StatusOK)
	v := decode[db.GetVideoForOwnerRow](t, rec)
	if v.Title != "New title" || v.About != "Facing the pass" || v.Status != statusActive || v.Src == "" {
		t.Errorf("updated = %+v", v)
	}
	wantStatus(t, h.do(as(userB, ""), http.MethodPut, "/me/videos/"+id, `{"title":"X"}`), http.StatusForbidden)
	wantStatus(t, h.do(as(userA, ""), http.MethodPut, "/me/videos/"+id, `{"title":""}`), http.StatusBadRequest)
	wantStatus(t, h.do(as(userA, ""), http.MethodPut, "/me/videos/999", `{"title":"X"}`), http.StatusNotFound)
}

func TestOwnerPauseResume(t *testing.T) {
	h := newOwnerHarness(t, true)
	ctxA := as(userA, "")
	sub := h.store.addSub(userA, statusApproved, 1)
	vid := h.store.addVid(userA, statusActive, sub, "s1")
	h.rs.add("s1")
	id := strconv.Itoa(int(vid))

	// active → paused sends "stop".
	rec := h.do(ctxA, http.MethodPost, "/me/videos/"+id+"/pause", "")
	wantStatus(t, rec, http.StatusOK)
	if v := decode[db.GetVideoForOwnerRow](t, rec); v.Status != statusPaused {
		t.Errorf("after pause = %+v", v)
	}
	if got := h.rs.commandLog(); len(got) != 1 || got[0] != "restreamer-ui:ingest:s1 stop" {
		t.Errorf("commands = %v, want one stop", got)
	}

	// paused → paused and paused → (approve) are invalid: 409, no command.
	wantStatus(t, h.do(ctxA, http.MethodPost, "/me/videos/"+id+"/pause", ""), http.StatusConflict)

	// paused → active sends "start".
	rec = h.do(ctxA, http.MethodPost, "/me/videos/"+id+"/resume", "")
	wantStatus(t, rec, http.StatusOK)
	if v := decode[db.GetVideoForOwnerRow](t, rec); v.Status != statusActive {
		t.Errorf("after resume = %+v", v)
	}
	if got := h.rs.commandLog(); len(got) != 2 || got[1] != "restreamer-ui:ingest:s1 start" {
		t.Errorf("commands = %v, want stop then start", got)
	}
	wantStatus(t, h.do(ctxA, http.MethodPost, "/me/videos/"+id+"/resume", ""), http.StatusConflict)

	// Every other status refuses both actions.
	for _, st := range []string{statusPending, statusRejected, statusInactive} {
		v := h.store.addVid(userA, st, sub, "")
		p := strconv.Itoa(int(v))
		wantStatus(t, h.do(ctxA, http.MethodPost, "/me/videos/"+p+"/pause", ""), http.StatusConflict)
		wantStatus(t, h.do(ctxA, http.MethodPost, "/me/videos/"+p+"/resume", ""), http.StatusConflict)
	}

	// Not the owner: 403, and no command reaches Restreamer.
	wantStatus(t, h.do(as(userB, ""), http.MethodPost, "/me/videos/"+id+"/pause", ""), http.StatusForbidden)
	if got := h.rs.commandLog(); len(got) != 2 {
		t.Errorf("commands after 403 = %v", got)
	}

	// A process Restreamer no longer has: the command fails and the row does
	// not change, so the row never claims a state the stream is not in.
	gone := h.store.addVid(userA, statusActive, sub, "vanished")
	rec = h.do(ctxA, http.MethodPost, "/me/videos/"+strconv.Itoa(int(gone))+"/pause", "")
	wantStatus(t, rec, http.StatusNotFound)
	if h.store.video(gone).Status != statusActive {
		t.Error("row paused although Restreamer refused the command")
	}

	// An externally hosted camera (no stream id) pauses and resumes with no
	// Restreamer involvement at all.
	ext := h.store.addVid(userA, statusActive, sub, "")
	wantStatus(t, h.do(ctxA, http.MethodPost, "/me/videos/"+strconv.Itoa(int(ext))+"/pause", ""), http.StatusOK)
	wantStatus(t, h.do(ctxA, http.MethodPost, "/me/videos/"+strconv.Itoa(int(ext))+"/resume", ""), http.StatusOK)
	if got := h.rs.commandLog(); len(got) != 2 {
		t.Errorf("external camera reached Restreamer: %v", got)
	}
}

func TestOwnerDeleteVideo(t *testing.T) {
	h := newOwnerHarness(t, true)
	ctxA := as(userA, "")
	sub := h.store.addSub(userA, statusApproved, 1)

	// With a live process: the process is deleted, then the row.
	vid := h.store.addVid(userA, statusActive, sub, "s1")
	h.rs.add("s1")
	wantStatus(t, h.do(ctxA, http.MethodDelete, "/me/videos/"+strconv.Itoa(int(vid)), ""), http.StatusNoContent)
	if h.rs.has("s1") {
		t.Error("process still on Restreamer after delete")
	}
	if _, err := h.store.GetVideoForOwner(context.Background(), vid); err == nil {
		t.Error("row still exists after delete")
	}

	// A process Restreamer already lost (404) is not an error.
	vid = h.store.addVid(userA, statusPaused, sub, "already-gone")
	wantStatus(t, h.do(ctxA, http.MethodDelete, "/me/videos/"+strconv.Itoa(int(vid)), ""), http.StatusNoContent)

	// Externally hosted: no stream id, row goes, Restreamer untouched.
	vid = h.store.addVid(userA, statusActive, sub, "")
	wantStatus(t, h.do(ctxA, http.MethodDelete, "/me/videos/"+strconv.Itoa(int(vid)), ""), http.StatusNoContent)

	// Not the owner: 403 and nothing deleted.
	other := h.store.addVid(userB, statusActive, h.store.addSub(userB, statusApproved, 1), "s9")
	h.rs.add("s9")
	wantStatus(t, h.do(ctxA, http.MethodDelete, "/me/videos/"+strconv.Itoa(int(other)), ""), http.StatusForbidden)
	if !h.rs.has("s9") {
		t.Error("someone else's process deleted")
	}
	wantStatus(t, h.do(ctxA, http.MethodDelete, "/me/videos/999", ""), http.StatusNotFound)
}
