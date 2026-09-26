import { useEffect, useState } from 'react'

/** One localStorage key holds the whole list, most recent first. */
const STORAGE_KEY = 'nationcam:recent-cameras'

/** How many cameras to remember. */
const MAX_ENTRIES = 6

export interface RecentCamera {
  path: string
  title: string
  subtitle: string
  poster?: string
  at: number
}

function readRecentCameras(): Array<RecentCamera> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeRecentCameras(entries: Array<RecentCamera>) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
  } catch {
    // Silent — localStorage may be unavailable (private mode, quota, etc.).
  }
}

/**
 * Records a camera as just-watched: dedupes by `path`, puts it first, and
 * caps the list at `MAX_ENTRIES`. Safe to call from a `useEffect` — every
 * localStorage read/write is wrapped in try/catch and failures are silent.
 */
export function recordRecentCamera(entry: Omit<RecentCamera, 'at'>) {
  try {
    const existing = readRecentCameras().filter((e) => e.path !== entry.path)
    const next = [{ ...entry, at: Date.now() }, ...existing].slice(
      0,
      MAX_ENTRIES,
    )
    writeRecentCameras(next)
  } catch {
    // Silent — see readRecentCameras/writeRecentCameras.
  }
}

/**
 * Returns the recently-watched cameras, most recent first. Empty on the
 * server and on first client render (so hydration never mismatches), then
 * fills from localStorage right after mount.
 */
export function useRecentCameras(): Array<RecentCamera> {
  const [entries, setEntries] = useState<Array<RecentCamera>>([])

  useEffect(() => {
    setEntries(readRecentCameras())
  }, [])

  return entries
}
