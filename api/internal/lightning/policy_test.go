package lightning

import (
	"math"
	"testing"
	"time"
)

// Venice Marina, LA — the issue's test path.
const (
	veniceLat = 29.2836
	veniceLon = -89.3495
)

// milesPerDegLat is the great-circle miles per degree of latitude on the
// haversine's sphere, so a flash `mi` miles due north of a point is at
// lat + mi/milesPerDegLat exactly (up to float error).
var milesPerDegLat = KmToMi(6371.0 * math.Pi / 180)

// north returns a flash `mi` miles due north of (lat, lon) at t.
func north(lat, lon, mi float64, t time.Time) Flash {
	return Flash{Lat: lat + mi/milesPerDegLat, Lon: lon, Time: t}
}

func TestDistanceKm(t *testing.T) {
	if d := DistanceKm(veniceLat, veniceLon, veniceLat, veniceLon); d != 0 {
		t.Errorf("same point = %v km, want 0", d)
	}
	// NYC → LA is ~3936 km.
	d := DistanceKm(40.7128, -74.0060, 34.0522, -118.2437)
	if d < 3900 || d > 4000 {
		t.Errorf("NYC-LA = %v km, want ~3936", d)
	}
	// Symmetric.
	if a, b := DistanceKm(1, 2, 3, 4), DistanceKm(3, 4, 1, 2); math.Abs(a-b) > 1e-9 {
		t.Errorf("asymmetric: %v vs %v", a, b)
	}
	// One degree of latitude is ~111.19 km on this sphere.
	if d := DistanceKm(0, 0, 1, 0); math.Abs(d-111.19) > 0.01 {
		t.Errorf("1° lat = %v km, want 111.19", d)
	}
}

func TestMilesConversion(t *testing.T) {
	if mi := KmToMi(1.609344); math.Abs(mi-1) > 1e-12 {
		t.Errorf("KmToMi(1.609344) = %v", mi)
	}
	if km := MiToKm(10); math.Abs(km-16.09344) > 1e-9 {
		t.Errorf("MiToKm(10) = %v", km)
	}
	f := north(veniceLat, veniceLon, 10, time.Time{})
	if mi := DistanceMi(veniceLat, veniceLon, f.Lat, f.Lon); math.Abs(mi-10) > 1e-6 {
		t.Errorf("north(10 mi) is %v mi away", mi)
	}
}

func TestEvaluateClearWhenEmpty(t *testing.T) {
	now := time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC)
	s := Evaluate(nil, veniceLat, veniceLon, now)
	if s.Status != StatusClear || s.NearestMi != nil || s.LastStrikeAt != nil || s.AllClearAt != nil ||
		s.Strikes10mi30min != 0 || s.Strikes30mi30min != 0 {
		t.Errorf("empty → %+v", s)
	}
}

func TestEvaluateDistanceBoundaries(t *testing.T) {
	now := time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC)
	recent := now.Add(-5 * time.Minute)
	for _, tc := range []struct {
		name string
		mi   float64
		want string
	}{
		{"right on top", 0, StatusAlert},
		{"just inside alert radius", 9.99, StatusAlert},
		{"just outside alert radius", 10.01, StatusCaution},
		{"just inside caution radius", 29.99, StatusCaution},
		{"just outside caution radius", 30.01, StatusClear},
		{"far away", 90, StatusClear},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := Evaluate([]Flash{north(veniceLat, veniceLon, tc.mi, recent)}, veniceLat, veniceLon, now)
			if s.Status != tc.want {
				t.Fatalf("%v mi → %q, want %q", tc.mi, s.Status, tc.want)
			}
			if tc.want == StatusClear {
				if s.NearestMi != nil || s.Strikes30mi30min != 0 {
					t.Fatalf("clear but %+v", s)
				}
				return
			}
			if s.NearestMi == nil || math.Abs(*s.NearestMi-tc.mi) > 1e-6 {
				t.Fatalf("nearest = %v, want %v", s.NearestMi, tc.mi)
			}
			if s.LastStrikeAt == nil || !s.LastStrikeAt.Equal(recent) {
				t.Fatalf("last_strike_at = %v, want %v", s.LastStrikeAt, recent)
			}
			if s.Strikes30mi30min != 1 {
				t.Fatalf("strikes_30mi = %d", s.Strikes30mi30min)
			}
			if tc.want == StatusAlert {
				if s.Strikes10mi30min != 1 || s.AllClearAt == nil || !s.AllClearAt.Equal(recent.Add(30*time.Minute)) {
					t.Fatalf("alert but %+v", s)
				}
			} else if s.Strikes10mi30min != 0 || s.AllClearAt != nil {
				t.Fatalf("caution but %+v", s)
			}
		})
	}
}

func TestEvaluateTimeBoundaries(t *testing.T) {
	now := time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name string
		age  time.Duration
		want string
	}{
		{"just now", 0, StatusAlert},
		{"29m59s old still counts", 30*time.Minute - time.Second, StatusAlert},
		{"exactly 30m old has aged out", 30 * time.Minute, StatusClear},
		{"older", 45 * time.Minute, StatusClear},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := Evaluate([]Flash{north(veniceLat, veniceLon, 2, now.Add(-tc.age))}, veniceLat, veniceLon, now)
			if s.Status != tc.want {
				t.Fatalf("age %v → %q, want %q", tc.age, s.Status, tc.want)
			}
		})
	}
}

func TestEvaluateAllClearIsLatestAlertFlash(t *testing.T) {
	now := time.Date(2026, 9, 27, 20, 0, 0, 0, time.UTC)
	flashes := []Flash{
		north(veniceLat, veniceLon, 4, now.Add(-20*time.Minute)),  // alert, older
		north(veniceLat, veniceLon, 8, now.Add(-6*time.Minute)),   // alert, latest in 10 mi
		north(veniceLat, veniceLon, 20, now.Add(-2*time.Minute)),  // caution only, but the most recent overall
		north(veniceLat, veniceLon, 60, now.Add(-1*time.Minute)),  // ignored: outside 30 mi
		north(veniceLat, veniceLon, 1, now.Add(-40*time.Minute)),  // ignored: aged out
		north(veniceLat, veniceLon, 25, now.Add(-29*time.Minute)), // caution
	}
	s := Evaluate(flashes, veniceLat, veniceLon, now)
	if s.Status != StatusAlert {
		t.Fatalf("status = %q", s.Status)
	}
	if s.Strikes10mi30min != 2 || s.Strikes30mi30min != 4 {
		t.Fatalf("counts = %d/%d, want 2/4", s.Strikes10mi30min, s.Strikes30mi30min)
	}
	if s.NearestMi == nil || math.Abs(*s.NearestMi-4) > 1e-6 {
		t.Fatalf("nearest = %v, want 4", s.NearestMi)
	}
	if s.LastStrikeAt == nil || !s.LastStrikeAt.Equal(now.Add(-2*time.Minute)) {
		t.Fatalf("last_strike_at = %v, want 2 min ago (the 20 mi flash)", s.LastStrikeAt)
	}
	// all_clear_at follows the latest flash *within 10 mi*, not the 20 mi one.
	want := now.Add(-6 * time.Minute).Add(AllClearAfter)
	if s.AllClearAt == nil || !s.AllClearAt.Equal(want) {
		t.Fatalf("all_clear_at = %v, want %v", s.AllClearAt, want)
	}
	// And at that instant the alert is over.
	after := Evaluate(flashes, veniceLat, veniceLon, want)
	if after.Status != StatusCaution {
		t.Fatalf("at all_clear_at status = %q, want caution (the 20 mi flash is still inside 30 min)", after.Status)
	}
}
