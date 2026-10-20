import { useEffect, useState } from 'react'
import { fetchPrivateImage } from '@/lib/api'

export interface PrivateImageState {
  /** An object URL for the image, or null until it loads (or if it failed). */
  url: string | null
  loading: boolean
  failed: boolean
}

/**
 * A private camera's still or archive frame as an object URL (DAN-383).
 * `<img src>` cannot send an Authorization header, so the image is fetched
 * with the bearer token and shown from a blob. The object URL is revoked when
 * the component unmounts, `path` changes, or `reloadKey` bumps — a still that
 * is replaced never leaks the old blob.
 *
 * `path` is the browser-facing `/api/private/videos/...` URL; pass null to
 * hold off (a lazily-loaded thumbnail not yet scrolled into view).
 */
export function usePrivateImage(
  path: string | null,
  getToken: () => Promise<string | null>,
  reloadKey = 0,
): PrivateImageState {
  const [state, setState] = useState<PrivateImageState>({
    url: null,
    loading: path !== null,
    failed: false,
  })

  useEffect(() => {
    if (path === null) return
    let cancelled = false
    let objectUrl: string | null = null
    // The previous blob is revoked by the cleanup below, so drop its URL now
    // rather than leave an <img> pointing at it.
    setState({ url: null, loading: true, failed: false })
    getToken()
      .then((token) => fetchPrivateImage(path, token))
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setState({ url: objectUrl, loading: false, failed: false })
      })
      .catch(() => {
        if (!cancelled) setState({ url: null, loading: false, failed: true })
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [path, reloadKey])

  return state
}
