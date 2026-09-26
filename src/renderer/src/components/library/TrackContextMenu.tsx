import { useEffect, useMemo, useRef, useState } from 'react'
import type { Track } from '@shared/types'
import { usePlaybackStore } from '../../state/playbackStore'
import { useTagStore } from '../../state/tagStore'
import { useProjectStore } from '../../state/projectStore'
import { useAliasStore } from '../../state/aliasStore'
import { useRatingStore } from '../../state/ratingStore'
import { useLibraryStore } from '../../state/libraryStore'
import { useFilterStore } from '../../state/filterStore'
import { useSimilarityStore } from '../../state/similarityStore'
import { FAVORITE_LEVELS, ENERGY_LEVELS } from '../../lib/ratings'
import favStyles from '../favorites/FavoriteSelector.module.css'
import enStyles from '../favorites/EnergySelector.module.css'
import styles from './TrackContextMenu.module.css'

interface TrackContextMenuProps {
  tracks: Track[]
  x: number
  y: number
  onClose: () => void
}

const MENU_WIDTH = 260
const MENU_MAX_HEIGHT = 420

/** Uniform > 0: how many of the given track ids have this membership; used to draw
 *  a checkbox as unchecked / checked / indeterminate for a single track or a whole
 *  multi-selection alike (a single-track selection just degenerates to 0 or 1). */
function membershipState(trackIds: number[], members: (id: number) => boolean): 'none' | 'all' | 'some' {
  let count = 0
  for (const id of trackIds) if (members(id)) count++
  if (count === 0) return 'none'
  if (count === trackIds.length) return 'all'
  return 'some'
}

