import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ImageOff, Lock, Play, Square } from 'lucide-react'
import type { OwnerVideo, VideoState } from '@/lib/types'
import { isPrivateCamera } from '@/lib/types'
import { fetchPrivateImage, privateVideoPath, watchSrc } from '@/lib/api'
import { cameraStill } from '@/lib/stills'
import StreamPlayer from '@/components/StreamPlayer'
import { StateBadge } from '@/components/owner/ownerUi'

/** How long the pointer rests on a tile before its live player starts, so
 *  sweeping across the wall does not spin players up behind the cursor. */
const HOVER_LIVE_DELAY_MS = 400

/** Cameras whose public still failed once this page view: they go straight to
 *  the bearer route when a tile remounts (page, layout or wall-mode change). */
const publicStillFailed = new Set<number>()

/** A coarse pointer (phone, tablet) has no hover: the first tap plays live,
 *  the second opens the camera. */
function noHover(): boolean {
  try {
    return window.matchMedia('(hover: none)').matches
  } catch {
    return false
  }
}

/**
 * A private camera's 320-wide still, refreshed in place: the previous blob
 * stays on screen until the next one has loaded, then it is revoked. Revoked
 * on unmount too. `path` null holds off (public camera, or no still yet).
 */
function useWallPrivateStill(
  path: string | null,
  getToken: () => Promise<string | null>,
  tick: number,
  paused: boolean,
): { url: string | null; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({
    url: null,
    failed: false,
  })
  const urlRef = useRef<string | null>(null)

  useEffect(() => {
    if (path === null || paused) return
    let cancelled = false
    getToken()
      .then((token) => fetchPrivateImage(path, token))
      .then((blob) => {
        if (cancelled) return
        const next = URL.createObjectURL(blob)
        const prev = urlRef.current
        urlRef.current = next
        setState({ url: next, failed: false })
        if (prev) URL.revokeObjectURL(prev)
      })
      .catch(() => {
        if (!cancelled)
          setState((s) => ({ url: s.url, failed: s.url === null }))
      })
    return () => {
      cancelled = true
    }
  }, [path, tick, paused])

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    },
    [],
  )

  return state
}

/** True when the camera is in a state worth asking a player to connect to. */
function canPlayLive(camera: OwnerVideo, state: VideoState | undefined) {
  return camera.status === 'active' && state !== 'offline'
}

export interface WallTileProps {
  camera: OwnerVideo
  /** From the status endpoint; undefined until the first poll lands. */
  state: VideoState | undefined
  isLive: boolean
  /** Bumps once a minute (while visible) to refresh stills. */
  stillTick: number
  /** Fullscreen wall: the tile fills its grid cell instead of keeping 16:9. */
  fill: boolean
  getToken: () => Promise<string | null>
  onStartLive: (id: number) => void
  onStopLive: (id: number) => void
}

