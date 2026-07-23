package restreamer

import (
	"crypto/rand"
	"fmt"
)

// ── UUID generation (v4, crypto/rand — no external deps) ──────────────

// NewUUID generates a random UUID v4 string.
func NewUUID() (string, error) {
	var uuid [16]byte
	if _, err := rand.Read(uuid[:]); err != nil {
		return "", fmt.Errorf("generate UUID: %w", err)
	}
	// Set version (4) and variant (RFC 4122).
	uuid[6] = (uuid[6] & 0x0f) | 0x40
	uuid[8] = (uuid[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		uuid[0:4], uuid[4:6], uuid[6:8], uuid[8:10], uuid[10:16]), nil
}

// IngestProcessID returns the Restreamer UI process ID for an ingest process.
func IngestProcessID(uuid string) string {
	return "restreamer-ui:ingest:" + uuid
}

// ── UI-compatible process config builder ──────────────────────────────

// BuildIngestConfig builds a complete UI-compatible ProcessConfig for an
// RTSP ingest process. The returned config matches the structure the
// Restreamer UI creates, so the process appears in the UI dashboard.
func BuildIngestConfig(uuid, rtspURL, restreamerURL string) ProcessConfig {
	processID := IngestProcessID(uuid)

	return ProcessConfig{
		ID:        processID,
		Type:      "ffmpeg",
		Reference: uuid,
		Input: []ProcessIO{{
			ID:      "input_0",
			Address: rtspURL,
			Options: []string{
				"-fflags", "+genpts",
				"-thread_queue_size", "512",
				"-timeout", "5000000",
				"-rtsp_transport", "tcp",
			},
		}},
		Output: []ProcessIO{{
			ID:      "output_0",
			Address: fmt.Sprintf("{memfs}/%s_{outputid}.m3u8", uuid),
			Options: []string{
				"-dn",
				"-sn",
				"-map", "0:0",
				"-codec:v", "copy",
				"-map", "0:1?",
				"-codec:a", "copy",
				"-metadata", fmt.Sprintf("title=%s/%s/oembed.json", restreamerURL, uuid),
				"-metadata", "service_provider=datarhei-Restreamer",
				"-f", "hls",
				"-start_number", "0",
				"-hls_time", "2",
				"-hls_list_size", "6",
				"-hls_flags", "append_list+delete_segments+program_date_time+temp_file",
				"-hls_delete_threshold", "4",
				"-hls_segment_filename", fmt.Sprintf("{memfs}/%s_{outputid}_%%04d.ts", uuid),
				"-master_pl_name", fmt.Sprintf("%s.m3u8", uuid),
				"-master_pl_publish_rate", "2",
				"-method", "PUT",
			},
			Cleanup: []ProcessCleanup{
				{
					Pattern:           fmt.Sprintf("memfs:/%s**", uuid),
					MaxFiles:          0,
					MaxFileAgeSeconds: 0,
					PurgeOnDelete:     true,
				},
				{
					Pattern:           fmt.Sprintf("memfs:/%s_{outputid}.m3u8", uuid),
					MaxFiles:          0,
					MaxFileAgeSeconds: 24,
					PurgeOnDelete:     true,
				},
				{
					Pattern:           fmt.Sprintf("memfs:/%s_{outputid}_**.ts", uuid),
					MaxFiles:          12,
					MaxFileAgeSeconds: 24,
					PurgeOnDelete:     true,
				},
				{
					Pattern:           fmt.Sprintf("memfs:/%s.m3u8", uuid),
					MaxFiles:          0,
					MaxFileAgeSeconds: 24,
					PurgeOnDelete:     true,
				},
			},
		}},
		Options: []string{
			"-err_detect", "ignore_err",
			"-y",
		},
		Autostart:             true,
		Reconnect:             true,
		ReconnectDelaySeconds: 15,
		StaleTimeoutSeconds:   30,
		Limits: &ProcessLimits{
			CPUUsage:       0,
			MemoryMbytes:   0,
			WaitforSeconds: 5,
		},
	}
}

// ── UI metadata builder ───────────────────────────────────────────────

// BuildUIMetadata creates the restreamer-ui metadata blob that makes a
// process visible in the Restreamer UI. The name parameter is the
// human-readable stream name shown in the UI.
func BuildUIMetadata(name, rtspURL, uuid string) *UIMetadata {
	return &UIMetadata{
		Version: "1.14.0",
		Meta: UIMeta{
			Name:        name,
			Description: "Live from earth. Powered by datarhei Restreamer.",
			Author:      UIAuthor{Name: "", Description: ""},
		},
		Control: UIControl{
			HLS: UIControlHLS{
				Cleanup:         true,
				LHLS:            false,
				ListSize:        6,
				MasterPlaylist:  true,
				SegmentDuration: 2,
				Storage:         "memfs",
				Version:         3,
			},
			Process: UIControlProcess{
				Autostart:    true,
				Delay:        15,
				LowDelay:     false,
				Reconnect:    true,
				StaleTimeout: 30,
			},
			Snapshot: UIControlSnapshot{
				Enable:   true,
				Interval: 60,
			},
			Limits: UIControlLimits{
				CPUUsage:       0,
				MemoryMbytes:   0,
				WaitforSeconds: 5,
			},
			RTMP: UIControlRTMP{Enable: false},
			SRT:  UIControlSRT{Enable: false},
		},
		License: "CC BY 4.0",
		Player:  UIPlayer{},
		Profiles: []UIProfile{{
			Video: UIProfileTrack{
				Source: 0,
				Stream: 0,
				Decoder: UICodecConfig{
					Coder:    "default",
					Mapping:  UICodecMapping{Global: []string{}, Local: []string{}},
					Settings: map[string]string{},
				},
				Encoder: UICodecConfig{
					Coder:    "copy",
					Mapping:  UICodecMapping{Global: []string{}, Local: []string{"-codec:v", "copy"}},
					Settings: map[string]string{},
				},
				Filter: UIFilterConfig{Graph: "", Settings: map[string]any{}},
			},
			Audio: UIProfileTrack{
				Source: 0,
				Stream: 1,
				Coder:  "copy",
				Decoder: UICodecConfig{
					Coder:    "default",
					Mapping:  UICodecMapping{Global: []string{}, Local: []string{}},
					Settings: map[string]string{},
				},
				Encoder: UICodecConfig{
					Coder:    "copy",
					Mapping:  UICodecMapping{Global: []string{}, Local: []string{"-codec:a", "copy"}},
					Settings: map[string]string{},
				},
				Filter: UIFilterConfig{Graph: "", Settings: map[string]any{}},
			},
			Custom: UIProfileCustom{Selected: false, Stream: 0},
		}},
		Sources: []UISource{
			{
				Type: "network",
				Inputs: []UISourceInput{{
					Address: rtspURL,
					Options: []any{
						"-fflags", "+genpts",
						"-thread_queue_size", 512,
						"-timeout", 5000000,
						"-rtsp_transport", "tcp",
					},
				}},
				Settings: map[string]any{
					"address": rtspURL,
					"mode":    "pull",
					"rtsp": map[string]any{
						"stimeout": 5000000,
						"udp":      false,
					},
					"general": map[string]any{
						"fflags":                      []string{"genpts"},
						"thread_queue_size":           512,
						"probesize":                   5000000,
						"analyzeduration":             5000000,
						"analyzeduration_http":        20000000,
						"analyzeduration_rtmp":        3000000,
						"max_probe_packets":           2500,
						"copyts":                      false,
						"start_at_zero":               false,
						"avoid_negative_ts":           "auto",
						"use_wallclock_as_timestamps": false,
					},
					"http": map[string]any{
						"readNative":     true,
						"forceFramerate": false,
						"framerate":      25,
						"userAgent":      "",
						"referer":        "",
						"http_proxy":     "",
					},
					"username": "",
					"password": "",
					"push": map[string]any{
						"name": uuid,
						"type": "rtmp",
					},
				},
				Streams: []UIStream{},
			},
			{
				Type:     "",
				Inputs:   []UISourceInput{},
				Settings: map[string]any{},
				Streams:  []UIStream{},
			},
		},
		Streams: []UIStream{},
	}
}

// ExtractStreamName extracts the human-readable name from a process's metadata.
// Falls back to the process reference (UUID) if metadata is missing.
func ExtractStreamName(p *Process) string {
	if p.Metadata.RestreamerUI != nil && p.Metadata.RestreamerUI.Meta.Name != "" {
		return p.Metadata.RestreamerUI.Meta.Name
	}
	if p.Reference != "" {
		return p.Reference
	}
	return p.ID
}
