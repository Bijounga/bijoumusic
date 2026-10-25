/** Tempo detection for the library's songs. Works on plain samples so it can be
 *  tested without a browser: pass one channel (or a mono mix) and its sample rate.
 *
 *  Method: turn the audio into a "something hit here" curve (how fast the loudness
 *  of the low end and of the whole sound jumps up, ~200 times a second), then find
 *  the beat spacing that lines that curve up with itself best (autocorrelation).
 *  Tempo is ambiguous by octaves (a 160 song can also be felt as 80), so candidates
 *  are scored with a gentle preference for everyday tempos; the app lets you
 *  halve/double a result that landed on the wrong side. */

/** How much of the song to listen to, taken from the middle (intros/outros drift). */
const ANALYZE_SECONDS = 90
const MIN_SONG_SECONDS = 12
const FRAMES_PER_SECOND = 200
const MIN_BPM = 60
const MAX_BPM = 200
const PRIOR_CENTER_BPM = 125
const PRIOR_SPREAD_OCTAVES = 1.1
/** A song whose best repeat doesn't stand out from the rest at least this much has no clear tempo. */
const MIN_CONFIDENCE = 0.03
/** Longest span (in beats) used to sharpen the tempo once it's roughly known. */
const REFINE_BEATS = 16
/** Results below this are checked for being a fast song heard in half-time. */
const SLOW_BPM = 100
const DOUBLE_IF_THIS_STRONG = 0.7

export interface BpmResult {
  /** Beats per minute, to one decimal. */
  bpm: number
  /** 0-1-ish: how strongly the beat repeats. Higher is more certain. */
  confidence: number
}

function onePoleLowPass(input: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  const alpha = 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate)
  const out = new Float32Array(input.length)
  let y = 0
  for (let i = 0; i < input.length; i++) {
    y += alpha * (input[i] - y)
    out[i] = y
  }
  return out
}

/** Per-frame loudness of a signal, as the log of its mean square. */
function frameLogEnergy(signal: Float32Array, hop: number, frames: number): Float32Array {
  const out = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    const start = f * hop
    let sum = 0
    for (let i = start; i < start + hop; i++) sum += signal[i] * signal[i]
    out[f] = Math.log(1e-7 + sum / hop)
  }
  return out
}

/** Positive jumps in loudness, with the slow average taken out and spread normalised,
 *  so loud and quiet songs (and low-heavy or bright ones) are measured alike. */
function onsetCurve(logEnergy: Float32Array): Float32Array {
  const n = logEnergy.length
  const flux = new Float32Array(n)
  for (let i = 1; i < n; i++) flux[i] = Math.max(0, logEnergy[i] - logEnergy[i - 1])

  // Remove a ~0.4s running mean so sustained loud stretches don't read as beats.
  const half = Math.round(FRAMES_PER_SECOND * 0.2)
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + flux[i]
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(n, i + half + 1)
    const mean = (prefix[b] - prefix[a]) / (b - a)
    const v = Math.max(0, flux[i] - mean)
    out[i] = v
  }
  // Blur each hit over a few frames (~±12 ms) so repeats still line up when a beat
  // lands a hair off the frame grid; without this the repeat peaks are one frame wide
  // and the self-match misses them at most spacings.
  const kernel = [1, 2, 3, 4, 3, 2, 1]
  const blurred = new Float32Array(n)
  let sumSq = 0
  for (let i = 0; i < n; i++) {
    let v = 0
    for (let k = 0; k < kernel.length; k++) {
      const j = i + k - 3
      if (j >= 0 && j < n) v += out[j] * kernel[k]
    }
    blurred[i] = v / 16
    sumSq += blurred[i] * blurred[i]
  }
  const std = Math.sqrt(sumSq / Math.max(1, n))
  if (std > 0) for (let i = 0; i < n; i++) blurred[i] /= std
  return blurred
}

function autocorrelation(curve: Float32Array, maxLag: number): Float32Array {
  const n = curve.length
  const acf = new Float32Array(maxLag + 1)
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i + lag < n; i++) sum += curve[i] * curve[i + lag]
    // Fewer samples overlap at long lags; average rather than sum so lags compare fairly.
    acf[lag] = sum / (n - lag)
  }
  return acf
}

/** The curve value at a fractional lag, by interpolating between its neighbours. */
function at(acf: Float32Array, lag: number): number {
  if (lag < 0 || lag >= acf.length - 1) return 0
  const i = Math.floor(lag)
  const t = lag - i
  return acf[i] * (1 - t) + acf[i + 1] * t
}

function parabolicPeak(acf: Float32Array, lag: number): number {
  if (lag <= 0 || lag >= acf.length - 1) return lag
  const a = acf[lag - 1]
  const b = acf[lag]
  const c = acf[lag + 1]
  const denom = a - 2 * b + c
  if (denom === 0) return lag
  return lag + (0.5 * (a - c)) / denom
}

