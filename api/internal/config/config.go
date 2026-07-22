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
	}, nil
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
