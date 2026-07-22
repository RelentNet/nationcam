import type {
  CameraDetail,
  CreateStateInput,
  CreateStreamInput,
  CreateSublocationInput,
  CreateVideoInput,
  PaginatedResponse,
  State,
  StreamDetail,
  StreamResponse,
  Sublocation,
  UpdateStateInput,
  UpdateSublocationInput,
  UpdateVideoInput,
  Video,
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
