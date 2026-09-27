// Package lightning turns NOAA's GOES-East Geostationary Lightning Mapper
// (GLM) feed into a per-sublocation "is there lightning near here right now"
// status.
//
// Source: GLM Level-2 "LCFA" files on NOAA Open Data — public S3, no
// credentials — one 20-second NetCDF4 file every 20 seconds, appearing ~20 s
// after its window ends. A Job lists the current UTC hour prefix every minute,
// fetches whatever is new, parses the flash centroids (Reader) and keeps the
// last hour of flashes near any sublocation with coordinates in memory
// (Store), mirrored to Redis so a restart does not blank the status. The
// handler evaluates a fixed policy (Evaluate) against that buffer per request.
//
// GLM detects total lightning (in-cloud + cloud-to-ground) from orbit at
// ~8–14 km resolution. It is informational only — never a certified safety
// system, never ground-based detection — and every surface that shows it must
// say so.
package lightning

import (
	"math"
	"time"
)

// Source is the provenance string every status response carries.
const Source = "GOES-19 GLM"

// Policy constants — the single place the alert/caution/clear rule lives.
// The handler, the store's retention and the UI copy all derive from these.
const (
	// AlertRadiusMi: any flash this close within Window is an alert.
	AlertRadiusMi = 10.0
	// CautionRadiusMi: any flash this close within Window (but none within
	// AlertRadiusMi) is a caution.
	CautionRadiusMi = 30.0
	// Window is how far back a flash still counts toward the status.
	Window = 30 * time.Minute
	// AllClearAfter is how long after the last alert-radius flash the status
	// returns to non-alert; it equals Window so "all clear" is exactly when
	// that flash ages out.
	AllClearAfter = Window

	// StaleAfter: when the newest successful fetch is older than this, the
	// status endpoint answers 503 rather than serving a possibly stale "clear".
	StaleAfter = 5 * time.Minute

	// KeepRadiusKm bounds which flashes enter the store: only those within
	// this distance of at least one sublocation with coordinates. Well beyond
	// CautionRadiusMi (~48 km) so the policy radii can grow without a refill.
	KeepRadiusKm = 100.0
	// Retention is how long a flash stays in the store.
	Retention = 60 * time.Minute
)

const kmPerMile = 1.609344

// Flash is one GLM flash centroid. JSON tags are short because the store
// mirrors thousands of these to Redis every minute.
type Flash struct {
	Lat  float64   `json:"lat"`
	Lon  float64   `json:"lon"`
	Time time.Time `json:"t"`
}

// Site is a sublocation with coordinates — the only thing the store needs to
// know about it.
type Site struct {
	Slug string
	Lat  float64
	Lon  float64
}

// DistanceKm is the great-circle (haversine) distance between two
// coordinates, in kilometers.
func DistanceKm(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusKm = 6371.0
	rad := math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLon := (lon2 - lon1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return earthRadiusKm * 2 * math.Asin(math.Sqrt(a))
}

// DistanceMi is DistanceKm in statute miles.
func DistanceMi(lat1, lon1, lat2, lon2 float64) float64 {
	return KmToMi(DistanceKm(lat1, lon1, lat2, lon2))
}

// KmToMi converts kilometers to statute miles.
func KmToMi(km float64) float64 { return km / kmPerMile }

// MiToKm converts statute miles to kilometers.
func MiToKm(mi float64) float64 { return mi * kmPerMile }

// Status levels.
const (
	StatusClear   = "clear"
	StatusCaution = "caution"
	StatusAlert   = "alert"
)

// Status is the evaluated policy for one point at one instant.
type Status struct {
	// Status is StatusClear, StatusCaution or StatusAlert.
	Status string
	// NearestMi is the distance of the closest flash within CautionRadiusMi
	// in the last Window; nil when there was none.
	NearestMi *float64
	// LastStrikeAt is the time of the most recent flash within CautionRadiusMi
	// in the last Window; nil when there was none.
	LastStrikeAt *time.Time
	// Strikes10mi30min / Strikes30mi30min count flashes within AlertRadiusMi /
	// CautionRadiusMi over the last Window.
	Strikes10mi30min int
	Strikes30mi30min int
	// AllClearAt is the most recent alert-radius flash plus AllClearAfter —
	// the instant the status stops being an alert if no more flashes land.
	// nil unless Status is StatusAlert.
	AllClearAt *time.Time
}

// Evaluate applies the policy to flashes for a point at `now`.
//
// A flash counts when its age is strictly less than Window (a flash exactly
// Window old has just aged out, which is what makes AllClearAt exact) and it
// is at most the radius away (inclusive).
func Evaluate(flashes []Flash, lat, lon float64, now time.Time) Status {
	cutoff := now.Add(-Window)
	s := Status{Status: StatusClear}

	nearest := math.Inf(1)
	var latest, latestAlert time.Time
	for _, f := range flashes {
		if !f.Time.After(cutoff) {
			continue
		}
		mi := DistanceMi(lat, lon, f.Lat, f.Lon)
		if mi > CautionRadiusMi {
			continue
		}
		s.Strikes30mi30min++
		if mi < nearest {
			nearest = mi
		}
		if f.Time.After(latest) {
			latest = f.Time
		}
		if mi <= AlertRadiusMi {
			s.Strikes10mi30min++
			if f.Time.After(latestAlert) {
				latestAlert = f.Time
			}
		}
	}
	if s.Strikes30mi30min == 0 {
		return s
	}
	s.NearestMi = &nearest
	s.LastStrikeAt = &latest
	if s.Strikes10mi30min > 0 {
		s.Status = StatusAlert
		allClear := latestAlert.Add(AllClearAfter)
		s.AllClearAt = &allClear
	} else {
		s.Status = StatusCaution
	}
	return s
}
