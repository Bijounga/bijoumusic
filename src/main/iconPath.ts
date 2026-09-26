import { app } from 'electron'
import { join } from 'path'

// electron-builder deliberately excludes `buildResources` (our `build/` dir) from
// the packaged app — it's treated as packaging-only input, not a runtime asset —
// so the packaged build ships its own copy via `extraResources` into
// `resourcesPath/build/icon.png` instead of the dev-time relative path.
export function getAppIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'build', 'icon.png')
    : join(__dirname, '../../build/icon.png')
}
