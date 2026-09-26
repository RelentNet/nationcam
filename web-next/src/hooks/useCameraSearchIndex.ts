import { useCallback, useState } from 'react'
import type { Video } from '@/lib/types'
import { fetchStates, fetchSublocationsByState, fetchVideos } from '@/lib/api'

/** A video plus the state/sublocation slugs its camera page URL needs. */
export interface SearchableCamera {
  video: Video
  stateSlug: string
  sublocationSlug: string
}

interface CameraIndex {
  cameras: Array<SearchableCamera>
}

/**
 * Module-level cache: `fetchVideos()`/`fetchStates()`/`fetchSublocationsByState()`
 * run once per page session, the first time the search dialog opens, and every
 * later `useCameraSearchIndex()` call (including remounts of the dialog) reuses
 * the same result instead of re-fetching.
 */
let cachedIndex: CameraIndex | null = null
let inflightIndex: Promise<CameraIndex> | null = null

/**
 * `Video` carries `state_id`/`sublocation_id` and the state/sublocation
 * *names*, but not their slugs, so building a camera page link needs a slug
 * lookup — the same one `routes/locations/$slug.index.tsx` gets for free from
 * its loader. `fetchStates()` gives the state slugs directly; sublocation
 * slugs only come back per-state from `fetchSublocationsByState()`, so this
 * fetches every state's sublocations in parallel and merges them into one map.
 */
async function buildIndex(): Promise<CameraIndex> {
  const [videos, states] = await Promise.all([fetchVideos(), fetchStates()])
  const stateSlugById = new Map(states.map((s) => [s.state_id, s.slug]))

  const sublocationLists = await Promise.all(
    states.map((s) => fetchSublocationsByState(s.slug).catch(() => [])),
  )
  const sublocationSlugById = new Map<number, string>()
  for (const sublocations of sublocationLists) {
    for (const sub of sublocations) {
      sublocationSlugById.set(sub.sublocation_id, sub.slug)
    }
  }

  // Only cameras with a sublocation have a page to link to — the same rule
  // the state page's own poster grid follows for its "Other Cameras" tiles.
  const cameras: Array<SearchableCamera> = []
  for (const video of videos) {
    if (video.sublocation_id == null) continue
    const stateSlug = stateSlugById.get(video.state_id)
    const sublocationSlug = sublocationSlugById.get(video.sublocation_id)
    if (!stateSlug || !sublocationSlug) continue
    cameras.push({ video, stateSlug, sublocationSlug })
  }

  return { cameras }
}

/**
 * Lazily loads and caches the searchable camera list for `CameraSearch`.
 * Nothing fetches until `ensureLoaded()` is called (the dialog's first open);
 * later calls, in this component or a remounted one, reuse the cached result.
 */
export function useCameraSearchIndex() {
  const [cameras, setCameras] = useState<Array<SearchableCamera>>(
    cachedIndex?.cameras ?? [],
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const ensureLoaded = useCallback(() => {
    if (cachedIndex) {
      setCameras(cachedIndex.cameras)
      return
    }
    setLoading(true)
    setError(false)
    if (!inflightIndex) {
      inflightIndex = buildIndex()
    }
    inflightIndex
      .then((index) => {
        cachedIndex = index
        setCameras(index.cameras)
      })
      .catch(() => setError(true))
      .finally(() => {
        setLoading(false)
        inflightIndex = null
      })
  }, [])

  return { cameras, loading, error, ensureLoaded }
}
