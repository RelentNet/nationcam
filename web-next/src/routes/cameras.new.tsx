import { createFileRoute } from '@tanstack/react-router'
import { Sparkles } from 'lucide-react'
import { fetchStates, fetchSublocationsByState, fetchVideos } from '@/lib/api'
import { seo, streamPoster } from '@/lib/seo'
import PosterTile, { usePosterTick } from '@/components/PosterTile'
import Reveal from '@/components/Reveal'

/** "Added <Month YYYY>" — matches the tile meta line other pages use. */
function addedLabel(createdAt: string) {
  return `Added ${new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(createdAt))}`
}

export const Route = createFileRoute('/cameras/new')({
  loader: async () => {
    const videos = await fetchVideos({ sort: 'newest' }).catch(() => [])
    // Same approach as /cameras/popular and the home loader: fetch
    // sublocations only for states that actually have a video, to build the
    // same camera links LiveNowSection does.
    const stateIds = new Set(videos.map((v) => v.state_id))
    const states = (await fetchStates().catch(() => [])).filter((s) =>
      stateIds.has(s.state_id),
    )
    const sublocations = (
      await Promise.all(
        states.map((s) => fetchSublocationsByState(s.slug).catch(() => [])),
      )
    ).flat()
    return { videos, states, sublocations }
  },
  head: () =>
    seo({
      title: 'Newest Cameras — NationCam',
      description:
        'The latest live cameras added to the NationCam network, newest first.',
      path: '/cameras/new',
    }),
  component: NewCamerasPage,
})

function NewCamerasPage() {
  const { videos, states, sublocations } = Route.useLoaderData()
  const tick = usePosterTick()

  const stateSlugById = new Map(states.map((s) => [s.state_id, s.slug]))
  const sublocationSlugById = new Map(
    sublocations.map((s) => [s.sublocation_id, s.slug]),
  )

  return (
    <section className="py-20">
      <Reveal variant="blur">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-1.5">
              <Sparkles size={14} className="text-accent" />
              <span className="font-mono text-xs font-medium text-accent">
                Newest
              </span>
            </div>
            <h1>Newest Cameras</h1>
            <p className="mx-auto max-w-lg">
              The latest additions to our network, newest first.
            </p>
          </div>

          {videos.length === 0 ? (
            <p className="text-center text-subtext0">
              No cameras yet — check back soon.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {videos.map((video) => {
                const stateSlug = stateSlugById.get(video.state_id)
                const sublocationSlug = video.sublocation_id
                  ? sublocationSlugById.get(video.sublocation_id)
                  : undefined
                return (
                  <PosterTile
                    key={video.video_id}
                    title={video.title}
                    meta={addedLabel(video.created_at)}
                    poster={streamPoster(video.src, video.status === 'active')}
                    live={video.status === 'active'}
                    paused={video.status === 'paused'}
                    tick={tick}
                    link={
                      stateSlug && sublocationSlug
                        ? {
                            to: '/locations/$slug/$sublocationSlug/$cameraSlug',
                            params: {
                              slug: stateSlug,
                              sublocationSlug,
                              cameraSlug: video.slug,
                            },
                          }
                        : undefined
                    }
                  />
                )
              })}
            </div>
          )}
        </div>
      </Reveal>
    </section>
  )
}
