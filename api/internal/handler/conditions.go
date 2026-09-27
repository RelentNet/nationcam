package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"sort"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// conditionsTTL is how long the full /conditions payload is served from
// Redis. Forecasts, tides and river stage all move slowly enough that a
// half hour keeps the page fresh without hammering three upstream APIs.
const conditionsTTL = 30 * time.Minute

// stationCacheTTL is how long a sublocation's *nearest* tide station / river
// site is remembered. The metadata endpoints that find them (a full NOAA
// station list, a USGS bounding-box scan) are heavy and never change day to
// day, so they are looked up once per day per sublocation; only the actual
// readings are re-fetched on every conditionsTTL cache miss.
const stationCacheTTL = 24 * time.Hour

const (
	tideStationRadiusKm = 50.0
	riverSiteRadiusKm   = 25.0
)

// The conditions page must never hang waiting on a third party.
var conditionsClient = &http.Client{Timeout: 6 * time.Second}

/* ──── Response shapes ──── */

type forecastDay struct {
	Date         string  `json:"date"`
	HighF        float64 `json:"high_f"`
	LowF         float64 `json:"low_f"`
	PrecipChance float64 `json:"precip_chance"`
	WindMaxMph   float64 `json:"wind_max_mph"`
	Sunrise      string  `json:"sunrise"`
	Sunset       string  `json:"sunset"`
}

type tidePrediction struct {
	Time     string  `json:"time"`
	HeightFt float64 `json:"height_ft"`
	Type     string  `json:"type"` // "high" | "low"
}

type tideBlock struct {
	StationName string           `json:"station_name"`
	Predictions []tidePrediction `json:"predictions"`
	// Source is "override" when noaa_station_id pinned this station, or
	// "nearest" when it was picked by distance.
	Source string `json:"source"`
}

type riverBlock struct {
	SiteName   string  `json:"site_name"`
	StageFt    float64 `json:"stage_ft"`
	ObservedAt string  `json:"observed_at"`
	// Source is "override" when usgs_site_id pinned this site, or "nearest"
	// when it was picked by distance.
	Source string `json:"source"`
}

type conditionsResponse struct {
	Forecast []forecastDay `json:"forecast"`
	Tides    *tideBlock    `json:"tides"`
	River    *riverBlock   `json:"river"`
}

/* ──── Distance ──── */

// haversineKm returns the great-circle distance between two coordinates, in
// kilometers.
func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const earthRadiusKm = 6371.0
	rad := math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLng := (lng2 - lng1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return earthRadiusKm * 2 * math.Asin(math.Sqrt(a))
}

// bboxAround returns a (west, south, east, north) bounding box roughly
// radiusKm around a coordinate — enough to ask USGS for "sites near here".
func bboxAround(lat, lng, radiusKm float64) (west, south, east, north float64) {
	latDelta := radiusKm / 111.0
	lngDelta := radiusKm / (111.320 * math.Cos(lat*math.Pi/180))
	return lng - lngDelta, lat - latDelta, lng + lngDelta, lat + latDelta
}

/* ──── Forecast (Open-Meteo) ──── */

type openMeteoDailyResponse struct {
	Daily struct {
		Time    []string  `json:"time"`
		High    []float64 `json:"temperature_2m_max"`
		Low     []float64 `json:"temperature_2m_min"`
		Rain    []float64 `json:"precipitation_probability_max"`
		WindMax []float64 `json:"wind_speed_10m_max"`
		Sunrise []string  `json:"sunrise"`
		Sunset  []string  `json:"sunset"`
	} `json:"daily"`
}

