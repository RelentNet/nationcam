package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// weatherTTL is how long one location's conditions are served from Redis.
// Open-Meteo refreshes hourly-ish, so 10 minutes is plenty fresh and keeps a
// busy camera page from hammering their API.
const weatherTTL = 10 * time.Minute

// The live view must never wait on a third party for long, but the forecast
// request grew heavy in DAN-32 (current + hourly + daily + 15-minutely blocks)
// and Open-Meteo answers it in 1–8 s from the production host. At 5 s the
// inland locations timed out intermittently and their whole panel vanished
// (2026-09-27). 12 s plus one retry (fetchJSON) plus the stale fallback in
// GetWeather keeps the panel populated through a slow upstream.
var weatherClient = &http.Client{Timeout: 12 * time.Second}

// staleWeatherTTL is how long the last successful reading for a location is
// kept as a fallback. Six hours of slightly old weather beats an empty panel.
const staleWeatherTTL = 6 * time.Hour

type marineBlock struct {
	WaveFt  float64 `json:"wave_ft"`
	PeriodS float64 `json:"period_s"`
	WaterF  float64 `json:"water_f"`
}

// heatStressBlock is a WBGT-style flag-condition estimate — see heatStress.
type heatStressBlock struct {
	Level string `json:"level"`
	Label string `json:"label"`
}

// stormPotentialBlock is a coarse near-term thunderstorm-risk read — see
// stormPotential.
type stormPotentialBlock struct {
	Level string `json:"level"`
}

// aqiBlock is the US AQI reading from Open-Meteo's Air Quality API, with the
// EPA category name attached so the frontend never has to re-derive it.
type aqiBlock struct {
	Value    int    `json:"value"`
	Category string `json:"category"`
}

// weatherResponse is the flat "Right now" payload the sublocation and camera
// pages render. Marine is nil when the marine API had nothing for these
// coordinates (inland) or failed — the row is simply omitted on the page.
//
// The outdoor-activity fields (DAN-32) are all best-effort: each is nil
// when Open-Meteo didn't offer that field for this forecast model/region, or
// when its upstream call failed. None of them ever fail the response.
type weatherResponse struct {
	TempF        float64      `json:"temp_f"`
	FeelsF       float64      `json:"feels_f"`
	Humidity     float64      `json:"humidity"`
	WeatherCode  int          `json:"weather_code"`
	Condition    string       `json:"condition"`
	WindMph      float64      `json:"wind_mph"`
	WindDirDeg   float64      `json:"wind_dir_deg"`
	WindDir      string       `json:"wind_dir"`
	GustMph      float64      `json:"gust_mph"`
	HighF        float64      `json:"high_f"`
	RainPct      float64      `json:"rain_pct"`
	Sunrise      string       `json:"sunrise"`
	Sunset       string       `json:"sunset"`
	Timezone     string       `json:"timezone"`
	TimezoneAbbr string       `json:"timezone_abbr"`
	Marine       *marineBlock `json:"marine"`
	FetchedAt    string       `json:"fetched_at"`

	DewPointF        *float64             `json:"dew_point_f,omitempty"`
	UvIndex          *float64             `json:"uv_index,omitempty"`
	UvIndexMax       *float64             `json:"uv_index_max,omitempty"`
	WetBulbF         *float64             `json:"wet_bulb_f,omitempty"`
	HeatStress       *heatStressBlock     `json:"heat_stress,omitempty"`
	CloudCoverPct    *float64             `json:"cloud_cover_pct,omitempty"`
	VisibilityMi     *float64             `json:"visibility_mi,omitempty"`
	PressureInHg     *float64             `json:"pressure_inhg,omitempty"`
	PressureTrend    *string              `json:"pressure_trend,omitempty"`
	PrecipLastHourIn *float64             `json:"precip_last_hour_in,omitempty"`
	RainNextHourPct  *float64             `json:"rain_next_hour_pct,omitempty"`
	StormPotential   *stormPotentialBlock `json:"storm_potential,omitempty"`
	UsAqi            *aqiBlock            `json:"us_aqi,omitempty"`
}

