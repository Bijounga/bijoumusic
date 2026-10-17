import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { execFile } from 'child_process'
import { cp, mkdir, readFile, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { IpcChannels } from '@shared/ipcChannels'
import type { PremiereExtStatus } from '@shared/types'
import { perfLog } from './perfLog'

// Keeps the two Premiere panels (the UXP "BijouMusic Bridge" and the CEP "Cut
// Silence") in step with the app. Both ship inside BijouMusic (see
// scripts/build-premiere-bundle.cjs), stamped with the app's version, so "is the
// installed panel current" is just a version comparison:
//
//   UXP panel  installed through Adobe's own command-line installer (the same thing
//              that runs when a .ccx is double-clicked), so Creative Cloud registers it
//              properly; if that tool can't be used, the .ccx is simply opened and
//              Creative Cloud asks the user to confirm.
//   CEP panel  a plain folder copy into Adobe's per-user extensions folder, plus the
//              switch that lets Premiere load an unsigned panel.
//
// Nothing is installed behind the user's back: the first install is the button.
// After that, whichever panels are installed are updated on their own when the app
// updates. Premiere has to be restarted to load a new version.

const UXP_NAME = 'BijouMusic Bridge'
const CEP_ID = 'com.bijoumusic.cutsilence'
const CCX_NAME = 'BijouMusic-Premiere-Panel.ccx'
const AUTO_CHECK_DELAY_MS = 12_000
const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

let mainWindow: BrowserWindow | null = null
let status: PremiereExtStatus = { state: 'unknown' }
let busy: Promise<void> | null = null

function setStatus(next: PremiereExtStatus): void {
  status = next
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IpcChannels.premiereExtStatus, status)
}

function bundleDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'premiere') : join(app.getAppPath(), 'build-premiere')
}

function installerPath(): string | null {
  const path = isWin
    ? join(
        process.env['CommonProgramFiles'] ?? 'C:\\Program Files\\Common Files',
        'Adobe',
        'Adobe Desktop Common',
        'RemoteComponents',
        'UPI',
        'UnifiedPluginInstallerAgent',
        'UnifiedPluginInstallerAgent.exe'
      )
    : isMac
      ? '/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent'
      : null
  return path && existsSync(path) ? path : null
}

function cepInstallDir(): string | null {
  if (isWin && process.env['APPDATA']) return join(process.env['APPDATA'], 'Adobe', 'CEP', 'extensions', CEP_ID)
  if (isMac) return join(homedir(), 'Library', 'Application Support', 'Adobe', 'CEP', 'extensions', CEP_ID)
  return null
}

function run(file: string, args: string[], timeoutMs: number): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
      resolve({ code, output: `${stdout}\n${stderr}` })
    })
  })
}

/** The version of the UXP panel Creative Cloud has installed, or null. */
async function installedUxpVersion(): Promise<string | null> {
  const upia = installerPath()
  if (!upia) return null
  const { output } = await run(upia, [isMac ? '--list' : '/list', 'all'], 60_000)
  const match = output.match(new RegExp(`${UXP_NAME}\\s+(\\d+\\.\\d+\\.\\d+)`))
  return match ? match[1] : null
}

async function installedCepVersion(): Promise<string | null> {
  const dir = cepInstallDir()
  if (!dir) return null
  try {
    const xml = await readFile(join(dir, 'CSXS', 'manifest.xml'), 'utf8')
    return xml.match(/ExtensionBundleVersion="([^"]+)"/)?.[1] ?? null
  } catch {
    return null
  }
}

async function installUxp(): Promise<'done' | 'manual'> {
  const ccx = join(bundleDir(), CCX_NAME)
  const upia = installerPath()
  if (upia) {
    const { code, output } = await run(upia, [isMac ? '--install' : '/install', ccx], 180_000)
    const now = await installedUxpVersion()
    if (now === app.getVersion()) return 'done'
    perfLog(`premiere panel install via Adobe's installer did not take (exit ${code}): ${output.trim().slice(0, 300)}`)
  }
  // Fall back to what a double-click does: Creative Cloud shows its own install dialog.
  await shell.openPath(ccx)
  return 'manual'
}

async function installCep(): Promise<void> {
  const dest = cepInstallDir()
  if (!dest) throw new Error('This computer is not supported')
  await mkdir(join(dest, '..'), { recursive: true })
  await rm(dest, { recursive: true, force: true })
  await cp(join(bundleDir(), CEP_ID), dest, { recursive: true })
  // Premiere only loads a panel that isn't signed by Adobe when this switch is on.
  for (const version of [9, 10, 11, 12]) {
    if (isWin) {
      await run('reg', ['add', `HKCU\\Software\\Adobe\\CSXS.${version}`, '/v', 'PlayerDebugMode', '/t', 'REG_SZ', '/d', '1', '/f'], 15_000)
    } else if (isMac) {
      await run('defaults', ['write', `com.adobe.CSXS.${version}`, 'PlayerDebugMode', '1'], 15_000)
    }
  }
}

/** Installs or updates whichever panels need it. `installMissing` is the button:
 *  it also installs a panel that isn't there at all; the automatic pass doesn't. */
async function bringUpToDate(installMissing: boolean): Promise<void> {
  const version = app.getVersion()
  if (!existsSync(join(bundleDir(), CCX_NAME))) {
    setStatus({ state: 'dev' })
    return
  }
  try {
    const uxp = await installedUxpVersion()
    const cep = await installedCepVersion()
    if (!installMissing && uxp === null && cep === null) {
      setStatus({ state: 'not-installed' })
      return
    }
    const needUxp = installMissing ? uxp !== version : uxp !== null && uxp !== version
    const needCep = installMissing ? cep !== version : cep !== null && cep !== version
    if (!needUxp && !needCep) {
      setStatus({ state: 'up-to-date', version })
      return
    }
    setStatus({ state: 'updating', version })
    let manual = false
    if (needUxp) manual = (await installUxp()) === 'manual'
    if (needCep) await installCep()
    setStatus(manual ? { state: 'manual', version } : { state: 'restart', version })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    perfLog(`premiere panel update failed: ${message}`)
    setStatus({ state: 'error', message })
  }
}

function enqueue(installMissing: boolean): Promise<void> {
  if (busy) return busy
  busy = bringUpToDate(installMissing).finally(() => {
    busy = null
  })
  return busy
}

export function registerPremiereExtIpc(): void {
  ipcMain.handle(IpcChannels.premiereExtGetStatus, (): PremiereExtStatus => status)
  ipcMain.handle(IpcChannels.premiereExtInstall, async (): Promise<PremiereExtStatus> => {
    await enqueue(true)
    return status
  })
}

export function startPremiereExtensions(window: BrowserWindow): void {
  mainWindow = window
  // Re-check a little after launch, once the first scan has got going; this is what
  // brings the panels up to date after the app itself has just been updated.
  setTimeout(() => void enqueue(false), AUTO_CHECK_DELAY_MS)
}
