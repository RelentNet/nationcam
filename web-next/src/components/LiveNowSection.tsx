import { Link } from '@tanstack/react-router'
import { Radio } from 'lucide-react'
import type { State, Sublocation, Video } from '@/lib/types'
import { streamPoster } from '@/lib/seo'
import PosterTile, { usePosterTick } from '@/components/PosterTile'
import { CTA_CLASS } from '@/components/SublocationPage'
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
 * "Live now" — every active camera, one click away from the home page.
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
  const activeVideos = videos.filter((v) => v.status === 'active')
  if (activeVideos.length === 0) return null

  const stateSlugById = new Map(states.map((s) => [s.state_id, s.slug]))
  const sublocationSlugById = new Map(
    sublocations.map((s) => [s.sublocation_id, s.slug]),
  )

  // Group by state, preserving first-seen order per state, then sort states
  // alphabetically so the grid reads consistently across renders.
  const groupsByStateId = new Map<number, StateGroup>()
  for (const video of activeVideos) {
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
  const hasMore = activeVideos.length > MAX_TILES

  return (
    <section className="py-20">
      <Reveal variant="blur">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/5 px-4 py-1.5">
              <Radio size={14} className="text-accent" />
              <span className="font-mono text-xs font-medium text-accent">
                Live now
              </span>
            </div>
            <h2>Every Camera, One Click Away</h2>
            <p className="mx-auto max-w-lg">
              Jump straight into any live feed in our network.
            </p>
          </div>

          {sections.map((group) => (
            <div key={group.stateId} className="mb-10">
              <h3 className="mb-4">{group.stateName}</h3>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {group.videos.map((video) => {
                  const sublocationSlug = video.sublocation_id
                    ? sublocationSlugById.get(video.sublocation_id)
                    : undefined
                  return (
                    <PosterTile
                      key={video.video_id}
                      title={video.title}
                      poster={streamPoster(video.src, true)}
                      live
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
              </div>
            </div>
          ))}

          {hasMore && (
            <div className="text-center">
              <Link to="/locations" className={CTA_CLASS}>
                See all cameras &rarr;
              </Link>
            </div>
          )}
        </div>
      </Reveal>
    </section>
  )
}
