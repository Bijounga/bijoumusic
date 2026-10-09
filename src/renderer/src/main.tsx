import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/theme.css'
import { bootstrapSettings } from './lib/settingsSync'

// Applied here, inline, rather than by importing themeStore.ts — that file pulls
// in zustand at module scope, which is exactly what bootstrapSettings() needs to
// stay deferred until settings are reconciled (see the comment below). This is
// just enough logic duplicated from themeStore.ts's load()/applyThemeAttribute()
// to paint the right theme before first paint, avoiding a flash of the default
// theme; the real store re-reads/re-applies once more after bootstrap resolves,
// in case the DB (not yet reconciled into localStorage at this point) disagrees.
function applyStoredThemeEarly(): void {
  try {
    const raw = localStorage.getItem('bijoumusic:theme')
    if (raw) document.documentElement.dataset.theme = raw
  } catch {
    // No-op — the dark theme's CSS already matches a bare <html> with no
    // data-theme attribute, so this is a safe, unstyled-content-free fallback.
  }
}
applyStoredThemeEarly()

async function main(): Promise<void> {
  // Reconciling settings has to finish before App's module graph (and the zustand
  // stores inside it that read localStorage synchronously at import time) ever
  // loads — hence the dynamic import instead of a static one.
  await bootstrapSettings()

  // Re-apply now that bootstrap may have pulled a different saved theme in from
  // the DB into localStorage — themeStore's own load() validates the id, unlike
  // applyStoredThemeEarly's unchecked read above.
  const { useThemeStore, applyThemeAttribute } = await import('./state/themeStore')
  applyThemeAttribute(useThemeStore.getState().theme)

  // The pop-out mini player loads this same page with #mini. It renders only the
  // MiniPlayer — never App, whose module graph starts the audio engine and loads
  // the library, which would mean a second player in a second window.
  const isMini = window.location.hash === '#mini'
  const Root = isMini ? (await import('./components/mini/MiniPlayer')).default : (await import('./App')).default

  // Part of the lag "black box" (see main/perfLog.ts): any stretch where this
  // window couldn't respond for 200ms+ is logged, with whether the window was in
  // front and how big its memory is, so intermittent lag can be diagnosed after
  // the fact.
  if (!isMini && 'PerformanceObserver' in window) {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.duration < 200) continue
          const heapMb = Math.round(((performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0) / 1048576)
          window.api.perfLog(
            `window froze for ${Math.round(entry.duration)}ms (in front: ${document.hasFocus()}, shown: ${document.visibilityState}, heap ${heapMb}MB)`
          )
        }
      }).observe({ entryTypes: ['longtask'] })
    } catch {
      // Not supported — the main-process half of the log still works.
    }
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>
  )
}

void main()
