import type {
  Ad,
  AdInput,
  Branding,
  CameraDetail,
  CreateStateInput,
  CreateStreamInput,
  CreateSublocationInput,
  CreateVideoInput,
  Host,
  PaginatedResponse,
  ServedAd,
  State,
  StreamDetail,
  StreamResponse,
  Sublocation,
  Submission,
  SubmitContactInput,
  UpdateStateInput,
  UpdateSublocationInput,
  UpdateVideoInput,
  Video,
  Weather,
} from '@/lib/types'

/**
 * The browser reaches the Go API through a same-origin `/api` proxy (see
 * `routes/api.$.ts`), so a relative path is correct there. Server loaders have
 * no origin to resolve a relative path against, so they need an absolute base:
 *
 *   - production: `API_URL` must be the internal address of the Go API
 *     (e.g. `http://api:8080`) so SSR skips the public round trip
 *   - dev: the Go API does not run locally, so fall back to production's
 *     public read-only API — the same source the dev `/api` proxy uses
 *
 * `import.meta.env.SSR` is replaced at build time, so the client bundle keeps
 * only the relative branch and never references `process`.
 */
function serverApiBase(): string {
  const url = process.env.API_URL
  if (url) return url
  // A production server that silently fell back to the public URL would keep
  // working while round-tripping every render out to the internet, so refuse
  // to start instead.
  if (import.meta.env.PROD) {
    throw new Error(
      'API_URL is not set. The SSR server needs the internal Go API address ' +
        '(e.g. http://api:8080); refusing to fall back to the public URL in production.',
    )
  }
  return 'https://nationcam.com/api'
}

export const API_BASE = import.meta.env.SSR ? serverApiBase() : '/api'

/* ──── Helpers ──── */

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

