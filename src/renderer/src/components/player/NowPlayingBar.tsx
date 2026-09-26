import { useState } from 'react'
import { usePlaybackStore } from '../../state/playbackStore'
import { usePremiereStatus } from '../../hooks/usePremiereStatus'
import { usePremiereExport } from '../../hooks/usePremiereExport'
import { useVisibleTracks } from '../../state/useVisibleTracks'
import { useTransportControls } from '../../hooks/useTransportControls'
import { useAuditionStore } from '../../state/auditionStore'
import { useAutoplayStore } from '../../state/autoplayStore'
import { useShuffleStore } from '../../state/shuffleStore'
import { usePreviewClipStore } from '../../state/previewClipStore'
import { formatDuration } from '../../lib/format'
import TagEditorPopover from '../tags/TagEditorPopover'
import AliasEditorPopover from '../aliases/AliasEditorPopover'
import BookmarksPopover from './BookmarksPopover'
import PreviewClipPopover from './PreviewClipPopover'
import ProjectPickerPopover from '../projects/ProjectPickerPopover'
import FavoriteSelector from '../favorites/FavoriteSelector'
import EnergySelector from '../favorites/EnergySelector'
import VolumeControl from './VolumeControl'
import PlaybackSpeedControl from './PlaybackSpeedControl'
import AlbumArt from './AlbumArt'
import PlaybackProgressRing from './PlaybackProgressRing'
import ScrollingText from '../common/ScrollingText'
import { PlayIcon, PauseIcon, PreviousTrackIcon, NextTrackIcon, ShuffleIcon, DragHandleIcon } from './TransportIcons'
import styles from './NowPlayingBar.module.css'

