package handler

import (
	"context"
	"math"
	"net/http"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/brandon-relentnet/nationcam/api/internal/lightning"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// LightningSite resolves a sublocation slug to its coordinates. found is
// false when the slug is unknown or the sublocation has no lat/lng — both
// are a 404 to the caller.
type LightningSite func(ctx context.Context, slug string) (lat, lon float64, found bool, err error)

// LightningSiteFromDB is the production LightningSite.
func LightningSiteFromDB(pool *pgxpool.Pool) LightningSite {
	return func(ctx context.Context, slug string) (float64, float64, bool, error) {
		sub, err := db.New(pool).GetSublocationBySlug(ctx, slug)
		if err != nil || !sub.Lat.Valid || !sub.Lng.Valid {
			return 0, 0, false, nil
		}
		return sub.Lat.Float64, sub.Lng.Float64, true, nil
	}
}

// lightningResponse is the wire shape of GET /sublocations/{slug}/lightning.
type lightningResponse struct {
	Status           string   `json:"status"`
	NearestMi        *float64 `json:"nearest_mi"`
	LastStrikeAt     *string  `json:"last_strike_at"`
	Strikes10mi30min int      `json:"strikes_10mi_30min"`
	Strikes30mi30min int      `json:"strikes_30mi_30min"`
	AllClearAt       *string  `json:"all_clear_at"`
	Source           string   `json:"source"`
	UpdatedAt        string   `json:"updated_at"`
}

type lightningUnavailable struct {
	Error     string  `json:"error"`
	UpdatedAt *string `json:"updated_at"`
}

// GetLightning handles GET /sublocations/{slug}/lightning — the GOES GLM
// policy (see package lightning) evaluated for the sublocation's
// coordinates right now. 404 when it has none; 503 when the store's newest
// successful fetch is older than lightning.StaleAfter (or the feature is
// off, store == nil), so the UI can say "no data" instead of a false
// "clear". Not cached: the store is in memory and the answer changes by the
// second.
func GetLightning(site LightningSite, store *lightning.Store) http.HandlerFunc {
	return getLightning(site, store, time.Now)
}

func getLightning(site LightningSite, store *lightning.Store, now func() time.Time) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		lat, lon, found, err := site(r.Context(), chi.URLParam(r, "slug"))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "lookup failed"})
			return
		}
		if !found {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no coordinates for this sublocation"})
			return
		}

		w.Header().Set("Cache-Control", "no-store")
		t := now()
		if store == nil || store.Stale(t) {
			var updated *string
			if store != nil && !store.UpdatedAt().IsZero() {
				s := rfc3339(store.UpdatedAt())
				updated = &s
			}
			writeJSON(w, http.StatusServiceUnavailable, lightningUnavailable{Error: "lightning data unavailable", UpdatedAt: updated})
			return
		}

		st := store.Evaluate(lat, lon, t)
		out := lightningResponse{
			Status:           st.Status,
			Strikes10mi30min: st.Strikes10mi30min,
			Strikes30mi30min: st.Strikes30mi30min,
			Source:           lightning.Source,
			UpdatedAt:        rfc3339(store.UpdatedAt()),
		}
		if st.NearestMi != nil {
			mi := math.Round(*st.NearestMi*10) / 10
			out.NearestMi = &mi
		}
		if st.LastStrikeAt != nil {
			s := rfc3339(*st.LastStrikeAt)
			out.LastStrikeAt = &s
		}
		if st.AllClearAt != nil {
			s := rfc3339(*st.AllClearAt)
			out.AllClearAt = &s
		}
		writeJSON(w, http.StatusOK, out)
	}
}

func rfc3339(t time.Time) string { return t.UTC().Format(time.RFC3339) }
