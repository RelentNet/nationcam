package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// azuraStation is the slice of AzuraCast's /api/stations we care about.
type azuraStation struct {
	Name      string `json:"name"`
	Shortcode string `json:"shortcode"`
	ListenURL string `json:"listen_url"`
	Mounts    []struct {
		URL       string `json:"url"`
		Format    string `json:"format"`
		IsDefault bool   `json:"is_default"`
	} `json:"mounts"`
}

// audioStation is what we return to the viewer: a slim, publicly-playable station.
type audioStation struct {
	Name      string `json:"name"`
	Shortcode string `json:"shortcode"`
	StreamURL string `json:"stream_url"`
}

var azuraClient = &http.Client{Timeout: 5 * time.Second}

// AudioStations handles GET /audio/stations — proxies the AzuraCast station list
// and rewrites each stream URL to a public HTTPS one under azuracastURL.
//
// The feature is fully optional: if azuracastURL is empty, or AzuraCast is
// unreachable / returns junk, it responds 200 with [] and never a 5xx — the
// player simply shows no picker.
func AudioStations(azuracastURL string) http.HandlerFunc {
	base := strings.TrimRight(azuracastURL, "/")
	return func(w http.ResponseWriter, r *http.Request) {
		if base == "" {
			writeJSON(w, http.StatusOK, []audioStation{})
			return
		}

		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, base+"/api/stations", nil)
		if err != nil {
			slog.Error("audio stations: build request", "error", err)
			writeJSON(w, http.StatusOK, []audioStation{})
			return
		}

		resp, err := azuraClient.Do(req)
		if err != nil {
			slog.Warn("audio stations: AzuraCast unreachable", "error", err)
			writeJSON(w, http.StatusOK, []audioStation{})
			return
		}
		defer resp.Body.Close()

		var raw []azuraStation
		if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
			slog.Warn("audio stations: decode failed", "status", resp.StatusCode, "error", err)
			writeJSON(w, http.StatusOK, []audioStation{})
			return
		}

		out := make([]audioStation, 0, len(raw))
		for _, s := range raw {
			streamURL := rewriteStreamURL(base, s)
			if streamURL == "" {
				continue
			}
			out = append(out, audioStation{Name: s.Name, Shortcode: s.Shortcode, StreamURL: streamURL})
		}
		writeJSON(w, http.StatusOK, out)
	}
}

// rewriteStreamURL turns AzuraCast's internal LAN address (e.g.
// http://192.168.1.182:8383/listen/fnit/radio.mp3) into a public HTTPS URL by
// keeping only the path and prepending base. Returns "" if no usable mount.
func rewriteStreamURL(base string, s azuraStation) string {
	src := pickMountURL(s)
	if src == "" {
		return ""
	}
	u, err := url.Parse(src)
	if err != nil || u.Path == "" {
		return ""
	}
	rewritten := base + u.Path
	if u.RawQuery != "" {
		rewritten += "?" + u.RawQuery
	}
	return rewritten
}

// pickMountURL prefers an mp3 mount, then the default mount, then the first
// mount, then the station's listen_url. (The current single mount is labeled
// MP3 but served as audio/aac — the <audio> element plays it fine, so we don't
// hard-require format=="mp3".)
func pickMountURL(s azuraStation) string {
	var first, def string
	for _, m := range s.Mounts {
		if m.URL == "" {
			continue
		}
		if strings.EqualFold(m.Format, "mp3") {
			return m.URL
		}
		if first == "" {
			first = m.URL
		}
		if m.IsDefault && def == "" {
			def = m.URL
		}
	}
	switch {
	case def != "":
		return def
	case first != "":
		return first
	default:
		return s.ListenURL
	}
}
