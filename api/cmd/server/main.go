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

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/config"
	"github.com/brandon-relentnet/nationcam/api/internal/handler"
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
	router := handler.NewRouter(pool, redisCache, auth, cfg.CORSOrigins, rc, cfg.StreamerAPIKey, proxyExtraHosts)

	// ── HTTP server ────────────────────────────────────────────────
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
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
	return srv.Shutdown(shutdownCtx)
}
