package handler

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func loadFixture(t *testing.T, name string, v any) {
	t.Helper()
	body, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatalf("reading fixture %s: %v", name, err)
	}
	if err := json.Unmarshal(body, v); err != nil {
		t.Fatalf("unmarshaling fixture %s: %v", name, err)
	}
}

func TestHaversineKm(t *testing.T) {
	// Same point: zero distance.
	if d := haversineKm(29.28, -89.35, 29.28, -89.35); d != 0 {
		t.Errorf("same-point distance = %v, want 0", d)
	}
	// NYC to LA is roughly 3940km — sanity check the formula is in the right
	// ballpark rather than pinning an exact figure.
	d := haversineKm(40.7128, -74.0060, 34.0522, -118.2437)
	if d < 3900 || d > 4000 {
		t.Errorf("NYC-LA distance = %v km, want ~3936km", d)
	}
}

func TestNearestTideStationWithinRange(t *testing.T) {
	var resp noaaStationsResponse
	loadFixture(t, "noaa_stations.json", &resp)

	// Venice, LA — the nearest fixture station (Pilots Station East) sits
	// ~39km away, well inside the 50km radius, and closer than Grand Isle.
	station, ok := nearestTideStation(resp.Stations, 29.2836, -89.3495, tideStationRadiusKm)
	if !ok {
		t.Fatalf("expected a station within range")
	}
	if station.ID != "8760922" {
		t.Errorf("nearest station = %q, want 8760922 (Pilots Station East)", station.ID)
	}
}

func TestNearestTideStationOutOfRange(t *testing.T) {
	var resp noaaStationsResponse
	loadFixture(t, "noaa_stations.json", &resp)

	// A point in the middle of Kansas is nowhere near any fixture station.
	_, ok := nearestTideStation(resp.Stations, 38.5, -98.0, tideStationRadiusKm)
	if ok {
		t.Errorf("expected no station within range")
	}
}

func TestNearestTideStationEmpty(t *testing.T) {
	if _, ok := nearestTideStation(nil, 29.28, -89.35, tideStationRadiusKm); ok {
		t.Errorf("expected no station from an empty list")
	}
}

func TestNearestRiverSiteWithinRange(t *testing.T) {
	var resp usgsIVResponse
	loadFixture(t, "usgs_sites.json", &resp)
	sites := flattenUSGS(resp)
	if len(sites) != 2 {
		t.Fatalf("flattenUSGS returned %d sites, want 2", len(sites))
	}

	// Westwego, LA — right across the river from the New Orleans gauge.
	site, ok := nearestRiverSite(sites, 29.9, -90.14, riverSiteRadiusKm)
	if !ok {
		t.Fatalf("expected a site within range")
	}
	if site.ID != "07374000" {
		t.Errorf("nearest site = %q, want 07374000 (New Orleans)", site.ID)
	}
	if math.Abs(site.StageFt-8.51) > 0.001 {
		t.Errorf("stage = %v, want the latest reading 8.51 (last point in the series)", site.StageFt)
	}
}

func TestNearestRiverSiteOutOfRange(t *testing.T) {
	var resp usgsIVResponse
	loadFixture(t, "usgs_sites.json", &resp)
	sites := flattenUSGS(resp)

	// A gym in mid-Michigan is nowhere near a river gauge covered by this
	// fixture — Grand Rapids is the closest and it's still >200km away.
	_, ok := nearestRiverSite(sites, 43.0, -84.5, riverSiteRadiusKm)
	if ok {
		t.Errorf("expected no site within range")
	}
}

func TestNearestRiverSiteEmpty(t *testing.T) {
	if _, ok := nearestRiverSite(nil, 29.9, -90.14, riverSiteRadiusKm); ok {
		t.Errorf("expected no site from an empty list")
	}
}

func TestBboxAround(t *testing.T) {
	west, south, east, north := bboxAround(29.9, -90.14, 25)
	if west >= -90.14 || east <= -90.14 {
		t.Errorf("bbox does not straddle the center longitude: west=%v east=%v", west, east)
	}
	if south >= 29.9 || north <= 29.9 {
		t.Errorf("bbox does not straddle the center latitude: south=%v north=%v", south, north)
	}
}

/* ──── Per-sublocation overrides (DAN-28) ──── */

func TestSourceOverrideUnset(t *testing.T) {
	id, disabled := sourceOverride(pgtype.Text{})
	if id != "" || disabled {
		t.Errorf("unset override = (%q, %v), want (\"\", false)", id, disabled)
	}
}

func TestSourceOverrideEmptyString(t *testing.T) {
	id, disabled := sourceOverride(pgtype.Text{String: "", Valid: true})
	if id != "" || disabled {
		t.Errorf("empty-string override = (%q, %v), want (\"\", false)", id, disabled)
	}
}

