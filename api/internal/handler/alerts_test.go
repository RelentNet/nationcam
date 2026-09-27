package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/go-chi/chi/v5"
)

func alertsSiteFor(slug string) AlertsSite {
	return func(_ context.Context, s string) (float64, float64, bool, error) {
		if s == slug {
			return testLat, testLon, true, nil
		}
		return 0, 0, false, nil
	}
}

func fixtureAlerts(t *testing.T) []nwsAlert {
	t.Helper()
	f, err := os.Open("testdata/nws_alerts.json")
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	defer f.Close()
	alerts, err := parseAlertsBody(f)
	if err != nil {
		t.Fatalf("parse fixture: %v", err)
	}
	return alerts
}

// newAlertsTestRouter wires getAlerts up like router.go, backed by an
// in-process fake Redis (newTestCache, from admin_users_test.go) so caching
// behavior is exercised without a real Redis server.
func newAlertsTestRouter(t *testing.T, site AlertsSite, fetch func(ctx context.Context, lat, lon float64) ([]nwsAlert, error)) http.Handler {
	t.Helper()
	c := newTestCache(t)
	r := chi.NewRouter()
	r.Get("/sublocations/{slug}/alerts", getAlerts(site, c, fetch))
	return r
}

func getAlertsJSON(t *testing.T, h http.Handler, slug string, into any) int {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/sublocations/"+slug+"/alerts", nil))
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q", ct)
	}
	if err := json.Unmarshal(rec.Body.Bytes(), into); err != nil {
		t.Fatalf("body %q: %v", rec.Body.String(), err)
	}
	return rec.Code
}

/* ──── Fixture parsing ──── */

func TestParseAlertsBodyFixture(t *testing.T) {
	alerts := fixtureAlerts(t)
	if len(alerts) != 4 {
		t.Fatalf("len(alerts) = %d, want 4", len(alerts))
	}

	byEvent := map[string]nwsAlert{}
	for _, a := range alerts {
		byEvent[a.Event] = a
	}

	watch, ok := byEvent["Tornado Watch"]
	if !ok {
		t.Fatalf("missing Tornado Watch in %v", byEvent)
	}
	if watch.Severity != "Extreme" {
		t.Fatalf("watch severity = %q", watch.Severity)
	}
	if watch.Instruction != nil {
		t.Fatalf("watch instruction = %v, want nil (empty in fixture)", *watch.Instruction)
	}
	// ends was null in the fixture — must fall back to expires.
	if watch.Ends == nil || *watch.Ends != "2026-09-27T22:00:00-05:00" {
		t.Fatalf("watch ends = %v, want expires fallback", watch.Ends)
	}

	warning, ok := byEvent["Severe Thunderstorm Warning"]
	if !ok {
		t.Fatalf("missing Severe Thunderstorm Warning in %v", byEvent)
	}
	if warning.Severity != "Severe" {
		t.Fatalf("warning severity = %q", warning.Severity)
	}
	if warning.Instruction == nil || *warning.Instruction == "" {
		t.Fatalf("warning instruction = %v, want non-empty", warning.Instruction)
	}
	if warning.Ends == nil || *warning.Ends != "2026-09-27T19:00:00-05:00" {
		t.Fatalf("warning ends = %v", warning.Ends)
	}
}

func TestTruncateRunes(t *testing.T) {
	short := "a short description"
	if got := truncateRunes(short, 400); got != short {
		t.Fatalf("truncateRunes(short) = %q", got)
	}

	long := ""
	for i := 0; i < 500; i++ {
		long += "x"
	}
	got := truncateRunes(long, 400)
	if len([]rune(got)) != 400 {
		t.Fatalf("len(truncated) = %d, want 400", len([]rune(got)))
	}

	// Multi-byte runes must not be split mid-character.
	multibyte := ""
	for i := 0; i < 410; i++ {
		multibyte += "é"
	}
	got = truncateRunes(multibyte, 400)
	if count := len([]rune(got)); count != 400 {
		t.Fatalf("multibyte truncated rune count = %d, want 400", count)
	}
}

/* ──── Sort order ──── */

