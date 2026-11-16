import { useEffect } from 'react'
import { useThemeStore } from '../state/themeStore'
import { isGlassTheme } from '../lib/glass'
import { startRefraction, stopRefraction } from '../lib/liquidGlassRefraction'

/** Turns the lens effect on the big glass panes on while a Liquid Glass theme is active.
 *  Only the sidebar and the player: the track list is where dense rows are read, so it
 *  stays flat. */
export function useGlassRefraction(): void {
  const theme = useThemeStore((s) => s.theme)

  useEffect(() => {
    if (isGlassTheme(theme)) startRefraction('[data-pane="sidebar"], [data-pane="footer"]')
    else stopRefraction()
    return () => stopRefraction()
  }, [theme])
}
