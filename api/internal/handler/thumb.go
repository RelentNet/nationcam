package handler

import (
	"bytes"
	"image"
	"image/draw"
	"image/jpeg"
	"net/http"
	"strconv"
)

// thumbWidths are the only ?w= values the still endpoints accept.
var thumbWidths = map[int]bool{320: true, 640: true}

// thumbQuality is the JPEG quality of resized stills.
const thumbQuality = 80

// parseThumbWidth reads ?w=. 0 with ok means "no w, serve full size"; anything
// other than 320 or 640 is not ok and the caller answers 400.
func parseThumbWidth(r *http.Request) (w int, ok bool) {
	q, present := r.URL.Query()["w"]
	if !present {
		return 0, true
	}
	n, err := strconv.Atoi(q[0])
	if err != nil || !thumbWidths[n] {
		return 0, false
	}
	return n, true
}

func badWidth(w http.ResponseWriter) {
	writeJSON(w, http.StatusBadRequest, map[string]string{"error": "w must be 320 or 640"})
}

// resizeJPEG scales a JPEG to width w, keeping the aspect ratio, and re-encodes
// it. A still already w pixels wide or narrower is returned unchanged (never
// upscaled).
func resizeJPEG(src []byte, w int) ([]byte, error) {
	img, err := jpeg.Decode(bytes.NewReader(src))
	if err != nil {
		return nil, err
	}
	b := img.Bounds()
	if b.Dx() <= w {
		return src, nil
	}
	h := (b.Dy()*w + b.Dx()/2) / b.Dx()
	if h < 1 {
		h = 1
	}
	out := boxScale(img, w, h)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: thumbQuality}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// boxScale downsamples img to dw x dh by area averaging (a box filter with
// fractional edge weights), done as a horizontal then a vertical pass.
func boxScale(img image.Image, dw, dh int) *image.RGBA {
	b := img.Bounds()
	sw, sh := b.Dx(), b.Dy()
	rgba := image.NewRGBA(image.Rect(0, 0, sw, sh))
	draw.Draw(rgba, rgba.Bounds(), img, b.Min, draw.Src)

	// Horizontal pass: sw x sh -> dw x sh.
	tmp := make([]float32, dw*sh*3)
	xs := float64(sw) / float64(dw)
	for y := 0; y < sh; y++ {
		row := rgba.Pix[y*rgba.Stride:]
		for x := 0; x < dw; x++ {
			var r, g, bl, wt float64
			lo, hi := float64(x)*xs, float64(x+1)*xs
			for sx := int(lo); sx < sw && float64(sx) < hi; sx++ {
				k := minF(hi, float64(sx+1)) - maxF(lo, float64(sx))
				r += float64(row[sx*4]) * k
				g += float64(row[sx*4+1]) * k
				bl += float64(row[sx*4+2]) * k
				wt += k
			}
			i := (y*dw + x) * 3
			tmp[i], tmp[i+1], tmp[i+2] = float32(r/wt), float32(g/wt), float32(bl/wt)
		}
	}
	// Vertical pass: dw x sh -> dw x dh.
	out := image.NewRGBA(image.Rect(0, 0, dw, dh))
	ys := float64(sh) / float64(dh)
	for y := 0; y < dh; y++ {
		lo, hi := float64(y)*ys, float64(y+1)*ys
		for x := 0; x < dw; x++ {
			var r, g, bl, wt float64
			for sy := int(lo); sy < sh && float64(sy) < hi; sy++ {
				k := minF(hi, float64(sy+1)) - maxF(lo, float64(sy))
				i := (sy*dw + x) * 3
				r += float64(tmp[i]) * k
				g += float64(tmp[i+1]) * k
				bl += float64(tmp[i+2]) * k
				wt += k
			}
			o := out.PixOffset(x, y)
			out.Pix[o], out.Pix[o+1], out.Pix[o+2], out.Pix[o+3] = uint8(r/wt+0.5), uint8(g/wt+0.5), uint8(bl/wt+0.5), 255
		}
	}
	return out
}

func minF(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}

func maxF(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
