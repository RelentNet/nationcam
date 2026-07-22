import { Link } from '@tanstack/react-router'

/**
 * NationCam logo — inline SVG aperture mark + wordmark.
 * Colors adapt to theme via CSS variables.
 */
export default function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="group flex items-center gap-2.5">
      {/* Aperture mark */}
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="h-8 w-8 transition-transform duration-350 ease-[var(--spring-snappy)] group-hover:rotate-[30deg]"
      >
        <circle
          cx="16"
          cy="16"
          r="14"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-overlay1"
        />
        <circle
          cx="16"
          cy="16"
          r="5"
          fill="currentColor"
          className="text-accent"
        />
        {/* Aperture blades */}
        {[0, 60, 120, 180, 240, 300].map((angle) => (
          <line
            key={angle}
            x1="16"
            y1="6"
            x2="16"
            y2="11"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className="text-accent"
            transform={`rotate(${String(angle)} 16 16)`}
          />
        ))}
      </svg>

      {/* Wordmark */}
      {!compact && (
        <span className="font-display text-lg font-bold tracking-tight text-text">
          Nation
          <span className="text-accent">Cam</span>
        </span>
      )}
    </Link>
  )
}
