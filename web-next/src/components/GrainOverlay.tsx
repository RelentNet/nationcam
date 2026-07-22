/**
 * Subtle film-grain texture overlay using SVG feTurbulence.
 * Adds atmospheric depth without impacting interactivity (pointer-events: none).
 */
export default function GrainOverlay() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[9999] opacity-[0.028] mix-blend-overlay dark:opacity-[0.04]"
      style={{ animation: 'grain-drift 8s steps(6) infinite', willChange: 'transform' }}
    >
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <filter id="grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.65"
            numOctaves="3"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
    </div>
  )
}
