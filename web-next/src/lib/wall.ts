import type { OwnerVideo } from '@/lib/types'

/**
 * Pure helpers for the command center wall (DAN-207): layout sizes, grouping
 * by location, paging, the live-player cap, and the localStorage-backed
 * choices. Kept out of the components so the rules read in one place.
 */

/** Tiles per screen. 1 = a single big camera, 16 = a 4x4 wall. */
export const WALL_LAYOUTS = [1, 4, 9, 16] as const
export type WallLayout = (typeof WALL_LAYOUTS)[number]
export const DEFAULT_LAYOUT: WallLayout = 4

/** Grid columns for each layout (rows follow from the page size). */
export const LAYOUT_COLUMNS: Record<WallLayout, number> = {
  1: 1,
  4: 2,
  9: 3,
  16: 4,
}

/** At most this many live players run at once; the oldest stops first. */
export const MAX_LIVE_PLAYERS = 4

/** Stills refresh this often (ms) while the page is visible. */
export const STILL_REFRESH_MS = 60_000
/** Status polls this often (ms) while the page is visible. */
export const STATUS_POLL_MS = 30_000

export function isWallLayout(n: unknown): n is WallLayout {
  return WALL_LAYOUTS.includes(n as WallLayout)
}

/* ── localStorage (every access guarded: private windows, blocked storage) ── */

const LAYOUT_KEY = 'nationcam.wall.layout'
const ACCOUNT_KEY = 'nationcam.wall.account'

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* the choice just isn't remembered */
  }
}

export function loadLayout(): WallLayout {
  const n = Number(readStored(LAYOUT_KEY))
  return isWallLayout(n) ? n : DEFAULT_LAYOUT
}

export function saveLayout(layout: WallLayout): void {
  writeStored(LAYOUT_KEY, String(layout))
}

export function loadAccountId(): number | null {
  const raw = readStored(ACCOUNT_KEY)
  if (raw === null) return null
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

export function saveAccountId(id: number): void {
  writeStored(ACCOUNT_KEY, String(id))
}

/* ── Grouping and paging ── */

export interface WallGroup {
  /** sublocation_id, or 0 for a camera with no location. */
  key: number
  heading: string
  cameras: Array<OwnerVideo>
}

/** Cameras ordered by location name, then title — the order tiles page in. */
export function sortForWall(cameras: Array<OwnerVideo>): Array<OwnerVideo> {
  return [...cameras].sort(
    (a, b) =>
      (a.sublocation_name || '￿').localeCompare(b.sublocation_name || '￿') ||
      a.title.localeCompare(b.title),
  )
}

/** Split one page of cameras into consecutive location groups. */
export function groupByLocation(cameras: Array<OwnerVideo>): Array<WallGroup> {
  const groups: Array<WallGroup> = []
  for (const cam of cameras) {
    const key = cam.sublocation_id ?? 0
    const last = groups.length > 0 ? groups[groups.length - 1] : null
    if (last && last.key === key) {
      last.cameras.push(cam)
      continue
    }
    groups.push({
      key,
      heading: cam.sublocation_name
        ? `${cam.sublocation_name}, ${cam.state_name}`
        : 'No location',
      cameras: [cam],
    })
  }
  return groups
}

export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / perPage))
}

/* ── Live-player cap ── */

/**
 * Start `id` live. A camera already live moves to the newest slot; past the
 * cap the oldest one is dropped (its player unmounts and stops).
 */
export function startLive(
  live: Array<number>,
  id: number,
  max: number = MAX_LIVE_PLAYERS,
): Array<number> {
  const next = [...live.filter((x) => x !== id), id]
  return next.length > max ? next.slice(next.length - max) : next
}
