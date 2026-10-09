import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipcChannels'
import type { MoveRootReport, MoveRootResult } from '@shared/types'
import { analyzeMoveRoot, applyMoveRoot } from '../libraryMove'

export function registerLibraryMoveIpc(): void {
  ipcMain.handle(
    IpcChannels.libraryAnalyzeMoveRoot,
    (_event, rootId: number, newPath: string): Promise<MoveRootReport> => analyzeMoveRoot(rootId, newPath)
  )
  ipcMain.handle(
    IpcChannels.libraryApplyMoveRoot,
    (_event, rootId: number, newPath: string): Promise<MoveRootResult> => applyMoveRoot(rootId, newPath)
  )
}