func TestSourceOverrideNone(t *testing.T) {
	id, disabled := sourceOverride(pgtype.Text{String: "none", Valid: true})
	if id != "" || !disabled {
		t.Errorf("\"none\" override = (%q, %v), want (\"\", true)", id, disabled)
	}
}

func TestSourceOverrideExplicitID(t *testing.T) {
	id, disabled := sourceOverride(pgtype.Text{String: "07374525", Valid: true})
	if id != "07374525" || disabled {
		t.Errorf("explicit override = (%q, %v), want (\"07374525\", false)", id, disabled)
	}
}

func TestResolveTidesOverrideSkipsNearestLookup(t *testing.T) {
	block := resolveTidesWith("westwego", pgtype.Text{String: "8760922", Valid: true},
		func() (tideStation, error) {
			return tideStation{ID: "8760922", Name: "Pilots Station East"}, nil
		},
		func() (tideStation, bool) {
			t.Fatal("nearest lookup must not run when an override is set")
			return tideStation{}, false
		},
		func(st tideStation) (*tideBlock, error) {
			if st.ID != "8760922" {
				t.Errorf("predictions requested for station %q, want 8760922", st.ID)
			}
			return &tideBlock{StationName: st.Name, Predictions: []tidePrediction{{Time: "2026-01-01 00:00", HeightFt: 1.2, Type: "high"}}}, nil
		},
	)
	if block == nil {
		t.Fatal("expected a tide block")
	}
	if block.Source != "override" {
		t.Errorf("source = %q, want override", block.Source)
	}
	if block.StationName != "Pilots Station East" {
		t.Errorf("station name = %q, want the overridden station's name", block.StationName)
	}
}

func TestResolveTidesOverrideMetadataFailureStillFetchesPredictions(t *testing.T) {
	// A metadata lookup failure (e.g. NOAA hiccup) must not block the
	// override — predictions are still requested for the pinned id.
	block := resolveTidesWith("westwego", pgtype.Text{String: "8760922", Valid: true},
		func() (tideStation, error) { return tideStation{}, fmt.Errorf("noaa unavailable") },
		func() (tideStation, bool) {
			t.Fatal("nearest lookup must not run when an override is set")
			return tideStation{}, false
		},
		func(st tideStation) (*tideBlock, error) {
			if st.ID != "8760922" {
				t.Errorf("predictions requested for station %q, want 8760922", st.ID)
			}
			return &tideBlock{StationName: "", Predictions: []tidePrediction{}}, nil
		},
	)
	if block == nil || block.Source != "override" {
		t.Fatalf("expected an override tide block despite the metadata failure, got %+v", block)
	}
}

func TestResolveTidesNoneDisablesTides(t *testing.T) {
	block := resolveTidesWith("gym", pgtype.Text{String: "none", Valid: true},
		func() (tideStation, error) {
			t.Fatal("metadata must not be fetched when the source is disabled")
			return tideStation{}, nil
		},
		func() (tideStation, bool) {
			t.Fatal("nearest lookup must not run when the source is disabled")
			return tideStation{}, false
		},
		func(tideStation) (*tideBlock, error) {
			t.Fatal("predictions must not be fetched when the source is disabled")
			return nil, nil
		},
	)
	if block != nil {
		t.Errorf("expected nil tides for \"none\", got %+v", block)
	}
}

func TestResolveTidesFallsBackToNearestStation(t *testing.T) {
	var resp noaaStationsResponse
	loadFixture(t, "noaa_stations.json", &resp)

	block := resolveTidesWith("venice-marina", pgtype.Text{},
		func() (tideStation, error) {
			t.Fatal("metadata must not be fetched without an override")
			return tideStation{}, nil
		},
		func() (tideStation, bool) {
			return nearestTideStation(resp.Stations, 29.2836, -89.3495, tideStationRadiusKm)
		},
		func(st tideStation) (*tideBlock, error) {
			return &tideBlock{StationName: st.Name, Predictions: []tidePrediction{}}, nil
		},
	)
	if block == nil {
		t.Fatal("expected a fallback tide block")
	}
	if block.Source != "nearest" {
		t.Errorf("source = %q, want nearest", block.Source)
	}
	if block.StationName == "" {
		t.Errorf("expected the nearest fixture station's name to be used")
	}
}

func TestResolveRiverOverrideSkipsNearestLookup(t *testing.T) {
	block := resolveRiverWith("westwego", pgtype.Text{String: "07374525", Valid: true},
		func(id string) (*riverSite, error) {
			if id != "07374525" {
				t.Errorf("fetched site %q, want 07374525", id)
			}
			return &riverSite{ID: id, Name: "Mississippi River at Belle Chasse", StageFt: 9.4, ObservedAt: "2026-09-27T12:00:00Z"}, nil
		},
		func() (riverSite, bool) {
			t.Fatal("nearest lookup must not run when an override is set")
			return riverSite{}, false
		},
	)
	if block == nil {
		t.Fatal("expected a river block")
	}
	if block.Source != "override" {
		t.Errorf("source = %q, want override", block.Source)
	}
	if block.SiteName != "Mississippi River at Belle Chasse" {
		t.Errorf("site name = %q, want the overridden site's name", block.SiteName)
	}
}

