import { create } from 'zustand'
import type { SyncStatus } from '@shared/types'

interface SyncStoreState {
  status: SyncStatus
}

export const useSyncStore = create<SyncStoreState>(() => ({
  status: { state: 'off' }
}))

let started = false

/** Subscribes the store to the main process's sync status (once), after first
 *  asking for the current one — a sync can finish before the window finishes loading. */
export function startSyncStatusSync(): void {
  if (started) return
  started = true
  window.api.onSyncStatus((status) => useSyncStore.setState({ status }))
  void window.api.syncGetStatus().then((status) => useSyncStore.setState({ status }))
}
