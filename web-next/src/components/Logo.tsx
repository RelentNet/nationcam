import { Link } from '@tanstack/react-router'
import { Shield, Wordmark } from '@/components/BrandMark'

/**
 * NationCam logo — the Route shield plus the NATIONCAM wordmark, inline SVG
 * from the shared brand paths. Navy in light mode, white in dark mode (both
 * via `text-text`), CAM and the C always orange.
 */
export default function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      className="group flex items-center gap-2.5 text-text"
      aria-label="NationCam home"
    >
      <Shield className="h-9 w-9 shrink-0 transition-transform duration-350 ease-[var(--spring-snappy)] group-hover:-rotate-3 group-hover:scale-105" />
      {!compact && <Wordmark className="h-[17px] w-auto" />}
    </Link>
  )
}
