package lightning

import (
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"
)

// DefaultBucket is GOES-East. GOES-West (noaa-goes18) has the same layout
// if a west-coast site ever needs it.
const DefaultBucket = "noaa-goes19"

// KeyPrefix is the product prefix every LCFA key starts with; the hour
// prefixes the job lists are KeyPrefix + "YYYY/DDD/HH/".
const KeyPrefix = "GLM-L2-LCFA/"

// maxFileBytes bounds one fetched file. LCFA files are ~230 KB; anything
// past this is not a GLM file.
const maxFileBytes = 16 << 20

// Object is one S3 listing entry.
type Object struct {
	Key          string
	Size         int64
	LastModified time.Time
}

// Lister lists the objects under a prefix (newest S3 listing semantics: every
// key, lexicographic order, paginated internally).
type Lister interface {
	List(ctx context.Context, prefix string) ([]Object, error)
}

// Fetcher downloads one object by key.
type Fetcher interface {
	Fetch(ctx context.Context, key string) ([]byte, error)
}

// S3Client lists and fetches from a public NOAA Open Data bucket over plain
// HTTPS — no credentials, no SDK. It is both a Lister and a Fetcher.
type S3Client struct {
	Bucket string
	HTTP   *http.Client
}

// NewS3Client returns a client for bucket with a conservative overall
// timeout; the job puts a tighter per-request deadline on the context.
func NewS3Client(bucket string) *S3Client {
	if bucket == "" {
		bucket = DefaultBucket
	}
	return &S3Client{Bucket: bucket, HTTP: &http.Client{Timeout: 60 * time.Second}}
}

func (c *S3Client) base() string {
	return "https://" + c.Bucket + ".s3.amazonaws.com/"
}

type listBucketResult struct {
	IsTruncated           bool   `xml:"IsTruncated"`
	NextContinuationToken string `xml:"NextContinuationToken"`
	Contents              []struct {
		Key          string    `xml:"Key"`
		Size         int64     `xml:"Size"`
		LastModified time.Time `xml:"LastModified"`
	} `xml:"Contents"`
}

// List implements Lister with ListObjectsV2, following continuation tokens.
func (c *S3Client) List(ctx context.Context, prefix string) ([]Object, error) {
	var out []Object
	token := ""
	for {
		q := url.Values{"list-type": {"2"}, "prefix": {prefix}}
		if token != "" {
			q.Set("continuation-token", token)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base()+"?"+q.Encode(), nil)
		if err != nil {
			return nil, err
		}
		res, err := c.HTTP.Do(req)
		if err != nil {
			return nil, err
		}
		body, err := io.ReadAll(io.LimitReader(res.Body, maxFileBytes))
		res.Body.Close()
		if err != nil {
			return nil, err
		}
		if res.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("list %s: status %d", prefix, res.StatusCode)
		}
		var page listBucketResult
		if err := xml.Unmarshal(body, &page); err != nil {
			return nil, fmt.Errorf("list %s: %w", prefix, err)
		}
		for _, e := range page.Contents {
			out = append(out, Object{Key: e.Key, Size: e.Size, LastModified: e.LastModified})
		}
		if !page.IsTruncated || page.NextContinuationToken == "" {
			return out, nil
		}
		token = page.NextContinuationToken
	}
}

// Fetch implements Fetcher with a plain GET of the object.
func (c *S3Client) Fetch(ctx context.Context, key string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base()+key, nil)
	if err != nil {
		return nil, err
	}
	res, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch %s: status %d", key, res.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(res.Body, maxFileBytes+1))
	if err != nil {
		return nil, err
	}
	if len(body) > maxFileBytes {
		return nil, fmt.Errorf("fetch %s: larger than %d bytes", key, maxFileBytes)
	}
	return body, nil
}

/* ──── Keys and prefixes ──── */

// HourPrefix is the listing prefix for the UTC hour containing t:
// "GLM-L2-LCFA/YYYY/DDD/HH/" with DDD the day of year.
func HourPrefix(t time.Time) string {
	t = t.UTC()
	return fmt.Sprintf("%s%04d/%03d/%02d/", KeyPrefix, t.Year(), t.YearDay(), t.Hour())
}

// HourPrefixes is one prefix per UTC hour from `from` through `to`,
// inclusive of both hours. A `from` after `to` yields just to's hour.
func HourPrefixes(from, to time.Time) []string {
	from, to = from.UTC().Truncate(time.Hour), to.UTC().Truncate(time.Hour)
	if from.After(to) {
		from = to
	}
	var out []string
	for h := from; !h.After(to); h = h.Add(time.Hour) {
		out = append(out, HourPrefix(h))
	}
	return out
}

// boundaryGrace is how long after an hour boundary the previous hour is
// still listed, since a file's key lives in the hour its window *started*
// and it appears ~20 s after that window ends.
const boundaryGrace = 2 * time.Minute

// PrefixesToList decides which hour prefixes a tick lists: the current hour,
// the previous hour within boundaryGrace of the boundary, and — so a slow or
// interrupted run never skips an hour — every hour back to the last key
// processed, floored at Retention. With no last key (cold start) the whole
// Retention window is listed so the buffer fills immediately.
func PrefixesToList(now time.Time, lastKey string) []string {
	from := now.Add(-boundaryGrace)
	floor := now.Add(-Retention)
	if lastKey == "" {
		from = floor
	} else if start, _, ok := KeyTimes(lastKey); ok && start.Before(from) {
		from = start
	}
	if from.Before(floor) {
		from = floor
	}
	return HourPrefixes(from, now)
}

// keyStamp matches the start/end/creation stamps in an LCFA key:
// ..._sYYYYDDDHHMMSSt_eYYYYDDDHHMMSSt_cYYYYDDDHHMMSSt.nc (t = tenths).
var keyStamp = regexp.MustCompile(`_s(\d{14})_e(\d{14})_c(\d{14})\.nc$`)

// KeyTimes parses the observation window (start, end) out of an LCFA key.
// ok is false for any key not in the product's naming scheme.
func KeyTimes(key string) (start, end time.Time, ok bool) {
	m := keyStamp.FindStringSubmatch(key)
	if m == nil {
		return time.Time{}, time.Time{}, false
	}
	start, ok1 := parseStamp(m[1])
	end, ok2 := parseStamp(m[2])
	return start, end, ok1 && ok2
}

func parseStamp(s string) (time.Time, bool) {
	if len(s) != 14 {
		return time.Time{}, false
	}
	year, e1 := strconv.Atoi(s[0:4])
	doy, e2 := strconv.Atoi(s[4:7])
	hh, e3 := strconv.Atoi(s[7:9])
	mm, e4 := strconv.Atoi(s[9:11])
	ss, e5 := strconv.Atoi(s[11:13])
	tenth, e6 := strconv.Atoi(s[13:14])
	if e1 != nil || e2 != nil || e3 != nil || e4 != nil || e5 != nil || e6 != nil {
		return time.Time{}, false
	}
	if doy < 1 || doy > 366 || hh > 23 || mm > 59 || ss > 60 {
		return time.Time{}, false
	}
	t := time.Date(year, 1, 1, hh, mm, ss, tenth*100_000_000, time.UTC).AddDate(0, 0, doy-1)
	return t, true
}
