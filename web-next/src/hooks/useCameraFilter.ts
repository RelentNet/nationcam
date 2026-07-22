import { useMemo, useState } from 'react'
import type { Video } from '@/lib/types'
import type { SortOption } from '@/components/CameraToolbar'

/**
 * Client-side search + sort for camera/video lists.
 * Returns controlled state and the filtered/sorted result set.
 */
export function useCameraFilter(videos: Array<Video>) {
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortOption>('a-z')

  const filtered = useMemo(() => {
    let result = [...videos]

    // Search — match against title, sublocation name, state name
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter(
        (v) =>
          v.title.toLowerCase().includes(q) ||
          (v.sublocation_name &&
            v.sublocation_name.toLowerCase().includes(q)) ||
          (v.state_name && v.state_name.toLowerCase().includes(q)),
      )
    }

    // Sort
    switch (sort) {
      case 'a-z':
        result.sort((a, b) => a.title.localeCompare(b.title))
        break
      case 'z-a':
        result.sort((a, b) => b.title.localeCompare(a.title))
        break
      case 'newest':
        result.sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
        break
      case 'oldest':
        result.sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )
        break
    }

    return result
  }, [videos, search, sort])

  return { search, setSearch, sort, setSort, filtered }
}