// Open-Meteo response shapes — only the fields we ask for. Pointers mark
// fields the model may omit entirely (not just zero); a missing pointer
// means "Open-Meteo didn't offer this", not "the reading was 0".
type forecastResponse struct {
	Timezone     string `json:"timezone"`
	TimezoneAbbr string `json:"timezone_abbreviation"`
	Current      struct {
		Time          string   `json:"time"`
		Temp          float64  `json:"temperature_2m"`
		Humidity      float64  `json:"relative_humidity_2m"`
		Feels         float64  `json:"apparent_temperature"`
		Code          int      `json:"weather_code"`
		Wind          float64  `json:"wind_speed_10m"`
		WindDir       float64  `json:"wind_direction_10m"`
		Gust          float64  `json:"wind_gusts_10m"`
		DewPoint      *float64 `json:"dew_point_2m"`
		CloudCover    *float64 `json:"cloud_cover"`
		VisibilityM   *float64 `json:"visibility"`
		PressureMsl   *float64 `json:"pressure_msl"`
		Precipitation *float64 `json:"precipitation"`
		WetBulb       *float64 `json:"wet_bulb_temperature_2m"`
		UvIndex       *float64 `json:"uv_index"`
		Cape          *float64 `json:"cape"`
	} `json:"current"`
	Hourly struct {
		Time                     []string  `json:"time"`
		PressureMsl              []float64 `json:"pressure_msl"`
		PrecipitationProbability []float64 `json:"precipitation_probability"`
		UvIndex                  []float64 `json:"uv_index"`
	} `json:"hourly"`
	Daily struct {
		Sunrise    []string  `json:"sunrise"`
		Sunset     []string  `json:"sunset"`
		High       []float64 `json:"temperature_2m_max"`
		Rain       []float64 `json:"precipitation_probability_max"`
		UvIndexMax []float64 `json:"uv_index_max"`
	} `json:"daily"`
	Minutely15 struct {
		Time                     []string  `json:"time"`
		PrecipitationProbability []float64 `json:"precipitation_probability"`
		Cape                     []float64 `json:"cape"`
		LightningPotential       []float64 `json:"lightning_potential"`
	} `json:"minutely_15"`
}

type marineResponse struct {
	Current struct {
		WaveHeight *float64 `json:"wave_height"`
		WavePeriod *float64 `json:"wave_period"`
		WaterTemp  *float64 `json:"sea_surface_temperature"`
	} `json:"current"`
}

// airQualityResponse is Open-Meteo's Air Quality API shape — only the one
// field we ask for.
type airQualityResponse struct {
	Current struct {
		UsAqi *float64 `json:"us_aqi"`
	} `json:"current"`
}

// wmoCondition maps a WMO weather interpretation code to a short label.
func wmoCondition(code int) string {
	switch {
	case code == 0:
		return "Clear"
	case code == 1:
		return "Mainly clear"
	case code == 2:
		return "Partly cloudy"
	case code == 3:
		return "Overcast"
	case code == 45 || code == 48:
		return "Fog"
	case code >= 51 && code <= 57:
		return "Drizzle"
	case code >= 61 && code <= 67:
		return "Rain"
	case code >= 71 && code <= 77:
		return "Snow"
	case code >= 80 && code <= 82:
		return "Showers"
	case code >= 95 && code <= 99:
		return "Thunderstorm"
	}
	return "Unknown"
}

var compassPoints = [16]string{"N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"}

// compass turns a bearing in degrees into a 16-point compass label.
func compass(deg float64) string {
	i := int((deg/22.5)+0.5) % 16
	if i < 0 {
		i += 16
	}
	return compassPoints[i]
}

// clockTime reformats an Open-Meteo local ISO timestamp ("2026-09-14T06:41")
// as "6:41 AM". Unparseable input is passed through untouched.
func clockTime(iso string) string {
	t, err := time.Parse("2006-01-02T15:04", iso)
	if err != nil {
		return iso
	}
	return t.Format("3:04 PM")
}

