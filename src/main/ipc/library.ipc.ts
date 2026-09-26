import { ipcMain, dialog, shell, nativeImage, BrowserWindow } from 'electron'
import { basename } from 'path'
import { IpcChannels } from '@shared/ipcChannels'
import type { Track, LibraryRoot, ScanResult } from '@shared/types'
import { listLibraryRoots, getOrCreateLibraryRoot } from '../db/repositories/libraryRootsRepo'
import {
  listTracks,
  findDuplicateGroups,
  updateTrackLoudness,
  updateTrackPreviewRange,
  findTrackById,
  markTrackMissing,
  type TrackRow
} from '../db/repositories/tracksRepo'
import { scanLibraryRoot, scanFolder } from '../scanner/libraryScanner'
import { getAppIconPath } from '../iconPath'

function toTrack(row: TrackRow): Track {
  return {
    id: row.id,
    libraryRootId: row.library_root_id,
    contentHash: row.content_hash,
    currentPath: row.current_path,
    filename: row.filename,
    folderPath: row.folder_path,
    extension: row.extension,
    durationSeconds: row.duration_seconds,
    fileSizeBytes: row.file_size_bytes,
    addedAt: row.added_at,
    lastSeenAt: row.last_seen_at,
    isMissing: row.is_missing === 1,
    previewStartSeconds: row.preview_start_seconds,
    previewEndSeconds: row.preview_end_seconds,
    loudnessRms: row.loudness_rms
  }
}

export function registerLibraryIpc(): void {
  ipcMain.handle(IpcChannels.pickLibraryFolder, async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.listLibraryRoots, (): LibraryRoot[] => {
    return listLibraryRoots().map((r) => ({ id: r.id, path: r.path, name: r.name }))
  })

  ipcMain.handle(IpcChannels.listTracks, (): Track[] => {
    return listTracks().map(toTrack)
  })

  ipcMain.handle(IpcChannels.showInExplorer, (_event, filePath: string): void => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle(IpcChannels.updateTrackLoudness, (_event, trackId: number, rms: number): void => {
    updateTrackLoudness(trackId, rms)
  })

  ipcMain.handle(
    IpcChannels.updateTrackPreviewRange,
    (_event, trackId: number, start: number | null, end: number | null): void => {
      updateTrackPreviewRange(trackId, start, end)
    }
  )

  ipcMain.handle(IpcChannels.listDuplicateGroups, (): Track[][] => {
    return findDuplicateGroups().map((group) => group.map(toTrack))
  })

  // Moves the file to the Recycle Bin rather than deleting it outright — reversible
  // if this was a misclick, and if it's ever restored a rescan picks it right back
  // up at the same path (matched by path) with all its tags/ratings intact, since
  // this only flips is_missing rather than deleting the track's row.
  ipcMain.handle(IpcChannels.deleteTrackFile, async (_event, trackId: number): Promise<{ success: boolean; error?: string }> => {
    const row = findTrackById(trackId)
    if (!row) return { success: false, error: 'Track not found' }
    try {
      await shell.trashItem(row.current_path)
      markTrackMissing(trackId)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Native OS drag so a track can be dropped straight into an external app (a video
  // editor's timeline) — a plain HTML5 drag only works between web content, so this
  // has to go through webContents.startDrag in the main process. Fire-and-forget
  // (send/on, not invoke/handle) since it must run synchronously inside the
  // renderer's dragstart handler, matching Electron's documented pattern.
  ipcMain.on(IpcChannels.startTrackDrag, (event, filePaths: string[]) => {
    const icon = nativeImage.createFromPath(getAppIconPath())
    if (filePaths.length <= 1) {
      event.sender.startDrag({ file: filePaths[0], icon })
    } else {
      event.sender.startDrag({ file: filePaths[0], files: filePaths, icon })
    }
  })

  ipcMain.handle(IpcChannels.scanLibrary, async (event, rootPath: string): Promise<ScanResult> => {
    const root = getOrCreateLibraryRoot(rootPath, basename(rootPath))
    const senderWindow = BrowserWindow.fromWebContents(event.sender)

    return scanLibraryRoot(root.id, root.path, (progress) => {
      senderWindow?.webContents.send(IpcChannels.scanProgress, progress)
    })
  })

  ipcMain.handle(
    IpcChannels.scanFolder,
    async (event, libraryRootId: number, relativePath: string): Promise<ScanResult> => {
      const root = listLibraryRoots().find((r) => r.id === libraryRootId)
      if (!root) throw new Error('Library folder not found')
      const senderWindow = BrowserWindow.fromWebContents(event.sender)

      return scanFolder(root.id, root.path, relativePath, (progress) => {
        senderWindow?.webContents.send(IpcChannels.scanProgress, progress)
      })
    }
  )
}
