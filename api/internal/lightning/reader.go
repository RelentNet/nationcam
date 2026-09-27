package lightning

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"strings"
	"time"

	"github.com/batchatco/go-native-netcdf/netcdf"
	"github.com/batchatco/go-native-netcdf/netcdf/api"
)

// GLM LCFA variables the reader depends on. Everything else in the file
// (events, groups, energies, bounds) is ignored.
const (
	varLat     = "flash_lat"
	varLon     = "flash_lon"
	varTime    = "flash_time_offset_of_first_event"
	varQuality = "flash_quality_flag"
	varProduct = "product_time"
)

// goodQuality is the flash_quality_flag value for a good-quality flash. The
// other flag values (1, 3, 5) mark degraded flashes and are dropped.
const goodQuality = 0

// Parse reads one GLM L2 LCFA NetCDF4 (HDF5) file and returns its
// good-quality flashes. It uses a pure-Go NetCDF reader — no CGO.
//
// Values are decoded the way the CF conventions say to: `_Unsigned` promotes
// the raw integer, `_FillValue` (in the raw domain) becomes "no value",
// then `scale_factor` and `add_offset` are applied. Times are the
// per-flash offset in seconds from the epoch named in that variable's
// `units` attribute ("seconds since YYYY-MM-DD HH:MM:SS.fff"), falling back
// to `product_time` (seconds since the J2000 epoch) if the units are not in
// that form.
func Parse(r io.ReadSeeker) ([]Flash, error) {
	g, err := netcdf.New(nopCloser{r})
	if err != nil {
		return nil, fmt.Errorf("lightning: open netcdf: %w", err)
	}
	defer g.Close()

	lat, _, err := floatVar(g, varLat)
	if err != nil {
		return nil, err
	}
	lon, _, err := floatVar(g, varLon)
	if err != nil {
		return nil, err
	}
	offset, timeAttrs, err := floatVar(g, varTime)
	if err != nil {
		return nil, err
	}
	quality, _, err := floatVar(g, varQuality)
	if err != nil {
		return nil, err
	}
	if len(lat) != len(lon) || len(lat) != len(offset) || len(lat) != len(quality) {
		return nil, fmt.Errorf("lightning: flash arrays disagree: lat=%d lon=%d time=%d quality=%d",
			len(lat), len(lon), len(offset), len(quality))
	}

	epoch, err := timeEpoch(g, timeAttrs)
	if err != nil {
		return nil, err
	}

	flashes := make([]Flash, 0, len(lat))
	for i := range lat {
		if quality[i] != goodQuality {
			continue
		}
		if math.IsNaN(lat[i]) || math.IsNaN(lon[i]) || math.IsNaN(offset[i]) {
			continue
		}
		if lat[i] < -90 || lat[i] > 90 || lon[i] < -180 || lon[i] > 180 {
			continue
		}
		flashes = append(flashes, Flash{
			Lat:  lat[i],
			Lon:  lon[i],
			Time: epoch.Add(time.Duration(offset[i] * float64(time.Second))),
		})
	}
	return flashes, nil
}

// ParseBytes is Parse over an in-memory file (what the fetcher hands the job).
func ParseBytes(b []byte) ([]Flash, error) {
	return Parse(bytes.NewReader(b))
}

// ParseFile is Parse over a file on disk.
func ParseFile(path string) ([]Flash, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return Parse(f)
}

type nopCloser struct{ io.ReadSeeker }

func (nopCloser) Close() error { return nil }

// timeEpoch resolves the instant that flash time offsets are relative to.
func timeEpoch(g api.Group, timeAttrs api.AttributeMap) (time.Time, error) {
	if units, ok := attrString(timeAttrs, "units"); ok {
		if t, ok := parseSince(units); ok {
			return t, nil
		}
	}
	// Fall back to product_time: seconds since the J2000 epoch (its own
	// units attribute says which).
	pt, ptAttrs, err := floatVar(g, varProduct)
	if err != nil {
		return time.Time{}, err
	}
	if len(pt) != 1 || math.IsNaN(pt[0]) {
		return time.Time{}, errors.New("lightning: product_time is not a scalar")
	}
	base := time.Date(2000, 1, 1, 12, 0, 0, 0, time.UTC)
	if units, ok := attrString(ptAttrs, "units"); ok {
		if t, ok := parseSince(units); ok {
			base = t
		}
	}
	return base.Add(time.Duration(pt[0] * float64(time.Second))), nil
}

