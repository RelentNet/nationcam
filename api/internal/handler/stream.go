package handler

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/brandon-relentnet/nationcam/api/internal/restreamer"
	"github.com/go-chi/chi/v5"
)

// ── Request types ─────────────────────────────────────────────────────

type createStreamRequest struct {
	Name    string `json:"name"`
	RTSPURL string `json:"rtspUrl"`
}

// ── Handlers ──────────────────────────────────────────────────────────

// CreateStream handles POST /streams — creates a new RTSP-to-HLS stream.
// The process is created with the Restreamer UI naming convention so it
// appears in the Restreamer dashboard and supports UI-based egress setup.
func CreateStream(rc *restreamer.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createStreamRequest
		if err := readJSON(r, &req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
			return
		}

		// Validate the human-readable name (used in UI metadata, not as process ID).
		name := strings.TrimSpace(req.Name)
		if name == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "stream name is required"})
			return
		}

		// Validate RTSP URL.
		if err := restreamer.ValidateRTSPURL(req.RTSPURL); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}

		uuid, err := createIngestStream(r.Context(), rc, name, req.RTSPURL)
		if err != nil {
			status, msg := mapRestreamerError(err)
			writeJSON(w, status, map[string]string{"error": msg})
			return
		}

		writeJSON(w, http.StatusCreated, restreamer.StreamResponse{
			StreamID: uuid,
			Name:     name,
			HlsURL:   rc.HLSURL(uuid),
			Status:   "created",
		})
	}
}

// createIngestStream creates one RTSP-to-HLS ingest process on Restreamer —
// UI naming convention, passthrough codec, auto-reconnect — and returns its
// UUID (the stream id; rc.HLSURL(uuid) is its manifest). Shared by POST
// /streams and the owner's POST /me/videos so both create identical
// processes. rtspURL must already have passed restreamer.ValidateRTSPURL.
// The returned error is a *restreamer.Error or a connection failure, either
// of which mapRestreamerError turns into a response.
func createIngestStream(ctx context.Context, rc *restreamer.Client, name, rtspURL string) (string, error) {
	// Generate a UUID for the process (matches Restreamer UI convention).
	uuid, err := restreamer.NewUUID()
	if err != nil {
		slog.Error("failed to generate UUID", "error", err)
		return "", err
	}
	processID := restreamer.IngestProcessID(uuid)

	// Build the UI-compatible FFmpeg process config and create the process.
	cfg := restreamer.BuildIngestConfig(uuid, rtspURL, rc.BaseURL())
	if _, err := rc.CreateProcess(ctx, cfg); err != nil {
		slog.Error("create stream failed", "processId", processID, "error", err)
		return "", err
	}

	// Set the restreamer-ui metadata so the process appears in the UI.
	uiMeta := restreamer.BuildUIMetadata(name, rtspURL, uuid)
	if err := rc.SetMetadata(ctx, processID, "restreamer-ui", uiMeta); err != nil {
		// Process was created but metadata failed — log but don't fail the request.
		// The stream will work for HLS but won't show in UI until metadata is fixed.
		slog.Error("set UI metadata failed (stream still functional)",
			"processId", processID, "error", err)
	}
	return uuid, nil
}

// ListStreams handles GET /streams — returns all active ingest streams.
// Only returns ingest processes (not snapshots, egress, etc.).
func ListStreams(rc *restreamer.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		procs, err := rc.ListProcesses(r.Context())
		if err != nil {
			status, msg := mapRestreamerError(err)
			writeJSON(w, status, map[string]string{"error": msg})
			return
		}

		streams := make([]restreamer.StreamDetail, 0, len(procs))
		for _, p := range procs {
			// Only include ingest processes (not snapshots or egress).
			if !isIngestProcess(p.ID) {
				continue
			}

			uuid := p.Reference
			if uuid == "" {
				uuid = extractUUID(p.ID)
			}

			state, err := rc.GetProcessState(r.Context(), p.ID)
			if err != nil {
				streams = append(streams, restreamer.StreamDetail{
					StreamID: uuid,
					Name:     restreamer.ExtractStreamName(&p),
					HlsURL:   rc.HLSURL(uuid),
					Status:   "unknown",
				})
				continue
			}
			streams = append(streams, buildStreamDetail(rc, uuid, restreamer.ExtractStreamName(&p), state))
		}

		writeJSON(w, http.StatusOK, streams)
	}
}