// parseOpenMeteoTime parses an Open-Meteo local ISO timestamp
// ("2026-09-14T06:41"). ok is false for empty/unparseable input.
func parseOpenMeteoTime(iso string) (t time.Time, ok bool) {
	if iso == "" {
		return time.Time{}, false
	}
	t, err := time.Parse("2006-01-02T15:04", iso)
	return t, err == nil
}

// nearestTimeIndex returns the index into times whose parsed timestamp is
// closest to target, or -1 if times is empty or every entry is unparseable
// or further than tolerance away. Used to line up hourly/minutely arrays
// against "now" or "now ± offset" without assuming a fixed array alignment.
func nearestTimeIndex(times []string, target time.Time, tolerance time.Duration) int {
	best := -1
	var bestDiff time.Duration
	for i, iso := range times {
		t, ok := parseOpenMeteoTime(iso)
		if !ok {
			continue
		}
		diff := t.Sub(target)
		if diff < 0 {
			diff = -diff
		}
		if best == -1 || diff < bestDiff {
			best, bestDiff = i, diff
		}
	}
	if best == -1 || bestDiff > tolerance {
		return -1
	}
	return best
}

// maxInWindow returns the largest value in values whose matching time in
// times falls within [start, end], or nil if none do. Used for "any rain in
// the next hour" / "any lightning potential in the next hour" reads from the
// 15-minutely forecast, which reports several points across that hour.
func maxInWindow(times []string, values []float64, start, end time.Time) *float64 {
	if len(times) == 0 || len(times) != len(values) {
		return nil
	}
	var max float64
	found := false
	for i, iso := range times {
		t, ok := parseOpenMeteoTime(iso)
		if !ok || t.Before(start) || t.After(end) {
			continue
		}
		if !found || values[i] > max {
			max, found = values[i], true
		}
	}
	if !found {
		return nil
	}
	return &max
}

const hPaPerInHg = 33.8639

// hPaToInHg converts a barometric pressure from hectopascals (Open-Meteo's
// pressure_msl unit) to inches of mercury.
func hPaToInHg(hpa float64) float64 {
	return hpa / hPaPerInHg
}

const metersPerMile = 1609.344

// metersToMiles converts Open-Meteo's visibility reading (always meters,
// regardless of the other unit params) to miles.
func metersToMiles(m float64) float64 {
	return m / metersPerMile
}

// pressureTrendThresholdInHg is the minimum 3-hour inHg swing to call the
// trend "rising"/"falling" instead of "steady" — small enough to catch a
// real frontal push, large enough to ignore normal sensor jitter.
const pressureTrendThresholdInHg = 0.03

// pressureTrend compares the current pressure to the hourly reading closest
// to 3 hours ago. nil when there's no "now" timestamp or no hourly reading
// close enough to that target to trust.
func pressureTrend(hourlyTimes []string, hourlyPressureHpa []float64, now time.Time, currentHpa float64) *string {
	if now.IsZero() || len(hourlyTimes) != len(hourlyPressureHpa) {
		return nil
	}
	idx := nearestTimeIndex(hourlyTimes, now.Add(-3*time.Hour), 90*time.Minute)
	if idx == -1 {
		return nil
	}
	delta := hPaToInHg(currentHpa) - hPaToInHg(hourlyPressureHpa[idx])
	trend := "steady"
	switch {
	case delta >= pressureTrendThresholdInHg:
		trend = "rising"
	case delta <= -pressureTrendThresholdInHg:
		trend = "falling"
	}
	return &trend
}

// rainNextHourPct is the highest precipitation-probability reading in the 60
// minutes after now: the 15-minutely forecast where Open-Meteo offers it
// (mainly North America/Europe), else the single nearest hourly value to
// now+1h. nil when neither source has anything usable.
func rainNextHourPct(now time.Time, m15Times []string, m15Prob []float64, hourlyTimes []string, hourlyProb []float64) *float64 {
	if now.IsZero() {
		return nil
	}
	if v := maxInWindow(m15Times, m15Prob, now, now.Add(time.Hour)); v != nil {
		return v
	}
	idx := nearestTimeIndex(hourlyTimes, now.Add(time.Hour), 90*time.Minute)
	if idx == -1 || idx >= len(hourlyProb) {
		return nil
	}
	v := hourlyProb[idx]
	return &v
}

