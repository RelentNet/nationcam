import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { Newspaper } from 'lucide-react'
import type { Post } from '@/lib/types'
import { fetchPostBySlug } from '@/lib/api'
import { seo } from '@/lib/seo'
import EditorialText from '@/components/EditorialText'
import Reveal from '@/components/Reveal'
import { buttonClasses } from '@/components/Button'
import Eyebrow from '@/components/ui/Eyebrow'

/** The three pages a note's scope link can lead to, with their params kept in
 *  step — same discriminated-union shape as PosterTile's LinkTarget. Kept in
 *  step with the identical helper in notes.index.tsx. */
type ScopeTarget =
  | { to: '/locations/$slug'; params: { slug: string } }
  | {
      to: '/locations/$slug/$sublocationSlug'
      params: { slug: string; sublocationSlug: string }
    }
  | {
      to: '/locations/$slug/$sublocationSlug/$cameraSlug'
      params: { slug: string; sublocationSlug: string; cameraSlug: string }
    }

type ScopeLink = { label: string; target: ScopeTarget }

/** Resolves a post's attachment (camera > sublocation > state) into the page
 *  it should link back to, or null for an unscoped post. A camera with no
 *  sublocation has no page of its own (see the sitemap route), so a
 *  camera-scoped post with an empty `sublocation_slug` also links nowhere. */
function postScopeLink(p: Post): ScopeLink | null {
  if (p.video_id && p.video_slug && p.state_slug && p.sublocation_slug) {
    return {
      label: p.video_title || 'this camera',
      target: {
        to: '/locations/$slug/$sublocationSlug/$cameraSlug',
        params: {
          slug: p.state_slug,
          sublocationSlug: p.sublocation_slug,
          cameraSlug: p.video_slug,
        },
      },
    }
  }
  if (p.sublocation_id && p.sublocation_slug && p.state_slug) {
    return {
      label: p.sublocation_name || 'this location',
      target: {
        to: '/locations/$slug/$sublocationSlug',
        params: { slug: p.state_slug, sublocationSlug: p.sublocation_slug },
      },
    }
  }
  if (p.state_id && p.state_slug) {
    return {
      label: p.state_name || 'this state',
      target: { to: '/locations/$slug', params: { slug: p.state_slug } },
    }
  }
  return null
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export const Route = createFileRoute('/notes/$slug')({
  loader: async ({ params }) => {
    const post = await fetchPostBySlug(params.slug).catch(() => null)
    if (!post) throw notFound()
    return { post }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { post } = loaderData
    return seo({
      title: `${post.title} | NationCam Field Notes`,
      description: post.excerpt || post.title,
      path: `/notes/${post.slug}`,
      image: post.cover_url || undefined,
    })
  },
  component: NotePage,
  pendingComponent: LoadingSpinner,
  notFoundComponent: NoteNotFound,
})

function LoadingSpinner() {
  return (
    <div className="page-container">
      <div
        className="flex flex-col items-center justify-center py-20"
        style={{
          opacity: 0,
          animation: 'scale-fade-in 500ms var(--spring-poppy) forwards',
        }}
      >
        <div
          className="h-8 w-8 rounded-full border-2 border-accent border-t-transparent"
          style={{ animation: 'spin 800ms linear infinite' }}
        />
        <p className="mt-4 font-mono text-sm text-subtext0">Loading...</p>
      </div>
    </div>
  )
}

function NoteNotFound() {
  return (
    <div className="page-container page-enter text-center">
      <h2>Note not found</h2>
      <p>The field note you are looking for does not exist.</p>
      <Link to="/notes" className={buttonClasses({ variant: 'primary' })}>
        Back to Field Notes
      </Link>
    </div>
  )
}

function NotePage() {
  const { post } = Route.useLoaderData()
  const scope = postScopeLink(post)

  return (
    <div className="page-container">
      <article className="mx-auto max-w-[720px]">
        <Reveal variant="blur">
          <Eyebrow className="mb-4">
            <Link
              to="/notes"
              className="transition-colors hover:text-accent-ink"
            >
              Field Notes
            </Link>
            {post.published_at && (
              <> &middot; {formatDate(post.published_at)}</>
            )}
          </Eyebrow>
          <h1 className="text-h1">{post.title}</h1>
          {post.excerpt && (
            <p className="text-lede text-subtext1">{post.excerpt}</p>
          )}
        </Reveal>

        {post.cover_url && (
          <Reveal variant="scale">
            <div className="mt-6 mb-8 aspect-video overflow-hidden rounded-xl bg-crust">
              <img
                src={post.cover_url}
                alt=""
                className="h-full w-full object-cover"
              />
            </div>
          </Reveal>
        )}

        <div className="max-w-none [&>p:last-child]:mb-0 [&>ul:last-child]:mb-0">
          {post.body_md.trim() ? (
            <EditorialText text={post.body_md} />
          ) : (
            <p className="mb-0 text-subtext0">
              <Newspaper
                size={14}
                className="mr-1.5 inline-block align-[-2px]"
              />
              This note has no body yet.
            </p>
          )}
        </div>

        {scope && (
          <div className="mt-12 border-t border-border pt-6">
            <Link
              {...scope.target}
              className="inline-flex items-center gap-1.5 font-sans text-sm font-medium text-accent-ink hover:underline"
            >
              &larr; See {scope.label} on NationCam
            </Link>
          </div>
        )}
      </article>
    </div>
  )
}
