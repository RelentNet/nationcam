package restreamer

// ── Restreamer Core API request/response types ────────────────────────

// ProcessConfig is the payload for POST /api/v3/process.
type ProcessConfig struct {
	ID                    string         `json:"id"`
	Type                  string         `json:"type"`
	Reference             string         `json:"reference"`
	Input                 []ProcessIO    `json:"input"`
	Output                []ProcessIO    `json:"output"`
	Options               []string       `json:"options"`
	Autostart             bool           `json:"autostart"`
	Reconnect             bool           `json:"reconnect"`
	ReconnectDelaySeconds int            `json:"reconnect_delay_seconds"`
	StaleTimeoutSeconds   int            `json:"stale_timeout_seconds"`
	Limits                *ProcessLimits `json:"limits,omitempty"`
}

// ProcessIO describes a single FFmpeg input or output.
type ProcessIO struct {
	ID      string           `json:"id"`
	Address string           `json:"address"`
	Options []string         `json:"options"`
	Cleanup []ProcessCleanup `json:"cleanup,omitempty"`
}

// ProcessCleanup defines memfs cleanup rules for an output.
type ProcessCleanup struct {
	Pattern           string `json:"pattern"`
	MaxFiles          int    `json:"max_files"`
	MaxFileAgeSeconds int    `json:"max_file_age_seconds"`
	PurgeOnDelete     bool   `json:"purge_on_delete"`
}

// ProcessLimits defines resource limits for a process.
type ProcessLimits struct {
	CPUUsage       float64 `json:"cpu_usage"`
	MemoryMbytes   float64 `json:"memory_mbytes"`
	WaitforSeconds int     `json:"waitfor_seconds"`
}

// Process is the response from GET/POST /api/v3/process.
type Process struct {
	ID                    string         `json:"id"`
	Type                  string         `json:"type"`
	Reference             string         `json:"reference"`
	Input                 []ProcessIO    `json:"input"`
	Output                []ProcessIO    `json:"output"`
	Options               []string       `json:"options"`
	Autostart             bool           `json:"autostart"`
	Reconnect             bool           `json:"reconnect"`
	ReconnectDelaySeconds int            `json:"reconnect_delay_seconds"`
	StaleTimeoutSeconds   int            `json:"stale_timeout_seconds"`
	Limits                *ProcessLimits `json:"limits,omitempty"`
	Metadata              ProcessMeta    `json:"metadata,omitempty"`
}

// ProcessMeta is the top-level metadata object on a process, as returned by
// GET /api/v3/process. Restreamer's restreamer-ui metadata is a large,
// loosely-typed blob (encode profiles store FFmpeg mappings as arrays of
// arrays, filter graphs as either strings or arrays, etc.), so we decode only
// the one field we actually consume — the display name. Decoding the whole
// blob into the rich UI* build types fails on real egress processes and 502s
// the /streams endpoints. The rich types (UIMetadata) are used only to build
// the create payload, where we control the shape.
type ProcessMeta struct {
	RestreamerUI *ProcessMetaUI `json:"restreamer-ui,omitempty"`
}

// ProcessMetaUI is the minimal read view of restreamer-ui metadata.
type ProcessMetaUI struct {
	Meta UIMeta `json:"meta"`
}

// UIMetadata is the restreamer-ui metadata blob that makes a process
// visible and editable in the Restreamer UI.
type UIMetadata struct {
	Version  string       `json:"version"`
	Meta     UIMeta       `json:"meta"`
	Control  UIControl    `json:"control"`
	License  string       `json:"license"`
	Player   UIPlayer     `json:"player"`
	Profiles []UIProfile  `json:"profiles"`
	Sources  []UISource   `json:"sources"`
	Streams  []UIStream   `json:"streams"`
}

// UIMeta holds stream name/description/author for the UI.
type UIMeta struct {
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Author      UIAuthor `json:"author"`
}