function TrackContextMenu({ tracks, x, y, onClose }: TrackContextMenuProps): React.JSX.Element {
  const [tagQuery, setTagQuery] = useState('')
  const [newAlias, setNewAlias] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  const isBulk = tracks.length > 1
  const primaryTrack = tracks[0]
  const trackIds = useMemo(() => tracks.map((t) => t.id), [tracks])

  const playTrack = usePlaybackStore((s) => s.playTrack)

  const tags = useTagStore((s) => s.tags)
  const trackTags = useTagStore((s) => s.trackTags)
  const groups = useTagStore((s) => s.groups)
  const addTrackTag = useTagStore((s) => s.addTrackTag)
  const removeTrackTag = useTagStore((s) => s.removeTrackTag)

  const projects = useProjectStore((s) => s.projects)
  const projectTracks = useProjectStore((s) => s.projectTracks)
  const addTrackToProject = useProjectStore((s) => s.addTrackToProject)
  const removeTrackFromProject = useProjectStore((s) => s.removeTrackFromProject)

  const aliasesByTrack = useAliasStore((s) => s.aliasesByTrack)
  const addAlias = useAliasStore((s) => s.addAlias)
  const deleteAlias = useAliasStore((s) => s.deleteAlias)
  const aliases = !isBulk ? (aliasesByTrack.get(primaryTrack.id) ?? []) : []

  const ratings = useRatingStore((s) => s.ratings)
  const setFavoriteLevel = useRatingStore((s) => s.setFavoriteLevel)
  const setEnergyLevel = useRatingStore((s) => s.setEnergyLevel)

  const allTracks = useLibraryStore((s) => s.tracks)
  const removeTracksLocally = useLibraryStore((s) => s.removeTracksLocally)
  const setActiveView = useFilterStore((s) => s.setActiveView)
  const findSimilar = useSimilarityStore((s) => s.findSimilar)

  const currentTrack = usePlaybackStore((s) => s.currentTrack)
  const togglePlayPause = usePlaybackStore((s) => s.togglePlayPause)
  const isPlaying = usePlaybackStore((s) => s.isPlaying)

  async function deleteFromDisk(): Promise<void> {
    const noun = isBulk ? `these ${tracks.length} tracks` : 'this track'
    if (!confirm(`Move ${noun} to the Recycle Bin? You can restore from there if this was a mistake.`)) return

    if (currentTrack && isPlaying && trackIds.includes(currentTrack.id)) togglePlayPause()

    const succeededIds: number[] = []
    const failures: string[] = []
    for (const t of tracks) {
      const result = await window.api.deleteTrackFile(t.id)
      if (result.success) succeededIds.push(t.id)
      else failures.push(`${t.filename}: ${result.error ?? 'unknown error'}`)
    }
    if (succeededIds.length > 0) removeTracksLocally(succeededIds)
    if (failures.length > 0) alert(`Couldn't delete:\n${failures.join('\n')}`)
    onClose()
  }

  async function submitNewAlias(): Promise<void> {
    if (!newAlias.trim()) return
    await addAlias(primaryTrack.id, newAlias)
    setNewAlias('')
  }

  const groupNameById = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups])
  const filteredTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase()
    if (!q) return tags
    return tags.filter((t) => t.name.toLowerCase().includes(q) || groupNameById.get(t.groupId ?? -1)?.toLowerCase().includes(q))
  }, [tags, tagQuery, groupNameById])

  function toggleTagForSelection(tagId: number): void {
    const state = membershipState(trackIds, (id) => trackTags.get(id)?.has(tagId) ?? false)
    for (const id of trackIds) {
      if (state === 'all') void removeTrackTag(id, tagId)
      else void addTrackTag(id, tagId)
    }
  }

  function toggleProjectForSelection(projectId: number): void {
    const members = projectTracks.get(projectId)
    const state = membershipState(trackIds, (id) => members?.has(id) ?? false)
    for (const id of trackIds) {
      if (state === 'all') void removeTrackFromProject(projectId, id)
      else void addTrackToProject(projectId, id)
    }
  }

  // "Common" level across the selection — undefined when the selected tracks
  // disagree, in which case no button shows as active until you pick one.
  const commonFavoriteLevel = useMemo(() => {
    const levels = new Set(tracks.map((t) => ratings.get(t.id)?.favoriteLevel ?? null))
    return levels.size === 1 ? [...levels][0] : undefined
  }, [tracks, ratings])

  const commonEnergyLevel = useMemo(() => {
    const levels = new Set(tracks.map((t) => ratings.get(t.id)?.energyLevel ?? null))
    return levels.size === 1 ? [...levels][0] : undefined
  }, [tracks, ratings])

  function applyFavoriteLevel(level: number): void {
    const clearing = commonFavoriteLevel === level
    for (const id of trackIds) void setFavoriteLevel(id, clearing ? null : level)
  }

  function applyEnergyLevel(level: number): void {
    const clearing = commonEnergyLevel === level
    for (const id of trackIds) void setEnergyLevel(id, clearing ? null : level)
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose()
    }
    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  // Clamp to viewport so the menu never renders partly off-screen.
  const clampedX = Math.min(x, window.innerWidth - MENU_WIDTH - 8)
  const clampedY = Math.min(y, window.innerHeight - MENU_MAX_HEIGHT - 8)

  return (
    <div className={styles.menu} ref={menuRef} style={{ left: Math.max(8, clampedX), top: Math.max(8, clampedY) }}>
      <div className={styles.trackName}>{isBulk ? `${tracks.length} tracks selected` : primaryTrack.filename}</div>

      {!isBulk && (
        <>
          <div
            className={styles.playRow}
            onClick={() => {
              playTrack(primaryTrack)
              onClose()
            }}
          >
            ▶ Play
          </div>

          <div
            className={styles.playRow}
            onClick={() => {
              void window.api.showInExplorer(primaryTrack.currentPath)
              onClose()
            }}
          >
            Show in Explorer
          </div>

          <div
            className={styles.playRow}
            title="Finds tracks with a similar loudness/energy shape over time — an approximation, not true audio content matching"
            onClick={() => {
              setActiveView('similar')
              void findSimilar(primaryTrack, allTracks)
              onClose()
            }}
          >
            Find Similar
          </div>
        </>
      )}

      <div className={`${styles.playRow} ${styles.dangerRow}`} onClick={() => void deleteFromDisk()}>
        Delete from disk{isBulk ? ` (${tracks.length})` : ''}
      </div>

      <p className={styles.sectionHeading}>Favorite</p>
      <div className={styles.inlineRow}>
        <div className={favStyles.row}>
          {FAVORITE_LEVELS.map(({ level, label, cssVar, glyph }) => {
            const isActive = commonFavoriteLevel === level
            return (
              <button
                key={level}
                className={`${favStyles.btn} ${isActive ? favStyles.btnActive : ''}`}
                style={{ color: isActive ? `var(${cssVar})` : undefined }}
                title={label}
                aria-label={label}
                onClick={() => applyFavoriteLevel(level)}
              >
                {glyph}
              </button>
            )
          })}
        </div>
      </div>

      <p className={styles.sectionHeading}>Energy</p>
      <div className={styles.inlineRow}>
        <div className={enStyles.row}>
          {ENERGY_LEVELS.map((level) => {
            const isActive = commonEnergyLevel === level
            return (
              <button
                key={level}
                className={`${enStyles.btn} ${isActive ? enStyles.btnActive : ''}`}
                title={`Energy ${level}`}
                aria-label={`Energy ${level}`}
                onClick={() => applyEnergyLevel(level)}
              >
                {level}
              </button>
            )
          })}
        </div>
      </div>

      {!isBulk && (
        <>
          <p className={styles.sectionHeading}>Aliases</p>
          {aliases.length === 0 && <p className={styles.emptyHint}>No aliases yet</p>}
          {aliases.map((alias) => (
            <div key={alias.id} className={styles.checkRow}>
              <span className={styles.checkLabel}>{alias.aliasText}</span>
              <span className={styles.deleteBtn} onClick={() => void deleteAlias(alias.id, primaryTrack.id)}>
                ×
              </span>
            </div>
          ))}
          <input
            className={styles.searchInput}
            placeholder="+ new alias…"
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNewAlias()
            }}
          />
        </>
      )}

      <p className={styles.sectionHeading}>Tags</p>
      <input
        className={styles.searchInput}
        placeholder="Search tags…"
        value={tagQuery}
        onChange={(e) => setTagQuery(e.target.value)}
      />
      {filteredTags.length === 0 && <p className={styles.emptyHint}>No matching tags</p>}
      {filteredTags.map((tag) => {
        const state = membershipState(trackIds, (id) => trackTags.get(id)?.has(tag.id) ?? false)
        const groupName = tag.groupId !== null ? groupNameById.get(tag.groupId) : null
        return (
          <div key={tag.id} className={styles.checkRow} onClick={() => toggleTagForSelection(tag.id)}>
            <span
              className={`${styles.checkbox} ${state === 'all' ? styles.checkboxChecked : ''} ${state === 'some' ? styles.checkboxIndeterminate : ''}`}
            >
              {state === 'all' ? '✓' : state === 'some' ? '–' : ''}
            </span>
            <span className={styles.checkLabel}>{tag.name}</span>
            {groupName && <span className={styles.checkGroup}>{groupName}</span>}
          </div>
        )
      })}

      <p className={styles.sectionHeading}>Projects</p>
      {projects.length === 0 && <p className={styles.emptyHint}>No projects yet</p>}
      {projects.map((project) => {
        const members = projectTracks.get(project.id)
        const state = membershipState(trackIds, (id) => members?.has(id) ?? false)
        return (
          <div key={project.id} className={styles.checkRow} onClick={() => toggleProjectForSelection(project.id)}>
            <span
              className={`${styles.checkbox} ${state === 'all' ? styles.checkboxChecked : ''} ${state === 'some' ? styles.checkboxIndeterminate : ''}`}
            >
              {state === 'all' ? '✓' : state === 'some' ? '–' : ''}
            </span>
            <span className={styles.checkLabel}>{project.name}</span>
          </div>
        )
      })}
    </div>
  )
}

export default TrackContextMenu
