package handler

import (
	"bytes"
	"context"
	_ "embed"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"image/png"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/cache"
	"github.com/brandon-relentnet/nationcam/api/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

// snapshotTTL matches Restreamer's snapshot interval, so a cached still is never
// much more than a minute behind the camera.
const snapshotTTL = 60 * time.Second

// memfsHLS matches a Restreamer HLS source; its snapshot sits beside it as .jpg.
// Same rule as streamPoster in web-next/src/lib/seo.ts.
var memfsHLS = regexp.MustCompile(`^(https?://[^?]+/memfs/[^/?]+)\.m3u8`)

// watermarkPNG is rendered from watermark.svg:
//
//	rsvg-convert -w 500 watermark.svg -o watermark.png
//
//go:embed watermark.png
var watermarkPNG []byte

var watermark = func() image.Image {
	img, err := png.Decode(bytes.NewReader(watermarkPNG))
	if err != nil {
		panic(err)
	}
	return img
}()

// CameraSnapshot handles GET /videos/{stateSlug}/{sublocationSlug}/{slug}/snapshot.jpg
// — the camera's latest still with the NationCam watermark, for webcam directories
// such as Windy and Ventusky to poll. Unlike the Restreamer URL behind it, this one
// survives the stream being recreated under a new ID.
func CameraSnapshot(pool *pgxpool.Pool, c *cache.Cache) http.HandlerFunc {
	client := &http.Client{Timeout: 10 * time.Second}
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		params := cameraParams(r)
		// Under videos: so any camera write invalidates it along with the rest.
		key := "videos:snapshot:" + params.StateSlug + ":" + params.SublocationSlug + ":" + params.Slug

		img, _ := c.Get(ctx, key)
		if img == "" {
			camera, err := db.New(pool).GetVideoBySlug(ctx, params)
			m := memfsHLS.FindStringSubmatch(camera.Src)
			if err != nil || m == nil {
				writeJSON(w, http.StatusNotFound, map[string]string{"error": "no snapshot for this camera"})
				return
			}
			b, err := brandedSnapshot(ctx, client, m[1]+".jpg")
			if err != nil {
				slog.Warn("snapshot fetch failed", "key", key, "error", err)
				writeJSON(w, http.StatusBadGateway, map[string]string{"error": "snapshot unavailable"})
				return
			}
			img = string(b)
			_ = c.Set(ctx, key, img, snapshotTTL)
		}

		w.Header().Set("Content-Type", "image/jpeg")
		w.Header().Set("Cache-Control", "public, max-age=60")
		_, _ = io.WriteString(w, img)
	}
}

// CameraStream handles GET /videos/{stateSlug}/{sublocationSlug}/{slug}/stream.m3u8
// — a stable redirect to the camera's current HLS manifest, for directories that
// also ask for a video URL.
func CameraStream(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		camera, err := db.New(pool).GetVideoBySlug(r.Context(), cameraParams(r))
		if err != nil || !memfsHLS.MatchString(camera.Src) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "no stream for this camera"})
			return
		}
		http.Redirect(w, r, camera.Src, http.StatusFound)
	}
}

// brandedSnapshot fetches a JPEG and stamps the watermark on it.
func brandedSnapshot(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream returned %d", resp.StatusCode)
	}
	src, err := jpeg.Decode(io.LimitReader(resp.Body, 20<<20))
	if err != nil {
		return nil, err
	}
	return stampWatermark(src)
}

// stampWatermark draws the watermark in the bottom-right corner and re-encodes.
//
// ponytail: the watermark is a fixed 500px, ~26% of a 1080p frame and ~16% of a
// 3K one. Scale it to the frame (golang.org/x/image/draw) if cameras ever land
// far outside that range.
func stampWatermark(src image.Image) ([]byte, error) {
	b := src.Bounds()
	dst := image.NewRGBA(b)
	draw.Draw(dst, b, src, b.Min, draw.Src)

	margin := b.Dx() / 60
	size := watermark.Bounds().Size()
	at := b.Max.Sub(size).Sub(image.Pt(margin, margin))
	draw.Draw(dst, image.Rectangle{Min: at, Max: at.Add(size)}, watermark, watermark.Bounds().Min, draw.Over)

	var buf bytes.Buffer
	err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 85})
	return buf.Bytes(), err
}
