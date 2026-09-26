import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipcChannels'
import type { Alias } from '@shared/types'
import { listAllAliases, addAlias, deleteAlias } from '../db/repositories/aliasesRepo'

export function registerAliasesIpc(): void {
  ipcMain.handle(IpcChannels.listAllAliases, (): Alias[] => {
    return listAllAliases().map((a) => ({ id: a.id, trackId: a.track_id, aliasText: a.alias_text }))
  })

  ipcMain.handle(IpcChannels.addAlias, (_event, trackId: number, aliasText: string): Alias => {
    const a = addAlias(trackId, aliasText)
    return { id: a.id, trackId: a.track_id, aliasText: a.alias_text }
  })

  ipcMain.handle(IpcChannels.deleteAlias, (_event, id: number): void => {
    deleteAlias(id)
  })
}
