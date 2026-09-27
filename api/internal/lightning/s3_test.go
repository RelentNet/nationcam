package lightning

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

func utc(h, m, s int) time.Time {
	return time.Date(2026, 9, 27, h, m, s, 0, time.UTC)
}

func TestHourPrefix(t *testing.T) {
	for _, tc := range []struct {
		t    time.Time
		want string
	}{
		{utc(17, 0, 0), "GLM-L2-LCFA/2026/270/17/"},
		{utc(17, 59, 59), "GLM-L2-LCFA/2026/270/17/"},
		{time.Date(2026, 1, 1, 0, 5, 0, 0, time.UTC), "GLM-L2-LCFA/2026/001/00/"},
		{time.Date(2026, 12, 31, 23, 0, 0, 0, time.UTC), "GLM-L2-LCFA/2026/365/23/"},
		// Non-UTC input is normalised.
		{time.Date(2026, 9, 27, 12, 0, 0, 0, time.FixedZone("CDT", -5*3600)), "GLM-L2-LCFA/2026/270/17/"},
	} {
		if got := HourPrefix(tc.t); got != tc.want {
			t.Errorf("HourPrefix(%v) = %q, want %q", tc.t, got, tc.want)
		}
	}
}

func TestHourPrefixesSpansBoundaries(t *testing.T) {
	got := HourPrefixes(utc(16, 30, 0), utc(17, 10, 0))
	want := []string{"GLM-L2-LCFA/2026/270/16/", "GLM-L2-LCFA/2026/270/17/"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("HourPrefixes = %v, want %v", got, want)
	}
	// Across a year boundary.
	got = HourPrefixes(time.Date(2026, 12, 31, 23, 30, 0, 0, time.UTC), time.Date(2027, 1, 1, 0, 1, 0, 0, time.UTC))
	want = []string{"GLM-L2-LCFA/2026/365/23/", "GLM-L2-LCFA/2027/001/00/"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("HourPrefixes across year = %v, want %v", got, want)
	}
	// from after to collapses to to's hour.
	got = HourPrefixes(utc(18, 0, 0), utc(17, 0, 0))
	if !reflect.DeepEqual(got, []string{"GLM-L2-LCFA/2026/270/17/"}) {
		t.Errorf("HourPrefixes(from>to) = %v", got)
	}
}

func keyAt(t time.Time) string {
	stamp := func(x time.Time) string {
		return fmt.Sprintf("%04d%03d%02d%02d%02d0", x.Year(), x.YearDay(), x.Hour(), x.Minute(), x.Second())
	}
	return HourPrefix(t) + "OR_GLM-L2-LCFA_G19_s" + stamp(t) + "_e" + stamp(t.Add(20*time.Second)) + "_c" + stamp(t.Add(22*time.Second)) + ".nc"
}

func TestPrefixesToList(t *testing.T) {
	h16, h17 := "GLM-L2-LCFA/2026/270/16/", "GLM-L2-LCFA/2026/270/17/"
	for _, tc := range []struct {
		name    string
		now     time.Time
		lastKey string
		want    []string
	}{
		{"cold start lists the whole retention window", utc(17, 30, 0), "", []string{h16, h17}},
		{"cold start exactly on the hour", utc(17, 0, 0), "", []string{h16, h17}},
		{"mid-hour, last key a minute ago", utc(17, 30, 0), keyAt(utc(17, 28, 40)), []string{h17}},
		{"within 2 min of the boundary, last key in the previous hour", utc(17, 1, 0), keyAt(utc(16, 59, 40)), []string{h16, h17}},
		{"within 2 min of the boundary even if the last key is already in the new hour", utc(17, 1, 30), keyAt(utc(17, 0, 40)), []string{h16, h17}},
		{"just past the 2 min grace, last key in the new hour", utc(17, 2, 30), keyAt(utc(17, 1, 40)), []string{h17}},
		{"past the grace but last key still in the previous hour (stalled run)", utc(17, 10, 0), keyAt(utc(16, 50, 0)), []string{h16, h17}},
		{"last key older than retention is floored", utc(17, 30, 0), keyAt(utc(12, 0, 0)), []string{h16, h17}},
		{"unparseable last key falls back to the grace rule", utc(17, 30, 0), "garbage", []string{h17}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := PrefixesToList(tc.now, tc.lastKey)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("PrefixesToList(%v, %q) = %v, want %v", tc.now, tc.lastKey, got, tc.want)
			}
		})
	}
}

