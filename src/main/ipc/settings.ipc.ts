import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipcChannels'
import { getAllSettings, setSetting } from '../db/repositories/settingsRepo'

export function registerSettingsIpc(): void {
  ipcMain.handle(IpcChannels.settingsGetAll, (): Record<string, string> => {
    return getAllSettings()
  })

  ipcMain.handle(IpcChannels.settingsSet, (_event, key: string, value: string): void => {
    setSetting(key, value)
  })
}
