package handler

import (
	"bytes"
	"net/http"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
)

// cachedHandler wraps a handler so its JSON response is cached in Redis.
// On cache hit the stored JSON is returned directly; on miss the handler runs
// and its output is stored for cache.DefaultTTL.
func cachedHandler(c *cache.Cache, key string, handler http.HandlerFunc) http.HandlerFunc {
	return cachedHandlerTTL(c, key, cache.DefaultTTL, handler)
}

// cachedHandlerTTL is cachedHandler with an explicit cache life, for responses
// that go stale faster than the default (e.g. today's snapshot frames).
func cachedHandlerTTL(c *cache.Cache, key string, ttl time.Duration, handler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()

		// Try cache first.
		if cached, err := c.Get(ctx, key); err == nil && cached != "" {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("X-Cache", "HIT")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(cached))
			return
		}

		// Cache miss — run handler and capture output.
		rec := &responseRecorder{ResponseWriter: w, body: &bytes.Buffer{}}
		handler(rec, r)

		// Only cache successful responses.
		if rec.status == http.StatusOK || rec.status == 0 {
			_ = c.Set(ctx, key, rec.body.String(), ttl)
		}
	}
}

type responseRecorder struct {
	http.ResponseWriter
	body   *bytes.Buffer
	status int
}

func (rr *responseRecorder) Write(b []byte) (int, error) {
	rr.body.Write(b)
	return rr.ResponseWriter.Write(b)
}

func (rr *responseRecorder) WriteHeader(code int) {
	rr.status = code
	rr.ResponseWriter.WriteHeader(code)
}