// fetchForecast asks Open-Meteo for the next 3 days of daily fields, same
// base endpoint as weather.go, imperial units, timezone auto-detected from
// the coordinates.
func fetchForecast(ctx context.Context, lat, lng float64) ([]forecastDay, error) {
	q := url.Values{
		"latitude":         {fmt.Sprintf("%.4f", lat)},
		"longitude":        {fmt.Sprintf("%.4f", lng)},
		"timezone":         {"auto"},
		"temperature_unit": {"fahrenheit"},
		"wind_speed_unit":  {"mph"},
		"forecast_days":    {"3"},
		"daily":            {"temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset"},
	}
	var f openMeteoDailyResponse
	if err := fetchJSON(ctx, "https://api.open-meteo.com/v1/forecast?"+q.Encode(), &f); err != nil {
		return nil, err
	}

	days := make([]forecastDay, 0, len(f.Daily.Time))
	for i, date := range f.Daily.Time {
		day := forecastDay{Date: date}
		if i < len(f.Daily.High) {
			day.HighF = f.Daily.High[i]
		}
		if i < len(f.Daily.Low) {
			day.LowF = f.Daily.Low[i]
		}
		if i < len(f.Daily.Rain) {
			day.PrecipChance = f.Daily.Rain[i]
		}
		if i < len(f.Daily.WindMax) {
			day.WindMaxMph = f.Daily.WindMax[i]
		}
		if i < len(f.Daily.Sunrise) {
			day.Sunrise = clockTime(f.Daily.Sunrise[i])
		}
		if i < len(f.Daily.Sunset) {
			day.Sunset = clockTime(f.Daily.Sunset[i])
		}
		days = append(days, day)
	}
	return days, nil
}

/* ──── Tides (NOAA CO-OPS) ──── */

type tideStation struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Lat  float64 `json:"lat"`
	Lng  float64 `json:"lng"`
}

type noaaStationsResponse struct {
	Stations []tideStation `json:"stations"`
}

// nearestTideStation picks the closest station to (lat, lng) within maxKm.
// Pure and deterministic so it can be unit tested against fixture JSON.
func nearestTideStation(stations []tideStation, lat, lng, maxKm float64) (tideStation, bool) {
	var best tideStation
	bestKm := math.Inf(1)
	for _, s := range stations {
		d := haversineKm(lat, lng, s.Lat, s.Lng)
		if d < bestKm {
			bestKm = d
			best = s
		}
	}
	if bestKm > maxKm {
		return tideStation{}, false
	}
	return best, true
}

// cachedTideStation is what gets stored in Redis for 24h per sublocation —
// either the nearest station, or the fact that none was found, so a
// station-less sublocation is not re-scanned against the full list on
// every conditions-cache miss.
type cachedTideStation struct {
	Found   bool        `json:"found"`
	Station tideStation `json:"station"`
}

// findTideStation returns the nearest NOAA tide-prediction station within
// tideStationRadiusKm, backed by a 24h Redis cache keyed per sublocation.
func findTideStation(ctx context.Context, c *cache.Cache, slug string, lat, lng float64) (tideStation, bool) {
	key := "conditions:tide-station:" + slug
	if cached, err := c.Get(ctx, key); err == nil && cached != "" {
		var cs cachedTideStation
		if json.Unmarshal([]byte(cached), &cs) == nil {
			return cs.Station, cs.Found
		}
	}

	var resp noaaStationsResponse
	err := fetchJSON(ctx, "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions", &resp)
	var cs cachedTideStation
	if err != nil {
		slog.Warn("noaa station lookup failed", "slug", slug, "error", err)
		// Do not cache a transient failure as "no station" — try again next time.
		return tideStation{}, false
	}
	cs.Station, cs.Found = nearestTideStation(resp.Stations, lat, lng, tideStationRadiusKm)
	if body, err := json.Marshal(cs); err == nil {
		_ = c.Set(ctx, key, string(body), stationCacheTTL)
	}
	return cs.Station, cs.Found
}

// fetchTideStationMeta fetches one NOAA station's metadata (its display name,
// for the override path where the admin already picked the station and the
// nearest-lookup scan is skipped entirely). Cached 24h per station id, same
// as the nearest lookup — a station's name does not change day to day.
func fetchTideStationMeta(ctx context.Context, c *cache.Cache, id string) (tideStation, error) {
	key := "conditions:tide-station-meta:" + id
	if cached, err := c.Get(ctx, key); err == nil && cached != "" {
		var st tideStation
		if json.Unmarshal([]byte(cached), &st) == nil {
			return st, nil
		}
	}

	var resp noaaStationsResponse
	if err := fetchJSON(ctx, "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/"+id+".json", &resp); err != nil {
		return tideStation{}, err
	}
	if len(resp.Stations) == 0 {
		return tideStation{}, fmt.Errorf("no station metadata for %s", id)
	}
	st := resp.Stations[0]
	if body, err := json.Marshal(st); err == nil {
		_ = c.Set(ctx, key, string(body), stationCacheTTL)
	}
	return st, nil
}

type noaaPrediction struct {
	Time   string `json:"t"`
	Height string `json:"v"`
	Type   string `json:"type"`
}

