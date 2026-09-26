import { create } from 'zustand'
import { setSetting } from '../lib/settingsSync'

const STORAGE_KEY = 'bijoumusic:waveformTagIntensity'
// Full tag colors read as pretty strong at 1 — this is the toned-down default;
// the slider still goes from 0 (plain, no tag color at all) to 1 (full strength).
const DEFAULT_INTENSITY = 0.45

function load(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return DEFAULT_INTENSITY
    const parsed = Number(raw)
    return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : DEFAULT_INTENSITY
  } catch {
    return DEFAULT_INTENSITY
  }
}

interface WaveformIntensityState {
  /** How strongly a track's tag colors show up on its waveform/visualizer — 0 is
   *  the plain single-color look, 1 is the full tag-color gradient. */
  intensity: number
  setIntensity: (value: number) => void
}

export const useWaveformIntensityStore = create<WaveformIntensityState>((set) => ({
  intensity: load(),
  setIntensity: (value: number) => {
    const clamped = Math.min(1, Math.max(0, value))
    try {
      setSetting(STORAGE_KEY, String(clamped))
    } catch {
      // Non-fatal — worst case the preference doesn't survive a restart.
    }
    set({ intensity: clamped })
  }
}))
