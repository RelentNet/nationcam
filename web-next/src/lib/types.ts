export interface State {
  state_id: number
  name: string
  description: string
  slug: string
  created_at: string
  updated_at: string
  video_count: number
}

export interface Sublocation {
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

export interface Video {
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

export interface CreateStateInput {
  name: string
  description?: string
}

export interface UpdateStateInput {
  name: string
  description?: string
}

export interface CreateSublocationInput {
  name: string
  description?: string
  state_id: number
}

export interface UpdateSublocationInput {
  name: string
  description?: string
  state_id: number
}

export interface CreateVideoInput {
  title: string
  src: string
  type: string
  state_id: number
  sublocation_id?: number | null
  status?: string
}

export interface UpdateVideoInput {
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