function NowPlayingBar(): React.JSX.Element {
  const currentTrack = usePlaybackStore((s) => s.currentTrack)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)
  const currentTime = usePlaybackStore((s) => s.currentTime)
  const duration = usePlaybackStore((s) => s.duration)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const visibleTracks = useVisibleTracks()
  const { next, previous, hasNext } = useTransportControls(visibleTracks)
  const auditionEnabled = useAuditionStore((s) => s.enabled)
  const toggleAudition = useAuditionStore((s) => s.toggle)
  const autoplayEnabled = useAutoplayStore((s) => s.enabled)
  const toggleAutoplay = useAutoplayStore((s) => s.toggle)
  const shuffleEnabled = useShuffleStore((s) => s.enabled)
  const toggleShuffle = useShuffleStore((s) => s.toggle)
  const isDrawingRange = usePreviewClipStore((s) => s.isDrawingRange)
  const toggleDrawingRange = usePreviewClipStore((s) => s.toggleDrawingRange)
  const premiereConnected = usePremiereStatus()
  const premiereExport = usePremiereExport(currentTrack)
  const [sendingToPremiere, setSendingToPremiere] = useState(false)

  async function handlePremiereButtonClick(): Promise<void> {
    if (!premiereConnected) {
      alert("Premiere extension not connected — open Premiere with the BijouMusic panel loaded, then try again.")
      return
    }
    if (!currentTrack) {
      alert('Select a track first.')
      return
    }
    setSendingToPremiere(true)
    try {
      await premiereExport.sendToPremiere()
    } catch (err) {
      alert(`Couldn't send to Premiere: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setSendingToPremiere(false)
    }
  }

  return (
    <div className={styles.bar}>
      <AlbumArt track={currentTrack} />

      <div className={styles.transportCluster}>
        <button
          className={styles.transportBtn}
          disabled={!currentTrack}
          onClick={previous}
          aria-label="Previous track"
          title="Previous track (press twice quickly to go back a track)"
        >
          <PreviousTrackIcon size={22} />
        </button>
        <PlaybackProgressRing size={70}>
          <button
            className={styles.playButton}
            disabled={!currentTrack}
            onClick={() => togglePlayPause()}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
          </button>
        </PlaybackProgressRing>
        <button
          className={styles.transportBtn}
          disabled={!currentTrack || !hasNext}
          onClick={next}
          aria-label="Next track"
          title="Next track"
        >
          <NextTrackIcon size={22} />
        </button>
        <button
          className={`${styles.transportBtn} ${shuffleEnabled ? styles.transportBtnActive : ''}`}
          onClick={() => toggleShuffle()}
          aria-label="Shuffle"
          title={shuffleEnabled ? 'Shuffle on — Next picks a random track' : 'Shuffle off — Next steps in order'}
        >
          <ShuffleIcon size={21} />
        </button>
      </div>

      {currentTrack && (
        <span className={styles.time}>
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </span>
      )}

      <div className={styles.trackInfo}>
        {currentTrack ? (
          <ScrollingText text={currentTrack.filename} scroll className={styles.trackName} />
        ) : (
          <span className={`${styles.trackName} ${styles.trackNameEmpty}`}>Nothing playing</span>
        )}
        {currentTrack && <span className={styles.trackFolder}>{currentTrack.folderPath || '(root)'}</span>}
      </div>

      <button
        className={styles.dragHandleBtn}
        disabled={!currentTrack}
        draggable={!!currentTrack}
        onDragStart={(e) => {
          e.preventDefault()
          if (!currentTrack) return
          // Tells the extension what to watch for before the drag actually starts —
          // dragstart can't await this (the gesture would be long over by the time
          // an async round trip resolves), so the temp file has to already be ready
          // (see usePremiereExport) and this notification is fire-and-forget.
          premiereExport.notifyExpectedDrop()
          window.api.startTrackDrag([premiereExport.getDragPath()])
        }}
        aria-label="Drag into Premiere or DaVinci"
        title="Drag into Premiere or DaVinci"
      >
        <DragHandleIcon size={16} />
      </button>

      <button
        className={styles.premiereStatusBtn}
        onClick={() => void handlePremiereButtonClick()}
        disabled={sendingToPremiere}
        aria-label="Send to Premiere"
        title={
          sendingToPremiere
            ? 'Sending…'
            : premiereConnected
              ? 'Send the current track to Premiere'
              : 'Premiere extension not connected — open Premiere with the BijouMusic panel loaded'
        }
      >
        <span className={`${styles.premiereStatusDot} ${premiereConnected ? styles.premiereStatusDotOn : ''}`} />
        Premiere
      </button>

      <EnergySelector track={currentTrack} />
      <FavoriteSelector track={currentTrack} />
      <AliasEditorPopover track={currentTrack} />
      <BookmarksPopover track={currentTrack} />
      <PreviewClipPopover track={currentTrack} />
      <button
        className={`${styles.auditionBtn} ${isDrawingRange ? styles.auditionBtnActive : ''}`}
        onClick={() => toggleDrawingRange()}
        title={
          isDrawingRange
            ? 'Drag-to-mark on — click and drag on the waveform to set the in/out points'
            : 'Toggle drag-to-mark: click and drag on the waveform to set the in/out points'
        }
      >
        Draw Range
      </button>
      <ProjectPickerPopover track={currentTrack} />
      <TagEditorPopover track={currentTrack} />
      <button
        className={`${styles.auditionBtn} ${autoplayEnabled ? styles.auditionBtnActive : ''}`}
        onClick={() => toggleAutoplay()}
        title={
          autoplayEnabled
            ? 'Keep playing is on — the next track starts automatically when one ends'
            : 'Keep playing — automatically start the next track when one ends'
        }
      >
        Keep Playing
      </button>
      <button
        className={`${styles.auditionBtn} ${auditionEnabled ? styles.auditionBtnActive : ''}`}
        onClick={() => toggleAudition()}
        title={
          auditionEnabled
            ? 'Rapid audition mode on — each track auto-advances after 10s'
            : 'Rapid audition mode — skim the list quickly, auto-advancing every 10s'
        }
      >
        Audition
      </button>
      <PlaybackSpeedControl />
      <VolumeControl />
    </div>
  )
}

export default NowPlayingBar