// UIAuthor holds author info for the metadata.
type UIAuthor struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// UIControl holds process behavior settings displayed in the UI.
type UIControl struct {
	HLS      UIControlHLS      `json:"hls"`
	Process  UIControlProcess  `json:"process"`
	Snapshot UIControlSnapshot `json:"snapshot"`
	Limits   UIControlLimits   `json:"limits"`
	RTMP     UIControlRTMP     `json:"rtmp"`
	SRT      UIControlSRT      `json:"srt"`
}

// UIControlHLS holds HLS output settings.
type UIControlHLS struct {
	Cleanup         bool   `json:"cleanup"`
	LHLS            bool   `json:"lhls"`
	ListSize        int    `json:"listSize"`
	MasterPlaylist  bool   `json:"master_playlist"`
	SegmentDuration int    `json:"segmentDuration"`
	Storage         string `json:"storage"`
	Version         int    `json:"version"`
}

// UIControlProcess holds process auto-start/reconnect settings.
type UIControlProcess struct {
	Autostart    bool `json:"autostart"`
	Delay        int  `json:"delay"`
	LowDelay     bool `json:"low_delay"`
	Reconnect    bool `json:"reconnect"`
	StaleTimeout int  `json:"staleTimeout"`
}

// UIControlSnapshot holds snapshot settings.
type UIControlSnapshot struct {
	Enable   bool `json:"enable"`
	Interval int  `json:"interval"`
}

// UIControlLimits holds resource limit settings for the UI.
type UIControlLimits struct {
	CPUUsage       float64 `json:"cpu_usage"`
	MemoryMbytes   float64 `json:"memory_mbytes"`
	WaitforSeconds int     `json:"waitfor_seconds"`
}

// UIControlRTMP holds RTMP push settings.
type UIControlRTMP struct {
	Enable bool `json:"enable"`
}

// UIControlSRT holds SRT push settings.
type UIControlSRT struct {
	Enable bool `json:"enable"`
}

// UIPlayer holds player embed settings (mostly empty for API-created streams).
type UIPlayer struct{}

// UIProfile holds video/audio encoder/decoder settings for the UI.
type UIProfile struct {
	Video  UIProfileTrack  `json:"video"`
	Audio  UIProfileTrack  `json:"audio"`
	Custom UIProfileCustom `json:"custom"`
}

// UIProfileTrack holds encoder/decoder config for one track.
type UIProfileTrack struct {
	Source  int            `json:"source"`
	Stream  int            `json:"stream"`
	Decoder UICodecConfig  `json:"decoder"`
	Encoder UICodecConfig  `json:"encoder"`
	Filter  UIFilterConfig `json:"filter"`
	Coder   string         `json:"coder,omitempty"` // only on audio
}

// UICodecConfig holds coder name and FFmpeg mapping args.
type UICodecConfig struct {
	Coder    string            `json:"coder"`
	Mapping  UICodecMapping    `json:"mapping"`
	Settings map[string]string `json:"settings"`
}

// UICodecMapping holds the FFmpeg flag arrays for a codec.
type UICodecMapping struct {
	Filter []string `json:"filter,omitempty"`
	Global []string `json:"global"`
	Local  []string `json:"local"`
}

// UIFilterConfig holds FFmpeg filter graph settings.
type UIFilterConfig struct {
	Graph    string         `json:"graph"`
	Settings map[string]any `json:"settings"`
}

// UIProfileCustom indicates whether a custom stream mapping is used.
type UIProfileCustom struct {
	Selected bool `json:"selected"`
	Stream   int  `json:"stream"`
}

// UISource holds input source configuration for the UI.
type UISource struct {
	Type     string         `json:"type"`
	Inputs   []UISourceInput `json:"inputs"`
	Settings map[string]any `json:"settings"`
	Streams  []UIStream     `json:"streams"`
}

// UISourceInput holds a single input address + options for the source.
type UISourceInput struct {
	Address string `json:"address"`
	Options []any  `json:"options"` // mix of strings and numbers
}

