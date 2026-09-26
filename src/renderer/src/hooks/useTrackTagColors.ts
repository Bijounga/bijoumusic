import { useMemo } from 'react'
import { useTagStore } from '../state/tagStore'
import { tagColorForId } from '../lib/tagColors'

/** A track's tag colors in a stable order (by tag id) — used to build waveform
 *  gradients, so the same set of tags always produces the same-looking gradient
 *  rather than reshuffling on every re-render. */
export function useTrackTagColors(trackId: number | undefined): string[] {
  const tagIds = useTagStore((s) => (trackId === undefined ? undefined : s.trackTags.get(trackId)))

  return useMemo(() => {
    if (!tagIds || tagIds.size === 0) return []
    return [...tagIds].sort((a, b) => a - b).map(tagColorForId)
  }, [tagIds])
}