/** Finds the tempo of a song, or null when it's too short or has no steady beat. */
export function detectBpm(samples: Float32Array, sampleRate: number): BpmResult | null {
  const seconds = samples.length / sampleRate
  if (seconds < MIN_SONG_SECONDS) return null

  // Listen to the middle of the song.
  const windowSamples = Math.min(samples.length, Math.round(ANALYZE_SECONDS * sampleRate))
  const startSample = Math.max(0, Math.floor((samples.length - windowSamples) / 2))
  const segment = samples.subarray(startSample, startSample + windowSamples)

  const hop = Math.max(1, Math.round(sampleRate / FRAMES_PER_SECOND))
  const frames = Math.floor(segment.length / hop)
  if (frames < FRAMES_PER_SECOND * 8) return null

  // Two views of the same audio: the thump (below ~200 Hz) and everything.
  const low = onePoleLowPass(segment, sampleRate, 200)
  const lowCurve = onsetCurve(frameLogEnergy(low, hop, frames))
  const fullCurve = onsetCurve(frameLogEnergy(segment, hop, frames))
  const curve = new Float32Array(frames)
  for (let i = 0; i < frames; i++) curve[i] = lowCurve[i] + fullCurve[i]

  const fps = sampleRate / hop
  const minLag = Math.floor((60 * fps) / MAX_BPM)
  const maxLag = Math.ceil((60 * fps) / MIN_BPM)
  const acf = autocorrelation(curve, Math.min(frames - 1, maxLag * 4 + REFINE_BEATS * maxLag))
  if (acf[0] <= 0) return null

  // Score every candidate beat spacing: its own repeat strength plus how well the
  // pattern repeats at two and four times that spacing (real beats do; noise doesn't).
  let bestLag = -1
  let bestScore = -Infinity
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / PRIOR_CENTER_BPM) / PRIOR_SPREAD_OCTAVES, 2))
    const strength = acf[lag] + 0.5 * at(acf, lag * 2) + 0.25 * at(acf, lag * 4)
    const score = strength * prior
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  if (bestLag < 0) return null

  // Slow results are often a fast song heard in half-time. If the beat clearly also
  // repeats at half the spacing (twice the tempo) and that tempo is in range, take it.
  if ((60 * fps) / bestLag < SLOW_BPM) {
    const fastLag = Math.round(bestLag / 2)
    let fastStrength = 0
    for (let l = fastLag - 1; l <= fastLag + 1; l++) fastStrength = Math.max(fastStrength, acf[l] ?? 0)
    if (fastLag >= minLag && fastStrength >= acf[bestLag] * DOUBLE_IF_THIS_STRONG) bestLag = fastLag
  }

  // How far the winning repeat stands above the typical self-match at other spacings:
  // a steady beat is a clear spike, rhythm-less music (strings, ambience) is a flat hum.
  let baseline = 0
  for (let l = minLag; l <= maxLag; l++) baseline += acf[l]
  baseline /= maxLag - minLag + 1
  const confidence = (acf[bestLag] - baseline) / acf[0]
  if (confidence < MIN_CONFIDENCE) return null

  // Sharpen: the same pattern repeating over many beats pins the spacing down much
  // more finely than one beat can. Look for the repeat near N beats and divide by N.
  let lag = parabolicPeak(acf, bestLag)
  for (const beats of [4, 8, REFINE_BEATS]) {
    const target = lag * beats
    if (target + 4 >= acf.length - 1) break
    const lo = Math.max(1, Math.floor(target - beats * 0.6))
    const hi = Math.min(acf.length - 2, Math.ceil(target + beats * 0.6))
    let peak = lo
    for (let l = lo; l <= hi; l++) if (acf[l] > acf[peak]) peak = l
    // Only trust it if it's a real peak, not the edge of the window.
    if (peak === lo || peak === hi) break
    const refined = parabolicPeak(acf, peak) / beats
    if (Math.abs(refined - lag) / lag > 0.03) break
    lag = refined
  }

  const bpm = Math.round(((60 * fps) / lag) * 10) / 10
  return { bpm, confidence }
}

/** The middle stretch of a song, mixed down to one channel — the only part detectBpm
 *  listens to, cut out up front so little data has to travel to the worker. */
export function middleMono(channels: Float32Array[], sampleRate: number): Float32Array {
  const length = channels[0].length
  const windowSamples = Math.min(length, Math.round(ANALYZE_SECONDS * sampleRate))
  const start = Math.max(0, Math.floor((length - windowSamples) / 2))
  const out = new Float32Array(windowSamples)
  for (const channel of channels) {
    for (let i = 0; i < windowSamples; i++) out[i] += channel[start + i] / channels.length
  }
  return out
}