// heatStressLabels are the fixed labels for each band — every one calls out
// "(estimate)" since this is a forecast-derived read, not a measured WBGT
// (that needs a globe thermometer for radiant heat, which no weather API
// provides).
var heatStressLabels = map[string]string{
	"low":      "Low heat stress (estimate)",
	"moderate": "Moderate heat stress (estimate)",
	"high":     "High heat stress (estimate)",
	"extreme":  "Extreme heat stress (estimate)",
}

// heatStress estimates a standard WBGT flag-condition band from wet-bulb
// temperature (°F) when the forecast offers it, else from apparent ("feels
// like") temperature as a rougher stand-in for the same bands:
//
//	low      < 80°F
//	moderate 80–84.9°F
//	high     85–87.9°F
//	extreme  >= 88°F
func heatStress(wetBulbF *float64, feelsF float64) *heatStressBlock {
	val := feelsF
	if wetBulbF != nil {
		val = *wetBulbF
	}
	level := "low"
	switch {
	case val >= 88:
		level = "extreme"
	case val >= 85:
		level = "high"
	case val >= 80:
		level = "moderate"
	}
	return &heatStressBlock{Level: level, Label: heatStressLabels[level]}
}

// stormPotential estimates near-term thunderstorm risk from CAPE (current
// convective available potential energy, J/kg) and, where the 15-minutely
// forecast offers it, lightning potential over the next hour:
//
//	low      CAPE < 500 J/kg
//	moderate CAPE 500–1500 J/kg, or any lightning potential > 0
//	high     CAPE > 1500 J/kg
//
// CAPE is required to classify at all — lightning potential alone can't
// distinguish low from moderate, so a nil CAPE reading returns nil rather
// than guessing. This is a forecast-model read, not real strike detection;
// callers must never word it as live lightning detection.
func stormPotential(capeJPerKg *float64, lightningPotentialNextHour *float64) *stormPotentialBlock {
	if capeJPerKg == nil {
		return nil
	}
	level := "low"
	switch {
	case *capeJPerKg > 1500:
		level = "high"
	case *capeJPerKg >= 500:
		level = "moderate"
	}
	if level == "low" && lightningPotentialNextHour != nil && *lightningPotentialNextHour > 0 {
		level = "moderate"
	}
	return &stormPotentialBlock{Level: level}
}

// aqiCategory maps a US AQI value to its standard EPA category name.
func aqiCategory(value int) string {
	switch {
	case value <= 50:
		return "Good"
	case value <= 100:
		return "Moderate"
	case value <= 150:
		return "Unhealthy for Sensitive Groups"
	case value <= 200:
		return "Unhealthy"
	case value <= 300:
		return "Very Unhealthy"
	default:
		return "Hazardous"
	}
}

// fetchJSON GETs a JSON document with one retry on transport errors, timeouts
// and 5xx/429 answers (the upstream weather services all hiccup occasionally).
// 4xx other than 429 and JSON decode errors are not retried: they would fail
// the same way again.
func fetchJSON(ctx context.Context, rawURL string, out any) error {
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return lastErr
			case <-time.After(500 * time.Millisecond):
			}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
		if err != nil {
			return err
		}
		res, err := weatherClient.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		if res.StatusCode != http.StatusOK {
			res.Body.Close()
			lastErr = fmt.Errorf("%s: status %d", rawURL, res.StatusCode)
			if res.StatusCode >= 500 || res.StatusCode == http.StatusTooManyRequests {
				continue
			}
			return lastErr
		}
		err = json.NewDecoder(res.Body).Decode(out)
		res.Body.Close()
		return err
	}
	return lastErr
}

