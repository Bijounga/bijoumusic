import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipcChannels'
import { isDatabaseOpen } from '../db/database'
import { readCachedPeaks, writeCachedPeaks } from '../waveform/waveformCache'
import { findSimilarByFingerprint, type SimilarityCandidate } from '../waveform/similarity'
import { updateTrackDuration } from '../db/repositories/tracksRepo'

export function registerWaveformIpc(): void {
  ipcMain.handle(IpcChannels.getWaveformPeaks, async (_event, contentHash: string): Promise<Float32Array | null> => {
    return readCachedPeaks(contentHash)
  })

  ipcMain.handle(
    IpcChannels.saveWaveformPeaks,
    async (_event, contentHash: string, peaks: Float32Array): Promise<void> => {
      await writeCachedPeaks(contentHash, peaks)
    }
  )

  ipcMain.handle(
    IpcChannels.updateTrackDuration,
    (_event, trackId: number, durationSeconds: number): void => {
      if (!isDatabaseOpen()) return
      updateTrackDuration(trackId, durationSeconds)
    }
  )

  ipcMain.handle(
    IpcChannels.findSimilarTracks,
    async (
      _event,
      targetContentHash: string,
      candidates: SimilarityCandidate[]
    ): Promise<{ trackId: number; distance: number }[]> => {
      return findSimilarByFingerprint(targetContentHash, candidates)
    }
  )
}
