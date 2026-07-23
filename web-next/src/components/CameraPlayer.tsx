import { SkipForward } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Camera, ServedAd } from '@/lib/types'
import { adClickUrl, fetchNextAd, recordAdImpression } from '@/lib/api'
import StreamPlayer from '@/components/StreamPlayer'

/** Don't show a pre-roll for the same camera more than once per this window. */
const CAP_MS = 30 * 60 * 1000
/** Skip control unlocks after this many seconds of actual ad playback. */
const SKIP_AFTER_S = 5
/**
 * If the ad decision (the /ads/next call) or the ad's own startup takes longer
 * than this, give up and go straight to live. The live view always wins.
 */
const AD_TIMEOUT_MS = 3000

function capKey(videoId: number): string {
  return `nc_preroll_${videoId}`
}

/**
 * Pure so it's trivially testable: capped when a pre-roll played for this camera
 * within CAP_MS. `stored` is the raw localStorage value (a timestamp or null).
 */
export function prerollCapped(stored: string | null, now: number): boolean {
  return stored != null && now - Number(stored) < CAP_MS
}

type Phase = 'checking' | 'ad' | 'live'

/**
 * The camera-page player. Before the live HLS stream, it optionally plays one
 * skippable MP4 pre-roll from `/ads/next`, then hands off to the shared
 * `StreamPlayer`. Every failure path (no ad, capped, fetch error, broken ad
 * URL, slow ad) falls open to live — an ad must never block the camera.
 *
 * Pre-roll lives here rather than in `StreamPlayer` on purpose: the grid
 * VideoCards reuse `StreamPlayer` for previews and must NOT get pre-roll.
 */
export default function CameraPlayer({ camera }: { camera: Camera }) {
  // 'checking' on both server and first client render → hydration-safe. The
  // client effect below is what actually decides ad-vs-live.
  const [phase, setPhase] = useState<Phase>('checking')
  const [ad, setAd] = useState<ServedAd | null>(null)
  const videoId = camera.video_id
  const isLive = camera.status === 'active'

  useEffect(() => {
    let settled = false
    const goLive = () => {
      if (settled) return
      settled = true
      setPhase('live')
    }

    // Capped → live immediately, no network round trip.
    try {
      if (prerollCapped(localStorage.getItem(capKey(videoId)), Date.now())) {
        goLive()
        return
      }
    } catch {
      /* storage blocked (private mode) — treat as not capped, carry on */
    }

    const timer = setTimeout(goLive, AD_TIMEOUT_MS)
    fetchNextAd(videoId).then((next) => {
      if (settled) return
      if (next && next.type === 'preroll_video' && next.video_url) {
        clearTimeout(timer)
        settled = true
        setAd(next)
        setPhase('ad')
      } else {
        clearTimeout(timer)
        goLive()
      }
    })

    return () => {
      settled = true
      clearTimeout(timer)
    }
  }, [videoId])

  if (phase === 'ad' && ad) {
    return (
      <PrerollAd
        ad={ad}
        videoId={videoId}
        onDone={() => setPhase('live')}
      />
    )
  }

  if (phase === 'live') {
    return (
      <StreamPlayer
        src={camera.src}
        type={camera.type}
        autoplay
        muted
        controls
        fluid
        live={isLive}
        className="shadow-xl"
      />
    )
  }

  // 'checking' — a stable, player-shaped placeholder so the layout doesn't shift
  // when we swap in the ad or the live stream.
  return (
    <div className="stream-player aspect-video shadow-xl">
      <div className="absolute inset-0 bg-crust" />
    </div>
  )
}

function PrerollAd({
  ad,
  videoId,
  onDone,
}: {
  ad: ServedAd
  videoId: number
  onDone: () => void
}) {
  const [secondsLeft, setSecondsLeft] = useState(SKIP_AFTER_S)
  const impressedRef = useRef(false)

  // Fail open if the creative never starts playing (a stalled load may never
  // fire `error`). Cleared once playback begins.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!impressedRef.current) onDone()
    }, AD_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [onDone])

  const onPlay = () => {
    if (impressedRef.current) return
    impressedRef.current = true
    // The impression is what "spends" the frequency cap — an ad that failed to
    // load never plays, so it never burns the 30-min window.
    recordAdImpression(ad.ad_id, videoId)
    try {
      localStorage.setItem(capKey(videoId), String(Date.now()))
    } catch {
      /* storage blocked — no cap, not a blocker */
    }
  }

  const onTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const left = Math.max(0, SKIP_AFTER_S - Math.floor(e.currentTarget.currentTime))
    setSecondsLeft(left)
  }

  const onClick = () => {
    if (!ad.click_url) return
    window.open(adClickUrl(ad.ad_id, videoId), '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="stream-player group aspect-video shadow-xl">
      <video
        src={ad.video_url}
        autoPlay
        muted
        playsInline
        onPlay={onPlay}
        onEnded={onDone}
        onError={onDone}
        onTimeUpdate={onTimeUpdate}
        onClick={onClick}
        // `.stream-player video` starts at opacity 0; reveal on load like the
        // live player does, so the ad fades in instead of popping.
        onLoadedData={(e) => e.currentTarget.classList.add('stream-ready')}
        className={`h-full w-full object-cover ${ad.click_url ? 'cursor-pointer' : ''}`}
      />

      {/* "Ad" marker */}
      <span className="absolute top-3 left-3 z-10 rounded bg-black/70 px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wide text-white/90 uppercase">
        Ad
      </span>

      {/* Skip control — disabled until the 5s countdown elapses */}
      <button
        onClick={onDone}
        disabled={secondsLeft > 0}
        className="absolute right-3 bottom-3 z-10 inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-black/70 px-3 py-1.5 font-mono text-xs text-white/90 transition-colors enabled:hover:border-accent/50 enabled:hover:text-accent disabled:cursor-default disabled:opacity-80"
      >
        {secondsLeft > 0 ? (
          `Skip Ad in ${secondsLeft}s`
        ) : (
          <>
            Skip Ad
            <SkipForward size={13} />
          </>
        )}
      </button>
    </div>
  )
}
