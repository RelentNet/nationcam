package config

import (
	"fmt"
	"os"
	"strings"
)

// Config holds all application configuration loaded from environment variables.
type Config struct {
	Port             string
	DatabaseURL      string
	RedisURL         string
	LogtoEndpoint    string
	LogtoAPIResource string
	CORSOrigins      []string

	// Restreamer (optional — empty RestreamerURL disables stream management).
	RestreamerURL  string
	RestreamerUser string
	RestreamerPass string
	StreamerAPIKey string

	// AzuraCast (optional — empty AzuracastURL disables the audio-channel picker).
	AzuracastURL string

	// Logto machine-to-machine app (optional — empty LogtoM2MAppID or
	// LogtoM2MAppSecret disables the /admin/* Logto management endpoints).
	LogtoM2MAppID     string
	LogtoM2MAppSecret string

	// OpsAPIKey (optional) enables X-API-Key access to the /admin/* routes,
	// for Home to read Logto user/role data without a Logto sign-in.
	OpsAPIKey string

	// UploadsDir is where uploaded branding assets are written and served from.
	UploadsDir string

	// SnapshotsDir is where the snapshot archive (one still per camera every
	// 15 minutes) is written and served from.
	SnapshotsDir string

	// LightningEnabled runs the GOES GLM lightning job (default true);
	// LightningBucket is the NOAA Open Data bucket it reads (default
	// noaa-goes19 — GOES-East).
	LightningEnabled bool
	LightningBucket  string
}

// Load reads configuration from environment variables with sensible defaults.
func Load() (*Config, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	origins := os.Getenv("CORS_ORIGINS")
	var corsList []string
	if origins != "" {
		for _, o := range strings.Split(origins, ",") {
			corsList = append(corsList, strings.TrimSpace(o))
		}
	}

	return &Config{
		Port:             envOr("PORT", "8080"),
		DatabaseURL:      dbURL,
		RedisURL:         envOr("REDIS_URL", "redis://localhost:6379/0"),
		LogtoEndpoint:    envOr("LOGTO_ENDPOINT", "http://localhost:3301"),
		LogtoAPIResource: os.Getenv("LOGTO_API_RESOURCE"),
		CORSOrigins:      corsList,

		RestreamerURL:  os.Getenv("RESTREAMER_URL"),
		RestreamerUser: os.Getenv("RESTREAMER_USER"),
		RestreamerPass: os.Getenv("RESTREAMER_PASS"),
		StreamerAPIKey: os.Getenv("STREAMER_API_KEY"),

		AzuracastURL: os.Getenv("AZURACAST_URL"),

		LogtoM2MAppID:     os.Getenv("LOGTO_M2M_APP_ID"),
		LogtoM2MAppSecret: os.Getenv("LOGTO_M2M_APP_SECRET"),
		OpsAPIKey:         os.Getenv("OPS_API_KEY"),

		UploadsDir:   envOr("UPLOADS_DIR", "/app/data/uploads"),
		SnapshotsDir: envOr("SNAPSHOTS_DIR", "/app/data/snapshots"),

		LightningEnabled: envBool("LIGHTNING_ENABLED", true),
		LightningBucket:  envOr("LIGHTNING_BUCKET", "noaa-goes19"),
	}, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

// envBool reads a boolean flag: "false", "0", "no" and "off" (any case) are
// false, "true", "1", "yes" and "on" are true, anything else is the fallback.
func envBool(key string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "false", "0", "no", "off":
		return false
	case "true", "1", "yes", "on":
		return true
	}
	return fallback
}