func TestKeyTimes(t *testing.T) {
	start, end, ok := KeyTimes(fixtureKey)
	if !ok {
		t.Fatal("fixture key did not parse")
	}
	// s20262701701400 = 2026, day 270, 17:01:40.0 (the fixture is the
	// 17:01:40–17:02:00 window).
	if !start.Equal(utc(17, 1, 40)) || !end.Equal(utc(17, 2, 0)) {
		t.Errorf("KeyTimes = %v → %v", start, end)
	}
	// Tenths of a second are honoured.
	_, end, ok = KeyTimes("x_s20262701700000_e20262701700205_c20262701700220.nc")
	if !ok || !end.Equal(utc(17, 0, 20).Add(500*time.Millisecond)) {
		t.Errorf("tenths: %v, %v", end, ok)
	}
	for _, bad := range []string{"", "OR_GLM-L2-LCFA_G19.nc", "x_s2026270170000_e20262701700200_c20262701700220.nc", "x_s20262701700000_e20262701700200_c20262701700220.txt", "x_s20264001700000_e20264001700200_c20264001700220.nc"} {
		if _, _, ok := KeyTimes(bad); ok {
			t.Errorf("KeyTimes(%q) unexpectedly ok", bad)
		}
	}
	// keyAt round-trips.
	s, _, ok := KeyTimes(keyAt(utc(16, 59, 40)))
	if !ok || !s.Equal(utc(16, 59, 40)) {
		t.Errorf("keyAt round trip = %v, %v", s, ok)
	}
}

func TestS3ClientListFollowsContinuation(t *testing.T) {
	page := func(keys []string, next string) string {
		var b strings.Builder
		b.WriteString(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">`)
		if next != "" {
			b.WriteString("<IsTruncated>true</IsTruncated><NextContinuationToken>" + next + "</NextContinuationToken>")
		} else {
			b.WriteString("<IsTruncated>false</IsTruncated>")
		}
		for _, k := range keys {
			b.WriteString("<Contents><Key>" + k + "</Key><LastModified>2026-09-27T17:00:27.000Z</LastModified><Size>234124</Size></Contents>")
		}
		b.WriteString("</ListBucketResult>")
		return b.String()
	}
	var prefixes, tokens []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			prefixes = append(prefixes, r.URL.Query().Get("prefix"))
			tok := r.URL.Query().Get("continuation-token")
			tokens = append(tokens, tok)
			if tok == "" {
				fmt.Fprint(w, page([]string{"p/a.nc", "p/b.nc"}, "tok2"))
			} else {
				fmt.Fprint(w, page([]string{"p/c.nc"}, ""))
			}
			return
		}
		if r.URL.Path == "/p/c.nc" {
			w.Write([]byte("hello"))
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	c := &S3Client{Bucket: "test", HTTP: srv.Client()}
	// Point the client at the test server by swapping the base through a
	// transport that rewrites the host.
	c.HTTP.Transport = rewriteHost(srv.URL, srv.Client().Transport)

	objs, err := c.List(context.Background(), "p/")
	if err != nil {
		t.Fatal(err)
	}
	if len(objs) != 3 || objs[2].Key != "p/c.nc" || objs[0].Size != 234124 {
		t.Fatalf("objs = %+v", objs)
	}
	if !reflect.DeepEqual(prefixes, []string{"p/", "p/"}) || !reflect.DeepEqual(tokens, []string{"", "tok2"}) {
		t.Fatalf("requests: prefixes=%v tokens=%v", prefixes, tokens)
	}

	body, err := c.Fetch(context.Background(), "p/c.nc")
	if err != nil || string(body) != "hello" {
		t.Fatalf("Fetch = %q, %v", body, err)
	}
	if _, err := c.Fetch(context.Background(), "p/missing.nc"); err == nil {
		t.Fatal("expected an error for a 404")
	}
}

// rewriteHost sends every request to the test server regardless of the URL
// the client built.
func rewriteHost(target string, next http.RoundTripper) http.RoundTripper {
	return roundTripFunc(func(r *http.Request) (*http.Response, error) {
		u := *r.URL
		u.Scheme = strings.SplitN(target, "://", 2)[0]
		u.Host = strings.SplitN(target, "://", 2)[1]
		r2 := r.Clone(r.Context())
		r2.URL = &u
		r2.Host = u.Host
		return next.RoundTrip(r2)
	})
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
