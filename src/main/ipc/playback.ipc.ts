import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipcChannels'
import { isDatabaseOpen } from '../db/database'
import { logPlaybackEvent } from '../db/repositories/playbackRepo'
import { getRecentlyPlayedTrackIds } from '../db/repositories/playbackEventsRepo'
import { getMostUsedByProjectsTrackIds } from '../db/repositories/projectsRepo'

export function registerPlaybackIpc(): void {
  ipcMain.handle(IpcChannels.logPlaybackEvent, (_event, trackId: number, eventType: string): void => {
    if (!isDatabaseOpen()) return
    logPlaybackEvent(trackId, eventType)
  })

  ipcMain.handle(IpcChannels.getRecentlyPlayed, (): number[] => {
    return getRecentlyPlayedTrackIds()
  })

  ipcMain.handle(IpcChannels.getMostUsed, (): number[] => {
    // Ranked by project usage, not play count — see getMostUsedByProjectsTrackIds.
    return getMostUsedByProjectsTrackIds()
  })
}
