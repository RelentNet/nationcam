package handler

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"testing"
)

func TestMemfsHLS(t *testing.T) {
	for src, want := range map[string]string{
		"https://streamer.nationcam.com/memfs/abc-123.m3u8": "https://streamer.nationcam.com/memfs/abc-123",
		"https://streamer.nationcam.com/memfs/abc.m3u8?x=1": "https://streamer.nationcam.com/memfs/abc",
		"https://example.com/live/abc.m3u8":                 "",
		"https://streamer.nationcam.com/memfs/abc.mp4":      "",
		"": "",
	} {
		got := ""
		if m := memfsHLS.FindStringSubmatch(src); m != nil {
			got = m[1]
		}
		if got != want {
			t.Errorf("memfsHLS(%q) = %q, want %q", src, got, want)
		}
	}
}

func TestStampWatermark(t *testing.T) {
	gray := color.RGBA{128, 128, 128, 255}
	frame := image.NewRGBA(image.Rect(0, 0, 1920, 1080))
	draw.Draw(frame, frame.Bounds(), image.NewUniform(gray), image.Point{}, draw.Src)

	b, err := stampWatermark(frame)
	if err != nil {
		t.Fatal(err)
	}
	out, err := jpeg.Decode(bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	if out.Bounds() != frame.Bounds() {
		t.Fatalf("bounds = %v, want %v", out.Bounds(), frame.Bounds())
	}
	// The watermark's dark plate darkens the bottom-right; the top-left is untouched.
	r, _, _, _ := out.At(1920-32-5, 1080-32-50).RGBA()
	if r>>8 > 100 {
		t.Errorf("bottom-right not watermarked: red = %d", r>>8)
	}
	r, _, _, _ = out.At(10, 10).RGBA()
	if d := int(r>>8) - 128; d < -4 || d > 4 {
		t.Errorf("top-left changed: red = %d", r>>8)
	}

	// A frame smaller than the watermark is clipped, not a panic.
	if _, err := stampWatermark(image.NewRGBA(image.Rect(0, 0, 100, 50))); err != nil {
		t.Fatal(err)
	}
}
