/**
 * Per-location branding, editable in the dashboard and stored on both states and
 * sublocations. Empty fields fall back to the site defaults in the hero. `hero_url`
 * is an uploaded image path when `hero_kind` is 'image', or a 3rd-party video URL
 * when 'video'.
 */
export interface Branding {
  hero_url: string
  hero_kind: 'image' | 'video'
  logo_url: string
  sponsor_url: string
  sponsor_link: string
  /** Wordmark that replaces the hero's text title when set. */
  title_url: string
  /** Official tourism site, shown as a pill at the top of the hero. */
  tourism_name: string
  tourism_url: string
}

/**
 * Editorial "About this location / camera" copy, written in the dashboard and
 * rendered by EditorialText. Light markdown: '## ' headings, blank-line-separated
 * paragraphs, '- ' bullets. Empty means the page renders no About section.
 */
export interface Editorial {
  about: string
}

/**
 * Host / visit details on a sublocation. `lat`/`lng` unlock the "Right now"
 * weather panel; the host fields feed the hosted-by row and "Plan a visit" card.
 * `host_since` is a `YYYY-MM-DD` date or null.
 */
export interface Host {
  lat: number | null
  lng: number | null
  host_name: string
  host_url: string
  host_since: string | null
  address: string
}

/**
 * Per-sublocation override for which NOAA tide station and USGS river gauge
 * the conditions page uses, instead of always taking the nearest one (which
 * can land on the wrong body of water). `null`/empty means "use the nearest
 * lookup"; the sentinel `'none'` disables that source entirely.
 */
export interface ConditionsOverride {
  noaa_station_id: string | null
  usgs_site_id: string | null
}

export interface State extends Branding, Editorial {
  state_id: number
  name: string
  description: string
  slug: string
  created_at: string
  updated_at: string
  video_count: number
  /** A camera is confirmed here but not live yet — shown prominently on /locations. */
  upcoming: boolean
}

export interface Sublocation
  extends Branding, Editorial, Host, ConditionsOverride {
  sublocation_id: number
  name: string
  description: string
  state_id: number
  slug: string
  created_at: string
  updated_at: string
  state_name: string
  /** The state's tourism link — the hero falls back to it when the
   *  sublocation's own `tourism_url` is empty. */
  state_tourism_name: string
  state_tourism_url: string
  video_count: number
  /** `src` of the active camera with the lowest id, or '' — for poster tiles. */
  first_src: string
}

/** `heat_stress.level` on `Weather` — a WBGT-style flag-condition estimate. */
export type HeatStressLevel = 'low' | 'moderate' | 'high' | 'extreme'

/** `storm_potential.level` on `Weather` — CAPE/lightning-potential estimate,
 *  forecast-model only, never live strike detection. */
export type StormPotentialLevel = 'low' | 'moderate' | 'high'

/**
 * Current conditions from `GET /sublocations/{slug}/weather` (Open-Meteo).
 * The outdoor-activity fields below (DAN-32) are all best-effort estimates
 * from forecast models, never on-site sensors or live lightning detection —
 * each is omitted from the response when Open-Meteo didn't offer it or its
 * upstream call failed, so every one of them is optional here too.
 */
export interface Weather {
  temp_f: number
  feels_f: number
  humidity: number
  weather_code: number
  condition: string
  wind_mph: number
  wind_dir_deg: number
  wind_dir: string
  gust_mph: number
  high_f: number
  rain_pct: number
  sunrise: string
  sunset: string
  timezone: string
  timezone_abbr: string
  marine: { wave_ft: number; period_s: number; water_f: number } | null
  fetched_at: string

