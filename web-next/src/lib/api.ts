import type { State, Sublocation, Video } from '@/lib/types'

/**
 * The browser reaches the Go API through a same-origin `/api` proxy, so a
 * relative path is correct there. Server loaders have no origin to resolve a
 * relative path against, so they need an absolute base:
 *
 *   - production: set `API_URL` to the internal address nginx proxies to
 *     (e.g. `http://api:8080`) so SSR skips the public round trip
 *   - dev: the Go API does not run locally, so fall back to production's
 *     public read-only API — the same source the dev `/api` proxy uses
 *
 * `import.meta.env.SSR` is replaced at build time, so the client bundle keeps
 * only the relative branch and never references `process`.
 */
const API_BASE = import.meta.env.SSR
  ? (process.env.API_URL ?? 'https://nationcam.com/api')
  : '/api'

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

/* ──── States ──── */

export async function fetchStates(): Promise<Array<State>> {
  return get<Array<State>>('/states')
}

export async function fetchStateBySlug(slug: string): Promise<State> {
  return get<State>(`/states/${slug}`)
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
