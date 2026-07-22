import { useReveal } from '@/hooks/useReveal'

type RevealVariant = 'default' | 'left' | 'right' | 'scale' | 'blur' | 'float'

const variantClassMap: Record<RevealVariant, string> = {
  default: 'reveal',
  left: 'reveal-left',
  right: 'reveal-right',
  scale: 'reveal-scale',
  blur: 'reveal-blur',
  float: 'reveal-float',
}

interface RevealProps {
  children: React.ReactNode
  className?: string
  /** Animation variant — controls direction and style of entrance */
  variant?: RevealVariant
  /** If true, staggers children that also have a reveal class */
  stagger?: boolean
}

/**
 * Wrapper that animates children when they enter the viewport.
 * Uses IntersectionObserver + CSS animations (no JS animation library).
 *
 * Variants:
 *  - default: fade + slide up
 *  - left/right: fade + slide from side
 *  - scale: fade + scale from center (poppy spring)
 *  - blur: fade + deblur
 *  - float: fade + large slide up with subtle scale
 *
 * When `stagger` is true, children are expected to have their own
 * reveal variant classes (e.g. `reveal-scale`) and will be animated
 * individually with staggered delays.
 */
export default function Reveal({
  children,
  className = '',
  variant = 'default',
  stagger = false,
}: RevealProps) {
  const ref = useReveal<HTMLDivElement>()

  // When stagger mode, the container just provides the stagger context.
  // When non-stagger, the container itself is the reveal element.
  const revealCls = stagger ? '' : variantClassMap[variant]
  const staggerCls = stagger ? 'reveal-stagger' : ''

  return (
    <div
      ref={ref}
      className={`${revealCls} ${staggerCls} ${className}`.trim()}
    >
      {children}
    </div>
  )
}


