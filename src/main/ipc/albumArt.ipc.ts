import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipcChannels'
import { getAlbumArtDataUrl } from '../albumArt/albumArtCache'

export function registerAlbumArtIpc(): void {
  ipcMain.handle(IpcChannels.getAlbumArt, async (_event, trackId: number): Promise<string | null> => {
    return getAlbumArtDataUrl(trackId)
  })
}
