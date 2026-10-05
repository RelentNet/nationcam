import type { StyleId } from '@/lib/constructionPricing'

// Top-down field-of-view sketch: the camera is the dot, the shaded shape is
// what it covers. Purely decorative, so it is hidden from assistive tech.
export default function FieldOfView({ kind }: { kind: StyleId }) {
  const wedge =
    kind === 'ultra' ? 'M60 68 L34 18 L86 18 Z' : 'M60 68 L42 18 L78 18 Z'
  return (
    <svg
      viewBox="0 0 120 80"
      aria-hidden="true"
      focusable="false"
      className="mx-auto aspect-[3/2] w-full max-w-[7.5rem] text-text"
    >
      {kind === 'ptz' && (
        <defs>
          <marker
            id="fov-sweep-head"
            viewBox="0 0 6 6"
            refX="5"
            refY="3"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M0 0L6 3L0 6z" fill="currentColor" />
          </marker>
        </defs>
      )}
      <path
        d={kind === 'panoramic' ? 'M60 68 L10 68 A50 50 0 0 1 110 68 Z' : wedge}
        className="fill-accent/20 stroke-accent"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {kind === 'ptz' && (
        <path
          d="M27 40 A44 44 0 0 1 93 40"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          markerStart="url(#fov-sweep-head)"
          markerEnd="url(#fov-sweep-head)"
        />
      )}
      {kind === 'ultra' && (
        <>
          {/* A photo frame in the scene: one still, captured on a schedule. */}
          <rect
            x="49"
            y="24"
            width="22"
            height="15"
            rx="1.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle
            cx="60"
            cy="31.5"
            r="3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </>
      )}
      <circle cx="60" cy="68" r="4" fill="currentColor" />
    </svg>
  )
}
