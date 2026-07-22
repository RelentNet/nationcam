package handler

import (
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	mw "github.com/brandon-relentnet/nationcam/api/internal/middleware"
	"github.com/brandon-relentnet/nationcam/api/internal/restreamer"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewRouter builds the Chi router with all routes and middleware.
// rc may be nil if Restreamer is not configured (stream routes are not mounted).
// proxyExtraHosts are hosts the stream proxy may fetch from in addition to
// video sources stored in the database (e.g. the Restreamer host).
func NewRouter(pool *pgxpool.Pool, c *cache.Cache, auth *mw.Auth, corsOrigins []string, rc *restreamer.Client, streamerAPIKey string, proxyExtraHosts []string) *chi.Mux {
	r := chi.NewRouter()

	// Global middleware.
	r.Use(mw.Logger)
	r.Use(mw.CORS(corsOrigins))
	r.Use(auth.Authenticate)

	// Health.
	r.Get("/health", Health(pool, c))

	// States.
	r.Get("/states", ListStates(pool, c))
	r.Get("/states/{slug}", GetState(pool, c))
	r.With(mw.RequireAdmin).Post("/states", CreateState(pool, c))
	r.With(mw.RequireAdmin).Put("/states/{id}", UpdateState(pool, c))
	r.With(mw.RequireAdmin).Delete("/states/{slug}", DeleteState(pool, c))
	r.With(mw.RequireAdmin).Get("/states/paginated", ListStatesPaginated(pool, c))

	// Sublocations.
	r.Get("/states/{slug}/sublocations", ListSublocationsByState(pool, c))
	r.Get("/sublocations/{slug}", GetSublocation(pool, c))
	r.With(mw.RequireAdmin).Post("/sublocations", CreateSublocation(pool, c))
	r.With(mw.RequireAdmin).Put("/sublocations/{id}", UpdateSublocation(pool, c))
	r.With(mw.RequireAdmin).Delete("/sublocations/{id}", DeleteSublocation(pool, c))
	r.With(mw.RequireAdmin).Get("/sublocations/paginated", ListSublocationsPaginated(pool, c))

	// Videos.
	r.Get("/videos", ListVideos(pool, c))
	r.Get("/videos/{stateSlug}/{sublocationSlug}/{slug}", GetVideo(pool, c))
	r.With(mw.RequireAdmin).Post("/videos", CreateVideo(pool, c))
	r.With(mw.RequireAdmin).Put("/videos/{id}", UpdateVideo(pool, c))
	r.With(mw.RequireAdmin).Delete("/videos/{id}", DeleteVideo(pool, c))
	r.With(mw.RequireAdmin).Get("/videos/paginated", ListVideosPaginated(pool, c))

	// Stream proxy — proxies known HLS manifests/segments to bypass CORS.
	r.Get("/stream-proxy", StreamProxy(pool, proxyExtraHosts))

	// Streams (Restreamer proxy) — only mounted if configured.
	// Accepts both X-API-Key (external tools) and Logto JWT (dashboard).
	if rc != nil && streamerAPIKey != "" {
		rl := mw.NewRateLimiter(10, time.Minute)
		r.Route("/streams", func(r chi.Router) {
			r.Use(mw.RequireAPIKeyOrAdmin(streamerAPIKey))
			r.Get("/", ListStreams(rc))
			r.With(mw.RateLimit(rl)).Post("/", CreateStream(rc))
			r.Get("/{id}", GetStream(rc))
			r.Delete("/{id}", DeleteStream(rc))
			r.Post("/{id}/restart", RestartStream(rc))
		})
	}

	return r
}
