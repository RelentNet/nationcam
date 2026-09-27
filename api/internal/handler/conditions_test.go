package handler

import (
	"encoding/json"
	"math"
	"os"
	"testing"
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