export default function WallTile({
  camera,
  state,
  isLive,
  stillTick,
  fill,
  getToken,
  onStartLive,
  onStopLive,
}: WallTileProps) {
  const isPrivate = isPrivateCamera(camera)
  const showsStill = camera.status === 'active' || camera.status === 'paused'
  const playable = canPlayLive(camera, state)

  // Public cameras use the public still (no bearer, shared 60 s cache);
  // private ones — and a public one whose still fails — use the
  // bearer-authenticated route.
  const [publicFailed, setPublicFailed] = useState(() =>
    publicStillFailed.has(camera.video_id),
  )
  const publicUrl =
    showsStill &&
    !isPrivate &&
    !publicFailed &&
    camera.sublocation_status === 'approved' &&
    camera.state_slug &&
    camera.sublocation_slug &&
    camera.slug
      ? cameraStill(
          camera.state_slug,
          camera.sublocation_slug,
          camera.slug,
          320,
          stillTick || undefined,
        )
      : null
  const privatePath =
    showsStill && publicUrl === null
      ? privateVideoPath(camera.video_id, 'snapshot.jpg?w=320')
      : null
  const privateStill = useWallPrivateStill(
    privatePath,
    getToken,
    stillTick,
    isLive,
  )
  const stillUrl = publicUrl ?? privateStill.url
  const stillFailed = publicUrl === null && privateStill.failed

  // Hover starts the live player after a short rest; leaving cancels the wait
  // (a player already started stays until it is stopped or evicted).
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
  }
  useEffect(() => cancelHover, [])

  const onEnter = () => {
    if (!playable || isLive || noHover()) return
    cancelHover()
    hoverTimer.current = setTimeout(
      () => onStartLive(camera.video_id),
      HOVER_LIVE_DELAY_MS,
    )
  }

  // The tile link opens the camera page; on a touch screen the first tap on a
  // playable, not-yet-live tile plays it instead.
  const onLinkClick = (e: React.MouseEvent) => {
    if (playable && !isLive && noHover()) {
      e.preventDefault()
      onStartLive(camera.video_id)
    }
  }

  const location = camera.sublocation_name
    ? `${camera.sublocation_name}, ${camera.state_name}`
    : camera.state_name

  return (
    <div
      data-testid="wall-tile"
      data-video-id={camera.video_id}
      onMouseEnter={onEnter}
      onMouseLeave={cancelHover}
      className={`group relative overflow-hidden rounded-xl border border-border bg-crust ${
        fill ? 'h-full min-h-0' : 'aspect-video'
      }`}
    >
      {/* Still, or live player over it */}
      {stillUrl && !isLive && (
        <img
          src={stillUrl}
          alt=""
          loading="lazy"
          onError={() => {
            if (publicUrl !== null) {
              publicStillFailed.add(camera.video_id)
              setPublicFailed(true)
            }
          }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {!stillUrl && !isLive && (
        <div className="absolute inset-0 flex items-center justify-center text-subtext0">
          {stillFailed || !showsStill ? (
            <span className="flex flex-col items-center gap-1.5 px-3 text-center font-mono text-xs">
              <ImageOff size={18} />
              {camera.status === 'pending'
                ? 'Awaiting review'
                : camera.status === 'rejected' || camera.status === 'inactive'
                  ? 'Not available'
                  : 'No still yet'}
            </span>
          ) : (
            <div className="h-full w-full animate-pulse bg-surface0" />
          )}
        </div>
      )}
      {isLive && (
        <StreamPlayer
          src={watchSrc(camera)}
          type={camera.type}
          autoplay
          muted
          controls={false}
          live={false}
          fluid={false}
          videoId={camera.video_id}
          poster={stillUrl ?? undefined}
          getToken={getToken}
          className="absolute inset-0 h-full w-full rounded-none"
        />
      )}

      {/* The whole tile opens the camera page */}
      <Link
        to="/dashboard/cameras/$videoId"
        params={{ videoId: String(camera.video_id) }}
        onClick={onLinkClick}
        aria-label={`Open ${camera.title}`}
        className="absolute inset-0 z-10 rounded-xl focus-visible:outline-2 focus-visible:outline-accent"
      />

      {/* Caption: title, location, state */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-2 bg-gradient-to-b from-crust/85 to-transparent p-2.5 pb-6">
        <div className="min-w-0">
          <p className="mb-0 flex items-center gap-1.5 truncate font-sans text-sm font-semibold text-text">
            {isPrivate && (
              <Lock
                size={12}
                className="shrink-0 text-accent"
                aria-label="Private"
              />
            )}
            <span className="truncate">{camera.title}</span>
          </p>
          <p className="mb-0 truncate font-mono text-[11px] text-subtext1">
            {location}
          </p>
        </div>
        <StateBadge state={state ?? 'unknown'} />
      </div>

      {/* Live toggle sits above the link so it is its own click target */}
      {playable && (
        <button
          type="button"
          onClick={() =>
            isLive ? onStopLive(camera.video_id) : onStartLive(camera.video_id)
          }
          aria-label={
            isLive ? `Stop live ${camera.title}` : `Play live ${camera.title}`
          }
          className="absolute right-2 bottom-2 z-20 flex h-8 w-8 items-center justify-center rounded-md bg-crust/80 text-text opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-accent hover:text-crust"
        >
          {isLive ? <Square size={14} /> : <Play size={14} />}
        </button>
      )}
    </div>
  )
}
