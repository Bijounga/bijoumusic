import { create } from 'zustand'
import type { PremiereExtStatus } from '@shared/types'

interface PremiereExtStoreState {
  status: PremiereExtStatus
}

export const usePremiereExtStore = create<PremiereExtStoreState>(() => ({
  status: { state: 'unknown' }
}))

let started = false

/** Subscribes the store to the main process's panel-install status (once), after
 *  first asking for the current one. */
export function startPremiereExtStatusSync(): void {
  if (started) return
  started = true
  window.api.onPremiereExtStatus((status) => usePremiereExtStore.setState({ status }))
  void window.api.premiereExtGetStatus().then((status) => usePremiereExtStore.setState({ status }))
}
