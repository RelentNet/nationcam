import { Link } from '@tanstack/react-router'
import { ArrowRight, Pause, Play, Repeat, Sunrise, Sunset } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Frame } from '@/lib/types'

/** A `Frame` that also knows whether it came from yesterday's archive. */
export interface StripFrame extends Frame {
  yesterday?: boolean
}

/** "14:15" → 855 (minutes since midnight). */
function frameMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

/** "6:42 AM" → 402. Returns null for anything that doesn't parse — the
 *  weather API's sunrise/sunset are always this shape, but a camera with no
 *  weather data passes undefined through here. */
function clockMinutes(label: string | null | undefined): number | null {
  if (!label) return null
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(label.trim())
  if (!m) return null
  let hours = Number(m[1]) % 12
  if (m[3].toUpperCase() === 'PM') hours += 12
  return hours * 60 + Number(m[2])
}

/** Index of the frame closest to a clock time, or null with no frames. */
function nearestFrameIndex(
  frames: Array<StripFrame>,
  targetMinutes: number | null,
): number | null {
  if (targetMinutes == null || frames.length === 0) return null
  let best = 0
  let bestDelta = Infinity
  frames.forEach((frame, i) => {
    const delta = Math.abs(frameMinutes(frame.time) - targetMinutes)
    if (delta < bestDelta) {
      bestDelta = delta
      best = i
    }
  })
  return best
}

