import { useEffect, useRef } from 'react'

/**
 * All CSS class names that represent revealable elements.
 * Each gets 'revealed' added when it enters the viewport.
 */
const REVEAL_SELECTORS = [
  '.reveal',
  '.reveal-left',
  '.reveal-right',
  '.reveal-scale',
  '.reveal-blur',
  '.reveal-float',
].join(',')

const REVEAL_CLASSES = [
  'reveal',
  'reveal-left',
  'reveal-right',
  'reveal-scale',
  'reveal-blur',
  'reveal-float',
]

/**
 * Observes an element and adds the 'revealed' class when it enters the viewport.
 * Works with all `.reveal*` CSS classes in styles.css.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(
  options: { threshold?: number; rootMargin?: string } = {},
) {
  const ref = useRef<T>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed')
            observer.unobserve(entry.target)
          }
        }
      },
      {
        threshold: options.threshold ?? 0.1,
        rootMargin: options.rootMargin ?? '0px 0px -40px 0px',
      },
    )

    // Observe all reveal-variant children
    const revealChildren = el.querySelectorAll(REVEAL_SELECTORS)
    for (const child of revealChildren) {
      observer.observe(child)
    }
    // Also observe the container itself if it has any reveal class
    const isRevealable = REVEAL_CLASSES.some((cls) => el.classList.contains(cls))
    if (isRevealable) {
      observer.observe(el)
    }

    return () => observer.disconnect()
  }, [options.threshold, options.rootMargin])

  return ref
}
