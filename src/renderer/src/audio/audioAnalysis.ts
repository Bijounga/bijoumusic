export interface SilenceSegment {
  start: number
  end: number
}

const SILENCE_WINDOW_SECONDS = 0.02
const DEFAULT_SILENCE_THRESHOLD_DB = -40
const DEFAULT_MIN_SILENCE_SECONDS = 0.3

function mixToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length)
  const channelCount = buffer.numberOfChannels
  for (let c = 0; c < channelCount; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < buffer.length; i++) mono[i] += data[i] / channelCount
  }
  return mono
}

/** Finds every audible content segment within an audio buffer — i.e. the
 *  complement of every silent gap at least minSilenceSeconds long. Consecutive
 *  quiet windows below thresholdDb are merged into gaps; a gap only counts as
 *  a cut point if it clears minSilenceSeconds, so ordinary pauses between
 *  words/hits aren't chopped out along with real dead air. The same windowed
 *  RMS pass generateWaveformPeaks.ts does for waveform/loudness, just kept
 *  per-window instead of reduced to one overall peak set.
 *
 *  searchStart/searchEnd (seconds, relative to the buffer's own start)
 *  constrain the scan to a sub-range — the underlying source file can be much
 *  longer than what's actually placed on the timeline (e.g. a full song behind
 *  a 6-second clip), so scanning the whole file would detect the wrong
 *  "silence." Always returns at least one segment (the full search range, if
 *  nothing in it ever crosses the threshold or every gap is too short to cut). */
export function detectSilenceSegments(
  buffer: AudioBuffer,
  searchStart = 0,
  searchEnd = buffer.duration,
  thresholdDb = DEFAULT_SILENCE_THRESHOLD_DB,
  minSilenceSeconds = DEFAULT_MIN_SILENCE_SECONDS
): SilenceSegment[] {
  const mono = mixToMono(buffer)
  const sampleRate = buffer.sampleRate
  const windowSize = Math.max(1, Math.round(SILENCE_WINDOW_SECONDS * sampleRate))

  const firstWindow = Math.max(0, Math.floor((searchStart * sampleRate) / windowSize))
  const lastWindow = Math.min(Math.ceil(mono.length / windowSize) - 1, Math.ceil((searchEnd * sampleRate) / windowSize))

  const windowDb = (w: number): number => {
    const start = w * windowSize
    const end = Math.min(mono.length, start + windowSize)
    let sumSquares = 0
    for (let i = start; i < end; i++) sumSquares += mono[i] * mono[i]
    const rms = Math.sqrt(sumSquares / Math.max(1, end - start))
    return rms > 0 ? 20 * Math.log10(rms) : -Infinity
  }

  // Collect gaps of consecutive quiet windows that clear minSilenceSeconds, then
  // the kept segments are simply whatever's left between/around them.
  const minGapWindows = Math.max(1, Math.round(minSilenceSeconds / SILENCE_WINDOW_SECONDS))
  const gaps: SilenceSegment[] = []
  let quietRunStart = -1
  for (let w = firstWindow; w <= lastWindow + 1; w++) {
    const isQuiet = w <= lastWindow && windowDb(w) <= thresholdDb
    if (isQuiet) {
      if (quietRunStart === -1) quietRunStart = w
    } else if (quietRunStart !== -1) {
      if (w - quietRunStart >= minGapWindows) {
        gaps.push({
          start: (quietRunStart * windowSize) / sampleRate,
          end: (w * windowSize) / sampleRate
        })
      }
      quietRunStart = -1
    }
  }

  const segments: SilenceSegment[] = []
  let cursor = searchStart
  for (const gap of gaps) {
    if (gap.start > cursor) segments.push({ start: cursor, end: Math.min(gap.start, searchEnd) })
    cursor = Math.max(cursor, gap.end)
  }
  if (cursor < searchEnd) segments.push({ start: cursor, end: searchEnd })

  return segments.length > 0 ? segments : [{ start: searchStart, end: searchEnd }]
}

// BS.1770's own mean-square-to-LUFS calibration constant. This measurement
// skips the standard's K-weighting pre-filter and gating stages (a meaningful
// simplification for content with wide dynamic range), so it's a reasonable
// loudness *approximation* for matching SFX/tracks to a target level, not a
// certified broadcast-standard LUFS reading.
const LUFS_CALIBRATION_OFFSET_DB = -0.691

export function measureLoudnessLufs(buffer: AudioBuffer): number {
  const mono = mixToMono(buffer)
  if (mono.length === 0) return -Infinity
  let sumSquares = 0
  for (let i = 0; i < mono.length; i++) sumSquares += mono[i] * mono[i]
  const meanSquare = sumSquares / mono.length
  if (meanSquare <= 0) return -Infinity
  return 10 * Math.log10(meanSquare) + LUFS_CALIBRATION_OFFSET_DB
}
