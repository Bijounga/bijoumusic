/**
 * Wraps one reused HTML5 <audio> element for actual playback — streaming,
 * buffering, and native mp3/wav/ogg decoding all come for free this way, instead of
 * hand-rolling playback via Web Audio's AudioBufferSourceNode. Web Audio is used
 * separately (in the waveform module) purely to extract peak data, not for the
 * playback signal path.
 *
 * This is a plain singleton, not a React hook: the <audio> element must persist
 * across component re-renders and unmounts, and playback position needs to be
 * readable every animation frame (for the waveform playhead, later) without routing
 * through React state.
 */

import { setSetting } from '../lib/settingsSync'

type EndedListener = () => void

const VOLUME_STORAGE_KEY = 'bijoumusic:volume'
const DEFAULT_VOLUME = 0.8
// Quiet recordings (e.g. some WAV rips) never reach a comfortable level at 100% —
// routing through a GainNode instead of relying on <audio>.volume (hard-capped at 1)
// lets the boost go up to 200%.
export const MAX_VOLUME = 2
const PLAYBACK_RATE_STORAGE_KEY = 'bijoumusic:playback-rate'
const DEFAULT_PLAYBACK_RATE = 1
const MIN_PLAYBACK_RATE = 0.25
const MAX_PLAYBACK_RATE = 3

const NORMALIZE_STORAGE_KEY = 'bijoumusic:normalize-volume'
// A moderate reference RMS to normalize toward — most tracks' measured RMS lands
// somewhere around here, so this keeps the correction factor modest rather than
// wildly boosting near-silent files or crushing hot masters.
const TARGET_RMS = 0.15
const MIN_NORMALIZATION_FACTOR = 0.5
const MAX_NORMALIZATION_FACTOR = 2

// Small on purpose — this only drives a compact visual (a couple dozen bars max),
// not a proper spectrum display, so the coarser resolution of a small FFT is fine
// and cheaper to poll every animation frame.
const ANALYSER_FFT_SIZE = 64

// A second, separate tap at a much higher resolution for the spectrum/spectrogram
// panels, which actually need real frequency detail — kept independent of the
// small analyser above so its bin-selection tuning (USABLE_BINS etc. in
// ReactiveVisualizer) isn't disturbed by changing one shared FFT size.
const HIRES_ANALYSER_FFT_SIZE = 2048

class AudioEngine {
  private audio = new Audio()
  private endedListeners = new Set<EndedListener>()
  private currentTrackId: number | null = null
  private audioContext: AudioContext
  private gainNode: GainNode
  private analyser: AnalyserNode
  private analyserData: Uint8Array<ArrayBuffer>
  private hiResAnalyser: AnalyserNode
  private hiResAnalyserData: Uint8Array<ArrayBuffer>
  private userVolume: number
  private normalizationEnabled: boolean
  private trackNormalizationFactor = 1

