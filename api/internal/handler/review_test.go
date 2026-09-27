package handler

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/brandon-relentnet/nationcam/api/internal/db"
)

var adminCtx = as("admin-user", "openid admin")

func TestReviewQueue(t *testing.T) {
	h := newOwnerHarness(t, true)
	pendingSub := h.store.addSub(userA, statusPending, 1)
	approvedSub := h.store.addSub(userA, statusApproved, 1)
	h.store.addSub(userB, statusRejected, 2)
	pendingVid := h.store.addVid(userA, statusPending, pendingSub, "s1")
	h.store.addVid(userA, statusActive, approvedSub, "s2")
	h.store.addVid(userB, statusRejected, approvedSub, "s3")

	rec := h.do(adminCtx, http.MethodGet, "/review", "")
	wantStatus(t, rec, http.StatusOK)
	q := decode[reviewQueue](t, rec)
	if len(q.Sublocations) != 1 || q.Sublocations[0].SublocationID != pendingSub || q.Sublocations[0].OwnerID != userA {
		t.Errorf("queue sublocations = %+v", q.Sublocations)
	}
	if len(q.Videos) != 1 || q.Videos[0].VideoID != pendingVid || q.Videos[0].OwnerID != userA || q.Videos[0].SublocationStatus != statusPending {
		t.Errorf("queue videos = %+v", q.Videos)
	}
}

func TestApproveVideoCascadesToSublocation(t *testing.T) {
	h := newOwnerHarness(t, true)
	sub := h.store.addSub(userA, statusPending, 1)
	vid := h.store.addVid(userA, statusPending, sub, "s1")
	other := h.store.addVid(userA, statusPending, sub, "s2")

	rec := h.do(adminCtx, http.MethodPost, "/videos/"+strconv.Itoa(int(vid))+"/approve", "")
	wantStatus(t, rec, http.StatusOK)
	v := decode[db.GetVideoForOwnerRow](t, rec)
	if v.Status != statusActive || v.SublocationStatus != statusApproved {
		t.Errorf("approved = %+v", v)
	}
	if h.store.sub(sub).Status != statusApproved {
		t.Error("pending sublocation not approved with its camera")
	}
	if h.store.txCalls != 1 {
		t.Errorf("approve ran %d transactions, want 1", h.store.txCalls)
	}
	// Sibling cameras stay pending — each is reviewed on its own.
	if h.store.video(other).Status != statusPending {
		t.Error("sibling camera approved by cascade")
	}

	// Approving again, or approving a non-pending camera, is 409.
	wantStatus(t, h.do(adminCtx, http.MethodPost, "/videos/"+strconv.Itoa(int(vid))+"/approve", ""), http.StatusConflict)
	for _, st := range []string{statusActive, statusPaused, statusRejected, statusInactive} {
		x := h.store.addVid(userA, st, sub, "")
		wantStatus(t, h.do(adminCtx, http.MethodPost, "/videos/"+strconv.Itoa(int(x))+"/approve", ""), http.StatusConflict)
	}
	wantStatus(t, h.do(adminCtx, http.MethodPost, "/videos/999/approve", ""), http.StatusNotFound)
	wantStatus(t, h.do(adminCtx, http.MethodPost, "/videos/x/approve", ""), http.StatusBadRequest)

	// A camera in a rejected sublocation cannot be approved.
	rejSub := h.store.addSub(userA, statusRejected, 1)
	rv := h.store.addVid(userA, statusPending, rejSub, "")
	wantStatus(t, h.do(adminCtx, http.MethodPost, "/videos/"+strconv.Itoa(int(rv))+"/approve", ""), http.StatusConflict)
	if h.store.video(rv).Status != statusPending {
		t.Error("camera approved under a rejected sublocation")
	}
}

