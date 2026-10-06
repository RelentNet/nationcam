import type { ReactNode } from 'react'

/**
 * The NationCam Mono camera grid: 1 column, 2 from 560px, 3 from 960px, with
 * a 24px row / 16px column gap. Put `PosterTile`s inside. `compact` keeps two
 * columns on phones, for narrow side columns.
 */
export default function CameraGrid({
  children,
  compact = false,
  className = '',
}: {
  children: ReactNode
  compact?: boolean
  className?: string
}) {
  return (
    <div
      className={`grid gap-x-4 gap-y-6 ${
        compact
          ? 'grid-cols-2 min-[960px]:grid-cols-3'
          : 'grid-cols-1 min-[560px]:grid-cols-2 min-[960px]:grid-cols-3'
      } ${className}`}
    >
      {children}
    </div>
  )
}
