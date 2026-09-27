import { Link, createFileRoute } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Newspaper } from 'lucide-react'
import type { Post } from '@/lib/types'
import { fetchPosts } from '@/lib/api'
import { seo } from '@/lib/seo'
import Reveal from '@/components/Reveal'

const NOTES_PER_PAGE = 12

// Optional so `<Link to="/notes">` (no page — page 1) never has to pass a
// search object; validateSearch/loaderDeps normalize the missing case to 1.
type NotesSearch = { page?: number }

/** The three pages a note's scope link can lead to, with their params kept in
 *  step — same discriminated-union shape as PosterTile's LinkTarget. */
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
 *  it should link to, or null for an unscoped post. A camera with no
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

export const Route = createFileRoute('/notes/')({
  validateSearch: (search: Record<string, unknown>): NotesSearch => {
    const page = Number(search.page)
    return Number.isFinite(page) && page > 1 ? { page: Math.floor(page) } : {}
  },
  loaderDeps: ({ search }) => ({ page: search.page ?? 1 }),
  loader: async ({ deps }) => {
    const offset = (deps.page - 1) * NOTES_PER_PAGE
    const { data, has_more } = await fetchPosts({
      limit: NOTES_PER_PAGE,
      offset,
    })
    return { posts: data, hasMore: has_more, page: deps.page }
  },
  head: () =>
    seo({
      title: 'Field Notes | NationCam',
      description:
        'Dispatches from the marinas, waterfronts and communities on NationCam — written by the people behind the cameras.',
      path: '/notes',
    }),
  component: NotesIndexPage,
  pendingComponent: NotesSkeleton,
})

function NotesHeader() {
  return (
    <Reveal variant="blur">
      <div className="mb-10">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-1.5">
          <Newspaper size={14} className="text-accent" />
          <span className="font-mono text-xs font-medium text-accent">
            Field notes
          </span>
        </div>
        <h1>Field Notes</h1>
        <p className="max-w-lg">
          Dispatches from the marinas, waterfronts and communities on NationCam.
        </p>
      </div>
    </Reveal>
  )
}

function NoteCard({ post: p }: { post: Post }) {
  const scope = postScopeLink(p)
  return (
    <article className="group overflow-hidden rounded-xl border border-overlay0/60 bg-surface0 transition-[transform,border-color,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-accent">
      <Link to="/notes/$slug" params={{ slug: p.slug }} className="block">
        <div className="aspect-video overflow-hidden bg-crust">
          {p.cover_url ? (
            <img
              src={p.cover_url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-overlay1">
              <Newspaper size={28} />
            </div>
          )}
        </div>
      </Link>
      <div className="p-4">
        {p.published_at && (
          <p className="mb-1.5 font-mono text-[11px] text-subtext0">
            {formatDate(p.published_at)}
          </p>
        )}
        <Link to="/notes/$slug" params={{ slug: p.slug }}>
          <h3 className="mb-1.5 !text-lg transition-colors group-hover:text-accent">
            {p.title}
          </h3>
        </Link>
        {p.excerpt && (
          <p className="mb-2 line-clamp-3 text-sm text-subtext1">{p.excerpt}</p>
        )}
        {scope && (
          <Link
            {...scope.target}
            className="text-xs font-medium text-accent hover:underline"
          >
            {scope.label} &rarr;
          </Link>
        )}
      </div>
    </article>
  )
}

function NotesEmpty() {
  return (
    <div className="section-container py-16 text-center">
      <Newspaper size={32} className="mx-auto mb-4 text-overlay1" />
      <h3>No field notes yet</h3>
      <p className="mx-auto max-w-lg">
        Check back soon — dispatches from the cameras will show up here.
      </p>
    </div>
  )
}

function NotesPagination({
  page,
  hasMore,
}: {
  page: number
  hasMore: boolean
}) {
  if (page === 1 && !hasMore) return null
  return (
    <div className="mt-10 flex items-center justify-between">
      {page > 1 ? (
        <Link
          to="/notes"
          search={{ page: page - 1 }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-overlay0 px-4 py-2 text-sm text-subtext0 transition-colors hover:text-text"
        >
          <ChevronLeft size={15} />
          Newer
        </Link>
      ) : (
        <span />
      )}
      {hasMore && (
        <Link
          to="/notes"
          search={{ page: page + 1 }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-overlay0 px-4 py-2 text-sm text-subtext0 transition-colors hover:text-text"
        >
          Older
          <ChevronRight size={15} />
        </Link>
      )}
    </div>
  )
}

function NotesSkeleton() {
  return (
    <div className="page-container">
      <NotesHeader />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="aspect-[4/5] rounded-xl border border-overlay0 bg-surface0"
            style={{
              opacity: 0,
              animation: `fade-in 400ms var(--spring-ease-out) ${i * 60}ms forwards`,
            }}
          >
            <div
              className="h-full w-full rounded-xl bg-gradient-to-r from-surface0 via-mantle to-surface0 bg-[length:200%_100%]"
              style={{ animation: 'shimmer 1.5s ease-in-out infinite' }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function NotesIndexPage() {
  const { posts, hasMore, page } = Route.useLoaderData()

  return (
    <div className="page-container">
      <NotesHeader />
      {posts.length === 0 ? (
        <NotesEmpty />
      ) : (
        <>
          <Reveal stagger>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((p) => (
                <NoteCard key={p.post_id} post={p} />
              ))}
            </div>
          </Reveal>
          <NotesPagination page={page} hasMore={hasMore} />
        </>
      )}
    </div>
  )
}