type noaaPredictionsResponse struct {
	Predictions []noaaPrediction `json:"predictions"`
}

// fetchTides fetches the next 48h of hi/lo predictions for a station. Times
// are requested in the station's local standard/daylight time (lst_ldt),
// same as the begin/end window, which NOAA accepts as naive "yyyyMMdd HH:mm"
// timestamps (no timezone offset needed).
func fetchTides(ctx context.Context, station tideStation) (*tideBlock, error) {
	now := time.Now().UTC()
	q := url.Values{
		"station":    {station.ID},
		"product":    {"predictions"},
		"interval":   {"hilo"},
		"units":      {"english"},
		"datum":      {"MLLW"},
		"time_zone":  {"lst_ldt"},
		"format":     {"json"},
		"begin_date": {now.Format("20060102 15:04")},
		"end_date":   {now.Add(48 * time.Hour).Format("20060102 15:04")},
	}
	var resp noaaPredictionsResponse
	if err := fetchJSON(ctx, "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?"+q.Encode(), &resp); err != nil {
		return nil, err
	}

	predictions := make([]tidePrediction, 0, len(resp.Predictions))
	for _, p := range resp.Predictions {
		var height float64
		_, _ = fmt.Sscanf(p.Height, "%f", &height)
		kind := "low"
		if p.Type == "H" {
			kind = "high"
		}
		predictions = append(predictions, tidePrediction{
			Time:     p.Time,
			HeightFt: height,
			Type:     kind,
		})
	}
	return &tideBlock{StationName: station.Name, Predictions: predictions}, nil
}

/* ──── River stage (USGS Water Services) ──── */

type usgsValuePoint struct {
	Value    string `json:"value"`
	DateTime string `json:"dateTime"`
}

type usgsTimeSeries struct {
	SourceInfo struct {
		SiteName string `json:"siteName"`
		SiteCode []struct {
			Value string `json:"value"`
		} `json:"siteCode"`
		GeoLocation struct {
			GeogLocation struct {
				Latitude  float64 `json:"latitude"`
				Longitude float64 `json:"longitude"`
			} `json:"geogLocation"`
		} `json:"geoLocation"`
	} `json:"sourceInfo"`
	Values []struct {
		Value []usgsValuePoint `json:"value"`
	} `json:"values"`
}

type usgsIVResponse struct {
	Value struct {
		TimeSeries []usgsTimeSeries `json:"timeSeries"`
	} `json:"value"`
}

// riverSite is the flattened, pure-data shape nearestRiverSite works with —
// easy to build from fixture JSON in tests.
type riverSite struct {
	ID         string
	Name       string
	Lat        float64
	Lng        float64
	StageFt    float64
	ObservedAt string
}

func flattenUSGS(resp usgsIVResponse) []riverSite {
	sites := make([]riverSite, 0, len(resp.Value.TimeSeries))
	for _, ts := range resp.Value.TimeSeries {
		if len(ts.Values) == 0 || len(ts.Values[0].Value) == 0 {
			continue
		}
		latest := ts.Values[0].Value[len(ts.Values[0].Value)-1]
		var stage float64
		_, _ = fmt.Sscanf(latest.Value, "%f", &stage)
		id := ""
		if len(ts.SourceInfo.SiteCode) > 0 {
			id = ts.SourceInfo.SiteCode[0].Value
		}
		sites = append(sites, riverSite{
			ID:         id,
			Name:       ts.SourceInfo.SiteName,
			Lat:        ts.SourceInfo.GeoLocation.GeogLocation.Latitude,
			Lng:        ts.SourceInfo.GeoLocation.GeogLocation.Longitude,
			StageFt:    stage,
			ObservedAt: latest.DateTime,
		})
	}
	return sites
}

// nearestRiverSite picks the closest site to (lat, lng) within maxKm among
// sites already reporting gage height. Pure and deterministic for testing.
func nearestRiverSite(sites []riverSite, lat, lng, maxKm float64) (riverSite, bool) {
	sorted := make([]riverSite, len(sites))
	copy(sorted, sites)
	sort.Slice(sorted, func(i, j int) bool {
		return haversineKm(lat, lng, sorted[i].Lat, sorted[i].Lng) <
			haversineKm(lat, lng, sorted[j].Lat, sorted[j].Lng)
	})
	if len(sorted) == 0 {
		return riverSite{}, false
	}
	best := sorted[0]
	if haversineKm(lat, lng, best.Lat, best.Lng) > maxKm {
		return riverSite{}, false
	}
	return best, true
}