func TestResolveRiverOverrideFetchFailureReturnsNil(t *testing.T) {
	block := resolveRiverWith("westwego", pgtype.Text{String: "07374525", Valid: true},
		func(id string) (*riverSite, error) { return nil, fmt.Errorf("usgs unavailable") },
		func() (riverSite, bool) {
			t.Fatal("nearest lookup must not run when an override is set")
			return riverSite{}, false
		},
	)
	if block != nil {
		t.Errorf("expected nil river block on override fetch failure, got %+v", block)
	}
}

func TestResolveRiverNoneDisablesRiver(t *testing.T) {
	block := resolveRiverWith("gym", pgtype.Text{String: "none", Valid: true},
		func(id string) (*riverSite, error) {
			t.Fatal("fetch must not run when the source is disabled")
			return nil, nil
		},
		func() (riverSite, bool) {
			t.Fatal("nearest lookup must not run when the source is disabled")
			return riverSite{}, false
		},
	)
	if block != nil {
		t.Errorf("expected nil river for \"none\", got %+v", block)
	}
}

func TestResolveRiverFallsBackToNearestSite(t *testing.T) {
	var resp usgsIVResponse
	loadFixture(t, "usgs_sites.json", &resp)
	sites := flattenUSGS(resp)

	block := resolveRiverWith("westwego", pgtype.Text{},
		func(id string) (*riverSite, error) {
			t.Fatal("fetch-by-id must not run without an override")
			return nil, nil
		},
		func() (riverSite, bool) {
			return nearestRiverSite(sites, 29.9, -90.14, riverSiteRadiusKm)
		},
	)
	if block == nil {
		t.Fatal("expected a fallback river block")
	}
	if block.Source != "nearest" {
		t.Errorf("source = %q, want nearest", block.Source)
	}
	if block.SiteName == "" {
		t.Errorf("expected the nearest fixture site's name to be used")
	}
}

/* ──── Hourly strip (DAN-32) ──── */

func TestHourlyStripStartsAtNow(t *testing.T) {
	times := []string{
		"2026-09-14T10:00", "2026-09-14T11:00", "2026-09-14T12:00",
		"2026-09-14T13:00", "2026-09-14T14:00",
	}
	temp := []float64{70, 72, 75, 78, 80}
	rain := []float64{0, 5, 10, 20, 30}
	wind := []float64{5, 6, 7, 8, 9}
	uv := []float64{1, 2, 4, 6, 7}

	got := hourlyStrip(times, temp, rain, wind, uv, "2026-09-14T11:45")
	if len(got) != 3 {
		t.Fatalf("hourlyStrip length = %d, want 3 (starting at 12:00)", len(got))
	}
	if got[0].TempF != 75 || got[0].RainPct != 10 || got[0].WindMph != 7 || got[0].UvIndex != 4 {
		t.Errorf("first point = %+v, want the 12:00 entry", got[0])
	}
	if got[0].Hour == "" {
		t.Error("expected a non-empty hour label")
	}
}

func TestHourlyStripCapsAt12Hours(t *testing.T) {
	times := make([]string, 24)
	vals := make([]float64, 24)
	base := time.Date(2026, 9, 14, 0, 0, 0, 0, time.UTC)
	for i := range times {
		times[i] = base.Add(time.Duration(i) * time.Hour).Format("2006-01-02T15:04")
		vals[i] = float64(i)
	}
	got := hourlyStrip(times, vals, vals, vals, vals, times[0])
	if len(got) != 12 {
		t.Fatalf("hourlyStrip length = %d, want 12", len(got))
	}
}

func TestHourlyStripNilOnBadInput(t *testing.T) {
	if got := hourlyStrip(nil, nil, nil, nil, nil, "garbage"); got != nil {
		t.Errorf("hourlyStrip with unparseable now = %v, want nil", got)
	}
	times := []string{"2026-09-14T10:00"}
	if got := hourlyStrip(times, nil, nil, nil, nil, "2026-09-14T10:00"); got != nil {
		t.Errorf("hourlyStrip with mismatched slice lengths = %v, want nil", got)
	}
	// now is after every offered hour.
	if got := hourlyStrip(times, []float64{1}, []float64{1}, []float64{1}, []float64{1}, "2026-09-14T23:00"); got != nil {
		t.Errorf("hourlyStrip with now past the last hour = %v, want nil", got)
	}
}
