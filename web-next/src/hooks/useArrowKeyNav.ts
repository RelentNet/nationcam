import { useEffect, useRef } from 'react'

/**
 * Fires `onPrev` / `onNext` on ArrowLeft / ArrowRight, ignoring keystrokes
 * typed into a form field (or any contenteditable) and any chord with a
 * modifier held. The listener is added once on mount and removed on unmount;
 * callbacks are read from a ref so callers don't need to memoize them.
 */
export function useArrowKeyNav(onPrev: () => void, onNext: () => void) {
  const prevRef = useRef(onPrev)
  const nextRef = useRef(onNext)
  prevRef.current = onPrev
  nextRef.current = onNext

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return
      }

      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        target?.isContentEditable
      ) {
        return
      }

      if (event.key === 'ArrowLeft') {
        prevRef.current()
      } else if (event.key === 'ArrowRight') {
        nextRef.current()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
