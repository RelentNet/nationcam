import type { Video } from '@/lib/types'

/**
 * The camera a hub page features by default: the active camera with the lowest
 * id, falling back to any non-paused camera, null for an empty list.
 * Deterministic on purpose — it is also the page's share image, so it must
 * not change per load. A paused camera is never picked, even as the
 * "nothing active" fallback (DAN-40) — it would hand `CameraPlayer` a hero
 * slot it can only render as a placeholder.
 */
export function pickFeatured(videos: Array<Video>): Video | null {
  const eligible = videos.filter((v) => v.status !== 'paused')
  const active = eligible.filter((v) => v.status === 'active')
  const from = active.length > 0 ? active : eligible
  return from.reduce<Video | null>(
    (best, v) => (best === null || v.video_id < best.video_id ? v : best),
    null,
  )
}
