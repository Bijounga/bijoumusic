import type { Track } from '@shared/types'
import { usePlaybackBoundaryEnforcer } from '../../hooks/usePlaybackBoundaryEnforcer'

/** Renders nothing; hosts usePlaybackBoundaryEnforcer in its own component. That
 *  hook subscribes to the ~4Hz playback time, and hosting it directly in AppShell
 *  re-rendered the entire app shell on every tick for as long as music played. */
function PlaybackBoundaryWatcher({ visibleTracks }: { visibleTracks: Track[] }): null {
  usePlaybackBoundaryEnforcer(visibleTracks)
  return null
}

export default PlaybackBoundaryWatcher
