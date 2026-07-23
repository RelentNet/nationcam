package restreamer

import (
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

// sampleProcessList is a sanitized capture of GET /api/v3/process shaped like
// the real Restreamer response: config nested under "config", metadata at the
// top level, and — critically — an egress process whose restreamer-ui encode
// profile stores FFmpeg mappings as arrays-of-arrays ("global":[["-vsync",...]])
// and filter graphs as arrays. Decoding this into the old rich UI* types failed
// with "cannot unmarshal array into ... mapping.global of type string", which
// made ListProcesses error and 502'd GET /api/streams. No secrets — RTSP creds
// and keys are placeholders.
const sampleProcessList = `[
  {
    "id": "restreamer-ui:ingest:11111111-1111-1111-1111-111111111111",
    "type": "ffmpeg",
    "reference": "11111111-1111-1111-1111-111111111111",
    "created_at": 1750304233,
    "config": {
      "id": "restreamer-ui:ingest:11111111-1111-1111-1111-111111111111",
      "input": [{"id": "input_0", "address": "rtsp://user:pass@example/stream", "options": ["-rtsp_transport", "tcp"]}]
    },
    "state": {"order": "start", "exec": "running"},
    "metadata": {
      "restreamer-ui": {
        "meta": {"name": "Test Ingest Camera", "description": "d", "author": {"name": "", "description": ""}},
        "profiles": [{
          "audio": {"encoder": {"coder": "copy", "mapping": {"filter": [], "global": [], "local": ["-codec:a", "copy"]}, "settings": {}}}
        }]
      }
    }
  },
  {
    "id": "restreamer-ui:egress:youtube:22222222-2222-2222-2222-222222222222",
    "type": "ffmpeg",
    "reference": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "created_at": 1750304299,
    "config": {"id": "restreamer-ui:egress:youtube:22222222-2222-2222-2222-222222222222"},
    "state": {"order": "start", "exec": "running"},
    "metadata": {
      "restreamer-ui": {
        "meta": {"name": "YouTube Egress", "description": "d", "author": {"name": "", "description": ""}},
        "profiles": [{
          "audio": {
            "encoder": {
              "coder": "libmp3lame",
              "mapping": {
                "filter": [],
                "global": [["-vsync", "drop"]],
                "local": ["-codec:a", "libmp3lame", "-b:a", "256k"]
              },
              "settings": {"bitrate": "256"}
            },
            "filter": {
              "graph": "aresample=osr=48000",
              "settings": {"pan": {"graph": [], "settings": {"value": "inherit"}}}
            }
          }
        }]
      }
    }
  }
]`

// TestDecodeProcessList is the regression test for the Restreamer 502: the real
// process list must decode without error and yield the display names.
func TestDecodeProcessList(t *testing.T) {
	var procs []Process
	if err := json.Unmarshal([]byte(sampleProcessList), &procs); err != nil {
		t.Fatalf("decode process list: %v", err)
	}
	if len(procs) != 2 {
		t.Fatalf("got %d processes, want 2", len(procs))
	}
	if got := ExtractStreamName(&procs[0]); got != "Test Ingest Camera" {
		t.Errorf("name[0] = %q, want %q", got, "Test Ingest Camera")
	}
	if got := ExtractStreamName(&procs[1]); got != "YouTube Egress" {
		t.Errorf("name[1] = %q, want %q", got, "YouTube Egress")
	}
}

func TestParseJWTExpiry(t *testing.T) {
	const exp = 2000000000 // 2033-05-18
	payload := base64.RawURLEncoding.EncodeToString([]byte(`{"exp":2000000000,"sub":"admin"}`))
	token := "header." + payload + ".sig"

	got := parseJWTExpiry(token)
	if !got.Equal(time.Unix(exp, 0)) {
		t.Errorf("parseJWTExpiry = %v, want %v", got, time.Unix(exp, 0))
	}

	// Malformed tokens fall back to a near-future time, never the zero value
	// (a zero/epoch expiry would make every request treat the token as expired).
	if fb := parseJWTExpiry("not-a-jwt"); !fb.After(time.Now()) {
		t.Errorf("malformed token fallback = %v, want a future time", fb)
	}
}
