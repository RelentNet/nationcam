package handler

import (
	"encoding/json"
	"testing"
)

func TestHostInputJSON(t *testing.T) {
	var h hostInput
	if err := json.Unmarshal([]byte(`{"lat":29.277,"lng":-89.354,"host_name":" Venice Marina ","host_url":"https://www.venicemarina.com/","host_since":"2026-02-01","address":""}`), &h); err != nil {
		t.Fatal(err)
	}
	if msg := h.normalizeHost(); msg != "" {
		t.Fatalf("valid host rejected: %q", msg)
	}
	if !h.Lat.Valid || h.Lat.Float64 != 29.277 || !h.HostSince.Valid || h.HostName != "Venice Marina" {
		t.Fatalf("decoded wrong: %+v", h)
	}

	// Nulls decode to invalid (unset) values and pass validation.
	h = hostInput{}
	if err := json.Unmarshal([]byte(`{"lat":null,"lng":null,"host_since":null}`), &h); err != nil {
		t.Fatal(err)
	}
	if msg := h.normalizeHost(); msg != "" || h.Lat.Valid || h.HostSince.Valid {
		t.Fatalf("null host: msg=%q lat=%v since=%v", msg, h.Lat.Valid, h.HostSince.Valid)
	}

	for _, bad := range []string{
		`{"lat":29.277}`,                     // lng missing
		`{"lat":91,"lng":0}`,                 // off the globe
		`{"host_url":"javascript:alert(1)"}`, // not http(s)
	} {
		h = hostInput{}
		if err := json.Unmarshal([]byte(bad), &h); err != nil {
			t.Fatal(err)
		}
		if msg := h.normalizeHost(); msg == "" {
			t.Errorf("%s accepted, want rejection", bad)
		}
	}
}
