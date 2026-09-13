package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	mw "github.com/brandon-relentnet/nationcam/api/internal/middleware"
)

// pngMagic is the 8-byte PNG signature — enough for http.DetectContentType to
// classify the bytes as image/png.
var pngMagic = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}

func multipartFile(t *testing.T, field, filename string, data []byte) (*bytes.Buffer, string) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, err := mw.CreateFormFile(field, filename)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fw.Write(data); err != nil {
		t.Fatalf("write data: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	return &buf, mw.FormDataContentType()
}

// TestUploadAsset exercises the upload handler directly: a valid image succeeds
// and is served back with the right content type, an oversize file and a
// non-image are both rejected.
func TestUploadAsset(t *testing.T) {
	dir := t.TempDir()
	handler := UploadAsset(dir)

	// A valid PNG (magic + a little payload) succeeds.
	img := append(append([]byte{}, pngMagic...), bytes.Repeat([]byte{0}, 64)...)
	body, ct := multipartFile(t, "file", "evil.php", img) // lying filename on purpose
	req := httptest.NewRequest(http.MethodPost, "/uploads", body)
	req.Header.Set("Content-Type", ct)
	rec := httptest.NewRecorder()
	handler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("valid image: got %d, want 200 (body %s)", rec.Code, rec.Body.String())
	}
	var resp struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !strings.HasPrefix(resp.URL, "/api/uploads/") || !strings.HasSuffix(resp.URL, ".png") {
		t.Fatalf("unexpected url %q — must be /api/uploads/<random>.png, never the client filename", resp.URL)
	}
	if strings.Contains(resp.URL, "evil") || strings.Contains(resp.URL, ".php") {
		t.Fatalf("stored name leaked client filename: %q", resp.URL)
	}

	// It is served back read-only with an image content type.
	served := ServeUploads(dir)
	getReq := httptest.NewRequest(http.MethodGet, strings.TrimPrefix(resp.URL, "/api"), nil)
	getRec := httptest.NewRecorder()
	served.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("serve upload: got %d, want 200", getRec.Code)
	}
	if got := getRec.Header().Get("Content-Type"); !strings.Contains(got, "image/") {
		t.Fatalf("served content-type %q, want image/*", got)
	}

	// A > 10MB file is rejected.
	big := append(append([]byte{}, pngMagic...), bytes.Repeat([]byte{0}, maxUploadBytes+1024)...)
	bigBody, bigCT := multipartFile(t, "file", "big.png", big)
	bigReq := httptest.NewRequest(http.MethodPost, "/uploads", bigBody)
	bigReq.Header.Set("Content-Type", bigCT)
	bigRec := httptest.NewRecorder()
	handler(bigRec, bigReq)
	if bigRec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversize upload: got %d, want 413", bigRec.Code)
	}

	// A non-image is rejected.
	txtBody, txtCT := multipartFile(t, "file", "note.png", []byte("this is definitely not an image"))
	txtReq := httptest.NewRequest(http.MethodPost, "/uploads", txtBody)
	txtReq.Header.Set("Content-Type", txtCT)
	txtRec := httptest.NewRecorder()
	handler(txtRec, txtReq)
	if txtRec.Code != http.StatusBadRequest {
		t.Fatalf("non-image upload: got %d, want 400", txtRec.Code)
	}
}

// TestUploadRequiresAdmin confirms the route is gated: an unauthenticated request
// (no admin scope) is rejected with 403 by RequireAdmin.
func TestUploadRequiresAdmin(t *testing.T) {
	dir := t.TempDir()
	h := mw.RequireAdmin(UploadAsset(dir))

	req := httptest.NewRequest(http.MethodPost, "/uploads", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("non-admin upload: got %d, want 403", rec.Code)
	}
}
