import { ipcMain, BrowserWindow } from 'electron'
import { join, basename } from 'path'
import { IpcChannels } from '@shared/ipcChannels'
import type { DownloadTrackPayload, DownloadResult, VideoInfoPreview } from '@shared/types'
import { listLibraryRoots } from '../db/repositories/libraryRootsRepo'
import { findTrackByFolderAndFilename } from '../db/repositories/tracksRepo'
import { scanFolder } from '../scanner/libraryScanner'
import { downloadAudioToFolder, getVideoThumbnail } from '../downloader/ytDlpDownloader'

export function registerDownloaderIpc(): void {
  ipcMain.handle(
    IpcChannels.downloadTrack,
    async (event, payload: DownloadTrackPayload): Promise<DownloadResult> => {
      const senderWindow = BrowserWindow.fromWebContents(event.sender)
      const root = listLibraryRoots().find((r) => r.id === payload.libraryRootId)
      if (!root) return { success: false, error: 'Library folder not found' }

      const destFolder = payload.relativePath ? join(root.path, payload.relativePath) : root.path

      try {
        const { filePath } = await downloadAudioToFolder(
          payload.url,
          destFolder,
          payload.embedThumbnail,
          (progress) => {
            senderWindow?.webContents.send(IpcChannels.downloadProgress, progress)
          }
        )

        senderWindow?.webContents.send(IpcChannels.downloadProgress, { stage: 'scanning' })
        const scanResult = await scanFolder(root.id, root.path, payload.relativePath)

        // The scan's own record of what it just inserted is authoritative and
        // doesn't involve matching against yt-dlp's reported path at all — a
        // title with sanitized-to-fullwidth punctuation (":" -> "："  etc.)
        // doesn't reliably round-trip through a spawned process's stdout, so
        // matching against that text intermittently found nothing. Only falls
        // back to the filename lookup for the rare case where this exact file
        // already existed (a re-download), so the scan inserted nothing new.
        let trackId: number | undefined = scanResult.insertedTrackIds[scanResult.insertedTrackIds.length - 1]
        if (trackId === undefined) {
          const track = findTrackByFolderAndFilename(root.id, payload.relativePath, basename(filePath))
          trackId = track?.id
        }

        return { success: true, filePath, trackId }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(IpcChannels.getVideoInfo, async (_event, url: string): Promise<VideoInfoPreview> => {
    try {
      const info = await getVideoThumbnail(url)
      return { thumbnail: info.thumbnail, title: info.title }
    } catch (err) {
      return { thumbnail: null, title: null, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