// UIStream describes an input/output stream track (video or audio).
type UIStream struct {
	Index      int    `json:"index"`
	Stream     int    `json:"stream"`
	Type       string `json:"type"`
	Codec      string `json:"codec"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
	Channels   int    `json:"channels,omitempty"`
	Layout     string `json:"layout,omitempty"`
	SamplingHz int    `json:"sampling_hz,omitempty"`
	PixFmt     string `json:"pix_fmt,omitempty"`
	URL        string `json:"url,omitempty"`
}

// ── Process state types ───────────────────────────────────────────────

// ProcessState is returned by GET /api/v3/process/{id}/state.
type ProcessState struct {
	Order            string          `json:"order"`
	Exec             string          `json:"exec"`
	RuntimeSeconds   int             `json:"runtime_seconds"`
	ReconnectSeconds int             `json:"reconnect_seconds"`
	LastLogline      string          `json:"last_logline"`
	Progress         ProcessProgress `json:"progress"`
	MemoryBytes      int64           `json:"memory_bytes"`
	CPUUsage         float64         `json:"cpu_usage"`
}

// ProcessProgress contains FFmpeg progress information.
type ProcessProgress struct {
	Inputs      []ProgressIO `json:"inputs"`
	Outputs     []ProgressIO `json:"outputs"`
	Frame       int64        `json:"frame"`
	Packet      int64        `json:"packet"`
	FPS         float64      `json:"fps"`
	Q           float64      `json:"q"`
	SizeKB      int64        `json:"size_kb"`
	Time        float64      `json:"time"`
	BitrateKbit float64      `json:"bitrate_kbit"`
	Speed       float64      `json:"speed"`
	Drop        int64        `json:"drop"`
	Dup         int64        `json:"dup"`
}

// ProgressIO describes a single input or output stream's progress.
type ProgressIO struct {
	ID          string  `json:"id"`
	Address     string  `json:"address"`
	Index       int     `json:"index"`
	Stream      int     `json:"stream"`
	Format      string  `json:"format"`
	Type        string  `json:"type"`
	Codec       string  `json:"codec"`
	Coder       string  `json:"coder"`
	Frame       int64   `json:"frame"`
	FPS         float64 `json:"fps"`
	Packet      int64   `json:"packet"`
	PPS         float64 `json:"pps"`
	SizeKB      int64   `json:"size_kb"`
	BitrateKbit float64 `json:"bitrate_kbit"`
	PixFmt      string  `json:"pix_fmt"`
	Q           float64 `json:"q"`
	Width       int     `json:"width"`
	Height      int     `json:"height"`
}

// ── Auth types ────────────────────────────────────────────────────────

// LoginRequest is the payload for POST /api/login.
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// LoginResponse is returned by POST /api/login.
type LoginResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

// RefreshResponse is returned by GET /api/login/refresh.
type RefreshResponse struct {
	AccessToken string `json:"access_token"`
}

// CommandRequest is the payload for PUT /api/v3/process/{id}/command.
type CommandRequest struct {
	Command string `json:"command"`
}

// ── Simplified API response types (returned to our clients) ───────────

// StreamResponse is the response for POST /streams (create).
type StreamResponse struct {
	StreamID string `json:"streamId"`
	Name     string `json:"name"`
	HlsURL   string `json:"hlsUrl"`
	Status   string `json:"status"`
}

// StreamDetail is the response for GET /streams/{id} and items in GET /streams.
type StreamDetail struct {
	StreamID       string  `json:"streamId"`
	Name           string  `json:"name"`
	HlsURL         string  `json:"hlsUrl"`
	Status         string  `json:"status"`
	RuntimeSeconds int     `json:"runtimeSeconds"`
	FPS            float64 `json:"fps,omitempty"`
	BitrateKbit    float64 `json:"bitrateKbit,omitempty"`
	MemoryMB       float64 `json:"memoryMb,omitempty"`
	CPUUsage       float64 `json:"cpuUsage,omitempty"`
}
