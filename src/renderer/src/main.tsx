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

  const { default: App } = await import('./App')

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

void main()
