import { useEffect, useState } from 'react'
import type { Track } from '@shared/types'

// In-memory cache on top of the on-disk one in main — keyed by content hash so a
// moved/renamed file still hits it, and reselecting a track this session is instant.
const memoryCache = new Map<string, string | null>()

export function useAlbumArt(track: Track | null): string | null {
  const [art, setArt] = useState<string | null>(null)

  useEffect(() => {
    if (!track) {
      setArt(null)
      return
    }

    const cached = memoryCache.get(track.contentHash)
    if (cached !== undefined) {
      setArt(cached)
      return
    }

    let cancelled = false
    setArt(null)

    window.api.getAlbumArt(track.id).then((dataUrl) => {
      if (cancelled) return
      memoryCache.set(track.contentHash, dataUrl)
      setArt(dataUrl)
    })

    return () => {
      cancelled = true
    }
  }, [track])

  return art
}
