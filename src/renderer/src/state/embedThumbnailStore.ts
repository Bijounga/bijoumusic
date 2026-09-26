import { create } from 'zustand'
import { setSetting } from '../lib/settingsSync'

const STORAGE_KEY = 'bijoumusic:download-embed-thumbnail'

function load(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

interface EmbedThumbnailState {
  /** Download modal preference — when on, the source's thumbnail gets embedded
   *  as the downloaded mp3's cover art via yt-dlp's --embed-thumbnail. */
  enabled: boolean
  toggle: () => void
}

export const useEmbedThumbnailStore = create<EmbedThumbnailState>((set, get) => ({
  enabled: load(),
  toggle: () => {
    const enabled = !get().enabled
    try {
      setSetting(STORAGE_KEY, enabled ? '1' : '0')
    } catch {
      // Non-fatal — worst case the preference doesn't survive a restart.
    }
    set({ enabled })
  }
}))
