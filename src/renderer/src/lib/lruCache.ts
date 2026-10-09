/** A Map that holds at most `limit` entries, dropping the least recently used
 *  one when full. The waveform and album-art caches used to be plain Maps that
 *  only ever grew: every row scrolled past in a 22,000-track library stayed in
 *  memory for the life of the app (roughly 60 KB per row — well over a gigabyte
 *  after browsing the whole library). Recently seen rows still come back
 *  instantly; only rows long out of view get re-read from disk. */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>()

  constructor(private readonly limit: number) {}

  get(key: K): V | undefined {
    if (!this.map.has(key)) return undefined
    const value = this.map.get(key) as V
    // Re-insert so this key becomes the most recently used.
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: K, value: V): void {
    this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.limit) {
      const oldest = this.map.keys().next().value as K
      this.map.delete(oldest)
    }
  }
}
