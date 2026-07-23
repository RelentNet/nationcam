import { useEffect, useRef, useState } from 'react'
import type { AdPlacement, ServedAd } from '@/lib/types'
import { adClickUrl, fetchBannerAd, recordAdImpression } from '@/lib/api'

interface BannerSlotProps {
  placement: AdPlacement
  /** Page scope — pass whatever the current page knows (at most one). */
  videoId?: number
  sublocationId?: number
  stateId?: number
  className?: string
}

/**
 * Injects admin-authored banner HTML into `host` so that any embedded
 * `<script>` actually executes. Setting `innerHTML` alone does NOT run scripts
 * (per the HTML spec), so every script node is recreated. For AdSense creatives
 * we then fire the `adsbygoogle` push the tag expects.
 *
 * SECURITY: `html` is trusted, admin-only content that can ONLY originate from
 * the `/ads/banner` endpoint (rows are created behind Logto RBAC — `admin`
 * scope required). It is never user input, and injection is scoped to this one
 * container, so this deliberate `innerHTML` is safe.
 */
export function injectCreative(host: HTMLElement, html: string): void {
  host.innerHTML = html
  host.querySelectorAll('script').forEach((old) => {
    const script = document.createElement('script')
    for (const attr of Array.from(old.attributes)) {
      script.setAttribute(attr.name, attr.value)
    }
    script.textContent = old.textContent
    old.replaceWith(script)
  })
  if (/adsbygoogle/i.test(html)) {
    try {
      const w = window as unknown as { adsbygoogle?: Array<unknown> }
      w.adsbygoogle = w.adsbygoogle || []
      w.adsbygoogle.push({})
    } catch {
      /* loader not ready / no fill — the tag retries itself, nothing to do */
    }
  }
}

/**
 * A single banner ad slot. Fetches the creative for its placement + page scope
 * and renders NOTHING on 204 (no empty box — the layout must look intentional
 * with or without an ad). Reused for every slot on every page.
 */
export default function BannerSlot({
  placement,
  videoId,
  sublocationId,
  stateId,
  className,
}: BannerSlotProps) {
  const [ad, setAd] = useState<ServedAd | null>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const impressedRef = useRef(false)

  // Fetch (client-only) whenever placement/scope changes.
  useEffect(() => {
    let cancelled = false
    impressedRef.current = false
    setAd(null)
    fetchBannerAd({ placement, videoId, sublocationId, stateId }).then(
      (next) => {
        if (!cancelled) setAd(next)
      },
    )
    return () => {
      cancelled = true
    }
  }, [placement, videoId, sublocationId, stateId])

  // Inject + execute the creative once we have one.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !ad) return
    injectCreative(host, ad.html_code)
    return () => {
      host.innerHTML = ''
    }
  }, [ad])

  // Record an impression the first time the slot is actually on screen — rail
  // and mobile slots can start below the fold.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !ad || impressedRef.current) return
    // No IntersectionObserver (very old / locked-down browsers): the creative
    // did render, so count it rather than dropping the billing row.
    if (typeof IntersectionObserver === 'undefined') {
      impressedRef.current = true
      recordAdImpression(ad.ad_id, videoId)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && !impressedRef.current) {
          impressedRef.current = true
          recordAdImpression(ad.ad_id, videoId)
          io.disconnect()
        }
      },
      { threshold: 0.5 },
    )
    io.observe(host)
    return () => io.disconnect()
  }, [ad, videoId])

  if (!ad) return null

  // AdSense records and routes its own clicks, so we must NOT wrap it. Only
  // direct-sold HTML that carries a click_url gets routed through our tracker.
  const isAdSense = /adsbygoogle/i.test(ad.html_code)
  const creative = <div ref={hostRef} />

  return (
    <aside className={className} aria-label="Advertisement">
      {!isAdSense && ad.click_url ? (
        <a
          href={adClickUrl(ad.ad_id, videoId)}
          target="_blank"
          rel="noopener noreferrer sponsored"
        >
          {creative}
        </a>
      ) : (
        creative
      )}
    </aside>
  )
}
