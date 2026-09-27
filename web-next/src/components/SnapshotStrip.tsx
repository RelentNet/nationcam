import { Link } from '@tanstack/react-router'
import { ArrowRight, Sunrise, Sunset } from 'lucide-react'
import { useState } from 'react'
import type { Frame } from '@/lib/types'

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
  frames: Array<Frame>,
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

interface SnapshotStripProps {
  sublocationName: string
  stateSlug: string
  sublocationSlug: string
  cameraSlug: string
  frames: Array<Frame>
  /** From the sublocation's weather, e.g. "6:42 AM" — undefined/null skips the mark. */
  sunrise?: string | null
  sunset?: string | null
}

/**
 * "Today at <sublocation>": a scrubbable strip of the camera's archived
 * stills for the current local day. A range slider and a thumbnail strip both
 * drive the same selected index; sunrise/sunset get a small badge on the
 * closest frame when the weather data has those times. Renders nothing when
 * there are no frames yet (a brand-new camera, or before the first capture).
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

  if (frames.length === 0) return null

  const sunriseIndex = nearestFrameIndex(frames, clockMinutes(sunrise))
  const sunsetIndex = nearestFrameIndex(frames, clockMinutes(sunset))
  const selected = frames[index]

  return (
    <section aria-label={`Today's stills at ${sublocationName}`}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="mb-0 text-xl">Today at {sublocationName}</h2>
        <Link
          to="/locations/$slug/$sublocationSlug/$cameraSlug/archive"
          params={{ slug: stateSlug, sublocationSlug, cameraSlug }}
          className="inline-flex items-center gap-1 font-mono text-xs font-medium text-accent hover:underline"
        >
          Browse the archive <ArrowRight size={12} />
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-overlay0 bg-surface0">
        <div className="relative aspect-video bg-crust">
          <img
            key={selected.url}
            src={selected.url}
            alt={`${sublocationName} at ${timeLabel(selected.time)}`}
            width={PREVIEW_W}
            height={PREVIEW_H}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>

        <div className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between font-mono text-sm text-text">
            <span className="tabular-nums">{timeLabel(selected.time)}</span>
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
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            step={1}
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
            className="snapshot-scrubber w-full"
            aria-label="Scrub through today's stills"
          />
        </div>

        <div className="flex gap-2 overflow-x-auto border-t border-overlay0 px-5 py-3">
          {frames.map((frame, i) => (
            <button
              key={frame.url}
              type="button"
              onClick={() => setIndex(i)}
              aria-current={i === index ? 'true' : undefined}
              aria-label={`View still from ${timeLabel(frame.time)}`}
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