  dew_point_f?: number
  uv_index?: number
  /** Today's forecast peak UV index. */
  uv_index_max?: number
  wet_bulb_f?: number
  /** Estimated from wet-bulb temperature when available, else apparent
   *  temperature — see `label` for the "(estimate)" disclaimer text. */
  heat_stress?: { level: HeatStressLevel; label: string }
  cloud_cover_pct?: number
  visibility_mi?: number
  pressure_inhg?: number
  /** vs. the pressure reading ~3 hours ago. */
  pressure_trend?: 'rising' | 'steady' | 'falling'
  precip_last_hour_in?: number
  rain_next_hour_pct?: number
  /** From CAPE and forecast-model lightning potential — not real strike
   *  detection. */
  storm_potential?: { level: StormPotentialLevel }
  us_aqi?: { value: number; category: string }
}

/** One day of `Conditions.forecast`. */
export interface ForecastDay {
  date: string
  high_f: number
  low_f: number
  precip_chance: number
  wind_max_mph: number
  sunrise: string
  sunset: string
}

/** One predicted high or low tide in `Conditions.tides.predictions`. */
export interface TidePrediction {
  time: string
  height_ft: number
  type: 'high' | 'low'
}

/** One hour of `Conditions.hourly` — the 12-hour strip (DAN-32). */
export interface HourlyPoint {
  hour: string
  temp_f: number
  rain_pct: number
  wind_mph: number
  uv_index: number
}

/** `GET /sublocations/{slug}/conditions` — the "is it worth going today"
 *  page: a 3-day forecast plus, where public data exists nearby, NOAA tide
 *  predictions and USGS river stage. `tides`/`river` are null when no
 *  station/gauge is within range, or when the sublocation's override turns
 *  that source off. `source` is `'override'` when a sublocation's
 *  `noaa_station_id`/`usgs_site_id` pinned it, `'nearest'` when it was
 *  picked by distance. `hourly` is up to the next 12 hours from now, empty
 *  when the forecast fetch failed. */
export interface Conditions {
  forecast: Array<ForecastDay>
  hourly: Array<HourlyPoint>
  tides: {
    station_name: string
    predictions: Array<TidePrediction>
    source: 'override' | 'nearest'
  } | null
  river: {
    site_name: string
    stage_ft: number
    observed_at: string
    source: 'override' | 'nearest'
  } | null
}

/** `status` on `Lightning` — the API's 10 mi / 30 mi / 30 min policy. */
export type LightningStatus = 'clear' | 'caution' | 'alert'

/**
 * `GET /sublocations/{slug}/lightning` — satellite lightning status for the
 * sublocation's coordinates from NOAA GOES-19 GLM (DAN-34). `alert` = any
 * flash within 10 mi in the last 30 min (`all_clear_at` is the latest such
 * flash + 30 min); `caution` = within 30 mi; `clear` otherwise. `nearest_mi`
 * and `last_strike_at` describe the flashes within 30 mi in the window and
 * are null when there were none. Satellite-detected, informational only —
 * never a certified safety system, and the UI must say so.
 */
export interface Lightning {
  status: LightningStatus
  nearest_mi: number | null
  last_strike_at: string | null
  strikes_10mi_30min: number
  strikes_30mi_30min: number
  all_clear_at: string | null
  source: string
  updated_at: string
}

/**
 * What the lightning fetch resolves to: the status, `'unavailable'` when the
 * feed is stale or the request failed (503 — render a muted "no data" card),
 * or `null` when the sublocation has no coordinates (404 — render nothing).
 */
export type LightningResult = Lightning | 'unavailable' | null

export interface Video extends Editorial {
  video_id: number
  title: string
  src: string
  type: string
  slug: string
  state_id: number
  sublocation_id: number | null
  status: 'active' | 'inactive'
  created_by: string
  created_at: string
  updated_at: string
  state_name: string
  sublocation_name: string
  /** Only present on `GET /videos?sort=views|newest` rows (and `Camera`). */
  view_count?: number
}

/**
 * A video as returned by the per-camera endpoint, which also resolves the
 * state/sublocation slugs needed to build camera URLs. `view_count` is only
 * present on the primary camera, not on the `related` entries.
 */
export interface Camera extends Video {
  state_slug: string
  sublocation_slug: string
  view_count?: number
}

