package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
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

// The live view must never wait on a third party: give up on Open-Meteo fast.
var weatherClient = &http.Client{Timeout: 5 * time.Second}

type marineBlock struct {
	WaveFt  float64 `json:"wave_ft"`
	PeriodS float64 `json:"period_s"`
	WaterF  float64 `json:"water_f"`
}

// weatherResponse is the flat "Right now" payload the sublocation and camera
// pages render. Marine is nil when the marine API had nothing for these
// coordinates (inland) or failed — the row is simply omitted on the page.
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
}

// Open-Meteo response shapes — only the fields we ask for.
type forecastResponse struct {
	Timezone     string `json:"timezone"`
	TimezoneAbbr string `json:"timezone_abbreviation"`
	Current      struct {
		Temp     float64 `json:"temperature_2m"`
		Humidity float64 `json:"relative_humidity_2m"`
		Feels    float64 `json:"apparent_temperature"`
		Code     int     `json:"weather_code"`
		Wind     float64 `json:"wind_speed_10m"`
		WindDir  float64 `json:"wind_direction_10m"`
		Gust     float64 `json:"wind_gusts_10m"`
	} `json:"current"`
	Daily struct {
		Sunrise []string  `json:"sunrise"`
		Sunset  []string  `json:"sunset"`
		High    []float64 `json:"temperature_2m_max"`
		Rain    []float64 `json:"precipitation_probability_max"`
	} `json:"daily"`
}

type marineResponse struct {
	Current struct {
		WaveHeight *float64 `json:"wave_height"`
		WavePeriod *float64 `json:"wave_period"`
		WaterTemp  *float64 `json:"sea_surface_temperature"`
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

func fetchJSON(ctx context.Context, rawURL string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return err
	}
	res, err := weatherClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: status %d", rawURL, res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(out)
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
	fq.Set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m")
	fq.Set("daily", "sunrise,sunset,temperature_2m_max,precipitation_probability_max")
	fq.Set("temperature_unit", "fahrenheit")
	fq.Set("wind_speed_unit", "mph")
	fq.Set("forecast_days", "1")
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

		wx, err := fetchWeather(r.Context(), sub.Lat.Float64, sub.Lng.Float64)
		if err != nil {
			slog.Warn("weather fetch failed", "slug", sub.Slug, "error", err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "weather unavailable"})
			return
		}
		body, _ := json.Marshal(wx)
		_ = c.Set(r.Context(), key, string(body), weatherTTL)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}
}