// fetchAirQuality is the one extra upstream call DAN-32 adds: Open-Meteo's
// Air Quality API, asked for just the US AQI composite. Best-effort — a
// failure here must never take down the rest of the weather response.
func fetchAirQuality(ctx context.Context, lat, lng float64) (*aqiBlock, error) {
	q := url.Values{
		"latitude":  {fmt.Sprintf("%.4f", lat)},
		"longitude": {fmt.Sprintf("%.4f", lng)},
		"current":   {"us_aqi"},
	}
	var resp airQualityResponse
	if err := fetchJSON(ctx, "https://air-quality-api.open-meteo.com/v1/air-quality?"+q.Encode(), &resp); err != nil {
		return nil, err
	}
	if resp.Current.UsAqi == nil {
		return nil, fmt.Errorf("air quality: no us_aqi in response")
	}
	value := int(math.Round(*resp.Current.UsAqi))
	return &aqiBlock{Value: value, Category: aqiCategory(value)}, nil
}

func fetchWeather(ctx context.Context, lat, lng float64) (*weatherResponse, error) {
	coords := url.Values{
		"latitude":  {fmt.Sprintf("%.4f", lat)},
		"longitude": {fmt.Sprintf("%.4f", lng)},
		"timezone":  {"auto"},
	}

	fq := url.Values{}
	for k, v := range coords {
		fq[k] = v
	}
	fq.Set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,dew_point_2m,cloud_cover,visibility,pressure_msl,precipitation,wet_bulb_temperature_2m,uv_index,cape")
	fq.Set("hourly", "pressure_msl,precipitation_probability,uv_index")
	fq.Set("daily", "sunrise,sunset,temperature_2m_max,precipitation_probability_max,uv_index_max")
	fq.Set("minutely_15", "precipitation_probability,cape,lightning_potential")
	fq.Set("temperature_unit", "fahrenheit")
	fq.Set("wind_speed_unit", "mph")
	fq.Set("precipitation_unit", "inch")
	// Two days plus a few hours of look-back so "3 hours ago" and "next
	// hour" both resolve even right after local midnight.
	fq.Set("forecast_days", "2")
	fq.Set("past_hours", "3")
	var f forecastResponse
	if err := fetchJSON(ctx, "https://api.open-meteo.com/v1/forecast?"+fq.Encode(), &f); err != nil {
		return nil, err
	}

	out := &weatherResponse{
		TempF:        f.Current.Temp,
		FeelsF:       f.Current.Feels,
		Humidity:     f.Current.Humidity,
		WeatherCode:  f.Current.Code,
		Condition:    wmoCondition(f.Current.Code),
		WindMph:      f.Current.Wind,
		WindDirDeg:   f.Current.WindDir,
		WindDir:      compass(f.Current.WindDir),
		GustMph:      f.Current.Gust,
		Timezone:     f.Timezone,
		TimezoneAbbr: f.TimezoneAbbr,
		FetchedAt:    time.Now().UTC().Format(time.RFC3339),
	}
	if len(f.Daily.Sunrise) > 0 {
		out.Sunrise = clockTime(f.Daily.Sunrise[0])
	}
	if len(f.Daily.Sunset) > 0 {
		out.Sunset = clockTime(f.Daily.Sunset[0])
	}
	if len(f.Daily.High) > 0 {
		out.HighF = f.Daily.High[0]
	}
	if len(f.Daily.Rain) > 0 {
		out.RainPct = f.Daily.Rain[0]
	}

	// Outdoor-activity stats (DAN-32) — every field below is best-effort;
	// see weatherResponse's doc comment.
	now, _ := parseOpenMeteoTime(f.Current.Time)

	out.DewPointF = f.Current.DewPoint

	uvNow := f.Current.UvIndex
	if uvNow == nil && !now.IsZero() {
		if idx := nearestTimeIndex(f.Hourly.Time, now, 45*time.Minute); idx != -1 && idx < len(f.Hourly.UvIndex) {
			v := f.Hourly.UvIndex[idx]
			uvNow = &v
		}
	}
	out.UvIndex = uvNow
	if len(f.Daily.UvIndexMax) > 0 {
		v := f.Daily.UvIndexMax[0]
		out.UvIndexMax = &v
	}

	out.WetBulbF = f.Current.WetBulb
	out.HeatStress = heatStress(f.Current.WetBulb, f.Current.Feels)

	out.CloudCoverPct = f.Current.CloudCover

	if f.Current.VisibilityM != nil {
		mi := metersToMiles(*f.Current.VisibilityM)
		out.VisibilityMi = &mi
	}

	if f.Current.PressureMsl != nil {
		inHg := hPaToInHg(*f.Current.PressureMsl)
		out.PressureInHg = &inHg
		out.PressureTrend = pressureTrend(f.Hourly.Time, f.Hourly.PressureMsl, now, *f.Current.PressureMsl)
	}

	out.PrecipLastHourIn = f.Current.Precipitation

	out.RainNextHourPct = rainNextHourPct(now, f.Minutely15.Time, f.Minutely15.PrecipitationProbability, f.Hourly.Time, f.Hourly.PrecipitationProbability)

	var lightningNextHour *float64
	if !now.IsZero() {
		lightningNextHour = maxInWindow(f.Minutely15.Time, f.Minutely15.LightningPotential, now, now.Add(time.Hour))
	}
	out.StormPotential = stormPotential(f.Current.Cape, lightningNextHour)

	// Marine is best-effort: inland coordinates return nulls, and an outage
	// must not take the whole panel down with it.
	mq := url.Values{}
	for k, v := range coords {
		mq[k] = v
	}
	mq.Set("current", "wave_height,wave_period,sea_surface_temperature")
	mq.Set("length_unit", "imperial")
	mq.Set("temperature_unit", "fahrenheit")
	var m marineResponse
	if err := fetchJSON(ctx, "https://marine-api.open-meteo.com/v1/marine?"+mq.Encode(), &m); err != nil {
		slog.Warn("marine weather fetch failed", "error", err)
	} else if m.Current.WaveHeight != nil && m.Current.WavePeriod != nil && m.Current.WaterTemp != nil {
		out.Marine = &marineBlock{
			WaveFt:  *m.Current.WaveHeight,
			PeriodS: *m.Current.WavePeriod,
			WaterF:  *m.Current.WaterTemp,
		}
	}

	// Air quality is the one extra upstream call DAN-32 adds — best-effort,
	// same pattern as marine.
	if aqi, err := fetchAirQuality(ctx, lat, lng); err != nil {
		slog.Warn("air quality fetch failed", "error", err)
	} else {
		out.UsAqi = aqi
	}

	return out, nil
}

