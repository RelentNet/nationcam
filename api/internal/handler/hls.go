package handler

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"path"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// HLS proxy (DAN-241). Restreamer-backed cameras are played through
//
//	GET /hls/{video_id}/index.m3u8   the camera's manifest
//	GET /hls/{video_id}/{segment}    variant playlists, segments, init maps
//
// instead of the public Restreamer URL, so the stream can only be fetched by a
// page on nationcam.com or on a licensed embed host (a sublocation's host_url
// domain). The check is on the Referer / Origin header, which a determined
// client can forge; it stops casual hotlinking, not a scripted scraper.
//
// DAN-242 puts an HMAC signature in front of that (see hlssign.go): every
// manifest and segment request needs a valid, unexpired player token or signed
// URL, so a spoofed Referer alone no longer fetches anything.
//
// The upstream URL always comes from the database (videos.src), never from the
// request, and the segment name is a strict filename, so the handler cannot be
// steered to another host or path.

const (
	hlsManifestMaxBytes = 1 << 20 // a playlist is a few KB; 1 MB is generous
	hlsTimeout          = 15 * time.Second
	hlsPathPrefix       = "/api/hls"
	posterTTL           = 60 * time.Second
	// hlsSrcTTL caches id -> upstream src in memory so a segment request (one
	// every few seconds per viewer) does not cost a Postgres round trip. A
	// camera rejected or paused stops being served within this window.
	hlsSrcTTL = 10 * time.Second
	// hlsCopyBufSize is the relay buffer for segments (pooled, see hlsCopy).
	hlsCopyBufSize = 32 << 10
)

