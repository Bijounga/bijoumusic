import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipcChannels'
import type { TrackBookmark } from '@shared/types'
import { listAllBookmarks, addBookmark, deleteBookmark, type BookmarkRow } from '../db/repositories/bookmarksRepo'

function toBookmark(row: BookmarkRow): TrackBookmark {
  return {
    id: row.id,
    trackId: row.track_id,
    positionSeconds: row.position_seconds,
    label: row.label,
    createdAt: row.created_at
  }
}

export function registerBookmarksIpc(): void {
  ipcMain.handle(IpcChannels.listAllBookmarks, (): TrackBookmark[] => {
    return listAllBookmarks().map(toBookmark)
  })

  ipcMain.handle(
    IpcChannels.addBookmark,
    (_event, trackId: number, positionSeconds: number, label: string | null): TrackBookmark => {
      return toBookmark(addBookmark(trackId, positionSeconds, label))
    }
  )

  ipcMain.handle(IpcChannels.deleteBookmark, (_event, id: number): void => {
    deleteBookmark(id)
  })
}
