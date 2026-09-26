import { BrowserWindow, ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipcChannels'

// The window is frameless (the renderer draws its own themed title bar), so the
// caption buttons need these to do what the native ones used to.
export function registerWindowIpc(): void {
  ipcMain.handle(IpcChannels.windowMinimize, (event): void => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle(IpcChannels.windowToggleMaximize, (event): void => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  ipcMain.handle(IpcChannels.windowClose, (event): void => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle(IpcChannels.windowIsMaximized, (event): boolean => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })
}
