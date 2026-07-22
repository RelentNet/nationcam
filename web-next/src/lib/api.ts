import type { State, Sublocation, Video } from '@/lib/types'

const API_BASE = '/api'

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
