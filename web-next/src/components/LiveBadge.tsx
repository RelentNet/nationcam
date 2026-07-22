/**
 * Pulsing LIVE indicator badge with monospace font.
 */
export default function LiveBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md bg-live/15 px-2.5 py-1 font-mono text-xs font-semibold tracking-wider text-live uppercase ${className}`}
    >
      <span
        className="inline-block h-2 w-2 rounded-full bg-live"
        style={{ animation: 'pulse-live 1.5s ease-in-out infinite' }}
      />
      Live
    </span>
  )
}
