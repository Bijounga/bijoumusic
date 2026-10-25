import { useEffect } from 'react'

/** Shift-clicking is how ranges are picked (energy levels, track rows), but the browser
 *  also treats it as "extend the text selection from the last click", which paints
 *  everything between the two clicks blue. Cancelling the mouse-down on shift-clicks
 *  stops that, except in text boxes where shift-click selecting text is wanted. */
export function useNoShiftTextSelect(): void {
  useEffect(() => {
    function handleMouseDown(event: MouseEvent): void {
      if (!event.shiftKey) return
      const target = event.target
      if (target instanceof HTMLElement && (target.closest('input, textarea') || target.isContentEditable)) return
      event.preventDefault()
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [])
}