func TestSortAlertsMostSevereFirstThenSoonestEnds(t *testing.T) {
	alerts := fixtureAlerts(t)
	sortAlerts(alerts)

	want := []string{
		"Tornado Watch",               // Extreme
		"Flash Flood Warning",         // Severe, ends 18:30 — sooner
		"Severe Thunderstorm Warning", // Severe, ends 19:00 — later
		"Heat Advisory",               // Moderate
	}
	if len(alerts) != len(want) {
		t.Fatalf("len(alerts) = %d, want %d", len(alerts), len(want))
	}
	for i, event := range want {
		if alerts[i].Event != event {
			t.Fatalf("alerts[%d].Event = %q, want %q (order: %v)", i, alerts[i].Event, event, eventNames(alerts))
		}
	}
}

func TestSortAlertsNilEndsSortsLastWithinTier(t *testing.T) {
	noEnd := nwsAlert{Event: "A", Severity: "Severe", Ends: nil}
	withEnd := nwsAlert{Event: "B", Severity: "Severe", Ends: strPtr("2026-09-27T19:00:00-05:00")}
	alerts := []nwsAlert{noEnd, withEnd}
	sortAlerts(alerts)
	if alerts[0].Event != "B" || alerts[1].Event != "A" {
		t.Fatalf("order = %v, want [B, A]", eventNames(alerts))
	}
}

func strPtr(s string) *string { return &s }

func eventNames(alerts []nwsAlert) []string {
	out := make([]string, len(alerts))
	for i, a := range alerts {
		out[i] = a.Event
	}
	return out
}

/* ──── Handler ──── */

func TestGetAlerts200WithFixture(t *testing.T) {
	site := alertsSiteFor("venice-marina")
	fetch := func(_ context.Context, _, _ float64) ([]nwsAlert, error) {
		return fixtureAlerts(t), nil
	}
	h := newAlertsTestRouter(t, site, fetch)

	var body alertsResponse
	if code := getAlertsJSON(t, h, "venice-marina", &body); code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if len(body.Alerts) != 4 {
		t.Fatalf("len(alerts) = %d, want 4", len(body.Alerts))
	}
	if body.Alerts[0].Event != "Tornado Watch" {
		t.Fatalf("alerts[0].Event = %q, want Tornado Watch (most severe first)", body.Alerts[0].Event)
	}
}

func TestGetAlerts404WithoutCoordinates(t *testing.T) {
	site := alertsSiteFor("venice-marina")
	fetch := func(_ context.Context, _, _ float64) ([]nwsAlert, error) {
		t.Fatal("fetch should not be called when the sublocation has no coordinates")
		return nil, nil
	}
	h := newAlertsTestRouter(t, site, fetch)

	var body map[string]any
	if code := getAlertsJSON(t, h, "no-coords", &body); code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (%v)", code, body)
	}
	if body["error"] == "" {
		t.Fatalf("body = %v", body)
	}
}

func TestGetAlertsLookupErrorIs500(t *testing.T) {
	site := func(_ context.Context, _ string) (float64, float64, bool, error) {
		return 0, 0, false, errors.New("db down")
	}
	fetch := func(_ context.Context, _, _ float64) ([]nwsAlert, error) { return nil, nil }
	h := newAlertsTestRouter(t, site, fetch)

	var body map[string]any
	if code := getAlertsJSON(t, h, "broken", &body); code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (%v)", code, body)
	}
}

func TestGetAlertsUpstreamFailureReturnsEmptyList(t *testing.T) {
	site := alertsSiteFor("venice-marina")
	fetch := func(_ context.Context, _, _ float64) ([]nwsAlert, error) {
		return nil, errors.New("upstream timeout")
	}
	h := newAlertsTestRouter(t, site, fetch)

	var body alertsResponse
	if code := getAlertsJSON(t, h, "venice-marina", &body); code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (upstream failure must never fail the page)", code)
	}
	if body.Alerts == nil || len(body.Alerts) != 0 {
		t.Fatalf("alerts = %v, want []", body.Alerts)
	}
}

func TestGetAlertsCachesResponse(t *testing.T) {
	site := alertsSiteFor("venice-marina")
	calls := 0
	fetch := func(_ context.Context, _, _ float64) ([]nwsAlert, error) {
		calls++
		return fixtureAlerts(t), nil
	}
	h := newAlertsTestRouter(t, site, fetch)

	var body alertsResponse
	if code := getAlertsJSON(t, h, "venice-marina", &body); code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	if code := getAlertsJSON(t, h, "venice-marina", &body); code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	if calls != 1 {
		t.Fatalf("fetch called %d times, want 1 (second request should hit cache)", calls)
	}
}