/** "14:15" → "2:15 PM". */
function timeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`
}

const THUMB_W = 96
const THUMB_H = 54
const PREVIEW_W = 800
const PREVIEW_H = 450

/** Speeds the timelapse can play at, in frames per second. */
const SPEEDS = [2, 4, 8] as const
type Speed = (typeof SPEEDS)[number]
const DEFAULT_SPEED: Speed = 4

/** While playing, preload this many frames ahead, capped at this many
 *  concurrent image loads. */
const PRELOAD_AHEAD = 6
const MAX_IN_FLIGHT = 10

interface SnapshotStripProps {
  sublocationName: string
  stateSlug: string
  sublocationSlug: string
  cameraSlug: string
  frames: Array<StripFrame>
  /** From the sublocation's weather, e.g. "6:42 AM" — undefined/null skips the mark. */
  sunrise?: string | null
  sunset?: string | null
}

/**
 * "Today at <sublocation>" (or "Last 24 hours at <sublocation>" once
 * yesterday's frames are included): a scrubbable, playable strip of the
 * camera's archived stills. A range slider and a thumbnail strip both drive
 * the same selected index; sunrise/sunset get a small badge on the closest
 * frame when the weather data has those times. With two or more frames, a
 * Play/Pause button runs the strip forward as a timelapse. Renders nothing
 * when there are no frames yet (a brand-new camera, or before the first
 * capture).
 */
export default function SnapshotStrip({
  sublocationName,
  stateSlug,
  sublocationSlug,
  cameraSlug,
  frames,
  sunrise,
  sunset,
}: SnapshotStripProps) {
  const [index, setIndex] = useState(frames.length - 1)
  const [playing, setPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [speed, setSpeed] = useState<Speed>(DEFAULT_SPEED)

  const preloadedRef = useRef<Set<string>>(new Set())
  const inFlightRef = useRef(0)

  const playable = frames.length >= 2
  const hasYesterday = frames.some((f) => f.yesterday)

  // Advance one frame at `speed` fps while playing.
  useEffect(() => {
    if (!playing || !playable) return
    const id = window.setInterval(() => {
      setIndex((i) => (i < frames.length - 1 ? i + 1 : i))
    }, 1000 / speed)
    return () => window.clearInterval(id)
  }, [playing, playable, speed, frames.length])

  // Stop at the last frame, or loop back to the start.
  useEffect(() => {
    if (!playing || index < frames.length - 1) return
    if (loop) {
      setIndex(0)
    } else {
      setPlaying(false)
    }
  }, [playing, index, loop, frames.length])

  // Preload a few frames ahead so playback doesn't stutter, capped at
  // MAX_IN_FLIGHT concurrent image loads.
  useEffect(() => {
    if (!playing) return
    for (
      let i = index + 1;
      i <= Math.min(index + PRELOAD_AHEAD, frames.length - 1);
      i++
    ) {
      const frame = frames[i]
      if (preloadedRef.current.has(frame.url)) continue
      if (inFlightRef.current >= MAX_IN_FLIGHT) break
      preloadedRef.current.add(frame.url)
      inFlightRef.current += 1
      const img = new Image()
      img.onload = img.onerror = () => {
        inFlightRef.current -= 1
      }
      img.src = frame.url
    }
  }, [playing, index, frames])

  if (frames.length === 0) return null

  const sunriseIndex = nearestFrameIndex(frames, clockMinutes(sunrise))
  const sunsetIndex = nearestFrameIndex(frames, clockMinutes(sunset))
  const selected = frames[index]

  function togglePlay() {
    if (!playable) return
    if (!playing && index === frames.length - 1) setIndex(0)
    setPlaying((p) => !p)
  }

  function stepBy(delta: number) {
    setIndex((i) => Math.min(frames.length - 1, Math.max(0, i + delta)))
  }

  // Space toggles play, arrow keys step one frame — but only while focus is
  // inside the strip, and only if we own the key: stopPropagation keeps
  // useArrowKeyNav's prev/next camera shortcuts from also firing.
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
      return
    }
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      event.stopPropagation()
      togglePlay()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      event.stopPropagation()
      stepBy(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      event.stopPropagation()
      stepBy(1)
    }
  }

  return (
    <section
      aria-label={
        hasYesterday
          ? `Last 24 hours of stills at ${sublocationName}`
          : `Today's stills at ${sublocationName}`
      }
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="mb-0 text-xl">
          {hasYesterday ? 'Last 24 hours at' : 'Today at'} {sublocationName}
        </h2>
        <Link
          to="/locations/$slug/$sublocationSlug/$cameraSlug/archive"
          params={{ slug: stateSlug, sublocationSlug, cameraSlug }}
          className="inline-flex items-center gap-1 font-mono text-xs font-medium text-accent hover:underline"
        >
          Browse the archive <ArrowRight size={12} />
        </Link>
      </div>

      <div
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="overflow-hidden rounded-2xl border border-overlay0 bg-surface0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-base"
      >
        <div className="relative aspect-video bg-crust">
          <img
            key={selected.url}
            src={selected.url}
            alt={`${sublocationName} at ${timeLabel(selected.time)}${selected.yesterday ? ' (yesterday)' : ''}`}
            width={PREVIEW_W}
            height={PREVIEW_H}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>

        <div className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between font-mono text-sm text-text">
            <span className="flex items-center gap-1.5 tabular-nums">
              {timeLabel(selected.time)}
              {selected.yesterday && (
                <span className="rounded-full bg-overlay0/40 px-1.5 py-0.5 text-[10px] font-medium text-subtext0 uppercase">
                  Yesterday
                </span>
              )}
            </span>
            {(sunriseIndex === index || sunsetIndex === index) && (
              <span className="inline-flex items-center gap-1 text-xs text-subtext0">
                {sunriseIndex === index ? (
                  <>
                    <Sunrise size={13} className="text-accent" /> Sunrise
                  </>
                ) : (
                  <>
                    <Sunset size={13} className="text-accent" /> Sunset
                  </>
                )}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            {playable && (
              <button
                type="button"
                onClick={togglePlay}
                aria-label={
                  playing
                    ? 'Pause timelapse'
                    : 'Play last 24 hours as a timelapse'
                }
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-crust transition-colors hover:bg-accent-hover"
              >
                {playing ? (
                  <Pause size={14} fill="currentColor" />
                ) : (
                  <Play size={14} fill="currentColor" className="ml-0.5" />
                )}
              </button>
            )}
            <input
              type="range"
              min={0}
              max={frames.length - 1}
              step={1}
              value={index}
              onChange={(e) => setIndex(Number(e.target.value))}
              className="snapshot-scrubber w-full"
              aria-label={
                hasYesterday
                  ? 'Scrub through the last 24 hours of stills'
                  : "Scrub through today's stills"
              }
            />
          </div>

          {playable && (
            <div className="mt-2 flex items-center justify-end gap-3 font-mono text-xs text-subtext0">
              <button
                type="button"
                onClick={() => setLoop((l) => !l)}
                aria-pressed={loop}
                aria-label={loop ? 'Disable loop' : 'Enable loop'}
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors ${
                  loop ? 'text-accent' : 'hover:text-text'
                }`}
              >
                <Repeat size={13} /> Loop
              </button>
              <div
                role="group"
                aria-label="Playback speed"
                className="flex items-center gap-1"
              >
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeed(s)}
                    aria-pressed={speed === s}
                    aria-label={`${s}x speed`}
                    className={`rounded-md px-1.5 py-1 transition-colors ${
                      speed === s
                        ? 'bg-overlay0/40 text-text'
                        : 'hover:text-text'
                    }`}
                  >
                    {s}×
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto border-t border-overlay0 px-5 py-3">
          {frames.map((frame, i) => (
            <button
              key={frame.url}
              type="button"
              onClick={() => setIndex(i)}
              aria-current={i === index ? 'true' : undefined}
              aria-label={`View still from ${timeLabel(frame.time)}${frame.yesterday ? ' yesterday' : ''}`}
              className={`relative shrink-0 overflow-hidden rounded-lg border transition-colors ${
                i === index
                  ? 'border-accent'
                  : 'border-transparent hover:border-overlay0'
              }`}
            >
              <img
                src={frame.url}
                alt=""
                width={THUMB_W}
                height={THUMB_H}
                loading="lazy"
                className="block h-[54px] w-24 object-cover"
              />
              {(i === sunriseIndex || i === sunsetIndex) && (
                <span className="absolute right-1 bottom-1 rounded-full bg-black/60 p-0.5">
                  {i === sunriseIndex ? (
                    <Sunrise size={10} className="text-white" />
                  ) : (
                    <Sunset size={10} className="text-white" />
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
