import type { Video } from '@/lib/types'
import PrerollGate from '@/components/PrerollGate'
import StreamPlayer from '@/components/StreamPlayer'

/**
 * The camera-page player: the live HLS stream behind an optional skippable
 * pre-roll (see `PrerollGate`), with audio channels and the page's drop shadow.
 */
export default function CameraPlayer({ camera }: { camera: Video }) {
  return (
    <PrerollGate videoId={camera.video_id} className="shadow-xl">
      <StreamPlayer
        src={camera.src}
        type={camera.type}
        autoplay
        muted
        controls
        fluid
        live={camera.status === 'active'}
        audioChannels
        className="shadow-xl"
      />
    </PrerollGate>
  )
}
