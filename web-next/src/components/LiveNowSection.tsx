import { Link } from '@tanstack/react-router'
import type { State, Sublocation, Video } from '@/lib/types'
import { streamPoster } from '@/lib/seo'
import PosterTile, { usePosterTick } from '@/components/PosterTile'
import CameraGrid from '@/components/CameraGrid'
import { buttonClasses } from '@/components/Button'
import SectionHead from '@/components/ui/SectionHead'
import Reveal from '@/components/Reveal'

/** Acceptance: show the first 24 cameras (grouped by state) when there are more. */
const MAX_TILES = 24

interface StateGroup {
  stateId: number
  stateName: string
  stateSlug: string | null
  videos: Array<Video>
}

interface LiveNowSectionProps {
  /** Every video from the home loader's `fetchVideos()` call — filtered to active here. */
  videos: Array<Video>
  states: Array<State>
  sublocations: Array<Sublocation>
}

/**
 * "Live now" — every active or paused camera, one click away from the home
 * page (a paused one shows the "Paused" badge instead of "Live" — DAN-40).
 * Grouped by state (locked decision), capped at 24 tiles with a link to the
 * full directory when there are more. Reuses `PosterTile` and builds camera
 * links exactly like `routes/locations/$slug.index.tsx` does.
 */
export default function LiveNowSection({
  videos,
  states,
  sublocations,
}: LiveNowSectionProps) {
  const tick = usePosterTick()
  const visibleVideos = videos.filter(
    (v) => v.status === 'active' || v.status === 'paused',
  )
  if (visibleVideos.length === 0) return null

  const stateSlugById = new Map(states.map((s) => [s.state_id, s.slug]))
  const sublocationSlugById = new Map(
    sublocations.map((s) => [s.sublocation_id, s.slug]),
  )

  // Group by state, preserving first-seen order per state, then sort states
  // alphabetically so the grid reads consistently across renders.
  const groupsByStateId = new Map<number, StateGroup>()
  for (const video of visibleVideos) {
    let group = groupsByStateId.get(video.state_id)
    if (!group) {
      group = {
        stateId: video.state_id,
        stateName: video.state_name,
        stateSlug: stateSlugById.get(video.state_id) ?? null,
        videos: [],
      }
      groupsByStateId.set(video.state_id, group)
    }
    group.videos.push(video)
  }
  const orderedGroups = Array.from(groupsByStateId.values()).sort((a, b) =>
    a.stateName.localeCompare(b.stateName),
  )

  // Cap at 24 tiles total, cutting off within a group rather than dropping
  // whole groups once the cap is reached.
  let remaining = MAX_TILES
  const sections: Array<StateGroup> = []
  for (const group of orderedGroups) {
    if (remaining <= 0) break
    const trimmed = group.videos.slice(0, remaining)
    sections.push({ ...group, videos: trimmed })
    remaining -= trimmed.length
  }
  const hasMore = visibleVideos.length > MAX_TILES

  return (
    <section className="measure section-y" aria-labelledby="home-live-now">
      <Reveal variant="blur">
        <SectionHead
          id="home-live-now"
          eyebrow="Live now"
          title="Every Camera, One Click Away"
          body="Jump straight into any live feed in our network."
        />

        {sections.map((group) => (
          <div key={group.stateId} className="mb-10">
            <h3 className="mb-4 font-display">{group.stateName}</h3>
            <CameraGrid>
              {group.videos.map((video) => {
                const sublocationSlug = video.sublocation_id
                  ? sublocationSlugById.get(video.sublocation_id)
                  : undefined
                return (
                  <PosterTile
                    key={video.video_id}
                    as="h4"
                    title={video.title}
                    poster={streamPoster(video.src, video.status === 'active')}
                    live={video.status === 'active'}
                    paused={video.status === 'paused'}
                    tick={tick}
                    link={
                      group.stateSlug && sublocationSlug
                        ? {
                            to: '/locations/$slug/$sublocationSlug/$cameraSlug',
                            params: {
                              slug: group.stateSlug,
                              sublocationSlug,
                              cameraSlug: video.slug,
                            },
                          }
                        : undefined
                    }
                  />
                )
              })}
            </CameraGrid>
          </div>
        ))}

        {hasMore && (
          <Link
            to="/locations"
            className={buttonClasses({ variant: 'secondary' })}
          >
            See all cameras &rarr;
          </Link>
        )}
      </Reveal>
    </section>
  )
}
