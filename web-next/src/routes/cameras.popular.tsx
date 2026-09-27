import { createFileRoute } from '@tanstack/react-router'
import { Trophy } from 'lucide-react'
import { fetchStates, fetchSublocationsByState, fetchVideos } from '@/lib/api'
import { seo, streamPoster } from '@/lib/seo'
import PosterTile, { usePosterTick } from '@/components/PosterTile'
import Reveal from '@/components/Reveal'

export const Route = createFileRoute('/cameras/popular')({
  loader: async () => {
    const videos = await fetchVideos({ sort: 'views' }).catch(() => [])
    // Videos are already active-only (the API's view-sorted query filters that
    // way), so the state/sublocation universe here matches the home loader's
    // approach in routes/index.tsx: only fetch sublocations for states that
    // actually have a video, to build the same camera links LiveNowSection does.
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
      title: 'Most Watched Cameras — NationCam',
      description:
        'The most-watched live cameras on NationCam, ranked by total views.',
      path: '/cameras/popular',
    }),
  component: PopularCamerasPage,
})

function PopularCamerasPage() {
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
              <Trophy size={14} className="text-accent" />
              <span className="font-mono text-xs font-medium text-accent">
                Most watched
              </span>
            </div>
            <h1>Most Watched Cameras</h1>
            <p className="mx-auto max-w-lg">
              Every camera in our network, ranked by total views.
            </p>
          </div>

          {videos.length === 0 ? (
            <p className="text-center text-subtext0">
              No cameras yet — check back soon.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {videos.map((video, index) => {
                const stateSlug = stateSlugById.get(video.state_id)
                const sublocationSlug = video.sublocation_id
                  ? sublocationSlugById.get(video.sublocation_id)
                  : undefined
                return (
                  <div key={video.video_id} className="relative">
                    <span className="absolute top-2 right-2 z-10 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-accent px-1.5 font-mono text-xs font-bold text-crust">
                      #{index + 1}
                    </span>
                    <PosterTile
                      title={video.title}
                      meta={video.sublocation_name || video.state_name}
                      poster={streamPoster(video.src, true)}
                      live
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
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Reveal>
    </section>
  )
}
