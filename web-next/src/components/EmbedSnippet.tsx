import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { SITE_URL } from '@/lib/seo'

interface EmbedSnippetProps {
  stateSlug: string
  sublocationSlug: string
  cameraSlug: string
  /** Camera title — used only for the iframe's `title` attribute. */
  title: string
  className?: string
}

/** Default iframe size (DAN-33 — locked decision, not configurable). */
export const EMBED_WIDTH = 400
export const EMBED_HEIGHT = 360

/** Absolute URL of the embed page for one camera. */
export function embedUrl(
  stateSlug: string,
  sublocationSlug: string,
  cameraSlug: string,
): string {
  return `${SITE_URL}/embed/${stateSlug}/${sublocationSlug}/${cameraSlug}`
}

/** The `<iframe>` snippet a host pastes into their own site. */
export function embedSnippetCode({
  stateSlug,
  sublocationSlug,
  cameraSlug,
  title,
}: Omit<EmbedSnippetProps, 'className'>): string {
  const src = embedUrl(stateSlug, sublocationSlug, cameraSlug)
  return `<iframe src="${src}" width="${EMBED_WIDTH}" height="${EMBED_HEIGHT}" style="border:0" loading="lazy" title="${title} — NationCam"></iframe>`
}

/**
 * A read-only code box with the host iframe snippet and a copy button — the
 * "Embed this camera" content shown on the camera page and in the dashboard's
 * camera row (DAN-33). Each call site provides its own disclosure/toggle.
 */
export default function EmbedSnippet({
  stateSlug,
  sublocationSlug,
  cameraSlug,
  title,
  className = '',
}: EmbedSnippetProps) {
  const [copied, setCopied] = useState(false)
  const code = embedSnippetCode({
    stateSlug,
    sublocationSlug,
    cameraSlug,
    title,
  })

  const copy = () => {
    navigator.clipboard.writeText(code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={`rounded-xl border border-overlay0 bg-base p-3.5 ${className}`}
    >
      <p className="mb-2 text-xs text-subtext0">
        Paste this into your site to show this camera — a live still (or
        player), current conditions, and a link back to NationCam.
      </p>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 font-mono text-xs break-all whitespace-pre-wrap text-text">
          {code}
        </code>
        <button
          type="button"
          onClick={copy}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-subtext0 transition-colors duration-150 hover:bg-accent/10 hover:text-accent"
          title={copied ? 'Copied!' : 'Copy embed code'}
          aria-label="Copy embed code"
        >
          {copied ? (
            <Check size={14} className="text-teal" />
          ) : (
            <Copy size={14} />
          )}
        </button>
      </div>
    </div>
  )
}
