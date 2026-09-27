package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sort"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// alertsTTL is how long one sublocation's active-alerts list is served from
// Redis. NWS alerts change with a watch/warning issuance, not by the
// second, and this keeps a busy camera page from hammering their API — the
// same "poll politely" budget the source's terms ask for.
const alertsTTL = 5 * time.Minute

// The live page must never hang waiting on a third party.
var alertsClient = &http.Client{Timeout: 8 * time.Second}

// nwsUserAgent identifies the app to api.weather.gov, which requires a
// User-Agent carrying contact info (no key/token auth).
const nwsUserAgent = "nationcam.com (daniel.f.velez@gmail.com)"

// AlertsSite resolves a sublocation slug to its coordinates, mirroring
// lightning.go's LightningSite so the handler can be tested without a
// database. found is false when the slug is unknown or the sublocation has
// no lat/lng — both are a 404 to the caller.
type AlertsSite func(ctx context.Context, slug string) (lat, lon float64, found bool, err error)

// AlertsSiteFromDB is the production AlertsSite.
func AlertsSiteFromDB(pool *pgxpool.Pool) AlertsSite {
	return func(ctx context.Context, slug string) (float64, float64, bool, error) {
		sub, err := db.New(pool).GetSublocationBySlug(ctx, slug)
		if err != nil || !sub.Lat.Valid || !sub.Lng.Valid {
			return 0, 0, false, nil
		}
		return sub.Lat.Float64, sub.Lng.Float64, true, nil
	}
}

// nwsAlert is the wire shape of one entry in GET /sublocations/{slug}/alerts.
type nwsAlert struct {
	ID          string  `json:"id"`
	Event       string  `json:"event"`
	Severity    string  `json:"severity"`
	Urgency     string  `json:"urgency"`
	Headline    string  `json:"headline"`
	Description string  `json:"description"`
	Instruction *string `json:"instruction"`
	Onset       string  `json:"onset"`
	// Ends falls back to the feature's `expires` when NWS didn't set `ends`
	// (common for watches, which run to their expiration rather than an
	// observed end). nil when neither is present.
	Ends   *string `json:"ends"`
	Sender string  `json:"sender"`
}

type alertsResponse struct {
	Alerts []nwsAlert `json:"alerts"`
}

// alertSeverityRank orders NWS's fixed severity vocabulary from most to
// least severe, for sortAlerts. Any value outside this set (there
// shouldn't be one) sorts after "Unknown".
var alertSeverityRank = map[string]int{
	"Extreme":  0,
	"Severe":   1,
	"Moderate": 2,
	"Minor":    3,
	"Unknown":  4,
}

func severityRank(s string) int {
	if r, ok := alertSeverityRank[s]; ok {
		return r
	}
	return len(alertSeverityRank)
}

// sortAlerts orders alerts most severe first, then soonest-ending first
// within a severity tier. An alert with no known end time sorts after ones
// that do (within the same tier) — an open-ended alert is less actionable
// than one with a known deadline. Pure and deterministic for testing.
func sortAlerts(alerts []nwsAlert) {
	sort.SliceStable(alerts, func(i, j int) bool {
		si, sj := severityRank(alerts[i].Severity), severityRank(alerts[j].Severity)
		if si != sj {
			return si < sj
		}
		ei, ej := alerts[i].Ends, alerts[j].Ends
		if ei == nil {
			return false
		}
		if ej == nil {
			return true
		}
		ti, oki := parseNWSTime(*ei)
		tj, okj := parseNWSTime(*ej)
		if !oki || !okj {
			return *ei < *ej
		}
		return ti.Before(tj)
	})
}

func parseNWSTime(s string) (time.Time, bool) {
	t, err := time.Parse(time.RFC3339, s)
	return t, err == nil
}

