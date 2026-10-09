import { create } from 'zustand'
import type { UpdateStatus } from '@shared/types'

interface UpdateStoreState {
  status: UpdateStatus
}

export const useUpdateStore = create<UpdateStoreState>(() => ({
  status: { state: 'idle', currentVersion: '' }
}))

let started = false

/** Subscribes the store to the main process's update status (once), after first
 *  asking for the current one — a check can finish before the window finishes
 *  loading, and its event would otherwise be missed. */
export function startUpdateStatusSync(): void {
  if (started) return
  started = true
  window.api.onUpdateStatus((status) => useUpdateStore.setState({ status }))
  void window.api.updateGetStatus().then((status) => useUpdateStore.setState({ status }))
}
