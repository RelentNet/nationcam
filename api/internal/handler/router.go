package handler

import (
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/archive"
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
func NewRouter(pool *pgxpool.Pool, c *cache.Cache, auth *mw.Auth, corsOrigins []string, rc *restreamer.Client, streamerAPIKey string, proxyExtraHosts []string, azuracastURL string, uploadsDir string, snapshots *archive.Store) *chi.Mux {
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
	r.Get("/sublocations/{slug}/weather", GetWeather(pool, c))
	r.Get("/sublocations/{slug}/conditions", GetConditions(pool, c))
	r.With(mw.RequireAdmin).Post("/sublocations", CreateSublocation(pool, c))
	r.With(mw.RequireAdmin).Put("/sublocations/{id}", UpdateSublocation(pool, c))
	r.With(mw.RequireAdmin).Delete("/sublocations/{id}", DeleteSublocation(pool, c))
	r.With(mw.RequireAdmin).Get("/sublocations/paginated", ListSublocationsPaginated(pool, c))

	// Videos.
	r.Get("/videos", ListVideos(pool, c))
	r.Get("/videos/{stateSlug}/{sublocationSlug}/{slug}", GetVideo(pool, c))
	r.Get("/videos/{stateSlug}/{sublocationSlug}/{slug}/snapshot.jpg", CameraSnapshot(pool, c))
	r.Get("/videos/{stateSlug}/{sublocationSlug}/{slug}/stream.m3u8", CameraStream(pool))
	r.With(mw.RequireAdmin).Post("/videos", CreateVideo(pool, c))
	r.With(mw.RequireAdmin).Put("/videos/{id}", UpdateVideo(pool, c))
	r.With(mw.RequireAdmin).Delete("/videos/{id}", DeleteVideo(pool, c))
	r.With(mw.RequireAdmin).Get("/videos/paginated", ListVideosPaginated(pool, c))

	// Uploads — host-local object storage for location branding. Serving is
	// public and read-only; uploading is admin-only.
	r.Get("/uploads/*", ServeUploads(uploadsDir).ServeHTTP)
	r.With(mw.RequireAdmin).Post("/uploads", UploadAsset(uploadsDir))

	// Stream proxy — proxies known HLS manifests/segments to bypass CORS.
	r.Get("/stream-proxy", StreamProxy(pool, proxyExtraHosts))

	// Audio channels — public AzuraCast station list for the player's audio
	// picker. Returns [] (never an error) when AzuraCast is unset/unreachable.
	r.Get("/audio/stations", cachedHandler(c, "audio:stations", AudioStations(azuracastURL)))

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

	// Ads. /ads/next is public and on the playback hot path; the two tracking
	// endpoints are public because the viewer's player calls them directly.
	r.Get("/ads/next", AdsNext(pool, c))
	r.Get("/ads/banner", AdsBanner(pool, c))
	r.Post("/ads/{id}/impression", RecordAdImpression(pool))
	r.Get("/ads/{id}/click", RecordAdClick(pool))
	r.With(mw.RequireAdmin).Get("/ads", ListAds(pool))
	r.With(mw.RequireAdmin).Post("/ads", CreateAd(pool, c))
	r.With(mw.RequireAdmin).Put("/ads/{id}", UpdateAd(pool, c))
	r.With(mw.RequireAdmin).Delete("/ads/{id}", DeleteAd(pool, c))

	// Submissions. POST is the public contact / "Add Your Camera" form — rate
	// limited and body-capped (it is unauthenticated). Reading and marking
	// handled are admin-only.
	// ponytail: NewRateLimiter is a global (not per-IP) window, matching the
	// streams limiter. Ceiling: one abuser can exhaust the shared budget for
	// everyone. Add a per-IP limiter if public spam becomes a problem.
	submitRL := mw.NewRateLimiter(30, time.Minute)
	r.With(mw.RateLimit(submitRL)).Post("/submissions", CreateSubmission(pool))
	r.With(mw.RequireAdmin).Get("/submissions", ListSubmissions(pool))
	r.With(mw.RequireAdmin).Patch("/submissions/{id}", UpdateSubmission(pool))

	// ── Field notes (DAN-25) ──────────────────────────────────────
	// A lightweight blog written in the dashboard, published at /notes. GET
	// endpoints are public and cached like other GETs; the scoped listings
	// (?video_id=|sublocation_id=|state_id=) back the related-notes block on a
	// camera/sublocation/state page. Admin CRUD mirrors ads.
	r.Get("/posts", ListPosts(pool, c))
	r.Get("/posts/{slug}", GetPostBySlug(pool, c))
	r.With(mw.RequireAdmin).Get("/posts/all", ListAllPosts(pool))
	r.With(mw.RequireAdmin).Post("/posts", CreatePost(pool, c))
	r.With(mw.RequireAdmin).Put("/posts/{id}", UpdatePost(pool, c))
	r.With(mw.RequireAdmin).Delete("/posts/{id}", DeletePost(pool, c))

	// ── Snapshot archive (DAN-22) ─────────────────────────────────
	// Per-camera stills captured every 15 minutes by archive.Job. The two JSON
	// listings are public and cached like other GETs; the files themselves are
	// served read-only from the snapshots volume with an immutable cache header.
	r.Get("/videos/{stateSlug}/{sublocationSlug}/{slug}/frames", ListFrames(pool, c, snapshots))
	r.Get("/videos/{stateSlug}/{sublocationSlug}/{slug}/frames/days", ListFrameDays(pool, c, snapshots))
	r.Get("/snapshots/*", ServeSnapshots(snapshots).ServeHTTP)

	return r
}
