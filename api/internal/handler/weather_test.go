package handler

import (
	"testing"
	"time"
)

func f64(v float64) *float64 { return &v }

func TestWmoCondition(t *testing.T) {
	for _, tc := range []struct {
		code int
		want string
	}{
		{0, "Clear"}, {1, "Mainly clear"}, {2, "Partly cloudy"}, {3, "Overcast"},
		{45, "Fog"}, {48, "Fog"}, {51, "Drizzle"}, {57, "Drizzle"},
		{61, "Rain"}, {67, "Rain"}, {71, "Snow"}, {77, "Snow"},
		{80, "Showers"}, {82, "Showers"}, {95, "Thunderstorm"}, {99, "Thunderstorm"},
		{4, "Unknown"}, {60, "Unknown"},
	} {
		if got := wmoCondition(tc.code); got != tc.want {
			t.Errorf("wmoCondition(%d) = %q, want %q", tc.code, got, tc.want)
		}
	}
}

func TestCompass(t *testing.T) {
	for _, tc := range []struct {
		deg  float64
		want string
	}{
		{0, "N"}, {11, "N"}, {12, "NNE"}, {45, "NE"}, {90, "E"}, {135, "SE"},
		{180, "S"}, {225, "SW"}, {270, "W"}, {315, "NW"}, {348, "NNW"}, {349, "N"}, {360, "N"},
	} {
		if got := compass(tc.deg); got != tc.want {
			t.Errorf("compass(%v) = %q, want %q", tc.deg, got, tc.want)
		}
	}
}

func TestClockTime(t *testing.T) {
	if got := clockTime("2026-09-14T06:41"); got != "6:41 AM" {
		t.Errorf("clockTime = %q", got)
	}
	if got := clockTime("2026-09-14T19:03"); got != "7:03 PM" {
		t.Errorf("clockTime = %q", got)
	}
	if got := clockTime("garbage"); got != "garbage" {
		t.Errorf("clockTime passthrough = %q", got)
	}
}

/* ──── Heat stress (DAN-32) ──── */

func TestHeatStressFromWetBulb(t *testing.T) {
	for _, tc := range []struct {
		name     string
		wetBulbF float64
		want     string
	}{
		{"well below low/moderate line", 70, "low"},
		{"just under moderate", 79.9, "low"},
		{"bottom of moderate", 80, "moderate"},
		{"top of moderate", 84.9, "moderate"},
		{"bottom of high", 85, "high"},
		{"top of high", 87.9, "high"},
		{"bottom of extreme", 88, "extreme"},
		{"well into extreme", 95, "extreme"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := heatStress(f64(tc.wetBulbF), 999 /* must be ignored when wet-bulb present */)
			if got == nil {
				t.Fatal("heatStress returned nil")
			}
			if got.Level != tc.want {
				t.Errorf("heatStress(wetBulb=%v) level = %q, want %q", tc.wetBulbF, got.Level, tc.want)
			}
			if got.Label != heatStressLabels[tc.want] {
				t.Errorf("heatStress(wetBulb=%v) label = %q, want %q", tc.wetBulbF, got.Label, heatStressLabels[tc.want])
			}
			if !containsEstimate(got.Label) {
				t.Errorf("heatStress label %q must say (estimate)", got.Label)
			}
		})
	}
}

func TestHeatStressFallsBackToApparentTemp(t *testing.T) {
	// No wet-bulb reading offered — the apparent temperature drives the
	// same bands instead.
	got := heatStress(nil, 90)
	if got == nil || got.Level != "extreme" {
		t.Fatalf("heatStress(nil, 90) = %+v, want level extreme", got)
	}
}

func containsEstimate(label string) bool {
	for i := 0; i+len("(estimate)") <= len(label); i++ {
		if label[i:i+len("(estimate)")] == "(estimate)" {
			return true
		}
	}
	return false
}

/* ──── Storm potential (DAN-32) ──── */

func TestStormPotentialFromCAPE(t *testing.T) {
	for _, tc := range []struct {
		name string
		cape float64
		want string
	}{
		{"low", 200, "low"},
		{"just under moderate", 499.9, "low"},
		{"bottom of moderate", 500, "moderate"},
		{"top of moderate", 1500, "moderate"},
		{"just over moderate", 1500.1, "high"},
		{"well into high", 3000, "high"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := stormPotential(f64(tc.cape), nil)
			if got == nil {
				t.Fatal("stormPotential returned nil")
			}
			if got.Level != tc.want {
				t.Errorf("stormPotential(cape=%v) = %q, want %q", tc.cape, got.Level, tc.want)
			}
		})
	}
}

func TestStormPotentialLightningBumpsLowToModerate(t *testing.T) {
	got := stormPotential(f64(100), f64(5))
	if got == nil || got.Level != "moderate" {
		t.Fatalf("stormPotential(low CAPE, lightning>0) = %+v, want moderate", got)
	}

	// Lightning potential of exactly 0 must not bump it.
	got = stormPotential(f64(100), f64(0))
	if got == nil || got.Level != "low" {
		t.Fatalf("stormPotential(low CAPE, lightning=0) = %+v, want low", got)
	}

	// Already-high CAPE stays high regardless of lightning.
	got = stormPotential(f64(2000), f64(0))
	if got == nil || got.Level != "high" {
		t.Fatalf("stormPotential(high CAPE, lightning=0) = %+v, want high", got)
	}
}

