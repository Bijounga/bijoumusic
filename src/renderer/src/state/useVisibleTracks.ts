import { useMemo } from 'react'
import { useLibraryStore } from './libraryStore'
import { useFilterStore } from './filterStore'
import { useTagStore } from './tagStore'
import { useRatingStore } from './ratingStore'
import { useAliasStore } from './aliasStore'
import { useRecentActivityStore } from './recentActivityStore'
import { useProjectStore } from './projectStore'
import { useSortStore } from './sortStore'
import { useDuplicateStore } from './duplicateStore'
import { useSimilarityStore } from './similarityStore'
import { useSearchBlacklistStore } from './searchBlacklistStore'
import type { Track } from '@shared/types'

/**
 * The single ordered list of tracks currently visible under the active filters.
 * TrackList renders this, and future Up/Down keyboard navigation steps through it —
 * both must read the same list so they never disagree on "what's currently browsable".
 */
export function useVisibleTracks(): Track[] {
  const tracks = useLibraryStore((s) => s.tracks)
  const activeView = useFilterStore((s) => s.activeView)
  const selectedFolder = useFilterStore((s) => s.selectedFolder)
  const selectedTagIds = useFilterStore((s) => s.selectedTagIds)
  const selectedFavoriteLevel = useFilterStore((s) => s.selectedFavoriteLevel)
  const selectedEnergyLevel = useFilterStore((s) => s.selectedEnergyLevel)
  const searchQuery = useFilterStore((s) => s.searchQuery)
  const trackTags = useTagStore((s) => s.trackTags)
  const tagNamesById = useTagStore((s) => s.tags)
  const ratings = useRatingStore((s) => s.ratings)
  const aliasesByTrack = useAliasStore((s) => s.aliasesByTrack)
  const recentlyPlayedIds = useRecentActivityStore((s) => s.recentlyPlayedIds)
  const mostUsedIds = useRecentActivityStore((s) => s.mostUsedIds)
  const activeProjectTrackIds = useProjectStore((s) => s.activeProjectTrackIds)
  const duplicateGroups = useDuplicateStore((s) => s.groups)
  const similarResultIds = useSimilarityStore((s) => s.resultTrackIds)
  const sortBy = useSortStore((s) => s.sortBy)
  const sortDirection = useSortStore((s) => s.sortDirection)
  const minDurationSeconds = useFilterStore((s) => s.minDurationSeconds)
  const maxDurationSeconds = useFilterStore((s) => s.maxDurationSeconds)
  const blacklistedWords = useSearchBlacklistStore((s) => s.words)
  const blacklistedFolders = useSearchBlacklistStore((s) => s.folders)

  const tagById = useMemo(() => new Map(tagNamesById.map((t) => [t.id, t])), [tagNamesById])
  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks])

  return useMemo(() => {
    // Recently Played / Most Used are a distinct ordering over the whole library
    // (by recency or play count), not a filter — folder/tag/rating filters don't
    // apply here, since the point is "show me these regardless of where they live".
    let result: Track[]
    if (activeView === 'recentlyPlayed') {
      result = recentlyPlayedIds.map((id) => trackById.get(id)).filter((t): t is Track => t !== undefined)
    } else if (activeView === 'mostUsed') {
      result = mostUsedIds.map((id) => trackById.get(id)).filter((t): t is Track => t !== undefined)
    } else if (activeView === 'project') {
      result = activeProjectTrackIds.map((id) => trackById.get(id)).filter((t): t is Track => t !== undefined)
    } else if (activeView === 'duplicates') {
      // Flattened, but each group's tracks stay adjacent (grouped by content hash)
      // so duplicates read as clusters in the list rather than scattered.
      result = duplicateGroups.flat()
    } else if (activeView === 'similar') {
      result = similarResultIds.map((id) => trackById.get(id)).filter((t): t is Track => t !== undefined)
    } else {
      result = tracks

      if (selectedFolder !== null) {
        const { libraryRootId, relativePath } = selectedFolder
        result = result.filter((t) => {
          if (t.libraryRootId !== libraryRootId) return false
          if (relativePath === '') return true
          return (
            t.folderPath === relativePath ||
            t.folderPath.startsWith(relativePath + '\\') ||
            t.folderPath.startsWith(relativePath + '/')
          )
        })
      }

      if (selectedTagIds.length > 0) {
        result = result.filter((t) => {
          const tags = trackTags.get(t.id)
          if (!tags) return false
          return selectedTagIds.every((tagId) => tags.has(tagId))
        })
      }

      if (selectedFavoriteLevel !== null) {
        result = result.filter((t) => ratings.get(t.id)?.favoriteLevel === selectedFavoriteLevel)
      }

      if (selectedEnergyLevel !== null) {
        result = result.filter((t) => ratings.get(t.id)?.energyLevel === selectedEnergyLevel)
      }

      // Recently Played / Most Used / a Project already have their own meaningful
      // order (recency, usage, manual project order) — the sort control only
      // applies to plain library browsing, where "folder order" would otherwise be
      // the only option.
      const sorted = [...result].sort((a, b) => {
        let cmp: number
        if (sortBy === 'name') cmp = a.filename.localeCompare(b.filename)
        else if (sortBy === 'recentlyAdded') cmp = a.addedAt - b.addedAt
        else cmp = a.folderPath.localeCompare(b.folderPath) || a.filename.localeCompare(b.filename)
        return sortDirection === 'asc' ? cmp : -cmp
      })
      result = sorted
    }

    const query = searchQuery.trim().toLowerCase()
    if (query.length > 0) {
      result = result.filter((t) => {
        if (t.filename.toLowerCase().includes(query)) return true

        const aliases = aliasesByTrack.get(t.id)
        if (aliases?.some((a) => a.aliasText.toLowerCase().includes(query))) return true

        const tagIds = trackTags.get(t.id)
        if (tagIds) {
          for (const tagId of tagIds) {
            if (tagById.get(tagId)?.name.toLowerCase().includes(query)) return true
          }
        }

        return false
      })

      // Only scoped to an active search, not plain folder/tag browsing — clicking
      // straight into a blacklisted folder is a deliberate "show me this" action,
      // not search casting a wide net that needs reining in. Built for a folder
      // with hundreds/thousands of similarly-named SFX drowning out unrelated
      // search results.
      if (blacklistedWords.length > 0) {
        result = result.filter((t) => {
          const name = t.filename.toLowerCase()
          return !blacklistedWords.some((word) => name.includes(word))
        })
      }
      if (blacklistedFolders.length > 0) {
        result = result.filter((t) => {
          return !blacklistedFolders.some((f) => {
            if (t.libraryRootId !== f.libraryRootId) return false
            if (f.relativePath === '') return true
            return t.folderPath === f.relativePath || t.folderPath.startsWith(f.relativePath + '\\')
          })
        })
      }
    }

    // Applies across every view (including Recently Played/Most Used/a Project),
    // unlike sort — "short tracks I've played recently" is a sensible thing to want.
    if (minDurationSeconds !== null || maxDurationSeconds !== null) {
      result = result.filter((t) => {
        if (t.durationSeconds === null) return false
        if (minDurationSeconds !== null && t.durationSeconds < minDurationSeconds) return false
        if (maxDurationSeconds !== null && t.durationSeconds > maxDurationSeconds) return false
        return true
      })
    }

    return result
  }, [
    tracks,
    activeView,
    recentlyPlayedIds,
    mostUsedIds,
    activeProjectTrackIds,
    duplicateGroups,
    similarResultIds,
    trackById,
    selectedFolder,
    selectedTagIds,
    selectedFavoriteLevel,
    selectedEnergyLevel,
    searchQuery,
    trackTags,
    tagById,
    ratings,
    aliasesByTrack,
    blacklistedWords,
    blacklistedFolders,
    sortBy,
    sortDirection,
    minDurationSeconds,
    maxDurationSeconds
  ])
}
