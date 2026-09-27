package handler

import (
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
)

// conditionsOverrideInput lets an admin pin (or turn off) which NOAA tide
// station and USGS river gauge a sublocation's conditions page uses, instead
// of always taking the nearest one — the nearest pick can land on the wrong
// body of water (DAN-28: a Mississippi River levee camera picking up tides
// and river stage from a nearby lake, both merely within the distance
// limits). Embedded in the sublocation create/update bodies the same way
// hostInput is. An empty string means "no override, use the nearest lookup";
// the sentinel "none" disables that source entirely for the sublocation.
type conditionsOverrideInput struct {
	NoaaStationID string `json:"noaa_station_id"`
	UsgsSiteID    string `json:"usgs_site_id"`
}

// normalizeConditionsOverride trims both fields. Any value — including the
// "none" sentinel — is accepted here; the conditions handler is what
// interprets it. Kept as a normalize method (matching brandingInput /
// hostInput / aboutInput) even though nothing can fail today, since these are
// free-text IDs the API cannot validate against NOAA/USGS without a network
// round trip.
func (c *conditionsOverrideInput) normalizeConditionsOverride() string {
	c.NoaaStationID = strings.TrimSpace(c.NoaaStationID)
	c.UsgsSiteID = strings.TrimSpace(c.UsgsSiteID)
	return ""
}

// overrideText converts a form field to the nullable column value: empty
// means "no override" (NULL, falls back to nearest); anything else —
// including "none" — is stored verbatim.
func overrideText(v string) pgtype.Text {
	if v == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: v, Valid: true}
}
