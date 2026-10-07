package handler

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"runtime"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
)

// Load check for the segment relay (DAN-242). A fake Restreamer serves one
// in-memory segment; clients fetch it either through the proxy (token +
// Referer, real TCP on both legs) or straight from the fake upstream, so the
// difference is the proxy's cost.
//
//	HLS_LOAD=1 go test ./internal/handler -run TestHLSLoadHarness -v
//	go test ./internal/handler -run '^$' -bench HLSSegment -benchmem

const hlsLoadSegmentSize = 512 << 10 // a 2 s segment at ~2 Mbit/s

func hlsLoadServers(tb testing.TB) (proxy, upstream *httptest.Server) {
	tb.Helper()
	seg := make([]byte, hlsLoadSegmentSize)
	for i := range seg {
		seg[i] = byte(i)
	}
	upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "video/mp2t")
		w.Header().Set("Content-Length", fmt.Sprint(len(seg)))
		_, _ = w.Write(seg)
	}))
	tb.Cleanup(upstream.Close)

	store := fakeHLSStore{srcs: map[int32]string{1: upstream.URL + "/memfs/cam.m3u8"}}
	manifest, segment, poster := newHLSHandlers(store, nil, newHLSClient())
	r := chi.NewRouter()
	r.Get("/api/hls/{video_id}/index.m3u8", manifest)
	r.Get("/api/hls/{video_id}/poster.jpg", poster)
	r.Get("/api/hls/{video_id}/{segment}", segment)
	proxy = httptest.NewServer(r)
	tb.Cleanup(proxy.Close)
	return proxy, upstream
}

type hlsLoadResult struct {
	reqs     int
	errs     int64
	rps      float64
	p50, p99 time.Duration
	// Whole-process allocations per request (client + proxy + fake
	// upstream); proxy minus direct is the proxy's share.
	allocs, allocKB float64
}

func hlsLoadRun(target string, hdr http.Header, clients int, d time.Duration) hlsLoadResult {
	tr := &http.Transport{MaxIdleConns: clients * 2, MaxIdleConnsPerHost: clients * 2, DisableCompression: true}
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr}

	var (
		mu   sync.Mutex
		lats []time.Duration
		errs atomic.Int64
		wg   sync.WaitGroup
	)
	var ms0, ms1 runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&ms0)
	deadline := time.Now().Add(d)
	start := time.Now()
	for range clients {
		wg.Add(1)
		go func() {
			defer wg.Done()
			local := make([]time.Duration, 0, 1024)
			for time.Now().Before(deadline) {
				req, _ := http.NewRequest(http.MethodGet, target, nil)
				req.Header = hdr.Clone()
				t0 := time.Now()
				resp, err := client.Do(req)
				if err != nil {
					errs.Add(1)
					continue
				}
				n, _ := io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				if resp.StatusCode != http.StatusOK || n != hlsLoadSegmentSize {
					errs.Add(1)
					continue
				}
				local = append(local, time.Since(t0))
			}
			mu.Lock()
			lats = append(lats, local...)
			mu.Unlock()
		}()
	}
	wg.Wait()
	elapsed := time.Since(start)
	runtime.ReadMemStats(&ms1)
	sort.Slice(lats, func(i, j int) bool { return lats[i] < lats[j] })
	res := hlsLoadResult{reqs: len(lats), errs: errs.Load(), rps: float64(len(lats)) / elapsed.Seconds()}
	if len(lats) > 0 {
		res.allocs = float64(ms1.Mallocs-ms0.Mallocs) / float64(len(lats))
		res.allocKB = float64(ms1.TotalAlloc-ms0.TotalAlloc) / float64(len(lats)) / 1024
		res.p50 = lats[len(lats)/2]
		res.p99 = lats[len(lats)*99/100]
	}
	return res
}

func TestHLSLoadHarness(t *testing.T) {
	if os.Getenv("HLS_LOAD") == "" {
		t.Skip("set HLS_LOAD=1 to run the load harness")
	}
	proxy, upstream := hlsLoadServers(t)
	tokenHdr := http.Header{}
	tokenHdr.Set("Referer", "https://nationcam.com/locations/x")
	// Long enough for the run; renewed tokens are the player's job.
	tokenHdr.Set(hlsTokenHeader, currentHLSSigner().playerToken(1, hlsNow().Add(time.Hour).Unix()))

	d := 5 * time.Second
	if v := os.Getenv("HLS_LOAD_SECONDS"); v != "" {
		if n, err := time.ParseDuration(v + "s"); err == nil {
			d = n
		}
	}
	for _, clients := range []int{50, 200} {
		direct := hlsLoadRun(upstream.URL+"/memfs/seg1.ts", http.Header{}, clients, d)
		proxied := hlsLoadRun(proxy.URL+"/api/hls/1/seg1.ts", tokenHdr, clients, d)
		for _, row := range []struct {
			name string
			r    hlsLoadResult
		}{{"direct", direct}, {"proxy", proxied}} {
			t.Logf("clients=%-3d %-6s reqs=%-6d errs=%-3d rps=%8.1f p50=%-10s p99=%-10s MB/s=%-5.0f allocs/req=%.0f KB/req=%.1f",
				clients, row.name, row.r.reqs, row.r.errs, row.r.rps, row.r.p50.Round(10*time.Microsecond), row.r.p99.Round(10*time.Microsecond),
				row.r.rps*hlsLoadSegmentSize/(1<<20), row.r.allocs, row.r.allocKB)
		}
		if proxied.errs > 0 {
			t.Errorf("clients=%d: %d proxied requests failed", clients, proxied.errs)
		}
	}
}

// discardResponse is a ResponseWriter that drops the body, so a benchmark
// counts only the proxy's own allocations (upstream request included).
type discardResponse struct{ h http.Header }

func (d *discardResponse) Header() http.Header         { return d.h }
func (d *discardResponse) Write(p []byte) (int, error) { return len(p), nil }
func (d *discardResponse) WriteHeader(int)             {}

func BenchmarkHLSSegmentProxy(b *testing.B) {
	// Drive the router in-process so allocations are the handler's, with the
	// upstream leg over real TCP.
	_, upstream := hlsLoadServers(b)
	st := fakeHLSStore{srcs: map[int32]string{1: upstream.URL + "/memfs/cam.m3u8"}}
	_, segment, _ := newHLSHandlers(st, nil, newHLSClient())
	r := chi.NewRouter()
	r.Get("/api/hls/{video_id}/{segment}", segment)
	tok := currentHLSSigner().playerToken(1, hlsNow().Add(time.Hour).Unix())

	b.SetBytes(hlsLoadSegmentSize)
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		req := httptest.NewRequest(http.MethodGet, "/api/hls/1/seg1.ts", nil)
		req.Header.Set(hlsTokenHeader, tok)
		req.Header.Set("Referer", "https://nationcam.com/")
		w := &discardResponse{h: http.Header{}}
		r.ServeHTTP(w, req)
	}
}

func BenchmarkHLSSegmentDirect(b *testing.B) {
	_, upstream := hlsLoadServers(b)
	client := newHLSClient()
	b.SetBytes(hlsLoadSegmentSize)
	b.ReportAllocs()
	b.ResetTimer()
	for b.Loop() {
		resp, err := client.Get(upstream.URL + "/memfs/seg1.ts")
		if err != nil {
			b.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}
}