  constructor() {
    this.audio.addEventListener('ended', () => {
      for (const listener of this.endedListeners) listener()
    })

    // <audio>.volume is left at 1 permanently — loudness is controlled entirely
    // through the gain node below so it can go past 100%.
    this.audioContext = new AudioContext()
    const source = this.audioContext.createMediaElementSource(this.audio)
    this.gainNode = this.audioContext.createGain()
    source.connect(this.gainNode)
    this.gainNode.connect(this.audioContext.destination)

    // A parallel tap, not inserted in series — the analyser doesn't need to also
    // forward to destination since gainNode already reaches it directly above.
    this.analyser = this.audioContext.createAnalyser()
    this.analyser.fftSize = ANALYSER_FFT_SIZE
    this.analyser.smoothingTimeConstant = 0.75
    this.gainNode.connect(this.analyser)
    this.analyserData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount))

    this.hiResAnalyser = this.audioContext.createAnalyser()
    this.hiResAnalyser.fftSize = HIRES_ANALYSER_FFT_SIZE
    this.hiResAnalyser.smoothingTimeConstant = 0.65
    this.gainNode.connect(this.hiResAnalyser)
    this.hiResAnalyserData = new Uint8Array(new ArrayBuffer(this.hiResAnalyser.frequencyBinCount))

    const rawStored = localStorage.getItem(VOLUME_STORAGE_KEY)
    const stored = rawStored === null ? NaN : Number(rawStored)
    this.userVolume = Number.isFinite(stored) && stored >= 0 && stored <= MAX_VOLUME ? stored : DEFAULT_VOLUME
    this.normalizationEnabled = localStorage.getItem(NORMALIZE_STORAGE_KEY) === '1'
    this.applyGain()

    const rawRate = localStorage.getItem(PLAYBACK_RATE_STORAGE_KEY)
    const storedRate = rawRate === null ? NaN : Number(rawRate)
    this.audio.playbackRate =
      Number.isFinite(storedRate) && storedRate >= MIN_PLAYBACK_RATE && storedRate <= MAX_PLAYBACK_RATE
        ? storedRate
        : DEFAULT_PLAYBACK_RATE
  }

  private applyGain(): void {
    const factor = this.normalizationEnabled ? this.trackNormalizationFactor : 1
    this.gainNode.gain.value = this.userVolume * factor
  }

  loadTrack(trackId: number, loudnessRms: number | null = null): void {
    this.currentTrackId = trackId
    this.audio.src = `app-audio://t${trackId}`
    // Some browsers reset playbackRate on a new source load — reapply defensively.
    this.audio.playbackRate = this.getPlaybackRate()
    this.setTrackLoudness(loudnessRms)
    // The context can start (or get put back) in "suspended" state — e.g. it's
    // created before any user gesture reaches the window — which would otherwise
    // play silently through the gain graph.
    void this.audioContext.resume()
    void this.audio.play()
  }

  /** Called whenever a track loads — recomputes how much to correct this
   *  particular track's gain by (relative to TARGET_RMS) so normalization can be
   *  toggled on/off instantly without waiting for the next track. */
  setTrackLoudness(rms: number | null): void {
    if (rms === null || rms <= 0) {
      this.trackNormalizationFactor = 1
    } else {
      const factor = TARGET_RMS / rms
      this.trackNormalizationFactor = Math.min(MAX_NORMALIZATION_FACTOR, Math.max(MIN_NORMALIZATION_FACTOR, factor))
    }
    this.applyGain()
  }

  getNormalizationEnabled(): boolean {
    return this.normalizationEnabled
  }

  setNormalizationEnabled(enabled: boolean): void {
    this.normalizationEnabled = enabled
    setSetting(NORMALIZE_STORAGE_KEY, enabled ? '1' : '0')
    this.applyGain()
  }

  getCurrentTrackId(): number | null {
    return this.currentTrackId
  }

  play(): void {
    void this.audioContext.resume()
    void this.audio.play()
  }

  pause(): void {
    this.audio.pause()
  }

  togglePlayPause(): void {
    if (this.audio.paused) {
      void this.audioContext.resume()
      void this.audio.play()
    } else {
      this.audio.pause()
    }
  }

  seek(seconds: number): void {
    this.audio.currentTime = seconds
  }

  getCurrentTime(): number {
    return this.audio.currentTime
  }

  getDuration(): number {
    return Number.isFinite(this.audio.duration) ? this.audio.duration : 0
  }

  isPaused(): boolean {
    return this.audio.paused
  }

  getVolume(): number {
    return this.userVolume
  }

  setVolume(volume: number): void {
    const clamped = Math.min(MAX_VOLUME, Math.max(0, volume))
    this.userVolume = clamped
    setSetting(VOLUME_STORAGE_KEY, String(clamped))
    this.applyGain()
  }

  getPlaybackRate(): number {
    return this.audio.playbackRate
  }

  setPlaybackRate(rate: number): void {
    const clamped = Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate))
    this.audio.playbackRate = clamped
    setSetting(PLAYBACK_RATE_STORAGE_KEY, String(clamped))
  }

  /** Live frequency magnitudes (0-255 per bin), for a reactive visualizer — reuses
   *  the same backing array every call rather than allocating one per animation
   *  frame, so the caller must read it synchronously, not hold onto the reference. */
  getFrequencyData(): Uint8Array<ArrayBuffer> {
    this.analyser.getByteFrequencyData(this.analyserData)
    return this.analyserData
  }

  /** Same idea as getFrequencyData, at real spectrum-analyzer/spectrogram
   *  resolution (1024 bins vs. the small ring's 32) — same synchronous,
   *  reused-array contract. */
  getHiResFrequencyData(): Uint8Array<ArrayBuffer> {
    this.hiResAnalyser.getByteFrequencyData(this.hiResAnalyserData)
    return this.hiResAnalyserData
  }

  onEnded(listener: EndedListener): () => void {
    this.endedListeners.add(listener)
    return () => this.endedListeners.delete(listener)
  }

  onTimeUpdate(listener: () => void): () => void {
    this.audio.addEventListener('timeupdate', listener)
    return () => this.audio.removeEventListener('timeupdate', listener)
  }

  onPlayPauseChange(listener: () => void): () => void {
    this.audio.addEventListener('play', listener)
    this.audio.addEventListener('pause', listener)
    return () => {
      this.audio.removeEventListener('play', listener)
      this.audio.removeEventListener('pause', listener)
    }
  }
}

export const audioEngine = new AudioEngine()