type cachedRiverSite struct {
	Found bool      `json:"found"`
	Site  riverSite `json:"site"`
}

// findRiverSite returns the nearest USGS site within riverSiteRadiusKm that
// reports gage height (parameter 00065), backed by a 24h Redis cache keyed
// per sublocation. On a cache hit it re-fetches that one site's latest
// reading directly (a much lighter call than the bounding-box scan used to
// discover it).
func findRiverSite(ctx context.Context, c *cache.Cache, slug string, lat, lng float64) (riverSite, bool) {
	key := "conditions:river-site:" + slug
	if cached, err := c.Get(ctx, key); err == nil && cached != "" {
		var cs cachedRiverSite
		if json.Unmarshal([]byte(cached), &cs) == nil {
			if !cs.Found {
				return riverSite{}, false
			}
			// Refresh the reading for a site we already know about.
			fresh, err := fetchRiverSiteByID(ctx, cs.Site.ID)
			if err != nil {
				slog.Warn("usgs site refresh failed", "slug", slug, "site", cs.Site.ID, "error", err)
				return cs.Site, true // stale but better than nothing
			}
			if fresh != nil {
				fresh.Lat, fresh.Lng = cs.Site.Lat, cs.Site.Lng
				return *fresh, true
			}
			return cs.Site, true
		}
	}

	west, south, east, north := bboxAround(lat, lng, riverSiteRadiusKm)
	q := url.Values{
		"format":      {"json"},
		"bBox":        {fmt.Sprintf("%.4f,%.4f,%.4f,%.4f", west, south, east, north)},
		"parameterCd": {"00065"},
		"siteStatus":  {"active"},
	}
	var resp usgsIVResponse
	err := fetchJSON(ctx, "https://waterservices.usgs.gov/nwis/iv/?"+q.Encode(), &resp)
	if err != nil {
		slog.Warn("usgs site lookup failed", "slug", slug, "error", err)
		return riverSite{}, false
	}

	site, found := nearestRiverSite(flattenUSGS(resp), lat, lng, riverSiteRadiusKm)
	cs := cachedRiverSite{Found: found, Site: site}
	if body, err := json.Marshal(cs); err == nil {
		_ = c.Set(ctx, key, string(body), stationCacheTTL)
	}
	return site, found
}

// fetchRiverSiteByID fetches one site's latest gage-height reading directly.
func fetchRiverSiteByID(ctx context.Context, id string) (*riverSite, error) {
	if id == "" {
		return nil, fmt.Errorf("empty site id")
	}
	q := url.Values{
		"format":      {"json"},
		"sites":       {id},
		"parameterCd": {"00065"},
		"siteStatus":  {"active"},
	}
	var resp usgsIVResponse
	if err := fetchJSON(ctx, "https://waterservices.usgs.gov/nwis/iv/?"+q.Encode(), &resp); err != nil {
		return nil, err
	}
	sites := flattenUSGS(resp)
	if len(sites) == 0 {
		return nil, fmt.Errorf("no data for site %s", id)
	}
	return &sites[0], nil
}

/* ──── Per-sublocation overrides (DAN-28) ──── */

// sourceOverride interprets a sublocation's noaa_station_id / usgs_site_id
// column, which follow the identical rule: unset or empty means "no opinion,
// fall back to the nearest lookup"; the sentinel "none" disables that source
// entirely; anything else pins the source to that id, skipping the nearest
// lookup. Pure and deterministic, so the override/none/fallback branching can
// be unit tested with no network calls.
func sourceOverride(raw pgtype.Text) (id string, disabled bool) {
	if !raw.Valid || raw.String == "" {
		return "", false
	}
	if raw.String == "none" {
		return "", true
	}
	return raw.String, false
}

