package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

func statusMap(t *testing.T, rec *httptest.ResponseRecorder) map[int32]string {
	t.Helper()
	wantStatus(t, rec, http.StatusOK)
	out := map[int32]string{}
	for _, s := range decode[[]videoStatus](t, rec) {
		out[s.VideoID] = s.State
	}
	return out
}

func TestVideoStatusRequiresUser(t *testing.T) {
	h := newOwnerHarness(t, true)
	wantStatus(t, h.do(as("", ""), http.MethodGet, "/me/videos/status", ""), http.StatusUnauthorized)
}

func TestVideoStatusStates(t *testing.T) {
	h := newOwnerHarness(t, true)
	sub := h.store.addSub(userA, statusApproved, 1)
	live := h.store.addVid(userA, statusActive, sub, "s-live")
	offline := h.store.addVid(userA, statusActive, sub, "s-off")
	missing := h.store.addVid(userA, statusActive, sub, "s-gone") // no process on Restreamer
	external := h.store.addVid(userA, statusActive, sub, "")      // no stream_id
	paused := h.store.addVid(userA, statusPaused, sub, "s-paused")
	pending := h.store.addVid(userA, statusPending, sub, "s-pending")
	rejected := h.store.addVid(userA, statusRejected, sub, "s-rej")
	other := h.store.addVid(userB, statusActive, h.store.addSub(userB, statusApproved, 1), "s-other")
	h.rs.add("s-live")
	h.rs.add("s-off")
	h.rs.setExec("s-off", "failed")

	got := statusMap(t, h.do(as(userA, ""), http.MethodGet, "/me/videos/status", ""))
	want := map[int32]string{
		live: videoStateLive, offline: videoStateOffline, missing: videoStateUnknown,
		external: videoStateUnknown, paused: videoStatePaused, pending: videoStatePending,
		rejected: videoStateOffline,
	}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for id, state := range want {
		if got[id] != state {
			t.Errorf("video %d = %q, want %q", id, got[id], state)
		}
	}
	if _, leaked := got[other]; leaked {
		t.Errorf("another user's camera %d is in the list", other)
	}
}

func TestVideoStatusSameRuleAsMyVideos(t *testing.T) {
	h := newOwnerHarness(t, true)
	acct := h.store.addAccount("Acme", userA)
	sub := h.store.addSub(userA, statusApproved, 1)
	cam1 := h.store.addVid(userA, statusActive, sub, "s1")
	cam2 := h.store.addVid(userA, statusActive, sub, "s2")
	h.store.moveSub(sub, acct)
	h.rs.add("s1")
	h.rs.add("s2")
	h.store.addMember(acct, userC, roleViewer, false, cam1) // restricted viewer

	got := statusMap(t, h.do(as(userC, ""), http.MethodGet, "/me/videos/status", ""))
	if len(got) != 1 || got[cam1] != videoStateLive {
		t.Errorf("restricted viewer got %v, want only camera %d live", got, cam1)
	}
	if _, ok := got[cam2]; ok {
		t.Errorf("camera %d is not picked for the viewer", cam2)
	}
}

func TestVideoStatusPrivateCameraStillProbed(t *testing.T) {
	// /me/videos blanks a private camera's stream_id; the status endpoint
	// reads the unredacted row, so it still answers live/offline.
	h := newOwnerHarness(t, true)
	sub := h.store.addSub(userA, statusApproved, 1)
	id := h.store.addVid(userA, statusActive, sub, "s-priv")
	h.rs.add("s-priv")
	h.store.mu.Lock()
	v := h.store.vids[id]
	v.Visibility = "private"
	h.store.vids[id] = v
	h.store.mu.Unlock()

	rec := h.do(as(userA, ""), http.MethodGet, "/me/videos/status", "")
	if got := statusMap(t, rec); got[id] != videoStateLive {
		t.Errorf("private camera = %q, want live", got[id])
	}
	if body := rec.Body.String(); strings.Contains(body, "s-priv") {
		t.Errorf("response leaks the stream id: %s", body)
	}
}

func TestVideoStatusRestreamerDown(t *testing.T) {
	h := newOwnerHarness(t, true)
	sub := h.store.addSub(userA, statusApproved, 1)
	active := h.store.addVid(userA, statusActive, sub, "s1")
	paused := h.store.addVid(userA, statusPaused, sub, "s2")
	h.rs.add("s1")
	h.rs.mu.Lock()
	h.rs.down = true
	h.rs.mu.Unlock()

	got := statusMap(t, h.do(as(userA, ""), http.MethodGet, "/me/videos/status", ""))
	if got[active] != videoStateUnknown || got[paused] != videoStatePaused {
		t.Errorf("got %v, want active unknown and paused paused", got)
	}
}

func TestVideoStatusRestreamerNotConfigured(t *testing.T) {
	h := newOwnerHarness(t, false)
	sub := h.store.addSub(userA, statusApproved, 1)
	active := h.store.addVid(userA, statusActive, sub, "s1")
	got := statusMap(t, h.do(as(userA, ""), http.MethodGet, "/me/videos/status", ""))
	if got[active] != videoStateUnknown {
		t.Errorf("got %v, want unknown", got)
	}
}

func TestVideoStatusEmptyIsArray(t *testing.T) {
	h := newOwnerHarness(t, true)
	rec := h.do(as(userA, ""), http.MethodGet, "/me/videos/status", "")
	wantStatus(t, rec, http.StatusOK)
	if body := rec.Body.String(); body != "[]\n" && body != "[]" {
		t.Errorf("body = %q, want []", body)
	}
}

func TestVideoStatusCachedFor15s(t *testing.T) {
	store := newFakeStore()
	rs := newFakeRestreamer(t)
	sub := store.addSub(userA, statusApproved, 1)
	id := store.addVid(userA, statusActive, sub, "s1")
	rs.add("s1")

	var mu sync.Mutex
	clock := time.Now()
	now := func() time.Time { mu.Lock(); defer mu.Unlock(); return clock }
	advance := func(d time.Duration) { mu.Lock(); clock = clock.Add(d); mu.Unlock() }

	r := chi.NewRouter()
	r.Get("/me/videos/status", listMyVideoStatus(store, rs.client(), now))
	call := func() string {
		req := httptest.NewRequest(http.MethodGet, "/me/videos/status", nil).WithContext(as(userA, ""))
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return statusMap(t, rec)[id]
	}

	if got := call(); got != videoStateLive {
		t.Fatalf("first = %q", got)
	}
	rs.setExec("s1", "failed")
	advance(10 * time.Second)
	if got := call(); got != videoStateLive {
		t.Errorf("within 15 s = %q, want the cached live", got)
	}
	if n := rs.stateCalls(); n != 1 {
		t.Errorf("state calls = %d, want 1", n)
	}
	advance(6 * time.Second)
	if got := call(); got != videoStateOffline {
		t.Errorf("after 15 s = %q, want offline", got)
	}
	if n := rs.stateCalls(); n != 2 {
		t.Errorf("state calls = %d, want 2", n)
	}
}