func TestStormPotentialNilWithoutCAPE(t *testing.T) {
	if got := stormPotential(nil, f64(50)); got != nil {
		t.Errorf("stormPotential(nil CAPE, lightning) = %+v, want nil", got)
	}
	if got := stormPotential(nil, nil); got != nil {
		t.Errorf("stormPotential(nil, nil) = %+v, want nil", got)
	}
}

/* ──── AQI category (DAN-32) ──── */

func TestAqiCategory(t *testing.T) {
	for _, tc := range []struct {
		value int
		want  string
	}{
		{0, "Good"}, {50, "Good"},
		{51, "Moderate"}, {100, "Moderate"},
		{101, "Unhealthy for Sensitive Groups"}, {150, "Unhealthy for Sensitive Groups"},
		{151, "Unhealthy"}, {200, "Unhealthy"},
		{201, "Very Unhealthy"}, {300, "Very Unhealthy"},
		{301, "Hazardous"}, {500, "Hazardous"},
	} {
		if got := aqiCategory(tc.value); got != tc.want {
			t.Errorf("aqiCategory(%d) = %q, want %q", tc.value, got, tc.want)
		}
	}
}

/* ──── Time-alignment helpers (DAN-32) ──── */

func TestNearestTimeIndex(t *testing.T) {
	times := []string{"2026-09-14T10:00", "2026-09-14T11:00", "2026-09-14T12:00"}
	target := time.Date(2026, 9, 14, 11, 10, 0, 0, time.UTC)
	if idx := nearestTimeIndex(times, target, 90*time.Minute); idx != 1 {
		t.Errorf("nearestTimeIndex = %d, want 1", idx)
	}
	// Nothing within tolerance.
	far := time.Date(2026, 9, 15, 11, 0, 0, 0, time.UTC)
	if idx := nearestTimeIndex(times, far, 90*time.Minute); idx != -1 {
		t.Errorf("nearestTimeIndex(far) = %d, want -1", idx)
	}
	if idx := nearestTimeIndex(nil, target, time.Hour); idx != -1 {
		t.Errorf("nearestTimeIndex(empty) = %d, want -1", idx)
	}
}

func TestPressureTrend(t *testing.T) {
	hourlyTimes := []string{"2026-09-14T08:00", "2026-09-14T09:00", "2026-09-14T10:00", "2026-09-14T11:00"}
	now := time.Date(2026, 9, 14, 11, 0, 0, 0, time.UTC)

	rising := pressureTrend(hourlyTimes, []float64{1010, 1011, 1012, 1013}, now, 1012.0)
	if rising == nil || *rising != "rising" {
		t.Errorf("pressureTrend rising = %v", rising)
	}

	falling := pressureTrend(hourlyTimes, []float64{1016, 1014, 1012, 1010}, now, 1010.0)
	if falling == nil || *falling != "falling" {
		t.Errorf("pressureTrend falling = %v", falling)
	}

	steady := pressureTrend(hourlyTimes, []float64{1013, 1013, 1013, 1013}, now, 1013.0)
	if steady == nil || *steady != "steady" {
		t.Errorf("pressureTrend steady = %v", steady)
	}

	if got := pressureTrend(hourlyTimes, []float64{1013, 1013}, now, 1013.0); got != nil {
		t.Errorf("pressureTrend with mismatched slice lengths = %v, want nil", got)
	}
	if got := pressureTrend(hourlyTimes, []float64{1010, 1011, 1012, 1013}, time.Time{}, 1013.0); got != nil {
		t.Errorf("pressureTrend with zero now = %v, want nil", got)
	}
}

func TestRainNextHourPctPrefersMinutely15(t *testing.T) {
	now := time.Date(2026, 9, 14, 14, 0, 0, 0, time.UTC)
	m15Times := []string{"2026-09-14T14:00", "2026-09-14T14:15", "2026-09-14T14:30", "2026-09-14T14:45"}
	m15Prob := []float64{10, 40, 20, 15}
	hourlyTimes := []string{"2026-09-14T14:00", "2026-09-14T15:00"}
	hourlyProb := []float64{5, 90}

	got := rainNextHourPct(now, m15Times, m15Prob, hourlyTimes, hourlyProb)
	if got == nil || *got != 40 {
		t.Errorf("rainNextHourPct = %v, want 40 (max of minutely window)", got)
	}
}

func TestRainNextHourPctFallsBackToHourly(t *testing.T) {
	now := time.Date(2026, 9, 14, 14, 0, 0, 0, time.UTC)
	hourlyTimes := []string{"2026-09-14T14:00", "2026-09-14T15:00"}
	hourlyProb := []float64{5, 65}

	got := rainNextHourPct(now, nil, nil, hourlyTimes, hourlyProb)
	if got == nil || *got != 65 {
		t.Errorf("rainNextHourPct fallback = %v, want 65", got)
	}
}

func TestRainNextHourPctNilWithoutNow(t *testing.T) {
	if got := rainNextHourPct(time.Time{}, nil, nil, nil, nil); got != nil {
		t.Errorf("rainNextHourPct with zero now = %v, want nil", got)
	}
}
