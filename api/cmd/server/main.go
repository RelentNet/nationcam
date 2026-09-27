package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/archive"
	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/config"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/brandon-relentnet/nationcam/api/internal/handler"
	"github.com/brandon-relentnet/nationcam/api/internal/lightning"
	"github.com/brandon-relentnet/nationcam/api/internal/logtoadmin"
	"github.com/brandon-relentnet/nationcam/api/internal/middleware"
	"github.com/brandon-relentnet/nationcam/api/internal/restreamer"
	dbschema "github.com/brandon-relentnet/nationcam/api/sql"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	// Structured logging.
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	if err := run(); err != nil {
		slog.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run() error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// ── Load config ────────────────────────────────────────────────
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	slog.Info("config loaded",
		"port", cfg.Port,
		"logto_endpoint", cfg.LogtoEndpoint,
	)

	// ── Connect to PostgreSQL ──────────────────────────────────────
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		return err
	}
	slog.Info("postgres connected")

	// ── Run schema migration (idempotent — safe on every startup) ──
	if _, err := pool.Exec(ctx, dbschema.Schema); err != nil {
		return fmt.Errorf("migrate schema: %w", err)
	}
	slog.Info("schema migration complete")

	// ── Connect to Redis ───────────────────────────────────────────
	redisCache, err := cache.New(ctx, cfg.RedisURL)
	if err != nil {
		return err
	}
	defer redisCache.Close()
	slog.Info("redis connected")

	// ── Auth middleware ─────────────────────────────────────────────
	auth := middleware.NewAuth(cfg.LogtoEndpoint, cfg.LogtoAPIResource)

	// ── Restreamer client (optional) ───────────────────────────────
	var rc *restreamer.Client
	if cfg.RestreamerURL != "" {
		rc = restreamer.NewClient(cfg.RestreamerURL, cfg.RestreamerUser, cfg.RestreamerPass)
		slog.Info("restreamer client configured", "url", cfg.RestreamerURL)
	}

	// ── Build router ───────────────────────────────────────────────
	var proxyExtraHosts []string
	if cfg.RestreamerURL != "" {
		if u, err := url.Parse(cfg.RestreamerURL); err == nil && u.Hostname() != "" {
			proxyExtraHosts = append(proxyExtraHosts, u.Hostname())
		}
	}
	if cfg.AzuracastURL != "" {
		slog.Info("azuracast configured", "url", cfg.AzuracastURL)
	}
	uploadsDir := handler.ResolveUploadsDir(cfg.UploadsDir)
	slog.Info("uploads dir ready", "dir", uploadsDir)
	snapshots := &archive.Store{Dir: archive.ResolveDir(cfg.SnapshotsDir)}
	slog.Info("snapshots dir ready", "dir", snapshots.Dir)

	// ── Logto management (M2M) client (optional) ───────────────────
	// Backs the /admin/users and /admin/roles endpoints. Disabled — and
	// those routes not mounted — unless both the app id and secret are set.
	// Never logs the secret.
	logtoAdminClient := logtoadmin.NewClient(cfg.LogtoEndpoint, cfg.LogtoM2MAppID, cfg.LogtoM2MAppSecret)
	if logtoAdminClient.Configured() {
		slog.Info("logto management API configured")
	} else {
		slog.Info("logto management API not configured (set LOGTO_M2M_APP_ID and LOGTO_M2M_APP_SECRET to enable /admin/* routes)")
	}

	// ── Lightning store (DAN-34) ───────────────────────────────────
	// The in-memory buffer of recent GOES GLM flashes near our sublocations.
	// Loaded from its Redis mirror first so a restart does not blank the
	// status; the job below keeps it current. nil when disabled — the route
	// still mounts and answers 503.
	var lightningStore *lightning.Store
	if cfg.LightningEnabled {
		lightningStore = lightning.NewStore()
		if n, err := lightningStore.Load(ctx, redisCache, time.Now()); err != nil {
			slog.Warn("lightning: mirror load failed", "error", err)
		} else {
			slog.Info("lightning store loaded", "flashes", n, "last_key", lightningStore.LastKey())
		}
	}

	router := handler.NewRouter(pool, redisCache, auth, cfg.CORSOrigins, rc, cfg.StreamerAPIKey, proxyExtraHosts, cfg.AzuracastURL, uploadsDir, snapshots, logtoAdminClient, cfg.OpsAPIKey, lightningStore)

	// ── Snapshot archive job ───────────────────────────────────────
	// One watermarked still per active camera every 15 minutes, plus hourly
	// retention. Runs on the server's root context, so cancelling it below is
	// what stops the job; jobDone lets shutdown wait for in-flight captures.
	snapshotClient := handler.NewSnapshotClient()
	job := &archive.Job{
		Store: snapshots,
		ListSources: func(ctx context.Context) ([]archive.Source, error) {
			// Active cameras only — never paused (not capturing), pending or
			// rejected ones (DAN-39).
			rows, err := db.New(pool).ListArchiveSources(ctx)
			if err != nil {
				return nil, err
			}
			sources := make([]archive.Source, 0, len(rows))
			for _, v := range rows {
				sources = append(sources, archive.Source{VideoID: v.VideoID, Src: v.Src})
			}
			return sources, nil
		},
		Capture: func(ctx context.Context, src string) ([]byte, error) {
			return handler.SnapshotForSource(ctx, snapshotClient, src)
		},
	}
	jobDone := make(chan struct{})
	go func() {
		defer close(jobDone)
		job.Run(ctx)
	}()

	// ── Lightning job (DAN-34) ─────────────────────────────────────
	// Every minute: list the current GLM hour prefix on NOAA's public S3
	// bucket, fetch what is new, keep the flashes near any sublocation with
	// coordinates, mirror to Redis. Same lifecycle as the snapshot job.
	lightningDone := make(chan struct{})
	if lightningStore != nil {
		s3 := lightning.NewS3Client(cfg.LightningBucket)
		ljob := &lightning.Job{
			Store:   lightningStore,
			Lister:  s3,
			Fetcher: s3,
			Mirror:  redisCache,
			ListSites: func(ctx context.Context) ([]lightning.Site, error) {
				return listLightningSites(ctx, pool)
			},
		}
		slog.Info("lightning job configured", "bucket", cfg.LightningBucket)
		go func() {
			defer close(lightningDone)
			ljob.Run(ctx)
		}()
	} else {
		close(lightningDone)
		slog.Info("lightning job disabled")
	}

	// ── HTTP server ────────────────────────────────────────────────
	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: router,
		// ReadHeaderTimeout (not ReadTimeout) — Slowloris protection without
		// capping how long a slow client gets to send a whole request body.
		// ReadTimeout bounded headers+body together at 10s, which was fine
		// for tiny image uploads but killed a multi-MB video upload (POST
		// /uploads, size already bounded per-handler by MaxBytesReader) on
		// anything but a fast connection.
		ReadHeaderTimeout: 10 * time.Second,
		// WriteTimeout also spans body-read time (Go counts it from end of
		// headers to end of response), so it has to fit a slow connection
		// reading the full 20MB /uploads cap, not just writing a response.
		WriteTimeout: 90 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// ── Graceful shutdown ──────────────────────────────────────────
	errCh := make(chan error, 1)
	go func() {
		slog.Info("server listening", "addr", srv.Addr)
		errCh <- srv.ListenAndServe()
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-quit:
		slog.Info("shutdown signal received", "signal", sig)
	case err := <-errCh:
		if err != nil && err != http.ErrServerClosed {
			return err
		}
	}

	// Give in-flight requests 10 seconds to finish.
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	slog.Info("shutting down server")
	err = srv.Shutdown(shutdownCtx)

	// Stop the archive job and wait for in-flight captures (each bounded by
	// its own timeout) so a still is never left half-written on the volume.
	cancel()
	select {
	case <-jobDone:
	case <-shutdownCtx.Done():
		slog.Warn("snapshot archive did not stop in time")
	}
	select {
	case <-lightningDone:
	case <-shutdownCtx.Done():
		slog.Warn("lightning job did not stop in time")
	}
	return err
}

// listLightningSites is the lightning job's site list: every sublocation
// with coordinates, read through the paginated sqlc query in pages of 500.
func listLightningSites(ctx context.Context, pool *pgxpool.Pool) ([]lightning.Site, error) {
	const page = 500
	q := db.New(pool)
	var sites []lightning.Site
	for offset := int32(0); ; offset += page {
		rows, err := q.ListSublocationsPaginated(ctx, db.ListSublocationsPaginatedParams{Limit: page, Offset: offset})
		if err != nil {
			return nil, err
		}
		for _, s := range rows {
			if s.Lat.Valid && s.Lng.Valid {
				sites = append(sites, lightning.Site{Slug: s.Slug, Lat: s.Lat.Float64, Lon: s.Lng.Float64})
			}
		}
		if len(rows) < page {
			return sites, nil
		}
	}
}