async function post<T>(
  path: string,
  body: unknown,
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`POST ${path} failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

async function put<T>(
  path: string,
  body: unknown,
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`PUT ${path} failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

async function patch<T>(
  path: string,
  body: unknown,
  token?: string | null,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`PATCH ${path} failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

async function del(path: string, token?: string | null): Promise<void> {
  const headers: Record<string, string> = {}
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`DELETE ${path} failed: ${res.status} ${text}`)
  }
}

async function authedGet<T>(path: string, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}${path}`, { headers })
  if (!res.ok) {
    throw new Error(`GET ${path} failed: ${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

/**
 * Fills the five branding fields with their defaults so create/update always
 * send a complete, valid payload (the API validates hero_kind and the URLs).
 */
function brandingBody(input: Partial<Branding>): Branding {
  return {
    hero_url: input.hero_url ?? '',
    hero_kind: input.hero_kind ?? 'video',
    logo_url: input.logo_url ?? '',
    sponsor_url: input.sponsor_url ?? '',
    sponsor_link: input.sponsor_link ?? '',
    title_url: input.title_url ?? '',
    tourism_name: input.tourism_name ?? '',
    tourism_url: input.tourism_url ?? '',
  }
}

/**
 * Same idea for the host block: every field present, nulls for the optional
 * coordinates and date, so the API's validator sees one consistent shape.
 */
function hostBody(input: Partial<Host>): Host {
  return {
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    host_name: input.host_name ?? '',
    host_url: input.host_url ?? '',
    host_since: input.host_since || null,
    address: input.address ?? '',
  }
}

/* ──── Uploads ──── */

/**
 * Upload one image to the API's local object storage and return its public URL
 * (`/api/uploads/<file>`). Browser-only — hits the same-origin `/api` proxy with
 * the admin bearer token. The browser sets the multipart boundary, so no
 * Content-Type header is set here.
 */
export async function uploadAsset(
  file: File,
  token?: string | null,
): Promise<{ url: string }> {
  const body = new FormData()
  body.append('file', file)
  const headers: Record<string, string> = {}
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const res = await fetch(`${API_BASE}/uploads`, {
    method: 'POST',
    headers,
    body,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Upload failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<{ url: string }>
}

/* ──── States ──── */

export async function fetchStates(): Promise<Array<State>> {
  return get<Array<State>>('/states')
}

export async function fetchStateBySlug(slug: string): Promise<State> {
  return get<State>(`/states/${slug}`)
}

export async function createState(
  input: CreateStateInput,
  token?: string | null,
): Promise<State> {
  return post<State>(
    '/states',
    {
      name: input.name,
      description: input.description ?? '',
      about: input.about ?? '',
      upcoming: input.upcoming ?? false,
      ...brandingBody(input),
    },
    token,
  )
}

export async function updateState(
  id: number,
  input: UpdateStateInput,
  token?: string | null,
): Promise<State> {
  return put<State>(
    `/states/${id}`,
    {
      name: input.name,
      description: input.description ?? '',
      about: input.about ?? '',
      upcoming: input.upcoming ?? false,
      ...brandingBody(input),
    },
    token,
  )
}

export async function deleteState(
  slug: string,
  token?: string | null,
): Promise<void> {
  return del(`/states/${slug}`, token)
}

export async function fetchStatesPaginated(
  page: number,
  perPage: number,
  token?: string | null,
): Promise<PaginatedResponse<State>> {
  return authedGet<PaginatedResponse<State>>(
    `/states/paginated?page=${page}&per_page=${perPage}`,
    token,
  )
}

/* ──── Sublocations ──── */

export async function fetchSublocationsByState(
  stateSlug: string,
): Promise<Array<Sublocation>> {
  return get<Array<Sublocation>>(`/states/${stateSlug}/sublocations`)
}

export async function fetchSublocationBySlug(
  slug: string,
): Promise<Sublocation> {
  return get<Sublocation>(`/sublocations/${slug}`)
}

/**
 * Current conditions for the sublocation's coordinates. Null on 404 (no
 * lat/lng set) or any failure — the page simply renders no weather panel.
 */
export async function fetchWeather(slug: string): Promise<Weather | null> {
  return get<Weather>(`/sublocations/${slug}/weather`).catch(() => null)
}

export async function createSublocation(
  input: CreateSublocationInput,
  token?: string | null,
): Promise<Sublocation> {
  return post<Sublocation>(
    '/sublocations',
    {
      name: input.name,
      description: input.description ?? '',
      state_id: input.state_id,
      about: input.about ?? '',
      ...brandingBody(input),
      ...hostBody(input),
    },
    token,
  )
}

export async function updateSublocation(
  id: number,
  input: UpdateSublocationInput,
  token?: string | null,
): Promise<Sublocation> {
  return put<Sublocation>(
    `/sublocations/${id}`,
    {
      name: input.name,
      description: input.description ?? '',
      state_id: input.state_id,
      about: input.about ?? '',
      ...brandingBody(input),
      ...hostBody(input),
    },
    token,
  )
}

export async function deleteSublocation(
  id: number,
  token?: string | null,
): Promise<void> {
  return del(`/sublocations/${id}`, token)
}

export async function fetchSublocationsPaginated(
  page: number,
  perPage: number,
  token?: string | null,
): Promise<PaginatedResponse<Sublocation>> {
  return authedGet<PaginatedResponse<Sublocation>>(
    `/sublocations/paginated?page=${page}&per_page=${perPage}`,
    token,
  )
}

/* ──── Videos ──── */

export async function fetchVideos(): Promise<Array<Video>> {
  return get<Array<Video>>('/videos')
}

export async function fetchVideosByState(
  stateId: number,
): Promise<Array<Video>> {
  return get<Array<Video>>(`/videos?state_id=${stateId}`)
}

export async function fetchVideosBySublocation(
  sublocationId: number,
): Promise<Array<Video>> {
  return get<Array<Video>>(`/videos?sublocation_id=${sublocationId}`)
}

export async function deleteVideo(
  id: number,
  token?: string | null,
): Promise<void> {
  return del(`/videos/${id}`, token)
}

export async function createVideo(
  input: CreateVideoInput,
  token?: string | null,
): Promise<Video> {
  return post<Video>(
    '/videos',
    {
      title: input.title,
      src: input.src,
      type: input.type,
      state_id: input.state_id,
      sublocation_id: input.sublocation_id ?? null,
      status: input.status ?? 'active',
      about: input.about ?? '',
    },
    token,
  )
}

export async function updateVideo(
  id: number,
  input: UpdateVideoInput,
  token?: string | null,
): Promise<Video> {
  return put<Video>(
    `/videos/${id}`,
    {
      title: input.title,
      src: input.src,
      type: input.type,
      state_id: input.state_id,
      sublocation_id: input.sublocation_id ?? null,
      status: input.status ?? 'active',
      about: input.about ?? '',
    },
    token,
  )
}

export async function fetchVideosPaginated(
  page: number,
  perPage: number,
  token?: string | null,
): Promise<PaginatedResponse<Video>> {
  return authedGet<PaginatedResponse<Video>>(
    `/videos/paginated?page=${page}&per_page=${perPage}`,
    token,
  )
}

/* ──── Streams (Restreamer) ──── */

export async function fetchStreams(
  token?: string | null,
): Promise<Array<StreamDetail>> {
  return authedGet<Array<StreamDetail>>('/streams', token)
}

export async function createStream(
  input: CreateStreamInput,
  token?: string | null,
): Promise<StreamResponse> {
  return post<StreamResponse>(
    '/streams',
    { name: input.name, rtspUrl: input.rtspUrl },
    token,
  )
}

export async function deleteStream(
  id: string,
  token?: string | null,
): Promise<void> {
  return del(`/streams/${id}`, token)
}

export async function restartStream(
  id: string,
  token?: string | null,
): Promise<StreamResponse> {
  return post<StreamResponse>(`/streams/${id}/restart`, {}, token)
}

/* ──── Ads ──── */

export async function fetchAds(token?: string | null): Promise<Array<Ad>> {
  return authedGet<Array<Ad>>('/ads', token)
}

export async function createAd(
  input: AdInput,
  token?: string | null,
): Promise<Ad> {
  return post<Ad>('/ads', input, token)
}

export async function updateAd(
  id: number,
  input: AdInput,
  token?: string | null,
): Promise<Ad> {
  return put<Ad>(`/ads/${id}`, input, token)
}

export async function deleteAd(
  id: number,
  token?: string | null,
): Promise<void> {
  return del(`/ads/${id}`, token)
}

/* ──── Ads — viewer delivery ──── */

/**
 * Ask the resolver for an ad. 204 (nothing sold) and *any* failure both return
 * null: an ad must never block or break the page it sits on, so the callers
 * treat null as "just show the content". Browser-only — hits the same-origin
 * `/api` proxy.
 */
async function fetchServedAd(path: string): Promise<ServedAd | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: 'application/json' },
    })
    if (res.status === 204 || !res.ok) return null
    return (await res.json()) as ServedAd
  } catch {
    return null
  }
}

export function fetchNextAd(videoId: number): Promise<ServedAd | null> {
  return fetchServedAd(`/ads/next?video_id=${videoId}`)
}

export function fetchBannerAd(scope: {
  placement: 'left' | 'right' | 'mobile'
  videoId?: number
  sublocationId?: number
  stateId?: number
}): Promise<ServedAd | null> {
  const q = new URLSearchParams({ placement: scope.placement })
  if (scope.videoId) q.set('video_id', String(scope.videoId))
  if (scope.sublocationId) q.set('sublocation_id', String(scope.sublocationId))
  if (scope.stateId) q.set('state_id', String(scope.stateId))
  return fetchServedAd(`/ads/banner?${q.toString()}`)
}

/**
 * Record one impression. Fire-and-forget: these are billing rows, but a failed
 * beacon must never surface to the viewer. video_id is optional (banners may be
 * viewed off a camera page).
 */
export function recordAdImpression(adId: number, videoId?: number): void {
  const q = videoId ? `?video_id=${videoId}` : ''
  void fetch(`${API_BASE}/ads/${adId}/impression${q}`, {
    method: 'POST',
  }).catch(() => {})
}

/**
 * URL of the click tracker, which records the click then 302-redirects to the
 * ad's click_url. Use as an anchor href / `window.open` target so the redirect
 * lands in a new tab and never navigates the player away.
 */
export function adClickUrl(adId: number, videoId?: number): string {
  const q = videoId ? `?video_id=${videoId}` : ''
  return `${API_BASE}/ads/${adId}/click${q}`
}

/* ──── Submissions (contact / "Add Your Camera" form) ──── */

/**
 * Submit the public contact form. No auth — hits the same-origin `/api` proxy,
 * which forwards to the rate-limited public `POST /submissions`. Returns
 * `{ ok: true }` on success; throws on any non-2xx so the form can show an error.
 */
export async function submitContact(
  input: SubmitContactInput,
): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>('/submissions', input)
}

/** List the latest submissions, newest first (admin). */
export async function fetchSubmissions(
  token?: string | null,
): Promise<Array<Submission>> {
  return authedGet<Array<Submission>>('/submissions', token)
}

/** Mark a submission handled/unhandled (admin). Returns the updated row. */
export async function markSubmissionHandled(
  id: number,
  handled: boolean,
  token?: string | null,
): Promise<Submission> {
  return patch<Submission>(`/submissions/${id}`, { handled }, token)
}

/**
 * Single camera plus its related cameras. Hitting this endpoint is what
 * increments the camera's view count — the API does that server-side.
 */
export async function fetchCamera(
  stateSlug: string,
  sublocationSlug: string,
  cameraSlug: string,
): Promise<CameraDetail> {
  return get<CameraDetail>(
    `/videos/${stateSlug}/${sublocationSlug}/${cameraSlug}`,
  )
}