func TestRejectVideoStopsProcess(t *testing.T) {
	h := newOwnerHarness(t, true)
	sub := h.store.addSub(userA, statusApproved, 1)

	for _, from := range []string{statusPending, statusActive, statusPaused} {
		vid := h.store.addVid(userA, from, sub, "p-"+from)
		h.rs.add("p-" + from)
		rec := h.do(adminCtx, http.MethodPost, "/videos/"+strconv.Itoa(int(vid))+"/reject", `{"note":"Stream is a slideshow"}`)
		wantStatus(t, rec, http.StatusOK)
		v := decode[db.GetVideoForOwnerRow](t, rec)
		if v.Status != statusRejected || v.ReviewNote != "Stream is a slideshow" {
			t.Errorf("rejected from %s = %+v", from, v)
		}
		// Stopped, not deleted.
		if !h.rs.has("p-" + from) {
			t.Errorf("process p-%s deleted on reject, want stopped", from)
		}
	}
	if got := h.rs.commandLog(); len(got) != 3 || got[0] != "restreamer-ui:ingest:p-pending stop" {
		t.Errorf("commands = %v, want three stops", got)
	}

	// Rejected and inactive cannot be rejected (again).
	for _, st := range []string{statusRejected, statusInactive} {
		x := h.store.addVid(userA, st, sub, "")
		wantStatus(t, h.do(adminCtx, http.MethodPost, "/videos/"+strconv.Itoa(int(x))+"/reject", `{"note":"x"}`), http.StatusConflict)
	}

	// An empty body is a rejection with no note; a bad body is 400.
	x := h.store.addVid(userA, statusPending, sub, "")
	wantStatus(t, h.do(adminCtx, http.MethodPost, "/videos/"+strconv.Itoa(int(x))+"/reject", ""), http.StatusOK)
	if v := h.store.video(x); v.Status != statusRejected || v.ReviewNote != "" {
		t.Errorf("no-note reject = %+v", v)
	}
	y := h.store.addVid(userA, statusPending, sub, "")
	wantStatus(t, h.do(adminCtx, http.MethodPost, "/videos/"+strconv.Itoa(int(y))+"/reject", `{`), http.StatusBadRequest)

	// Restreamer refusing the stop (process unknown) does not undo the
	// moderation decision.
	z := h.store.addVid(userA, statusActive, sub, "never-existed")
	wantStatus(t, h.do(adminCtx, http.MethodPost, "/videos/"+strconv.Itoa(int(z))+"/reject", `{"note":"bye"}`), http.StatusOK)
	if h.store.video(z).Status != statusRejected {
		t.Error("reject rolled back on Restreamer 404")
	}
}

func TestApproveRejectSublocation(t *testing.T) {
	h := newOwnerHarness(t, true)

	// Approve: pending → approved; its cameras stay pending.
	sub := h.store.addSub(userA, statusPending, 1)
	vid := h.store.addVid(userA, statusPending, sub, "s1")
	rec := h.do(adminCtx, http.MethodPost, "/sublocations/"+strconv.Itoa(int(sub))+"/approve", "")
	wantStatus(t, rec, http.StatusOK)
	if s := decode[db.GetSublocationForOwnerRow](t, rec); s.Status != statusApproved {
		t.Errorf("approved = %+v", s)
	}
	if h.store.video(vid).Status != statusPending {
		t.Error("camera approved along with its sublocation")
	}
	wantStatus(t, h.do(adminCtx, http.MethodPost, "/sublocations/"+strconv.Itoa(int(sub))+"/approve", ""), http.StatusConflict)
	wantStatus(t, h.do(adminCtx, http.MethodPost, "/sublocations/"+strconv.Itoa(int(sub))+"/reject", ""), http.StatusConflict)
	wantStatus(t, h.do(adminCtx, http.MethodPost, "/sublocations/999/approve", ""), http.StatusNotFound)

	// Reject: pending → rejected, its pending cameras are rejected with the
	// same note and their processes stopped; its non-pending cameras are
	// left alone.
	sub2 := h.store.addSub(userA, statusPending, 1)
	p1 := h.store.addVid(userA, statusPending, sub2, "r1")
	p2 := h.store.addVid(userA, statusPending, sub2, "r2")
	keep := h.store.addVid(userA, statusActive, sub2, "r3")
	h.rs.add("r1")
	h.rs.add("r2")
	h.rs.add("r3")
	rec = h.do(adminCtx, http.MethodPost, "/sublocations/"+strconv.Itoa(int(sub2))+"/reject", `{"note":"Not a public place"}`)
	wantStatus(t, rec, http.StatusOK)
	if s := decode[db.GetSublocationForOwnerRow](t, rec); s.Status != statusRejected || s.ReviewNote != "Not a public place" {
		t.Errorf("rejected = %+v", s)
	}
	for _, id := range []int32{p1, p2} {
		if v := h.store.video(id); v.Status != statusRejected || v.ReviewNote != "Not a public place" {
			t.Errorf("cascaded camera %d = %+v", id, v)
		}
	}
	if h.store.video(keep).Status != statusActive {
		t.Error("active camera rejected by sublocation cascade")
	}
	cmds := h.rs.commandLog()
	stopped := map[string]bool{}
	for _, c := range cmds {
		stopped[c] = true
	}
	if len(cmds) != 2 || !stopped["restreamer-ui:ingest:r1 stop"] || !stopped["restreamer-ui:ingest:r2 stop"] {
		t.Errorf("commands = %v, want stops for r1 and r2 only", cmds)
	}
	for _, id := range []string{"r1", "r2", "r3"} {
		if !h.rs.has(id) {
			t.Errorf("process %s deleted on reject, want stopped", id)
		}
	}
}
