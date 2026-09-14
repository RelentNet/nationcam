package handler

import "testing"

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