// GetStream handles GET /streams/{id} — returns a single stream's state.
// The {id} parameter is the UUID (without the restreamer-ui:ingest: prefix).
func GetStream(rc *restreamer.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uuid := chi.URLParam(r, "id")
		processID := restreamer.IngestProcessID(uuid)

		// Fetch the process to get the name from metadata.
		proc, err := rc.GetProcess(r.Context(), processID)
		if err != nil {
			status, msg := mapRestreamerError(err)
			writeJSON(w, status, map[string]string{"error": msg})
			return
		}

		state, err := rc.GetProcessState(r.Context(), processID)
		if err != nil {
			status, msg := mapRestreamerError(err)
			writeJSON(w, status, map[string]string{"error": msg})
			return
		}

		writeJSON(w, http.StatusOK, buildStreamDetail(rc, uuid, restreamer.ExtractStreamName(proc), state))
	}
}

// DeleteStream handles DELETE /streams/{id} — removes a stream.
func DeleteStream(rc *restreamer.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uuid := chi.URLParam(r, "id")
		processID := restreamer.IngestProcessID(uuid)

		if err := rc.DeleteProcess(r.Context(), processID); err != nil {
			status, msg := mapRestreamerError(err)
			writeJSON(w, status, map[string]string{"error": msg})
			return
		}

		// Also try to delete the snapshot process (best-effort).
		_ = rc.DeleteProcess(r.Context(), processID+"_snapshot")

		w.WriteHeader(http.StatusNoContent)
	}
}

// RestartStream handles POST /streams/{id}/restart — stops then starts a stream.
func RestartStream(rc *restreamer.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		uuid := chi.URLParam(r, "id")
		processID := restreamer.IngestProcessID(uuid)

		// Stop the process.
		if err := rc.CommandProcess(r.Context(), processID, "stop"); err != nil {
			status, msg := mapRestreamerError(err)
			writeJSON(w, status, map[string]string{"error": msg})
			return
		}

		// Brief pause to allow FFmpeg to shut down cleanly.
		time.Sleep(1 * time.Second)

		// Start the process.
		if err := rc.CommandProcess(r.Context(), processID, "start"); err != nil {
			status, msg := mapRestreamerError(err)
			slog.Error("restart stream: start failed", "processId", processID, "error", err)
			writeJSON(w, status, map[string]string{"error": msg})
			return
		}

		writeJSON(w, http.StatusOK, restreamer.StreamResponse{
			StreamID: uuid,
			Name:     "",
			HlsURL:   rc.HLSURL(uuid),
			Status:   "restarting",
		})
	}
}

// ── Helpers ───────────────────────────────────────────────────────────

// isIngestProcess returns true if the process ID is an ingest process
// (not a snapshot, egress, or other auxiliary process).
func isIngestProcess(id string) bool {
	return strings.HasPrefix(id, "restreamer-ui:ingest:") &&
		!strings.HasSuffix(id, "_snapshot")
}

// extractUUID extracts the UUID from a restreamer-ui:ingest:<uuid> process ID.
func extractUUID(processID string) string {
	const prefix = "restreamer-ui:ingest:"
	if strings.HasPrefix(processID, prefix) {
		return strings.TrimSuffix(strings.TrimPrefix(processID, prefix), "_snapshot")
	}
	return processID
}

// buildStreamDetail maps a Restreamer process state to a simplified StreamDetail.
func buildStreamDetail(rc *restreamer.Client, uuid, name string, state *restreamer.ProcessState) restreamer.StreamDetail {
	return restreamer.StreamDetail{
		StreamID:       uuid,
		Name:           name,
		HlsURL:         rc.HLSURL(uuid),
		Status:         state.Exec,
		RuntimeSeconds: state.RuntimeSeconds,
		FPS:            state.Progress.FPS,
		BitrateKbit:    state.Progress.BitrateKbit,
		MemoryMB:       float64(state.MemoryBytes) / (1024 * 1024),
		CPUUsage:       state.CPUUsage,
	}
}

// mapRestreamerError converts a restreamer.Error to an HTTP status and message
// suitable for the client response.
func mapRestreamerError(err error) (int, string) {
	var re *restreamer.Error
	if errors.As(err, &re) {
		switch re.StatusCode {
		case http.StatusNotFound:
			return http.StatusNotFound, "stream not found"
		case http.StatusConflict:
			return http.StatusConflict, "stream already exists"
		case http.StatusBadGateway:
			return http.StatusBadGateway, "Restreamer service unavailable"
		case http.StatusUnauthorized, http.StatusForbidden:
			return http.StatusServiceUnavailable, "unable to authenticate with Restreamer"
		default:
			return re.StatusCode, re.Message
		}
	}
	// Connection errors (not a restreamer.Error) indicate the service is down.
	return http.StatusBadGateway, "Restreamer service unavailable"
}
