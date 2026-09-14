package handler

import (
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
)

// hostInput is the host / visit block an admin can set on a sublocation:
// coordinates (which unlock the weather panel), who hosts the camera, since
// when, and a street address. Embedded in the sublocation create/update bodies
// the same way brandingInput and aboutInput are. The pgtype fields marshal as
// number / "YYYY-MM-DD" or null, so the JSON shape is the same in and out.
type hostInput struct {
	Lat       pgtype.Float8 `json:"lat"`
	Lng       pgtype.Float8 `json:"lng"`
	HostName  string        `json:"host_name"`
	HostURL   string        `json:"host_url"`
	HostSince pgtype.Date   `json:"host_since"`
	Address   string        `json:"address"`
}

// normalizeHost trims the text fields and returns an error message ("" when
// valid). lat and lng must be set together and lie on the globe; host_url must
// be empty or an http(s) URL.
func (h *hostInput) normalizeHost() string {
	h.HostName = strings.TrimSpace(h.HostName)
	h.HostURL = strings.TrimSpace(h.HostURL)
	h.Address = strings.TrimSpace(h.Address)
	if h.Lat.Valid != h.Lng.Valid {
		return "lat and lng must be set together"
	}
	if h.Lat.Valid && (h.Lat.Float64 < -90 || h.Lat.Float64 > 90 || h.Lng.Float64 < -180 || h.Lng.Float64 > 180) {
		return "lat must be within -90..90 and lng within -180..180"
	}
	if h.HostURL != "" && !isHTTPURL(h.HostURL) {
		return "host_url must be empty or an http(s) URL"
	}
	return ""
}
