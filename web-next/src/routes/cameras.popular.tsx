import { createFileRoute } from '@tanstack/react-router'
import { fetchStates, fetchSublocationsByState, fetchVideos } from '@/lib/api'
import { seo, streamPoster } from '@/lib/seo'
import PosterTile, { usePosterTick } from '@/components/PosterTile'
import Reveal from '@/components/Reveal'
import SectionHead from '@/components/ui/SectionHead'

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
    <div className="page-container">
      <Reveal variant="blur">
        <div>
          <SectionHead
            as="h1"
            eyebrow="Most watched"
            title="Most Watched Cameras"
            body="Every camera in our network, ranked by total views."
          />

          {videos.length === 0 ? (
            <p className="rounded-xl border border-border bg-surface0 px-6 py-16 text-center text-subtext1">
              No cameras yet — check back soon.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 lg:grid-cols-4">
              {videos.map((video, index) => {
                const stateSlug = stateSlugById.get(video.state_id)
                const sublocationSlug = video.sublocation_id
                  ? sublocationSlugById.get(video.sublocation_id)
                  : undefined
                return (
                  <PosterTile
                    key={video.video_id}
                    rank={index + 1}
                    title={video.title}
                    meta={video.sublocation_name || video.state_name}
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
    </div>
  )
}