// truncateRunes returns the first n runes of s, unchanged if it is already
// that short. Rune-safe so a multi-byte character is never split.
func truncateRunes(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// nwsAlertsFeatureResponse is the slice of api.weather.gov's GeoJSON
// response this handler reads — only the `properties` fields it needs.
type nwsAlertsFeatureResponse struct {
	Features []struct {
		Properties struct {
			ID          string `json:"id"`
			Event       string `json:"event"`
			Severity    string `json:"severity"`
			Urgency     string `json:"urgency"`
			Headline    string `json:"headline"`
			Description string `json:"description"`
			Instruction string `json:"instruction"`
			Onset       string `json:"onset"`
			Ends        string `json:"ends"`
			Expires     string `json:"expires"`
			SenderName  string `json:"senderName"`
		} `json:"properties"`
	} `json:"features"`
}

// alertsFromFeatures maps the upstream GeoJSON shape to the wire shape this
// endpoint answers with — truncating description to 400 runes, nulling
// instruction when empty, and falling `ends` back to `expires`. Pure and
// deterministic for testing.
func alertsFromFeatures(parsed nwsAlertsFeatureResponse) []nwsAlert {
	out := make([]nwsAlert, 0, len(parsed.Features))
	for _, f := range parsed.Features {
		p := f.Properties

		ends := p.Ends
		if ends == "" {
			ends = p.Expires
		}
		var endsPtr *string
		if ends != "" {
			endsPtr = &ends
		}

		var instructionPtr *string
		if p.Instruction != "" {
			instructionPtr = &p.Instruction
		}

		out = append(out, nwsAlert{
			ID:          p.ID,
			Event:       p.Event,
			Severity:    p.Severity,
			Urgency:     p.Urgency,
			Headline:    p.Headline,
			Description: truncateRunes(p.Description, 400),
			Instruction: instructionPtr,
			Onset:       p.Onset,
			Ends:        endsPtr,
			Sender:      p.SenderName,
		})
	}
	return out
}

// parseAlertsBody decodes an api.weather.gov alerts/active GeoJSON body
// into this endpoint's wire shape. Split out from fetchNWSAlerts so a test
// can feed it a fixture file directly, with no network involved.
func parseAlertsBody(r io.Reader) ([]nwsAlert, error) {
	var parsed nwsAlertsFeatureResponse
	if err := json.NewDecoder(r).Decode(&parsed); err != nil {
		return nil, err
	}
	return alertsFromFeatures(parsed), nil
}

// fetchNWSAlerts asks api.weather.gov for active alerts at a point. The API
// requires a descriptive User-Agent (no key/token auth) and answers
// GeoJSON; a non-200 or any transport error is returned to the caller,
// which treats it as "no alerts right now" rather than failing the page.
func fetchNWSAlerts(ctx context.Context, lat, lon float64) ([]nwsAlert, error) {
	u := fmt.Sprintf("https://api.weather.gov/alerts/active?point=%.4f,%.4f", lat, lon)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", nwsUserAgent)
	req.Header.Set("Accept", "application/geo+json")

	res, err := alertsClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("nws alerts: status %d", res.StatusCode)
	}
	return parseAlertsBody(res.Body)
}

// GetAlerts handles GET /sublocations/{slug}/alerts — active NWS watches
// and warnings for the sublocation's coordinates, most severe first. 404
// without coordinates. An upstream failure or timeout (8s) answers
// { alerts: [] } with one warn log line rather than failing the page.
// Cached 5 min in Redis per sublocation.
func GetAlerts(site AlertsSite, c *cache.Cache) http.HandlerFunc {
	return getAlerts(site, c, fetchNWSAlerts)
}

func getAlerts(site AlertsSite, c *cache.Cache, fetch func(ctx context.Context, lat, lon float64) ([]nwsAlert, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		slug := chi.URLParam(r, "slug")
		lat, lon, found, err := site(r.Context(), slug)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "lookup failed"})
			return
		}
		if !found {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no coordinates for this sublocation"})
			return
		}

		key := "alerts:" + slug
		if cached, err := c.Get(r.Context(), key); err == nil && cached != "" {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Cache", "HIT")
			_, _ = w.Write([]byte(cached))
			return
		}

		alerts, err := fetch(r.Context(), lat, lon)
		if err != nil {
			slog.Warn("nws alerts fetch failed", "slug", slug, "error", err)
			alerts = []nwsAlert{}
		}
		sortAlerts(alerts)

		body, _ := json.Marshal(alertsResponse{Alerts: alerts})
		_ = c.Set(r.Context(), key, string(body), alertsTTL)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(body)
	}
}
