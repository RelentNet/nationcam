package handler

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// maxUploadBytes caps a single upload at 10MB.
const maxUploadBytes = 10 << 20

// uploadExtByType maps the sniffed content type to the extension we store under.
// The client's filename and Content-Type are never trusted — only these bytes.
var uploadExtByType = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif":  ".gif",
}

// ResolveUploadsDir returns a writable uploads directory, creating it if needed.
// It uses `configured` (env UPLOADS_DIR, default /app/data/uploads) when that can
// be created; otherwise it falls back to ./uploads for local dev where /app/data
// does not exist.
//
// ponytail: host-local disk storage (a Docker volume). Ceiling: one host, not
// backed up, not shared across replicas. Upgrade path: point UploadAsset/serve at
// object storage (S3/R2) behind the same /uploads URL.
func ResolveUploadsDir(configured string) string {
	if configured == "" {
		configured = "/app/data/uploads"
	}
	if err := os.MkdirAll(configured, 0o755); err == nil {
		return configured
	}
	_ = os.MkdirAll("uploads", 0o755)
	return "uploads"
}

// UploadAsset handles POST /uploads (admin only) — stores a single image and
// returns its public URL. Security: the body is capped with MaxBytesReader; the
// type is sniffed from the bytes (png/jpeg/webp/gif only); the stored name is
// random (crypto/rand) with an extension derived from the sniffed type, never
// from the client's filename.
func UploadAsset(uploadsDir string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)

		file, _, err := r.FormFile("file")
		if err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "file exceeds 10MB limit"})
				return
			}
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "expected a single file in the 'file' field"})
			return
		}
		defer file.Close()

		// Sniff the real type from the first 512 bytes, then rewind.
		head := make([]byte, 512)
		n, err := io.ReadFull(file, head)
		if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "could not read file"})
			return
		}
		ext, ok := uploadExtByType[http.DetectContentType(head[:n])]
		if !ok {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "only png, jpeg, webp or gif images are allowed"})
			return
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not process file"})
			return
		}

		name, err := randomHex()
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not generate filename"})
			return
		}
		filename := name + ext

		out, err := os.Create(filepath.Join(uploadsDir, filename))
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not save file"})
			return
		}
		defer out.Close()
		if _, err := io.Copy(out, file); err != nil {
			_ = os.Remove(out.Name())
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "file exceeds 10MB limit"})
				return
			}
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not save file"})
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"url": "/api/uploads/" + filename})
	}
}

// ServeUploads returns a read-only file server for the uploads directory, mounted
// at /uploads/*. http.FileServer serves GET/HEAD only.
func ServeUploads(uploadsDir string) http.Handler {
	return http.StripPrefix("/uploads/", http.FileServer(http.Dir(uploadsDir)))
}

func randomHex() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}