// GetWeather handles GET /sublocations/{slug}/weather — current conditions at
// the sublocation's coordinates. 404 when it has none. Cached in Redis per
// coordinate pair (2dp ≈ 1km) so nearby sublocations share one upstream call.
func GetWeather(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sub, err := db.New(pool).GetSublocationBySlug(r.Context(), chi.URLParam(r, "slug"))
		if err != nil || !sub.Lat.Valid || !sub.Lng.Valid {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no coordinates for this sublocation"})
			return
		}

		key := fmt.Sprintf("weather:%.2f:%.2f", sub.Lat.Float64, sub.Lng.Float64)
		if cached, err := c.Get(r.Context(), key); err == nil && cached != "" {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Cache", "HIT")
			_, _ = w.Write([]byte(cached))
			return
		}

		staleKey := "stale:" + key
		wx, err := fetchWeather(r.Context(), sub.Lat.Float64, sub.Lng.Float64)
		if err != nil {
			slog.Warn("weather fetch failed", "slug", sub.Slug, "error", err)
			// Serve the last good reading rather than blanking the panel; its
			// fetched_at tells the client how old it is.
			if stale, serr := c.Get(r.Context(), staleKey); serr == nil && stale != "" {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("X-Cache", "STALE")
				_, _ = w.Write([]byte(stale))
				return
			}
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "weather unavailable"})
			return
		}
		body, _ := json.Marshal(wx)
		_ = c.Set(r.Context(), key, string(body), weatherTTL)
		_ = c.Set(r.Context(), staleKey, string(body), staleWeatherTTL)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}
}
