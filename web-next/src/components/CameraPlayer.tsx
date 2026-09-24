import type { Video } from '@/lib/types'
import { streamPoster } from '@/lib/seo'
import PrerollGate from '@/components/PrerollGate'
import StreamPlayer from '@/components/StreamPlayer'

/**
 * The camera-page player: the live HLS stream behind an optional skippable
 * pre-roll (see `PrerollGate`), with audio channels and the page's drop shadow.
 * The camera's latest still fills the frame until the stream is up.
 */
export default function CameraPlayer({ camera }: { camera: Video }) {
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