export interface CameraDetail {
  camera: Camera
  related: Array<Camera>
}

export interface CreateStateInput
  extends Partial<Branding>, Partial<Editorial> {
  name: string
  description?: string
  upcoming?: boolean
}

export interface UpdateStateInput
  extends Partial<Branding>, Partial<Editorial> {
  name: string
  description?: string
  upcoming?: boolean
}

export interface CreateSublocationInput
  extends
    Partial<Branding>,
    Partial<Editorial>,
    Partial<Host>,
    Partial<ConditionsOverride> {
  name: string
  description?: string
  state_id: number
}

export interface UpdateSublocationInput
  extends
    Partial<Branding>,
    Partial<Editorial>,
    Partial<Host>,
    Partial<ConditionsOverride> {
  name: string
  description?: string
  state_id: number
}

export interface CreateVideoInput extends Partial<Editorial> {
  title: string
  src: string
  type: string
  state_id: number
  sublocation_id?: number | null
  status?: string
}

export interface UpdateVideoInput extends Partial<Editorial> {
  title: string
  src: string
  type: string
  state_id: number
  sublocation_id?: number | null
  status?: string
}

/* ──── Ads ──── */

export type AdType = 'preroll_video' | 'banner_html'
export type AdPlacement = 'left' | 'right' | 'mobile'

/**
 * An ad row as returned by `GET /api/ads`. Scope is whichever of
 * state_id/sublocation_id/video_id is set (at most one); all null = House.
 * `*_name`/`video_title` and impression/click counts are join/aggregate
 * columns the list endpoint adds for display.
 */
export interface Ad {
  ad_id: number
  name: string
  type: AdType
  video_url: string
  html_code: string
  click_url: string
  placement: AdPlacement | ''
  weight: number
  starts_at: string | null
  ends_at: string | null
  enabled: boolean
  is_override: boolean
  state_id: number | null
  sublocation_id: number | null
  video_id: number | null
  created_by: string
  created_at: string
  updated_at: string
  state_name: string
  sublocation_name: string
  video_title: string
  impressions: number
  clicks: number
}

/**
 * The ad the resolver serves to viewers via `GET /ads/next` and `/ads/banner`
 * — a slimmer row than the dashboard `Ad` (no counts, no lifecycle columns).
 * `scope` is how specific the winning target was (higher = more specific).
 */
export interface ServedAd {
  ad_id: number
  name: string
  type: AdType
  video_url: string
  html_code: string
  placement: AdPlacement | ''
  click_url: string
  weight: number
  starts_at: string | null
  ends_at: string | null
  scope: number
}

export interface AdInput {
  name: string
  type: AdType
  video_url: string
  html_code: string
  click_url: string
  placement: AdPlacement | ''
  weight: number
  starts_at: string | null
  ends_at: string | null
  enabled: boolean
  is_override: boolean
  state_id: number | null
  sublocation_id: number | null
  video_id: number | null
}

/* ──── Field notes (posts) ──── */

export type PostStatus = 'draft' | 'published'

/**
 * A field-notes post as returned by the public listing/article endpoints
 * (`GET /posts`, `GET /posts/{slug}`) — includes the resolved scope name/slug
 * so the list and article pages can link straight to the attached
 * camera/sublocation/state without a second request. `state_name`/`state_slug`
 * and `sublocation_name`/`sublocation_slug` resolve from whichever attachment
 * is actually set: a post scoped to a sublocation has no direct `state_id`, so
 * `state_slug` comes from that sublocation's parent state; a post scoped to a
 * camera has neither directly, so both come from the camera's own
 * state/sublocation.
 */
export interface Post {
  post_id: number
  title: string
  slug: string
  body_md: string
  excerpt: string
  cover_url: string
  state_id: number | null
  sublocation_id: number | null
  video_id: number | null
  status: PostStatus
  published_at: string | null
  created_by: string
  created_at: string
  updated_at: string
  state_name: string
  state_slug: string
  sublocation_name: string
  sublocation_slug: string
  video_title: string
  video_slug: string
}

