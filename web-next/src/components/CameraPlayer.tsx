import { Link } from '@tanstack/react-router'
import { Pause } from 'lucide-react'
import type { Video } from '@/lib/types'
import { streamPoster } from '@/lib/seo'
import PrerollGate from '@/components/PrerollGate'
import StreamPlayer from '@/components/StreamPlayer'

/**
 * The camera-page player: the live HLS stream behind an optional skippable
 * pre-roll (see `PrerollGate`), with audio channels and the page's drop shadow.
 * The camera's latest still fills the frame until the stream is up.
 *
 * An owner-paused camera (DAN-40) never reaches the player — no HLS load is
 * attempted — `PausedPlaceholder` renders in its place instead.
 */
export default function CameraPlayer({ camera }: { camera: Video }) {
  if (camera.status === 'paused') {
    return <PausedPlaceholder camera={camera} />
  }

  const poster = streamPoster(camera.src, camera.status === 'active')
  return (
    <PrerollGate
      videoId={camera.video_id}
      poster={poster}
      className="shadow-xl"
    >
      <StreamPlayer
        src={camera.src}
        type={camera.type}
        autoplay
        muted
        controls
        fluid
        live={camera.status === 'active'}
        audioChannels
        poster={poster}
        className="shadow-xl"
      />
    </PrerollGate>
  )
}

/**
 * Shown in the player's place when `camera.status === 'paused'`: the
 * camera's latest still — from the stable snapshot endpoint, not the
 * Restreamer live jpg beside the manifest, which is gone once the stream
 * stops — dimmed behind a Pause icon and a link back to the rest of the
 * sublocation's cameras. `state_slug`/`sublocation_slug` are only set when
 * `camera` came from the per-camera endpoint (see `Camera` in lib/types);
 * every known `CameraPlayer` caller passes exactly that, but the still and
 * link degrade to plain text rather than breaking if they're ever absent.
 */
function PausedPlaceholder({ camera }: { camera: Video }) {
  const stillUrl =
    camera.state_slug && camera.sublocation_slug
      ? `/api/videos/${camera.state_slug}/${camera.sublocation_slug}/${camera.slug}/snapshot.jpg`
      : undefined
  const sublocationName = camera.sublocation_name || 'this location'

  return (
    <div className="stream-player aspect-video shadow-xl">
      {stillUrl && (
        <img
          src={stillUrl}
          alt=""
          className="h-full w-full object-cover opacity-30"
        />
      )}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-crust/50 px-6 text-center">
        <Pause size={28} className="text-overlay1" />
        <p className="mb-0 font-sans font-semibold text-text">
          This camera has been paused by its owner
        </p>
        <p className="mb-0 text-sm text-subtext1">
          Check back later or{' '}
          {camera.state_slug && camera.sublocation_slug ? (
            <Link
              to="/locations/$slug/$sublocationSlug"
              params={{
                slug: camera.state_slug,
                sublocationSlug: camera.sublocation_slug,
              }}
              className="text-accent hover:underline"
            >
              browse other cameras at {sublocationName}
            </Link>
          ) : (
            `browse other cameras at ${sublocationName}`
          )}
        </p>
      </div>
    </div>
  )
}
