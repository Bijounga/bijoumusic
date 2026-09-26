const BUCKET_COUNT = 2000

export interface DecodedWaveform {
  peaks: Float32Array
  durationSeconds: number
  /** Overall RMS level (0-1) of the decoded channel — computed in the same pass as
   *  the peaks, at negligible extra cost, and used for volume normalization. */
  rms: number
}

/** Decodes a track's audio and downsamples it to a fixed-resolution min/max peak
 *  set. Runs once per track (result gets cached to disk keyed by content hash), so
 *  a synchronous downsampling pass on the main thread is an acceptable one-time cost
 *  here — reopening a cached track never re-runs this. */
export async function generateWaveformPeaks(trackId: number): Promise<DecodedWaveform> {
  const response = await fetch(`app-audio://t${trackId}`)
  const arrayBuffer = await response.arrayBuffer()

  const audioContext = new AudioContext()
  let audioBuffer: AudioBuffer
  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
  } finally {
    void audioContext.close()
  }

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
  return { peaks, durationSeconds: audioBuffer.duration, rms }
}
