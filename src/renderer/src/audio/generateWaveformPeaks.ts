import { detectBpm, middleMono } from './detectBpm'

const BUCKET_COUNT = 2000

export interface DecodedWaveform {
  peaks: Float32Array
  durationSeconds: number
  /** Overall RMS level (0-1) of the decoded channel — computed in the same pass as
   *  the peaks, at negligible extra cost, and used for volume normalization. */
  rms: number
  /** Tempo found in the same decode: 0 when the song has no steady beat, null if it couldn't be worked out. */
  bpm: number | null
}

let bpmWorker: Worker | null = null
let nextRequestId = 1
const pendingBpm = new Map<number, (bpm: number | null) => void>()
let bpmWorkerBroken = false

function getBpmWorker(): Worker | null {
  if (bpmWorker) return bpmWorker
  if (bpmWorkerBroken) return null
  try {
    bpmWorker = new Worker(new URL('./bpmWorker.ts', import.meta.url), { type: 'module' })
    bpmWorker.onmessage = (event: MessageEvent<{ id: number; bpm: number }>) => {
      pendingBpm.get(event.data.id)?.(event.data.bpm)
      pendingBpm.delete(event.data.id)
    }
    // If the worker can't start or dies, carry on without it rather than losing tempos.
    bpmWorker.onerror = () => {
      bpmWorkerBroken = true
      bpmWorker = null
      for (const resolve of pendingBpm.values()) resolve(null)
      pendingBpm.clear()
    }
    return bpmWorker
  } catch {
    bpmWorkerBroken = true
    return null
  }
}

/** Beats per minute of a decoded song; 0 means "looked, found no steady beat", null that
 *  the tempo couldn't be worked out this time (so it's tried again later). */
async function tempoOf(audioBuffer: AudioBuffer): Promise<number | null> {
  const channels: Float32Array[] = []
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) channels.push(audioBuffer.getChannelData(c))
  const samples = middleMono(channels, audioBuffer.sampleRate)

  const worker = getBpmWorker()
  if (!worker) return detectBpm(samples, audioBuffer.sampleRate)?.bpm ?? 0
  return new Promise<number | null>((resolve) => {
    const id = nextRequestId++
    pendingBpm.set(id, resolve)
    worker.postMessage({ id, samples, sampleRate: audioBuffer.sampleRate }, [samples.buffer])
  })
}

async function decodeTrack(trackId: number): Promise<AudioBuffer> {
  const response = await fetch(`app-audio://t${trackId}`)
  const arrayBuffer = await response.arrayBuffer()

  const audioContext = new AudioContext()
  try {
    return await audioContext.decodeAudioData(arrayBuffer)
  } finally {
    void audioContext.close()
  }
}

/** Works out a song's tempo without making a waveform — for songs whose waveform was
 *  made before tempo detection existed. */
export async function detectTrackBpm(trackId: number): Promise<number | null> {
  return await tempoOf(await decodeTrack(trackId))
}

/** Decodes a track's audio and downsamples it to a fixed-resolution min/max peak
 *  set. Runs once per track (result gets cached to disk keyed by content hash), so
 *  a synchronous downsampling pass on the main thread is an acceptable one-time cost
 *  here — reopening a cached track never re-runs this. */
export async function generateWaveformPeaks(trackId: number): Promise<DecodedWaveform> {
  const audioBuffer = await decodeTrack(trackId)

  const channelData = audioBuffer.getChannelData(0)
  const samplesPerBucket = Math.max(1, Math.floor(channelData.length / BUCKET_COUNT))
  const peaks = new Float32Array(BUCKET_COUNT * 2)
  let sumSquares = 0

  for (let i = 0; i < BUCKET_COUNT; i++) {
    const start = i * samplesPerBucket
    const end = Math.min(start + samplesPerBucket, channelData.length)
    let min = 0
    let max = 0
    for (let j = start; j < end; j++) {
      const value = channelData[j]
      sumSquares += value * value
      if (value < min) min = value
      if (value > max) max = value
    }
    peaks[i * 2] = min
    peaks[i * 2 + 1] = max
  }

  const rms = channelData.length > 0 ? Math.sqrt(sumSquares / channelData.length) : 0
  return { peaks, durationSeconds: audioBuffer.duration, rms, bpm: await tempoOf(audioBuffer) }
}
