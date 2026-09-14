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
}

/**
 * Editorial "About this location / camera" copy, written in the dashboard and
 * rendered by EditorialText. Light markdown: '## ' headings, blank-line-separated
 * paragraphs, '- ' bullets. Empty means the page renders no About section.
 */
export interface Editorial {
  about: string
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

export interface Sublocation extends Branding, Editorial {
  sublocation_id: number
  name: string
  description: string
  state_id: number
  slug: string
  created_at: string
  updated_at: string
  state_name: string
  video_count: number
}

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
  extends Partial<Branding>, Partial<Editorial> {
  name: string
  description?: string
  state_id: number
}

export interface UpdateSublocationInput
  extends Partial<Branding>, Partial<Editorial> {
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
