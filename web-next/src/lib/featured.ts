import type { Video } from '@/lib/types'

/**
 * The camera a hub page features by default: the active camera with the lowest
 * id, falling back to any camera, null for an empty list. Deterministic on
 * purpose — it is also the page's share image, so it must not change per load.
 */
export function pickFeatured(videos: Array<Video>): Video | null {
  const active = videos.filter((v) => v.status === 'active')
  const from = active.length > 0 ? active : videos
  return from.reduce<Video | null>(
    (best, v) => (best === null || v.video_id < best.video_id ? v : best),
    null,
  )
}