// parseSince parses a CF "seconds since <timestamp>" units string.
func parseSince(units string) (time.Time, bool) {
	rest, ok := strings.CutPrefix(strings.TrimSpace(units), "seconds since ")
	if !ok {
		return time.Time{}, false
	}
	rest = strings.TrimSpace(rest)
	for _, layout := range []string{
		"2006-01-02 15:04:05.000",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05.000Z",
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05.000 UTC",
		"2006-01-02 15:04:05 UTC",
	} {
		if t, err := time.ParseInLocation(layout, rest, time.UTC); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// floatVar reads a whole variable as float64s with CF decoding applied
// (see Parse). NaN marks a fill value.
func floatVar(g api.Group, name string) ([]float64, api.AttributeMap, error) {
	vg, err := g.GetVarGetter(name)
	if err != nil {
		return nil, nil, fmt.Errorf("lightning: variable %s: %w", name, err)
	}
	vals, err := vg.Values()
	if err != nil {
		return nil, nil, fmt.Errorf("lightning: variable %s values: %w", name, err)
	}
	attrs := vg.Attributes()

	unsigned := false
	if s, ok := attrString(attrs, "_Unsigned"); ok {
		unsigned = strings.EqualFold(strings.TrimSpace(s), "true")
	}
	raw, bits, err := toFloat64s(vals, unsigned)
	if err != nil {
		return nil, nil, fmt.Errorf("lightning: variable %s: %w", name, err)
	}

	scale, hasScale := attrFloat(attrs, "scale_factor")
	offset, hasOffset := attrFloat(attrs, "add_offset")
	fill, hasFill := attrFloat(attrs, "_FillValue")
	if hasFill && unsigned && fill < 0 && bits > 0 {
		// _FillValue is stored in the signed type; read it the way the data
		// was read.
		fill += math.Pow(2, float64(bits))
	}

	out := make([]float64, len(raw))
	for i, v := range raw {
		if hasFill && v == fill {
			out[i] = math.NaN()
			continue
		}
		if hasScale {
			v *= scale
		}
		if hasOffset {
			v += offset
		}
		out[i] = v
	}
	return out, attrs, nil
}

// toFloat64s widens any numeric slice or scalar the reader can hand back.
// bits is the integer width (0 for floats) so callers can re-domain
// _FillValue for _Unsigned integers.
func toFloat64s(v any, unsigned bool) (out []float64, bits int, err error) {
	switch x := v.(type) {
	case []float64:
		return append([]float64(nil), x...), 0, nil
	case []float32:
		out = make([]float64, len(x))
		for i, e := range x {
			out[i] = float64(e)
		}
		return out, 0, nil
	case []int8:
		out = make([]float64, len(x))
		for i, e := range x {
			if unsigned {
				out[i] = float64(uint8(e))
			} else {
				out[i] = float64(e)
			}
		}
		return out, 8, nil
	case []uint8:
		out = make([]float64, len(x))
		for i, e := range x {
			out[i] = float64(e)
		}
		return out, 8, nil
	case []int16:
		out = make([]float64, len(x))
		for i, e := range x {
			if unsigned {
				out[i] = float64(uint16(e))
			} else {
				out[i] = float64(e)
			}
		}
		return out, 16, nil
	case []uint16:
		out = make([]float64, len(x))
		for i, e := range x {
			out[i] = float64(e)
		}
		return out, 16, nil
	case []int32:
		out = make([]float64, len(x))
		for i, e := range x {
			if unsigned {
				out[i] = float64(uint32(e))
			} else {
				out[i] = float64(e)
			}
		}
		return out, 32, nil
	case []uint32:
		out = make([]float64, len(x))
		for i, e := range x {
			out[i] = float64(e)
		}
		return out, 32, nil
	case []int64:
		out = make([]float64, len(x))
		for i, e := range x {
			out[i] = float64(e)
		}
		return out, 64, nil
	case []uint64:
		out = make([]float64, len(x))
		for i, e := range x {
			out[i] = float64(e)
		}
		return out, 64, nil
	case float64:
		return []float64{x}, 0, nil
	case float32:
		return []float64{float64(x)}, 0, nil
	case int8, uint8, int16, uint16, int32, uint32, int64, uint64:
		f, _ := attrToFloat(x, unsigned)
		return []float64{f}, 0, nil
	}
	return nil, 0, fmt.Errorf("unsupported value type %T", v)
}

// attrFloat reads a numeric attribute, accepting a scalar or a one-element
// slice (readers differ on which they return for a scalar attribute).
func attrFloat(attrs api.AttributeMap, key string) (float64, bool) {
	if attrs == nil {
		return 0, false
	}
	v, ok := attrs.Get(key)
	if !ok {
		return 0, false
	}
	return attrToFloat(v, false)
}

func attrToFloat(v any, unsigned bool) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case float32:
		return float64(x), true
	case int8:
		if unsigned {
			return float64(uint8(x)), true
		}
		return float64(x), true
	case uint8:
		return float64(x), true
	case int16:
		if unsigned {
			return float64(uint16(x)), true
		}
		return float64(x), true
	case uint16:
		return float64(x), true
	case int32:
		if unsigned {
			return float64(uint32(x)), true
		}
		return float64(x), true
	case uint32:
		return float64(x), true
	case int64:
		return float64(x), true
	case uint64:
		return float64(x), true
	case int:
		return float64(x), true
	}
	// One-element slices.
	if fs, _, err := toFloat64s(v, unsigned); err == nil && len(fs) == 1 {
		return fs[0], true
	}
	return 0, false
}

// attrString reads a string attribute (scalar or one-element slice).
func attrString(attrs api.AttributeMap, key string) (string, bool) {
	if attrs == nil {
		return "", false
	}
	v, ok := attrs.Get(key)
	if !ok {
		return "", false
	}
	switch x := v.(type) {
	case string:
		return x, true
	case []string:
		if len(x) == 1 {
			return x[0], true
		}
	}
	return "", false
}
