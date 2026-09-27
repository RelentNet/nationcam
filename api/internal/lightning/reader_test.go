package lightning

import (
	"math"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

// fixtureKey is the real GLM file under testdata — one 20-second window
// downloaded from noaa-goes19 (the smallest of its hour). Its key encodes
// the observation window, which the parser's times must land inside.
const fixtureKey = "GLM-L2-LCFA/2026/270/17/OR_GLM-L2-LCFA_G19_s20262701701400_e20262701702000_c20262701702019.nc"

func fixturePath(t *testing.T) string {
	t.Helper()
	p := filepath.Join("testdata", filepath.Base(fixtureKey))
	if _, err := os.Stat(p); err != nil {
		t.Fatalf("fixture missing: %v", err)
	}
	return p
}

func fixtureBytes(t *testing.T) []byte {
	t.Helper()
	b, err := os.ReadFile(fixturePath(t))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestParseRealGLMFile(t *testing.T) {
	flashes, err := ParseFile(fixturePath(t))
	if err != nil {
		t.Fatalf("ParseFile: %v", err)
	}
	if len(flashes) == 0 {
		t.Fatal("no flashes parsed from a real file")
	}

	start, end, ok := KeyTimes(fixtureKey)
	if !ok {
		t.Fatal("fixture key did not parse")
	}
	// A flash's first event may precede the file window by up to the
	// add_offset (-5 s) and the scaled range tops out at +20 s.
	lo, hi := start.Add(-5*time.Second), end.Add(5*time.Second)

	// GLM orders flashes by flash_id, not by first-event time, so the
	// parsed times are not monotone in file order — what must hold is that
	// every one lands inside the file's 20-second window (the offset
	// decoding: _Unsigned + scale_factor + add_offset all correct), and
	// that the whole set spans no more than that window.
	first, last := flashes[0].Time, flashes[0].Time
	for i, f := range flashes {
		if f.Lat < -90 || f.Lat > 90 || math.IsNaN(f.Lat) {
			t.Fatalf("flash %d: lat %v out of range", i, f.Lat)
		}
		if f.Lon < -180 || f.Lon > 180 || math.IsNaN(f.Lon) {
			t.Fatalf("flash %d: lon %v out of range", i, f.Lon)
		}
		if f.Time.Before(lo) || f.Time.After(hi) {
			t.Fatalf("flash %d: time %v outside window [%v, %v]", i, f.Time, lo, hi)
		}
		if f.Time.Before(first) {
			first = f.Time
		}
		if f.Time.After(last) {
			last = f.Time
		}
	}
	if span := last.Sub(first); span > 25*time.Second {
		t.Fatalf("flash times span %v, more than one file window", span)
	}
	// Sorted by time they are monotone, and sorting is what the store's
	// consumers rely on rather than file order.
	sorted := append([]Flash(nil), flashes...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Time.Before(sorted[j].Time) })
	prev := sorted[0].Time
	for i, f := range sorted[1:] {
		if f.Time.Before(prev) {
			t.Fatalf("sorted flash %d: %v before %v", i+1, f.Time, prev)
		}
		prev = f.Time
	}

	// GOES-East sees the Americas: everything must be in the western
	// hemisphere and well inside the full disk.
	for i, f := range flashes {
		if f.Lon > 0 || f.Lon < -160 {
			t.Fatalf("flash %d: lon %v is not in GOES-East's field of view", i, f.Lon)
		}
	}
	t.Logf("parsed %d good flashes, earliest %v, latest %v", len(flashes), first.UTC(), last.UTC())
}

func TestParseBytesMatchesParseFile(t *testing.T) {
	a, err := ParseFile(fixturePath(t))
	if err != nil {
		t.Fatal(err)
	}
	b, err := ParseBytes(fixtureBytes(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != len(b) {
		t.Fatalf("ParseBytes returned %d flashes, ParseFile %d", len(b), len(a))
	}
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("flash %d differs: %+v vs %+v", i, a[i], b[i])
		}
	}
}

func TestParseRejectsGarbage(t *testing.T) {
	if _, err := ParseBytes([]byte("not a netcdf file at all")); err == nil {
		t.Fatal("expected an error for a non-NetCDF payload")
	}
}

func TestParseSince(t *testing.T) {
	want := time.Date(2026, 9, 27, 17, 0, 0, 0, time.UTC)
	for _, units := range []string{
		"seconds since 2026-09-27 17:00:00.000",
		"seconds since 2026-09-27 17:00:00",
		"seconds since 2026-09-27T17:00:00Z",
		"  seconds since 2026-09-27 17:00:00.000  ",
	} {
		got, ok := parseSince(units)
		if !ok || !got.Equal(want) {
			t.Errorf("parseSince(%q) = %v, %v; want %v", units, got, ok, want)
		}
	}
	for _, units := range []string{"", "1", "hours since 2026-09-27 17:00:00", "seconds since yesterday"} {
		if _, ok := parseSince(units); ok {
			t.Errorf("parseSince(%q) unexpectedly ok", units)
		}
	}
}

func TestToFloat64sHonorsUnsigned(t *testing.T) {
	// GLM stores flash_time_offset_of_first_event as int16 with
	// _Unsigned=true: a raw -1 is really 65535.
	got, bits, err := toFloat64s([]int16{-1, 0, 11331}, true)
	if err != nil {
		t.Fatal(err)
	}
	if bits != 16 || got[0] != 65535 || got[1] != 0 || got[2] != 11331 {
		t.Fatalf("unsigned int16 → %v (bits %d)", got, bits)
	}
	got, _, err = toFloat64s([]int16{-1}, false)
	if err != nil || got[0] != -1 {
		t.Fatalf("signed int16 → %v, %v", got, err)
	}
	if _, _, err := toFloat64s("nope", false); err == nil {
		t.Fatal("expected an error for a string value")
	}
}
