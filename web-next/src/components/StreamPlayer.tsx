import {
  AlertTriangle,
  Maximize,
  Minimize,
  Pause,
  Play,
  RefreshCw,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type HlsType from 'hls.js'
import LiveBadge from '@/components/LiveBadge'

interface StreamPlayerProps {
  /** Video source URL — supports HLS (.m3u8), MP4, WebM, etc. */
  src: string
  /** MIME type hint (optional — auto-detected from URL if omitted) */
  type?: string
  /** Start playing automatically */
  autoplay?: boolean
  /** Start muted */
  muted?: boolean
  /** Show player controls */
  controls?: boolean
  /** Show LIVE badge */
  live?: boolean
  /** Additional CSS classes on the outer container */
  className?: string
  /** Maintain 16:9 aspect ratio */
  fluid?: boolean
}

/** How long to wait for MANIFEST_PARSED before declaring the stream dead. */
const LOAD_TIMEOUT_MS = 15_000
/** How many fatal HLS errors we tolerate before giving up. */
const MAX_RETRIES = 3

function detectType(src: string): string {
  if (src.includes('.m3u8')) return 'application/x-mpegURL'
  if (src.includes('.mpd')) return 'application/dash+xml'
  if (src.includes('.mp4')) return 'video/mp4'
  if (src.includes('.webm')) return 'video/webm'
  return ''
}

/**
 * Route an HLS URL through the Go API stream proxy so that hls.js
 * can fetch manifests and segments without CORS issues.
 */
function proxyHlsUrl(src: string): string {
  return `/api/stream-proxy?url=${encodeURIComponent(src)}`
}

export default function StreamPlayer({
  src,
  type,
  autoplay = false,
  muted = true,
  controls = true,
  live = false,
  className = '',
  fluid = true,
}: StreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<HlsType | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const retriesRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [playing, setPlaying] = useState(autoplay)
  const [isMuted, setIsMuted] = useState(muted)
  const [volume, setVolume] = useState(muted ? 0 : 0.8)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)

  const resolvedType = type ?? detectType(src)
  const isHls = resolvedType === 'application/x-mpegURL'

  /** Tear down any active HLS instance + timeout. */
  const cleanup = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy()
      hlsRef.current = null
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  /** Full reset — clears error state, retries, and re-initialises. */
  const retry = useCallback(() => {
    retriesRef.current = 0
    setIsError(false)
    setIsLoading(true)
    // Trigger re-init by toggling a dependency (src is stable so we use a key
    // trick at the call-site level OR just re-set source on the video element).
    cleanup()
    const video = videoRef.current
    if (video) {
      video.classList.remove('stream-ready')
      // Force the effect to re-run by re-setting src attribute.
      video.removeAttribute('src')
      video.load()
    }
    // We need to trigger the effect below — simplest way is a state toggle.
    setRetryCounter((c) => c + 1)
  }, [cleanup])

  // Invisible counter just to re-trigger the init effect on retry.
  const [retryCounter, setRetryCounter] = useState(0)

  // ── Initialise video source ──
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    setIsLoading(true)
    setIsError(false)
    video.classList.remove('stream-ready')
    retriesRef.current = 0

    const markReady = () => {
      setIsLoading(false)
      setIsError(false)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
      requestAnimationFrame(() => {
        video.classList.add('stream-ready')
      })
    }

    const markError = () => {
      cleanup()
      setIsLoading(false)
      setIsError(true)
    }

    // Start a loading timeout — if we don't get MANIFEST_PARSED in time, error.
    timeoutRef.current = setTimeout(() => {
      if (!video.classList.contains('stream-ready')) {
        console.warn('[StreamPlayer] load timeout for', src)
        markError()
      }
    }, LOAD_TIMEOUT_MS)

    if (isHls) {
      // Dynamically import hls.js — it's ~300KB and only needed for HLS streams.
      let cancelled = false
      import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return

        if (Hls.isSupported()) {
          const proxiedSrc = proxyHlsUrl(src)
          const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
          })
          hls.loadSource(proxiedSrc)
          hls.attachMedia(video)
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            markReady()
            if (autoplay) {
              video.play().catch(() => {
                /* browser may block autoplay */
              })
            }
          })
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
              retriesRef.current++
              console.warn(
                `[StreamPlayer] fatal HLS error (${retriesRef.current}/${MAX_RETRIES})`,
                data.type,
                data.details,
              )
              if (retriesRef.current >= MAX_RETRIES) {
                markError()
                return
              }
              if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                hls.startLoad()
              } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                hls.recoverMediaError()
              } else {
                markError()
              }
            }
          })
          hlsRef.current = hls
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari native HLS
          video.src = proxyHlsUrl(src)
          video.addEventListener('loadedmetadata', markReady)
          video.addEventListener('error', markError)
        } else {
          markError()
        }
      })

      return () => {
        cancelled = true
        cleanup()
      }
    } else {
      // Native playback (MP4, WebM, etc.) — no proxy needed.
      video.src = src
      const onData = () => {
        markReady()
        if (autoplay) video.play().catch(() => {})
      }
      const onError = () => markError()
      video.addEventListener('loadeddata', onData)
      video.addEventListener('error', onError)
      return () => {
        video.removeEventListener('loadeddata', onData)
        video.removeEventListener('error', onError)
        cleanup()
      }
    }
  }, [src, isHls, autoplay, cleanup, retryCounter])

  // ── Sync playing state ──
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
    }
  }, [])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play().catch(() => {})
    } else {
      video.pause()
    }
  }, [])

  const toggleMute = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setIsMuted(video.muted)
    if (!video.muted && volume === 0) {
      video.volume = 0.5
      setVolume(0.5)
    }
  }, [volume])

  const handleVolume = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    if (!video) return
    const v = parseFloat(e.target.value)
    video.volume = v
    video.muted = v === 0
    setVolume(v)
    setIsMuted(v === 0)
  }, [])

  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
      setIsFullscreen(false)
    } else {
      container.requestFullscreen().catch(() => {})
      setIsFullscreen(true)
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  return (
    <div
      ref={containerRef}
      className={`stream-player group ${fluid ? 'aspect-video' : ''} ${className}`}
    >
      <video
        ref={videoRef}
        muted={muted}
        playsInline
        className="h-full w-full object-cover"
      />

      {/* Loading shimmer */}
      {isLoading && !isError && (
        <div className="absolute inset-0 flex items-center justify-center bg-crust">
          <div
            className="h-full w-full bg-gradient-to-r from-crust via-surface0 to-crust bg-[length:200%_100%]"
            style={{ animation: 'shimmer 1.5s ease-in-out infinite' }}
          />
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-crust">
          <AlertTriangle size={28} className="text-overlay1" />
          <p className="mb-0 font-mono text-xs text-subtext0">
            Stream unavailable
          </p>
          <button
            onClick={retry}
            className="inline-flex items-center gap-1.5 rounded-lg border border-overlay0 bg-surface0 px-3 py-1.5 font-mono text-xs text-subtext1 transition-colors hover:border-accent/40 hover:text-accent"
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      )}

      {/* LIVE badge */}
      {live && <LiveBadge className="absolute top-3 left-3 z-10" />}

      {/* Custom controls */}
      {controls && !isError && (
        <div className="stream-controls">
          <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={16} /> : <Play size={16} />}
          </button>

          <div className="volume-group flex items-center">
            <button
              onClick={toggleMute}
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            <div className="volume-slider">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolume}
                className="ml-1 w-14"
                aria-label="Volume"
              />
            </div>
          </div>

          <div className="flex-1" />

          <button
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
          </button>
        </div>
      )}
    </div>
  )
}