// resolveTidesWith holds the override/none/fallback decision tree for tides,
// with every network-touching step injected as a closure so the branching
// itself is testable against fixtures without a live NOAA call.
func resolveTidesWith(slug string, override pgtype.Text,
	fetchMeta func() (tideStation, error),
	findNearest func() (tideStation, bool),
	fetchPredictions func(tideStation) (*tideBlock, error),
) *tideBlock {
	id, disabled := sourceOverride(override)
	if disabled {
		return nil
	}

	if id != "" {
		station, err := fetchMeta()
		if err != nil {
			slog.Warn("tide station metadata fetch failed", "slug", slug, "station", id, "error", err)
			station = tideStation{}
		}
		station.ID = id
		block, err := fetchPredictions(station)
		if err != nil {
			slog.Warn("tide predictions fetch failed", "slug", slug, "station", id, "error", err)
			return nil
		}
		block.Source = "override"
		return block
	}

	station, ok := findNearest()
	if !ok {
		return nil
	}
	block, err := fetchPredictions(station)
	if err != nil {
		slog.Warn("tide predictions fetch failed", "slug", slug, "station", station.ID, "error", err)
		return nil
	}
	block.Source = "nearest"
	return block
}

// resolveTides wires resolveTidesWith to the real NOAA calls for one request.
func resolveTides(ctx context.Context, c *cache.Cache, sub db.GetSublocationBySlugRow, lat, lng float64) *tideBlock {
	return resolveTidesWith(sub.Slug, sub.NoaaStationID,
		func() (tideStation, error) { return fetchTideStationMeta(ctx, c, sub.NoaaStationID.String) },
		func() (tideStation, bool) { return findTideStation(ctx, c, sub.Slug, lat, lng) },
		func(st tideStation) (*tideBlock, error) { return fetchTides(ctx, st) },
	)
}

// resolveRiverWith is resolveTidesWith's counterpart for river stage. The
// USGS instantaneous-values response already carries the site's name, so
// there is no separate metadata lookup like fetchTideStationMeta.
func resolveRiverWith(slug string, override pgtype.Text,
	fetchByID func(id string) (*riverSite, error),
	findNearest func() (riverSite, bool),
) *riverBlock {
	id, disabled := sourceOverride(override)
	if disabled {
		return nil
	}

	if id != "" {
		site, err := fetchByID(id)
		if err != nil {
			slog.Warn("usgs site override fetch failed", "slug", slug, "site", id, "error", err)
			return nil
		}
		return &riverBlock{SiteName: site.Name, StageFt: site.StageFt, ObservedAt: site.ObservedAt, Source: "override"}
	}

	site, ok := findNearest()
	if !ok {
		return nil
	}
	return &riverBlock{SiteName: site.Name, StageFt: site.StageFt, ObservedAt: site.ObservedAt, Source: "nearest"}
}

// resolveRiver wires resolveRiverWith to the real USGS calls for one request.
func resolveRiver(ctx context.Context, c *cache.Cache, sub db.GetSublocationBySlugRow, lat, lng float64) *riverBlock {
	return resolveRiverWith(sub.Slug, sub.UsgsSiteID,
		func(id string) (*riverSite, error) { return fetchRiverSiteByID(ctx, id) },
		func() (riverSite, bool) { return findRiverSite(ctx, c, sub.Slug, lat, lng) },
	)
}

/* ──── Handler ──── */

// GetConditions handles GET /sublocations/{slug}/conditions — a 3-day
// forecast plus, where public data exists nearby, NOAA tide predictions and
// USGS river stage. 404 without coordinates. Every upstream call is
// independent: a failure in one source only nulls that section, never the
// whole response.
func GetConditions(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub, err := db.New(pool).GetSublocationBySlug(r.Context(), chi.URLParam(r, "slug"))
		if err != nil || !sub.Lat.Valid || !sub.Lng.Valid {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no coordinates for this sublocation"})
			return
		}

		key := "conditions:" + sub.Slug
		if cached, err := c.Get(r.Context(), key); err == nil && cached != "" {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Cache", "HIT")
			_, _ = w.Write([]byte(cached))
			return
		}

		lat, lng := sub.Lat.Float64, sub.Lng.Float64
		out := conditionsResponse{Forecast: []forecastDay{}}

		forecast, err := fetchForecast(r.Context(), lat, lng)
		if err != nil {
			slog.Warn("forecast fetch failed", "slug", sub.Slug, "error", err)
		} else {
			out.Forecast = forecast
		}

		out.Tides = resolveTides(r.Context(), c, sub, lat, lng)
		out.River = resolveRiver(r.Context(), c, sub, lat, lng)

		body, _ := json.Marshal(out)
		_ = c.Set(r.Context(), key, string(body), conditionsTTL)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}
}
