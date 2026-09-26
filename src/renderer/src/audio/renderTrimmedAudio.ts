/** Encodes decoded PCM channels as a 16-bit PCM WAV file — enough to hand a real,
 *  playable audio file to Premiere for the drag/insert preview; no compression
 *  needed since this is a short-lived temp file, not something kept around. */
function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const numChannels = channels.length
  const numFrames = channels[0]?.length ?? 0
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = numFrames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  function writeString(offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let frame = 0; frame < numFrames; frame++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const clamped = Math.max(-1, Math.min(1, channels[ch][frame]))
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true)
      offset += 2
    }
  }

  return new Uint8Array(buffer)
}

/** Decodes a track and slices out just [startSeconds, endSeconds] as a standalone
 *  WAV — this is what makes the Premiere drag/insert preview show a clip of the
 *  correct length immediately, rather than the full file. All channels are kept
 *  (unlike the waveform decode, which only reads channel 0) since this is real
 *  audio headed into an editor, not just a peak visualization. */
export async function renderTrimmedAudioWav(
  trackId: number,
  startSeconds: number,
  endSeconds: number
): Promise<Uint8Array> {
  const response = await fetch(`app-audio://t${trackId}`)
  const arrayBuffer = await response.arrayBuffer()

  const audioContext = new AudioContext()
  let audioBuffer: AudioBuffer
  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
  } finally {
    void audioContext.close()
  }

  const sampleRate = audioBuffer.sampleRate
  const startFrame = Math.max(0, Math.floor(startSeconds * sampleRate))
  const endFrame = Math.min(audioBuffer.length, Math.ceil(endSeconds * sampleRate))
  const frameCount = Math.max(1, endFrame - startFrame)

  const channels: Float32Array[] = []
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    channels.push(audioBuffer.getChannelData(ch).slice(startFrame, startFrame + frameCount))
  }

  return encodeWav(channels, sampleRate)
}
