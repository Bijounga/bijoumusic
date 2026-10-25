import { detectBpm } from './detectBpm'

/** Runs tempo detection off the page's main thread, so working through the library in
 *  the background never makes scrolling or playback stutter. */
interface Request {
  id: number
  samples: Float32Array
  sampleRate: number
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, samples, sampleRate } = event.data
  self.postMessage({ id, bpm: detectBpm(samples, sampleRate)?.bpm ?? 0 })
}
