import type { Glyph } from '@/lib/brandPaths'
import { SHIELD, WORDMARK } from '@/lib/brandPaths'

/**
 * The NationCam brand marks as inline SVG, drawn from the same path data as
 * public/brand/*.svg and the favicons. Border and navy lettering use
 * `currentColor`, so a parent's `text-text` makes them navy in light mode and
 * white in dark mode; the orange C / CAM always use the accent token. The
 * shield's fill is white in light mode and transparent in dark mode
 * (`.brand-shield-fill` in styles.css), matching the reverse artwork.
 */

function GlyphPath({ glyph, fill }: { glyph: Glyph; fill: string }) {
  return (
    <path
      d={glyph.d}
      fill={fill}
      transform={`translate(${String(glyph.tx)} ${String(glyph.ty)}) scale(${String(glyph.sx)} 1)`}
    />
  )
}

/**
 * The Route-style shield. `full` carries ROUTE, the rule and NC; `nc` is the
 * small-size version (favicon, ≤32px) with just the letters.
 */
export function Shield({
  className = '',
  mode = 'full',
  title = 'NationCam',
}: {
  className?: string
  mode?: 'full' | 'nc'
  title?: string
}) {
  const pad = SHIELD.stroke / 2 + 1
  const size = SHIELD.box + pad * 2
  const pair = mode === 'full' ? SHIELD : SHIELD.ncOnly
  return (
    <svg
      viewBox={`0 0 ${String(size)} ${String(size)}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
    >
      <g transform={`translate(${String(pad)} ${String(pad)})`}>
        <path
          d={SHIELD.path}
          className="brand-shield-fill"
          stroke="currentColor"
          strokeWidth={SHIELD.stroke}
          strokeLinejoin="round"
        />
        {mode === 'full' && (
          <>
            <path d={SHIELD.route} fill="currentColor" />
            <rect
              x={SHIELD.rule.x}
              y={SHIELD.rule.y}
              width={SHIELD.rule.w}
              height={SHIELD.rule.h}
              rx={1}
              fill="currentColor"
            />
          </>
        )}
        <GlyphPath glyph={pair.n} fill="currentColor" />
        <GlyphPath glyph={pair.c} fill="var(--color-accent)" />
      </g>
    </svg>
  )
}

/** NATIONCAM wordmark: NATION in currentColor, CAM in the accent. */
export function Wordmark({
  className = '',
  title = 'NationCam',
}: {
  className?: string
  title?: string
}) {
  return (
    <svg
      viewBox={`0 0 ${String(WORDMARK.width)} ${String(WORDMARK.capHeight)}`}
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      className={className}
    >
      <g
        transform={`translate(0 ${String(WORDMARK.capHeight)}) scale(${String(WORDMARK.scaleX)} 1)`}
      >
        <path d={WORDMARK.nation} fill="currentColor" />
        <path d={WORDMARK.cam} fill="var(--color-accent)" />
      </g>
    </svg>
  )
}
