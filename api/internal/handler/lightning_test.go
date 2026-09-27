package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/lightning"
	"github.com/go-chi/chi/v5"
)

const (
	testLat = 29.2836
	testLon = -89.3495
)

func lightningRouter(store *lightning.Store, now time.Time) http.Handler {
	site := func(_ context.Context, slug string) (float64, float64, bool, error) {
		switch slug {
		case "venice-marina":
			return testLat, testLon, true, nil
		case "broken":
			return 0, 0, false, errors.New("db down")
		}
		return 0, 0, false, nil
	}
	r := chi.NewRouter()
	r.Get("/sublocations/{slug}/lightning", getLightning(site, store, func() time.Time { return now }))
	return r
}

func getLightningJSON(t *testing.T, h http.Handler, slug string, into any) int {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/sublocations/"+slug+"/lightning", nil))
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Fatalf("Content-Type = %q", ct)
	}
	if err := json.Unmarshal(rec.Body.Bytes(), into); err != nil {
		t.Fatalf("body %q: %v", rec.Body.String(), err)
	}
	return rec.Code
}

func TestGetLightning404WithoutCoordinates(t *testing.T) {
	now := time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC)
	store := lightning.NewStore()
	store.MarkFetched(now)
	var body map[string]any
	if code := getLightningJSON(t, lightningRouter(store, now), "no-coords", &body); code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 (%v)", code, body)
	}
	if body["error"] == "" {
		t.Fatalf("body = %v", body)
	}
	// The 404 wins over a stale/missing store: no coordinates is the more
	// specific answer.
	if code := getLightningJSON(t, lightningRouter(nil, now), "no-coords", &body); code != http.StatusNotFound {
		t.Fatalf("nil store status = %d, want 404", code)
	}
	if code := getLightningJSON(t, lightningRouter(store, now), "broken", &body); code != http.StatusInternalServerError {
		t.Fatalf("lookup error status = %d, want 500", code)
	}
}

func TestGetLightning503WhenStale(t *testing.T) {
	now := time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC)
	var body struct {
		Error     string  `json:"error"`
		UpdatedAt *string `json:"updated_at"`
	}

	// Never fetched.
	store := lightning.NewStore()
	if code := getLightningJSON(t, lightningRouter(store, now), "venice-marina", &body); code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", code)
	}
	if body.Error == "" || body.UpdatedAt != nil {
		t.Fatalf("body = %+v", body)
	}

	// Fetched, but too long ago.
	store.MarkFetched(now.Add(-6 * time.Minute))
	if code := getLightningJSON(t, lightningRouter(store, now), "venice-marina", &body); code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", code)
	}
	if body.UpdatedAt == nil || *body.UpdatedAt != "2026-09-27T19:54:00Z" {
		t.Fatalf("updated_at = %v", body.UpdatedAt)
	}

	// Feature disabled (nil store).
	if code := getLightningJSON(t, lightningRouter(nil, now), "venice-marina", &body); code != http.StatusServiceUnavailable {
		t.Fatalf("nil store status = %d, want 503", code)
	}
}

func TestGetLightning200Shapes(t *testing.T) {
	now := time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC)
	store := lightning.NewStore()
	store.SetSites([]lightning.Site{{Slug: "venice-marina", Lat: testLat, Lon: testLon}})
	store.MarkFetched(now.Add(-30 * time.Second))
	h := lightningRouter(store, now)

	type resp struct {
		Status           string   `json:"status"`
		NearestMi        *float64 `json:"nearest_mi"`
		LastStrikeAt     *string  `json:"last_strike_at"`
		Strikes10mi30min int      `json:"strikes_10mi_30min"`
		Strikes30mi30min int      `json:"strikes_30mi_30min"`
		AllClearAt       *string  `json:"all_clear_at"`
		Source           string   `json:"source"`
		UpdatedAt        string   `json:"updated_at"`
	}

	// Clear: no flashes at all.
	var body resp
	if code := getLightningJSON(t, h, "venice-marina", &body); code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if body.Status != "clear" || body.NearestMi != nil || body.LastStrikeAt != nil || body.AllClearAt != nil ||
		body.Strikes10mi30min != 0 || body.Strikes30mi30min != 0 ||
		body.Source != "GOES-19 GLM" || body.UpdatedAt != "2026-09-27T19:59:30Z" {
		t.Fatalf("clear body = %+v", body)
	}
	// Every key is present even when null — the frontend relies on the shape.
	var raw map[string]json.RawMessage
	getLightningJSON(t, h, "venice-marina", &raw)
	for _, k := range []string{"status", "nearest_mi", "last_strike_at", "strikes_10mi_30min", "strikes_30mi_30min", "all_clear_at", "source", "updated_at"} {
		if _, ok := raw[k]; !ok {
			t.Fatalf("key %q missing from %v", k, raw)
		}
	}

	// Caution: one flash ~18 mi away, 12 minutes ago.
	milesPerDegLat := lightning.KmToMi(6371.0 * 3.141592653589793 / 180)
	strike := now.Add(-12 * time.Minute)
	store.Add([]lightning.Flash{{Lat: testLat + 18/milesPerDegLat, Lon: testLon, Time: strike}}, now)
	if code := getLightningJSON(t, h, "venice-marina", &body); code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	if body.Status != "caution" || body.NearestMi == nil || *body.NearestMi != 18 ||
		body.LastStrikeAt == nil || *body.LastStrikeAt != "2026-09-27T19:48:00Z" ||
		body.Strikes10mi30min != 0 || body.Strikes30mi30min != 1 || body.AllClearAt != nil {
		t.Fatalf("caution body = %+v (nearest %v)", body, body.NearestMi)
	}

	// Alert: another flash 6 mi away, 4 minutes ago → all clear 26 minutes
	// from now; nearest is rounded to one decimal.
	store.Add([]lightning.Flash{{Lat: testLat + 6.04/milesPerDegLat, Lon: testLon, Time: now.Add(-4 * time.Minute)}}, now)
	if code := getLightningJSON(t, h, "venice-marina", &body); code != http.StatusOK {
		t.Fatalf("status = %d", code)
	}
	if body.Status != "alert" || body.NearestMi == nil || *body.NearestMi != 6 ||
		body.LastStrikeAt == nil || *body.LastStrikeAt != "2026-09-27T19:56:00Z" ||
		body.Strikes10mi30min != 1 || body.Strikes30mi30min != 2 ||
		body.AllClearAt == nil || *body.AllClearAt != "2026-09-27T20:26:00Z" {
		t.Fatalf("alert body = %+v (nearest %v, all clear %v)", body, body.NearestMi, body.AllClearAt)
	}
}
