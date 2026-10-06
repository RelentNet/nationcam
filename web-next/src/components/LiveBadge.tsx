/**
 * Pulsing LIVE badge: live-red mono text on a surface chip, pulsing dot,
 * red glow ring.
 */
export default function LiveBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md bg-live-bg px-2 py-[5px] font-mono text-[11px] leading-none font-semibold tracking-[0.05em] text-live uppercase shadow-[0_0_0_1px_var(--color-live-glow),0_0_14px_-2px_var(--color-live-glow)] ${className}`}
    >
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 rounded-full bg-live shadow-[0_0_0_3px_var(--color-live-glow)]"
        style={{ animation: 'pulse-live 1.5s ease-in-out infinite' }}
      />
      Live
    </span>
  )
}
