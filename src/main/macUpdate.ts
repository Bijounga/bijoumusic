// macOS self-update without disk images — ported from BijouDocs'
// electron/main/macUpdate.js (itself from Bijou Footage).
//
// electron-updater's own Mac path goes through Squirrel.Mac, which needs an
// Apple-signed app; BijouMusic is only ad-hoc signed (scripts/adhoc-sign.cjs).
// So instead:
//   - The Release's .zip is downloaded (checked against the sha512 in
//     latest-mac.yml) and unpacked with ditto into a temp folder.
//   - "Restart to update" hands off to a small detached script that waits for
//     the app to quit, swaps the new BijouMusic.app in place, relaunches it and
//     deletes the temp folder. Quitting with an update waiting installs it too,
//     without reopening.
//   - At launch, leftover BijouMusic disk images are ejected and old update
//     downloads are deleted; started from inside a disk image, the app offers
//     to move itself to Applications first — so installing never leaves a
//     disk icon on the desktop.
import { app, dialog } from 'electron'
import type { UpdateInfo } from 'electron-updater'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { spawn, execFile } from 'child_process'
import { once } from 'events'

const TMP_PREFIX = 'bijoumusic-update-'
const APP_NAME = 'BijouMusic'

interface ReadyUpdate {
  version: string
  app: string
  dir: string
}

// …/BijouMusic.app (the running bundle)
export function bundlePath(): string {
  return path.resolve(process.execPath, '..', '..', '..')
}
const insideVolume = (p: string): boolean => p.startsWith('/Volumes/')

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 60000 }, (err, out) => (err ? reject(err) : resolve(String(out))))
  )
}

// ---- launch-time tidying ----
export async function tidyOnLaunch(): Promise<void> {
  try {
    for (const d of fs.readdirSync(os.tmpdir())) {
      if (d.startsWith(TMP_PREFIX)) fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true })
    }
  } catch {
    /* nothing to tidy */
  }
  if (insideVolume(bundlePath())) {
    await offerMoveToApplications()
    return
  }
  // Leftover disk images of this app: "BijouMusic 0.2.0", "BijouMusic 1"…
  let vols: string[] = []
  try {
    vols = fs.readdirSync('/Volumes')
  } catch {
    return
  }
  for (const v of vols) {
    if (!v.startsWith(APP_NAME)) continue
    const vol = path.join('/Volumes', v)
    if (!fs.existsSync(path.join(vol, APP_NAME + '.app'))) continue // someone else's drive
    await run('hdiutil', ['detach', vol, '-quiet']).catch(() =>
      run('hdiutil', ['detach', vol, '-quiet', '-force']).catch(() => '')
    )
  }
}

async function offerMoveToApplications(): Promise<void> {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Move to Applications', 'Not now'],
    defaultId: 0,
    cancelId: 1,
    message: 'Move BijouMusic to your Applications folder?',
    detail: "It's running from the disk image. Once it's in Applications, the disk image is ejected for you and updates can install themselves."
  })
  if (response !== 0) return
  try {
    // Moves, relaunches from Applications (which then ejects this image).
    app.moveToApplicationsFolder({ conflictHandler: () => true })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    dialog.showErrorBox('Couldn’t move it', message + '\n\nDrag BijouMusic into Applications instead.')
  }
}

// ---- updates ----
// Can the running app be replaced in place?
export function canSelfUpdate(): boolean {
  const me = bundlePath()
  if (insideVolume(me) || !me.endsWith('.app')) return false
  try {
    fs.accessSync(path.dirname(me), fs.constants.W_OK)
    fs.accessSync(me, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

let ready: ReadyUpdate | null = null
let installing = false
let busy: Promise<ReadyUpdate> | null = null
export const isReady = (): boolean => !!ready

// info: electron-updater's UpdateInfo (from latest-mac.yml). base: the
// Release's download folder.
export async function download(info: UpdateInfo, base: string, onProgress: (percent: number) => void): Promise<ReadyUpdate> {
  if (ready && ready.version === info.version) return ready
  if (busy) return busy
  busy = (async () => {
    const file = (info.files || []).find((f) => f.url.endsWith('.zip'))
    if (!file) throw new Error('This release has no Mac .zip.')
    const url = /^https?:/.test(file.url) ? file.url : base.replace(/\/?$/, '/') + encodeURIComponent(file.url).replace(/%2F/g, '/')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX))
    try {
      const zip = path.join(dir, 'update.zip')
      const res = await fetch(url, { redirect: 'follow' })
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
      const total = Number(res.headers.get('content-length')) || file.size || 0
      const out = fs.createWriteStream(zip)
      const hash = crypto.createHash('sha512')
      let got = 0
      let last = 0
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk)
        if (!out.write(chunk)) await once(out, 'drain')
        got += chunk.length
        if (Date.now() - last > 250 && total) {
          last = Date.now()
          onProgress(Math.round((got / total) * 100))
        }
      }
      await new Promise<void>((r) => out.end(r))
      if (file.sha512 && hash.digest('base64') !== file.sha512) throw new Error('The download was damaged (checksum mismatch).')
      const unpacked = path.join(dir, 'app')
      await run('ditto', ['-x', '-k', zip, unpacked])
      fs.rmSync(zip, { force: true })
      const newApp = path.join(unpacked, APP_NAME + '.app')
      if (!fs.existsSync(newApp)) throw new Error('The download had no app in it.')
      await run('codesign', ['--verify', '--deep', '--strict', newApp])
      ready = { version: info.version, app: newApp, dir }
      return ready
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true })
      throw e
    } finally {
      busy = null
    }
  })()
  return busy
}

// A detached script waits for the app to quit, swaps the new app in,
// relaunches it (or not — quitting with an update waiting just installs it)
// and deletes the download.
export function installAndRelaunch(relaunch = true): boolean {
  if (!ready || installing) return false
  installing = true
  const target = bundlePath()
  const script = path.join(ready.dir, 'swap.sh')
  fs.writeFileSync(
    script,
    [
      '#!/bin/sh',
      'PID="$1"; OLD="$2"; NEW="$3"; TMP="$4"',
      'i=0; while kill -0 "$PID" 2>/dev/null && [ $i -lt 300 ]; do sleep 0.2; i=$((i+1)); done',
      'if mv "$OLD" "$TMP/old.app" && mv "$NEW" "$OLD"; then',
      '  rm -rf "$TMP/old.app"',
      'else',
      '  [ -d "$OLD" ] || mv "$TMP/old.app" "$OLD"  # put the old one back',
      'fi',
      'xattr -dr com.apple.quarantine "$OLD" 2>/dev/null',
      '[ "$5" = 1 ] && open "$OLD"',
      'rm -rf "$TMP"',
      ''
    ].join('\n')
  )
  const p = spawn('/bin/sh', [script, String(process.pid), target, ready.app, ready.dir, relaunch ? '1' : '0'], {
    detached: true,
    stdio: 'ignore'
  })
  p.unref()
  if (relaunch) app.quit()
  return true
}
