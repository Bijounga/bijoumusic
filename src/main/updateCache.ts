import fs from 'fs'
import path from 'path'

/** electron-updater (Windows) keeps the installer it downloaded in
 *  `<cache>/pending` until the *next* update replaces it, so after a successful
 *  update a ~90 MB installer would sit there for good. Once the running app IS
 *  that version, the file has done its job: delete it, along with the
 *  update-info.json describing it. An update that was downloaded but not yet
 *  installed (a newer version than the running one) is left alone.
 *
 *  Kept free of Electron imports so it can be tested on its own. */
export function tidyUpdateCache(pendingDir: string, runningVersion: string): string[] {
  const removed: string[] = []
  let names: string[]
  try {
    names = fs.readdirSync(pendingDir)
  } catch {
    return removed // no cache folder yet
  }
  // Installer names look like "BijouMusic-Setup-0.2.1.exe" (or "temp-…" while downloading).
  const pendingInstallers = names.filter((n) => /\.exe$/i.test(n))
  const stale = pendingInstallers.filter((n) => n.includes(`-${runningVersion}.`))
  for (const name of stale) {
    try {
      fs.rmSync(path.join(pendingDir, name), { force: true })
      removed.push(name)
    } catch {
      // Still locked by the installer that just finished — the next launch gets it.
    }
  }
  // With no installer left waiting, the info file describing one is junk too.
  const stillPending = pendingInstallers.filter((n) => !stale.includes(n))
  if (stillPending.length === 0 && names.includes('update-info.json')) {
    try {
      fs.rmSync(path.join(pendingDir, 'update-info.json'), { force: true })
      removed.push('update-info.json')
    } catch {
      // Ignore.
    }
  }
  return removed
}
