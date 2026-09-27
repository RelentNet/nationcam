package handler

import (
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/archive"
	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/lightning"
	"github.com/brandon-relentnet/nationcam/api/internal/logtoadmin"
	mw "github.com/brandon-relentnet/nationcam/api/internal/middleware"
	"github.com/brandon-relentnet/nationcam/api/internal/restreamer"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewRouter builds the Chi router with all routes and middleware.
// rc may be nil if Restreamer is not configured (stream routes are not mounted).
// proxyExtraHosts are hosts the stream proxy may fetch from in addition to
// video sources stored in the database (e.g. the Restreamer host).
// la may be nil if the Logto M2M app is not configured (/admin/* routes are
// not mounted); opsAPIKey is the ops key accepted alongside a Logto sign-in
// for those routes (empty disables the key, leaving only Logto sign-in).
// lightningStore may be nil (LIGHTNING_ENABLED=false) — the route still
// mounts and answers 503.
func NewRouter(pool *pgxpool.Pool, c *cache.Cache, auth *mw.Auth, corsOrigins []string, rc *restreamer.Client, streamerAPIKey string, proxyExtraHosts []string, azuracastURL string, uploadsDir string, snapshots *archive.Store, la *logtoadmin.Client, opsAPIKey string, lightningStore *lightning.Store) *chi.Mux {
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

	// ── Events (DAN-27) ────────────────────────────────────────────
	// Hosts' events shown on the cameras that can watch them and on the
	// sitewide /events page. GET endpoints are public and cached like other
	// GETs; the scoped listings (?video_id=|sublocation_id=) back the
	// "Upcoming" block on a camera/sublocation page. Admin CRUD mirrors posts.
	r.Get("/events", ListEvents(pool, c))
	r.With(mw.RequireAdmin).Get("/events/all", ListAllEvents(pool))
	r.With(mw.RequireAdmin).Post("/events", CreateEvent(pool, c))
	r.With(mw.RequireAdmin).Put("/events/{id}", UpdateEvent(pool, c))
	r.With(mw.RequireAdmin).Delete("/events/{id}", DeleteEvent(pool, c))

	// ── Logto management connection (DAN-37) ───────────────────────
	// Read-only view into Logto's users/roles via a machine-to-machine app,
	// for the admin console's Users panel and for Home. Mounted only when
	// the M2M app is configured; guarded the same way as /streams —
	// RequireAPIKeyOrAdmin accepts either the ops API key or a signed-in
	// Logto user.
	if la != nil && la.Configured() {
		r.Route("/admin", func(r chi.Router) {
			r.Use(mw.RequireAPIKeyOrAdmin(opsAPIKey))
			r.Get("/users", AdminListUsers(la, c))
			r.Get("/users/stats", AdminUserStats(la, c))
			r.Get("/roles", AdminListRoles(la, c))
		})
	}

	// ── Lightning (DAN-34) ─────────────────────────────────────────
	// Satellite lightning status per sublocation from NOAA GOES-19 GLM,
	// evaluated per request against lightning.Job's in-memory buffer. Not
	// Redis-cached: the answer changes by the second and the store is
	// already in memory. 404 without coordinates, 503 when the feed is stale.
	r.Get("/sublocations/{slug}/lightning", GetLightning(LightningSiteFromDB(pool), lightningStore))

	// ── NWS active alerts (DAN-35) ─────────────────────────────────
	// Active National Weather Service watches/warnings for a sublocation's
	// coordinates (api.weather.gov, no auth — a User-Agent with contact info
	// is required instead), most severe first. 404 without coordinates; an
	// upstream failure or timeout answers { alerts: [] } rather than an
	// error. Cached 5 min in Redis (alerts:{slug}).
	r.Get("/sublocations/{slug}/alerts", GetAlerts(AlertsSiteFromDB(pool), c))

	// ── Owner accounts and review (DAN-39) ─────────────────────────
	// Any signed-in Logto user (RequireUser: valid token with a subject, any
	// scope) can submit their own sublocations and cameras under /me; both
	// enter review and stay out of every public endpoint until an admin
	// approves them from /review. Nothing under /me is Redis-cached (per
	// user); every write flushes the public catalog caches. POST /me/videos
	// creates a Restreamer process, so it shares the streams limiter pattern
	// on top of the per-owner limits in status.go. rc may be nil (Restreamer
	// not configured): creating a camera then answers 503, and pause/resume/
	// delete on a camera that has a stream id do too.
	owners := newOwnerStore(pool)
	mountOwnerRoutes(r, owners, c, rc)

	return r
}

// mountOwnerRoutes wires the /me and review endpoints; split out so the
// handler tests can mount them on a fake store without the rest of NewRouter.
func mountOwnerRoutes(r chi.Router, owners ownerStore, c *cache.Cache, rc *restreamer.Client) {
	r.Route("/me", func(r chi.Router) {
		r.Use(mw.RequireUser)
		r.Get("/", GetMe(owners))
		r.Get("/sublocations", ListMySublocations(owners))
		r.Post("/sublocations", CreateMySublocation(owners, c))
		r.Put("/sublocations/{id}", UpdateMySublocation(owners, c))
		r.Delete("/sublocations/{id}", DeleteMySublocation(owners, c))
		r.Get("/videos", ListMyVideos(owners))
		r.With(mw.RateLimit(mw.NewRateLimiter(10, time.Minute))).Post("/videos", CreateMyVideo(owners, c, rc))
		r.Put("/videos/{id}", UpdateMyVideo(owners, c))
		r.Post("/videos/{id}/pause", PauseMyVideo(owners, c, rc))
		r.Post("/videos/{id}/resume", ResumeMyVideo(owners, c, rc))
		r.Delete("/videos/{id}", DeleteMyVideo(owners, c, rc))
	})

	r.With(mw.RequireAdmin).Get("/review", ReviewQueue(owners))
	r.With(mw.RequireAdmin).Post("/videos/{id}/approve", ApproveVideo(owners, c))
	r.With(mw.RequireAdmin).Post("/videos/{id}/reject", RejectVideo(owners, c, rc))
	r.With(mw.RequireAdmin).Post("/sublocations/{id}/approve", ApproveSublocation(owners, c))
	r.With(mw.RequireAdmin).Post("/sublocations/{id}/reject", RejectSublocation(owners, c, rc))
}