// hlsSegmentName is the only shape accepted for {segment}: a plain filename
// with a media extension. No slashes, no "..", no query.
var hlsSegmentName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*\.(m3u8|ts|m4s|mp4|aac|mp3|vtt|webvtt)$`)

// hlsStore is the slice of the database the proxy needs, so tests can run on a
// fake.
type hlsStore interface {
	// PublicVideoSource returns the stored src of a publicly visible camera,
	// or pgx.ErrNoRows.
	PublicVideoSource(ctx context.Context, videoID int32) (string, error)
	// LicensedHostURLs returns the host_url of every approved sublocation
	// that has one.
	LicensedHostURLs(ctx context.Context) ([]string, error)
}

type pgHLSStore struct{ pool *pgxpool.Pool }

func (s pgHLSStore) PublicVideoSource(ctx context.Context, id int32) (string, error) {
	return db.New(s.pool).GetPublicVideoSource(ctx, id)
}

func (s pgHLSStore) LicensedHostURLs(ctx context.Context) ([]string, error) {
	return db.New(s.pool).ListLicensedHostURLs(ctx)
}

// hlsPublicSrc is the browser-facing src for a camera: the proxy manifest for a
// Restreamer-backed one, the stored src untouched for an external HLS/MP4
// source. Used by every public video response.
func hlsPublicSrc(videoID int32, src string) string {
	if memfsHLS.MatchString(src) {
		return fmt.Sprintf("%s/%d/index.m3u8", hlsPathPrefix, videoID)
	}
	return src
}

// hlsProxySrc matches the proxy form of a src, so an admin edit that sends it
// back unchanged keeps the stored Restreamer URL.
var hlsProxySrc = regexp.MustCompile(`^/api/hls/\d+/index\.m3u8$`)

// hlsHostAllowlist decides which Referer/Origin hosts may fetch HLS. Static
// hosts (nationcam.com, localhost) are always allowed; licensed embed hosts
// come from sublocations.host_url and are cached for allowlistCacheTTL (the
// same 5-minute pattern as the stream-proxy allow-list), falling back to the
// stale set when a refresh fails.
type hlsHostAllowlist struct {
	store hlsStore

	mu      sync.RWMutex
	hosts   map[string]struct{}
	fetched time.Time
}

var hlsStaticHosts = map[string]struct{}{
	"nationcam.com": {},
	"localhost":     {},
	"127.0.0.1":     {},
	"::1":           {},
}

// normalizeHost lowercases a hostname and drops a leading "www." so
// example.com and www.example.com are one licence.
func normalizeHost(h string) string {
	h = strings.ToLower(strings.TrimSuffix(h, "."))
	return strings.TrimPrefix(h, "www.")
}

// hostFromURLish parses a stored host_url, tolerating a missing scheme
// ("example.com/path"). Returns "" when no host can be found.
func hostFromURLish(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}
	return normalizeHost(u.Hostname())
}

func (a *hlsHostAllowlist) allowed(ctx context.Context, host string) bool {
	host = normalizeHost(host)
	if host == "" {
		return false
	}
	if _, ok := hlsStaticHosts[host]; ok {
		return true
	}

	a.mu.RLock()
	fresh := a.hosts != nil && time.Since(a.fetched) < allowlistCacheTTL
	_, ok := a.hosts[host]
	a.mu.RUnlock()
	if fresh {
		return ok
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.hosts == nil || time.Since(a.fetched) >= allowlistCacheTTL {
		urls, err := a.store.LicensedHostURLs(ctx)
		if err != nil {
			slog.Warn("hls: allowlist refresh failed", "err", err)
			if a.hosts == nil {
				return false
			}
		} else {
			hosts := make(map[string]struct{}, len(urls))
			for _, raw := range urls {
				if h := hostFromURLish(raw); h != "" {
					hosts[h] = struct{}{}
				}
			}
			a.hosts = hosts
			a.fetched = time.Now()
		}
	}
	_, ok = a.hosts[host]
	return ok
}

// refererAllowed reports whether the request carries a Referer or Origin and
// every one it carries names an allowed host.
func (a *hlsHostAllowlist) refererAllowed(r *http.Request) bool {
	seen := false
	for _, h := range []string{r.Header.Get("Referer"), r.Header.Get("Origin")} {
		if h == "" {
			continue
		}
		seen = true
		u, err := url.Parse(h)
		if err != nil || !a.allowed(r.Context(), u.Hostname()) {
			return false
		}
	}
	return seen
}

// HLS serves the proxy routes. c may be nil only in tests that never hit the
// poster.
func HLS(pool *pgxpool.Pool, c *cache.Cache) (manifest, segment, poster http.HandlerFunc) {
	return newHLSHandlers(pgHLSStore{pool}, c, newHLSClient())
}

// newHLSClient is the upstream client for the proxy. Its own transport keeps
// enough idle connections to Restreamer for every concurrent viewer: the
// default transport keeps 2 per host, so under load most segment fetches would
// open a fresh TCP (and TLS) connection.
func newHLSClient() *http.Client {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.MaxIdleConns = 512
	t.MaxIdleConnsPerHost = 256
	t.IdleConnTimeout = 90 * time.Second
	return &http.Client{
		Timeout:   hlsTimeout,
		Transport: t,
		// An upstream redirect is never followed: the target would escape the
		// DB-derived URL this handler is pinned to.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// hlsSrcCache memoizes PublicVideoSource hits for hlsSrcTTL. Misses and errors
// are never cached.
type hlsSrcCache struct {
	store hlsStore
	mu    sync.RWMutex
	m     map[int32]hlsSrcEntry
}

type hlsSrcEntry struct {
	src string
	at  time.Time
}

func (c *hlsSrcCache) get(ctx context.Context, id int32) (string, error) {
	c.mu.RLock()
	e, ok := c.m[id]
	c.mu.RUnlock()
	if ok && time.Since(e.at) < hlsSrcTTL {
		return e.src, nil
	}
	src, err := c.store.PublicVideoSource(ctx, id)
	if err != nil {
		return "", err
	}
	c.mu.Lock()
	if c.m == nil || len(c.m) > 10000 {
		c.m = make(map[int32]hlsSrcEntry)
	}
	c.m[id] = hlsSrcEntry{src: src, at: time.Now()}
	c.mu.Unlock()
	return src, nil
}

// hlsAccess is what the guard established about a request.
type hlsAccess struct {
	// signedExp is non-zero when the request came in on a signed URL
	// (?exp=&sig=): a manifest served to it gets signed URIs that expire no
	// later than this.
	signedExp int64
}

var hlsCopyBufs = sync.Pool{New: func() any { b := make([]byte, hlsCopyBufSize); return &b }}

// hlsWriterOnly hides http.ResponseWriter's ReaderFrom so io.CopyBuffer uses
// our pooled buffer. Otherwise the copy goes through net.TCPConn.ReadFrom,
// which for a source that is neither a file nor a socket (an HTTP response
// body) falls back to io.Copy with a fresh 32 KB buffer per segment.
type hlsWriterOnly struct{ io.Writer }

// hlsCopy relays body to w through one pooled buffer: no body buffering and
// no per-segment buffer allocation.
func hlsCopy(w io.Writer, body io.Reader) (int64, error) {
	bp := hlsCopyBufs.Get().(*[]byte)
	defer hlsCopyBufs.Put(bp)
	return io.CopyBuffer(hlsWriterOnly{w}, body, *bp)
}

func newHLSHandlers(store hlsStore, c *cache.Cache, client *http.Client) (manifest, segment, poster http.HandlerFunc) {
	allow := &hlsHostAllowlist{store: store}
	srcs := &hlsSrcCache{store: store}

	forbid := func(w http.ResponseWriter, err error) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden", "detail": err.Error()})
	}

	// hlsGuard is the single verification hook: it runs before any upstream
	// work. A request needs either a signed URL bound to this exact file
	// (?exp=&sig=, the stream.m3u8 / native-HLS path, no Referer needed) or a
	// player token in X-HLS-Token plus an allowed Referer/Origin (our player).
	// See hlssign.go.
	hlsGuard := func(w http.ResponseWriter, r *http.Request, videoID int32, file string) (hlsAccess, bool) {
		signer := currentHLSSigner()
		now := hlsNow()
		q := r.URL.Query()
		if q.Has("sig") || q.Has("exp") {
			exp, err := strconv.ParseInt(q.Get("exp"), 10, 64)
			if err != nil {
				forbid(w, errHLSBadSig)
				return hlsAccess{}, false
			}
			if err := signer.verify(videoID, file, exp, q.Get("sig"), now); err != nil {
				forbid(w, err)
				return hlsAccess{}, false
			}
			return hlsAccess{signedExp: exp}, true
		}
		if err := signer.verifyPlayerToken(videoID, r.Header.Get(hlsTokenHeader), now); err != nil {
			forbid(w, err)
			return hlsAccess{}, false
		}
		if !allow.refererAllowed(r) {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "forbidden", "detail": "stream not available from this site"})
			return hlsAccess{}, false
		}
		return hlsAccess{}, true
	}

	// lookup resolves {video_id} to the raw upstream src, or writes the error.
	lookup := func(w http.ResponseWriter, r *http.Request, file string) (int32, *url.URL, hlsAccess, bool) {
		id, err := strconv.ParseInt(chi.URLParam(r, "video_id"), 10, 32)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "camera not found"})
			return 0, nil, hlsAccess{}, false
		}
		access, ok := hlsGuard(w, r, int32(id), file)
		if !ok {
			return 0, nil, hlsAccess{}, false
		}
		src, err := srcs.get(r.Context(), int32(id))
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				slog.Warn("hls: source lookup failed", "video_id", id, "err", err)
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "lookup failed"})
				return 0, nil, hlsAccess{}, false
			}
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "camera not found"})
			return 0, nil, hlsAccess{}, false
		}
		if !memfsHLS.MatchString(src) {
			// External sources are played directly, never through here.
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "camera not found"})
			return 0, nil, hlsAccess{}, false
		}
		u, err := url.Parse(src)
		if err != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "camera not found"})
			return 0, nil, hlsAccess{}, false
		}
		u.RawQuery = ""
		return int32(id), u, access, true
	}

	manifest = func(w http.ResponseWriter, r *http.Request) {
		id, upstream, access, ok := lookup(w, r, "index.m3u8")
		if !ok {
			return
		}
		serveHLSUpstream(w, r, client, id, upstream, access)
	}

	segment = func(w http.ResponseWriter, r *http.Request) {
		name := chi.URLParam(r, "segment")
		if !hlsSegmentName.MatchString(name) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
			return
		}
		id, base, access, ok := lookup(w, r, name)
		if !ok {
			return
		}
		u := *base
		u.Path = path.Join(path.Dir(base.Path), name)
		serveHLSUpstream(w, r, client, id, &u, access)
	}

	// poster is the camera's latest watermarked still, public like snapshot.jpg
	// (no Referer check): crawlers and link previews need it, and it is a
	// single frame.
	poster = func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(chi.URLParam(r, "video_id"), 10, 32)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "camera not found"})
			return
		}
		ctx := r.Context()
		key := fmt.Sprintf("videos:snapshot:id:%d", id)
		img := ""
		if c != nil {
			img, _ = c.Get(ctx, key)
		}
		if img == "" {
			src, err := store.PublicVideoSource(ctx, int32(id))
			if err != nil || !memfsHLS.MatchString(src) {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "no snapshot for this camera"})
				return
			}
			b, err := SnapshotForSource(ctx, client, src)
			if err != nil {
				slog.Warn("poster fetch failed", "video_id", id, "error", err)
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": "snapshot unavailable"})
				return
			}
			img = string(b)
			if c != nil {
				_ = c.Set(ctx, key, img, posterTTL)
			}
		}
		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "public, max-age=60")
		_, _ = io.WriteString(w, img)
	}
	return manifest, segment, poster
}

// serveHLSUpstream fetches one upstream file and relays it. Playlists are
// buffered (bounded) and rewritten; everything else is streamed.
func serveHLSUpstream(w http.ResponseWriter, r *http.Request, client *http.Client, videoID int32, upstream *url.URL, access hlsAccess) {
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, upstream.String(), nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not build upstream request"})
		return
	}
	if ua := r.Header.Get("User-Agent"); ua != "" {
		req.Header.Set("User-Agent", ua)
	}
	if rng := r.Header.Get("Range"); rng != "" {
		req.Header.Set("Range", rng)
	}

	resp, err := client.Do(req)
	if err != nil {
		slog.Warn("hls: upstream fetch failed", "video_id", videoID, "err", err)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": "upstream request failed"})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		slog.Warn("hls: upstream error status", "video_id", videoID, "status", resp.StatusCode)
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": fmt.Sprintf("upstream returned %d", resp.StatusCode)})
		return
	}

	isManifest := strings.HasSuffix(strings.ToLower(upstream.Path), ".m3u8")
	if isManifest {
		body, err := io.ReadAll(io.LimitReader(resp.Body, hlsManifestMaxBytes))
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "failed to read upstream response"})
			return
		}
		var sign func(file string) string
		if access.signedExp != 0 {
			sign = hlsURISigner(videoID, access.signedExp)
		}
		out := rewriteHLSManifest(body, videoID, upstream, sign)
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Vary", "Origin, Referer")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(out)
		return
	}

	if ct := resp.Header.Get("Content-Type"); ct != "" {
		w.Header().Set("Content-Type", ct)
	}
	if cl := resp.Header.Get("Content-Length"); cl != "" {
		w.Header().Set("Content-Length", cl)
	}
	if cr := resp.Header.Get("Content-Range"); cr != "" {
		w.Header().Set("Content-Range", cr)
	}
	// private: a shared cache would hand a segment to a client that never
	// passed the signature check.
	w.Header().Set("Cache-Control", "private, max-age=60")
	w.Header().Set("Vary", "Origin, Referer")
	w.WriteHeader(resp.StatusCode)
	_, _ = hlsCopy(w, io.LimitReader(resp.Body, proxyMaxBodySize))
}

// hlsURISigner signs the URIs of a manifest served on a signed URL whose
// signature expires at manifestExp: playlists inherit manifestExp (a native
// player reloads them for as long as the manifest is valid), segments and
// init maps get min(now+hlsSegmentURLTTL, manifestExp). Every manifest fetch
// re-signs, so a live player always holds fresh segment URIs.
func hlsURISigner(videoID int32, manifestExp int64) func(file string) string {
	signer := currentHLSSigner()
	segExp := hlsNow().Add(hlsSegmentURLTTL).Unix()
	if segExp > manifestExp {
		segExp = manifestExp
	}
	return func(file string) string {
		exp := segExp
		if strings.HasSuffix(strings.ToLower(file), ".m3u8") {
			exp = manifestExp
		}
		return signer.signedURL(videoID, file, exp)
	}
}

// rewriteHLSManifest points every URI in a playlist back at this proxy. A URI
// that resolves to a file in the same directory as the manifest becomes
// /api/hls/{id}/{file}, or sign(file) (a signed URL) when sign is non-nil;
// anything else (another host or directory) is dropped from the URI line so it
// can never be fetched around the proxy.
func rewriteHLSManifest(body []byte, videoID int32, manifestURL *url.URL, sign func(file string) string) []byte {
	proxied := func(raw string) (string, bool) {
		ref, err := url.Parse(strings.TrimSpace(raw))
		if err != nil {
			return "", false
		}
		abs := manifestURL.ResolveReference(ref)
		if abs.Host != manifestURL.Host || path.Dir(abs.Path) != path.Dir(manifestURL.Path) {
			return "", false
		}
		name := path.Base(abs.Path)
		if !hlsSegmentName.MatchString(name) {
			return "", false
		}
		if sign != nil {
			return sign(name), true
		}
		return fmt.Sprintf("%s/%d/%s", hlsPathPrefix, videoID, name), true
	}

	lines := strings.Split(strings.ReplaceAll(string(body), "\r\n", "\n"), "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		switch {
		case trimmed == "":
		case strings.HasPrefix(trimmed, "#"):
			if idx := strings.Index(trimmed, `URI="`); idx >= 0 {
				start := idx + len(`URI="`)
				if end := strings.Index(trimmed[start:], `"`); end >= 0 {
					if p, ok := proxied(trimmed[start : start+end]); ok {
						lines[i] = trimmed[:start] + p + trimmed[start+end:]
					} else {
						lines[i] = trimmed[:start] + trimmed[start+end:]
					}
				}
			}
		default:
			if p, ok := proxied(trimmed); ok {
				lines[i] = p
			} else {
				lines[i] = "#"
			}
		}
	}
	return []byte(strings.Join(lines, "\n"))
}
