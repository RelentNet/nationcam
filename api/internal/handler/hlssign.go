package handler

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Signed HLS access (DAN-242). Nothing under /api/hls/{video_id}/ (except the
// public poster.jpg) is served without an HMAC-SHA256 signature over
// (video_id, path, exp) made with HLS_SIGNING_KEY. Two shapes carry it:
//
//   - Player token — header `X-HLS-Token: {exp}.{sig}`, path "*" (any file of
//     that camera), ~5 min. Issued by the uncached GET /videos/{id}/stream-token
//     and renewed by StreamPlayer before it expires; hls.js attaches it to every
//     manifest and segment request (xhrSetup). These requests must also pass
//     the Referer/Origin gate. A URL copied from the page carries no token at
//     all, and a copied token dies within minutes.
//   - Signed URL — query `?exp=…&sig=…`, path = the exact file name. Used by
//     the public stream.m3u8 302 (manifest valid hlsRedirectTTL) and by the
//     native-HLS fallback in StreamPlayer. The proxy rewrites such a manifest
//     with a signed URI per entry: playlists inherit the manifest's exp,
//     segments get min(now+hlsSegmentURLTTL, manifest exp), refreshed on every
//     manifest fetch. These requests skip the Referer gate: their consumers
//     (third-party HLS players behind stream.m3u8) send no nationcam Referer,
//     and the path-bound, expiring signature is the gate.

const (
	// hlsTokenTTL is the player token's lifetime. StreamPlayer renews it a
	// minute before expiry, so a live viewer watches for hours.
	hlsTokenTTL = 5 * time.Minute
	// hlsSegmentURLTTL bounds a signed segment/init URI emitted into a signed
	// manifest. A live player refetches the manifest every target duration,
	// so each segment URI it holds is at most a few seconds old.
	hlsSegmentURLTTL = 2 * time.Minute
	// hlsRedirectTTL is the manifest lifetime handed out by the public
	// stream.m3u8 302. Third-party consumers re-resolve that stable URL each
	// time they start playback; 12 h covers a long viewing session (a wall
	// display left on through a working day) while a URL copied out of the
	// redirect dies the same day.
	hlsRedirectTTL = 12 * time.Hour
	// hlsNativeTTL is the signed manifest lifetime for our own player on
	// browsers without MSE/MMS (old iOS Safari), which cannot attach a header
	// and keep reloading the same manifest URL.
	hlsNativeTTL = 1 * time.Hour
	// hlsClockSkew is how far past exp a signature is still accepted.
	hlsClockSkew = 30 * time.Second
	// hlsMaxLifetime rejects an exp further out than any URL we issue (plus
	// skew), so a signature can never be valid for longer than designed.
	hlsMaxLifetime = hlsRedirectTTL + time.Minute

	hlsTokenHeader = "X-HLS-Token"
	hlsScopeAll    = "*"
)

var (
	errHLSUnsigned = errors.New("missing stream signature")
	errHLSBadSig   = errors.New("invalid stream signature")
	errHLSExpired  = errors.New("stream link expired")
)

// hlsNow is the clock used for signing and verification (tests move it).
var hlsNow = time.Now

type hlsSigner struct{ key []byte }

var hlsSignerPtr atomic.Pointer[hlsSigner]

func init() {
	// A process that never calls SetHLSSigningKey (tests) still signs and
	// verifies consistently with a random key.
	_, _ = SetHLSSigningKey("")
}

// SetHLSSigningKey installs the HMAC key for signed HLS URLs. An empty key
// generates a random 32-byte key, valid for this process only; generated
// reports that so main can log it.
func SetHLSSigningKey(key string) (generated bool, err error) {
	k := []byte(key)
	if len(k) == 0 {
		k = make([]byte, 32)
		if _, err := rand.Read(k); err != nil {
			return true, fmt.Errorf("generate HLS signing key: %w", err)
		}
		generated = true
	}
	hlsSignerPtr.Store(&hlsSigner{key: k})
	return generated, nil
}

func currentHLSSigner() *hlsSigner { return hlsSignerPtr.Load() }

func (s *hlsSigner) mac(videoID int32, p string, exp int64) []byte {
	m := hmac.New(sha256.New, s.key)
	// Newline-separated: neither an id, a strict file name nor an integer can
	// contain one, so fields cannot bleed into each other.
	fmt.Fprintf(m, "nc-hls-v1\n%d\n%s\n%d", videoID, p, exp)
	return m.Sum(nil)
}

func (s *hlsSigner) sign(videoID int32, p string, exp int64) string {
	return base64.RawURLEncoding.EncodeToString(s.mac(videoID, p, exp))
}

// verify checks sig (constant-time) and exp against now, allowing
// hlsClockSkew past expiry.
func (s *hlsSigner) verify(videoID int32, p string, exp int64, sig string, now time.Time) error {
	if sig == "" {
		return errHLSUnsigned
	}
	raw, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(raw, s.mac(videoID, p, exp)) {
		return errHLSBadSig
	}
	if now.After(time.Unix(exp, 0).Add(hlsClockSkew)) {
		return errHLSExpired
	}
	if time.Unix(exp, 0).After(now.Add(hlsMaxLifetime)) {
		return errHLSBadSig
	}
	return nil
}

// playerToken is the X-HLS-Token value for a camera: "{exp}.{sig}" over
// path "*".
func (s *hlsSigner) playerToken(videoID int32, exp int64) string {
	return strconv.FormatInt(exp, 10) + "." + s.sign(videoID, hlsScopeAll, exp)
}

func (s *hlsSigner) verifyPlayerToken(videoID int32, tok string, now time.Time) error {
	if tok == "" {
		return errHLSUnsigned
	}
	expStr, sig, ok := strings.Cut(tok, ".")
	if !ok {
		return errHLSBadSig
	}
	exp, err := strconv.ParseInt(expStr, 10, 64)
	if err != nil {
		return errHLSBadSig
	}
	return s.verify(videoID, hlsScopeAll, exp, sig, now)
}

// signedURL is /api/hls/{id}/{file}?exp=…&sig=… with the signature bound to
// that exact file.
func (s *hlsSigner) signedURL(videoID int32, file string, exp int64) string {
	q := url.Values{}
	q.Set("exp", strconv.FormatInt(exp, 10))
	q.Set("sig", s.sign(videoID, file, exp))
	return fmt.Sprintf("%s/%d/%s?%s", hlsPathPrefix, videoID, file, q.Encode())
}

// hlsSignedManifestURL is the signed manifest URL for a camera, valid for ttl.
func hlsSignedManifestURL(videoID int32, ttl time.Duration) string {
	return currentHLSSigner().signedURL(videoID, "index.m3u8", hlsNow().Add(ttl).Unix())
}

// HLSStreamToken handles GET /videos/{id}/stream-token, the uncached endpoint
// our player calls at mount and again before each token expires. It answers
// 404 for a camera that is not publicly visible or not proxied (external
// sources need no token). DAN-205 puts its permission check here.
func HLSStreamToken(pool *pgxpool.Pool) http.HandlerFunc {
	return newHLSStreamToken(pgHLSStore{pool})
}

type hlsStreamTokenResponse struct {
	VideoID    int32  `json:"video_id"`
	Token      string `json:"token"`
	Header     string `json:"header"`
	ExpiresAt  string `json:"expires_at"`
	TTLSeconds int    `json:"ttl_seconds"`
	// ManifestURL is what hls.js loads, sending Token in Header on every
	// request.
	ManifestURL string `json:"manifest_url"`
	// SignedManifestURL is for players that cannot set a header (native HLS
	// in old Safari): a signed URL valid NativeTTLSeconds.
	SignedManifestURL string `json:"signed_manifest_url"`
	NativeTTLSeconds  int    `json:"native_ttl_seconds"`
}

func newHLSStreamToken(store hlsStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 32)
		if err != nil || id <= 0 {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "camera not found"})
			return
		}
		src, err := store.PublicVideoSource(r.Context(), int32(id))
		if err != nil {
			if !errors.Is(err, pgx.ErrNoRows) {
				slog.Warn("hls: token lookup failed", "video_id", id, "err", err)
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "lookup failed"})
				return
			}
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "camera not found"})
			return
		}
		if !memfsHLS.MatchString(src) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "camera has no proxied stream"})
			return
		}
		signer := currentHLSSigner()
		exp := hlsNow().Add(hlsTokenTTL)
		writeJSON(w, http.StatusOK, hlsStreamTokenResponse{
			VideoID:           int32(id),
			Token:             signer.playerToken(int32(id), exp.Unix()),
			Header:            hlsTokenHeader,
			ExpiresAt:         exp.UTC().Format(time.RFC3339),
			TTLSeconds:        int(hlsTokenTTL / time.Second),
			ManifestURL:       hlsPublicSrc(int32(id), src),
			SignedManifestURL: hlsSignedManifestURL(int32(id), hlsNativeTTL),
			NativeTTLSeconds:  int(hlsNativeTTL / time.Second),
		})
	}
}