/** `GET /posts` (no scope filter) — a page of `Post` plus whether another page follows. */
export interface PostsListResponse {
  data: Array<Post>
  has_more: boolean
}

/**
 * A related post from the scoped listings
 * (`GET /posts?video_id=|sublocation_id=|state_id=`) that back the "Field
 * notes" block. No joined scope names here — the caller already knows the
 * scope it asked for.
 */
export interface RelatedPost {
  post_id: number
  title: string
  slug: string
  body_md: string
  excerpt: string
  cover_url: string
  state_id: number | null
  sublocation_id: number | null
  video_id: number | null
  status: PostStatus
  published_at: string | null
  created_by: string
  created_at: string
  updated_at: string
}

/** A post row in the admin dashboard (`GET /posts/all`) — every status, with
 *  scope names for the list row (the dashboard links by id, not by URL). */
export interface AdminPost {
  post_id: number
  title: string
  slug: string
  body_md: string
  excerpt: string
  cover_url: string
  state_id: number | null
  sublocation_id: number | null
  video_id: number | null
  status: PostStatus
  published_at: string | null
  created_by: string
  created_at: string
  updated_at: string
  state_name: string
  sublocation_name: string
  video_title: string
}

export interface PostInput {
  title: string
  body_md: string
  excerpt: string
  cover_url: string
  status: PostStatus
  state_id: number | null
  sublocation_id: number | null
  video_id: number | null
}

/* ──── Events ──── */

/**
 * A host's event (tournament, rodeo, festival) as returned by every listing
 * — public and admin alike. Unlike posts, `sublocation_id` is always set (an
 * event always belongs to one place); `video_id` is an optional, additional
 * "watch here" pointer to a specific camera in that sublocation. Every query
 * joins the sublocation and its parent state, so the frontend can link
 * straight to the camera or sublocation page without a second request.
 */
export interface EventItem {
  event_id: number
  title: string
  description_md: string
  starts_at: string
  ends_at: string | null
  url: string | null
  sublocation_id: number
  video_id: number | null
  created_by: string
  created_at: string
  updated_at: string
  sublocation_name: string
  sublocation_slug: string
  state_name: string
  state_slug: string
  video_title: string
  video_slug: string
}

export interface EventInput {
  title: string
  description_md: string
  starts_at: string
  ends_at: string | null
  url: string
  sublocation_id: number
  video_id: number | null
}

/* ──── Submissions (contact / "Add Your Camera" form) ──── */

/** A contact-form submission as returned by `GET /api/submissions` (admin). */
export interface Submission {
  submission_id: number
  name: string
  email: string
  message: string
  kind: string
  handled: boolean
  created_at: string
}

/** The public payload sent by the contact form to `POST /api/submissions`. */
export interface SubmitContactInput {
  name: string
  email: string
  message: string
  kind: string
}

export interface PaginatedResponse<T> {
  data: Array<T>
  total: number
  page: number
  per_page: number
}

/* ──── Streams (Restreamer) ──── */

export interface StreamDetail {
  streamId: string
  name: string
  hlsUrl: string
  status: string
  runtimeSeconds: number
  fps?: number
  bitrateKbit?: number
  memoryMb?: number
  cpuUsage?: number
}

export interface StreamResponse {
  streamId: string
  name: string
  hlsUrl: string
  status: string
}

export interface CreateStreamInput {
  name: string
  rtspUrl: string
}

/* ──── Snapshot archive ──── */

/**
 * One archived still from `GET .../frames`. `time` is `HH:MM` in the camera's
 * local (America/Chicago) day; `url` is the browser-facing path returned by
 * the API (`/api/snapshots/{video_id}/{day}/{HHMM}.jpg`) — used as-is.
 */
export interface Frame {
  time: string
  url: string
}

/** `GET .../frames?day=YYYY-MM-DD` — one local day's stills, sorted by time. */
export interface FramesResponse {
  day: string
  frames: Array<Frame>
}
