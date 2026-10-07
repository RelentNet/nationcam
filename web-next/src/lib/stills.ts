/** Widths the API's `?w=` accepts for stills (DAN-244). Anything else is a 400. */
export type StillWidth = 320 | 640

/**
 * A camera's latest still from the API, resized to `width` (aspect kept). It is
 * the watermarked `snapshot.jpg` the Windy/Ventusky feeds use, cached 60s
 * server-side per width. `t` is an optional cache-buster.
 */
export function cameraStill(
  stateSlug: string,
  sublocationSlug: string,
  cameraSlug: string,
  width: StillWidth,
  t?: number,
): string {
  const base = `/api/videos/${stateSlug}/${sublocationSlug}/${cameraSlug}/snapshot.jpg?w=${width}`
  return t ? `${base}&t=${t}` : base
}

/** An archive frame URL (`/api/snapshots/...jpg`) resized to `width`. */
export function archiveStill(url: string, width: StillWidth): string {
  return `${url}?w=${width}`
}

/** `srcSet` for a camera still: the 320 and 640 renditions. */
export function cameraStillSrcSet(
  stateSlug: string,
  sublocationSlug: string,
  cameraSlug: string,
  t?: number,
): string {
  return (
    `${cameraStill(stateSlug, sublocationSlug, cameraSlug, 320, t)} 320w, ` +
    `${cameraStill(stateSlug, sublocationSlug, cameraSlug, 640, t)} 640w`
  )
}
