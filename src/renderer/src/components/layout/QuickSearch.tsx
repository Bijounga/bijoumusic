import { useEffect, useMemo, useRef, useState } from 'react'
import type { Tag, Track } from '@shared/types'
import { useLibraryStore } from '../../state/libraryStore'
import { useFilterStore } from '../../state/filterStore'
import { useTagStore } from '../../state/tagStore'
import { useAliasStore } from '../../state/aliasStore'
import { usePlaybackStore } from '../../state/playbackStore'
import { useSearchBlacklistStore } from '../../state/searchBlacklistStore'
import { buildFolderTree, flattenFolderTree, type FlatFolderOption } from '../../lib/folderTree'
import { tagColorForId } from '../../lib/tagColors'
import { formatDuration } from '../../lib/format'
import FolderIcon from '../library/FolderIcon'
import styles from './QuickSearch.module.css'

const MAX_SONGS = 8
const MAX_TAGS = 6
const MAX_FOLDERS = 6

type Result =
  | { kind: 'song'; key: string; score: number; track: Track }
  | { kind: 'tag'; key: string; score: number; tag: Tag; count: number }
  | { kind: 'folder'; key: string; score: number; folder: FlatFolderOption }

/** Lower is better: exact, then starts-with, then a word inside starting with
 *  the query, then contains anywhere. -1 = no match. */
function matchScore(text: string, query: string): number {
  const t = text.toLowerCase()
  if (t === query) return 0
  if (t.startsWith(query)) return 1
  const at = t.indexOf(query)
  if (at === -1) return -1
  return /[a-z0-9]/i.test(t[at - 1] ?? '') ? 3 : 2
}

function bestMatches<T>(items: T[], score: (item: T) => number, sortLen: (item: T) => number, limit: number): { item: T; score: number }[] {
  const hits: { item: T; score: number; len: number }[] = []
  for (const item of items) {
    const s = score(item)
    if (s >= 0) hits.push({ item, score: s, len: sortLen(item) })
  }
  hits.sort((a, b) => a.score - b.score || a.len - b.len)
  return hits.slice(0, limit)
}

/** Ctrl + Space quick search: one box that finds songs, tags and folders.
 *  Enter opens the highlighted result (plays a song, filters to a tag, jumps to a
 *  folder). On a tag, Shift + Enter adds it to (or removes it from) the current
 *  search and keeps the popup open, so a search of several tags can be typed in a
 *  row; Ctrl + Enter adds it to (or removes it from) the playing song instead.
 *  When a folder is selected, songs and folders are limited to that folder (Tab
 *  toggles to searching everywhere); every tag stays available. */
function QuickSearch(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  // Search is scoped to the folder you're in; Tab widens it to everything.
  const [searchEverywhere, setSearchEverywhere] = useState(false)
  // True once a tag has been stacked onto the search with Shift + Enter in this popup:
  // from then on a plain Enter on a tag adds it too, instead of replacing the stack.
  const [stackedTags, setStackedTags] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const tracks = useLibraryStore((s) => s.tracks)
  const libraryRoots = useLibraryStore((s) => s.libraryRoots)
  const tags = useTagStore((s) => s.tags)
  const groups = useTagStore((s) => s.groups)
  const trackTags = useTagStore((s) => s.trackTags)
  const addTrackTag = useTagStore((s) => s.addTrackTag)
  const removeTrackTag = useTagStore((s) => s.removeTrackTag)
  const aliasesByTrack = useAliasStore((s) => s.aliasesByTrack)
  const currentTrack = usePlaybackStore((s) => s.currentTrack)
  const playTrack = usePlaybackStore((s) => s.playTrack)
  const blacklistedWords = useSearchBlacklistStore((s) => s.words)
  const blacklistedFolders = useSearchBlacklistStore((s) => s.folders)
  const selectedFolder = useFilterStore((s) => s.selectedFolder)
  const activeView = useFilterStore((s) => s.activeView)
  const selectedTagIds = useFilterStore((s) => s.selectedTagIds)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.code !== 'Space' || !event.ctrlKey || event.altKey || event.metaKey) return
      event.preventDefault()
      event.stopPropagation()
      setOpen((wasOpen) => !wasOpen)
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setStatus(null)
    setActiveIndex(0)
    setSearchEverywhere(false)
    setStackedTags(false)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const allFolders = useMemo(() => (open ? flattenFolderTree(buildFolderTree(tracks, libraryRoots)) : []), [open, tracks, libraryRoots])

  // The folder selected in the sidebar, if any (not in Recently Played etc.).
  const scope = !searchEverywhere && activeView === 'library' ? selectedFolder : null
  const scopeName = useMemo(() => {
    if (!selectedFolder) return ''
    const match = allFolders.find(
      (f) => f.libraryRootId === selectedFolder.libraryRootId && f.relativePath === selectedFolder.relativePath
    )
    return match ? match.label.slice(match.label.lastIndexOf('\\') + 1) : 'this folder'
  }, [selectedFolder, allFolders])

  const scopedTracks = useMemo(() => {
    if (!open || !scope) return tracks
    const prefix = scope.relativePath + '\\'
    return tracks.filter(
      (t) =>
        t.libraryRootId === scope.libraryRootId &&
        (scope.relativePath === '' || t.folderPath === scope.relativePath || t.folderPath.startsWith(prefix))
    )
  }, [open, scope, tracks])

  // Subfolders of the scope folder only (not the folder itself).
  const folders = useMemo(() => {
    if (!scope) return allFolders
    const prefix = scope.relativePath === '' ? '' : scope.relativePath + '\\'
    return allFolders.filter(
      (f) => f.libraryRootId === scope.libraryRootId && f.relativePath !== scope.relativePath && f.relativePath.startsWith(prefix)
    )
  }, [scope, allFolders])

  // Every tag stays listed (Shift + Enter can apply any tag), but counts reflect
  // the songs in the current scope.
  const tagCounts = useMemo(() => {
    const counts = new Map<number, number>()
    if (!open) return counts
    for (const t of scopedTracks) {
      for (const id of trackTags.get(t.id) ?? []) counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [open, scopedTracks, trackTags])

  const groupNames = useMemo(() => new Map(groups.map((g) => [g.id, g.name])), [groups])
  const currentTagIds = currentTrack ? trackTags.get(currentTrack.id) : undefined

  const results = useMemo((): Result[] => {
    const q = query.trim().toLowerCase()
    if (!q) return []

    const isBlacklisted = (t: Track): boolean => {
      const name = t.filename.toLowerCase()
      if (blacklistedWords.some((word) => name.includes(word))) return true
      return blacklistedFolders.some(
        (f) =>
          t.libraryRootId === f.libraryRootId &&
          (f.relativePath === '' || t.folderPath === f.relativePath || t.folderPath.startsWith(f.relativePath + '\\'))
      )
    }
    const songs = bestMatches(
      scopedTracks,
      (t) => {
        if (t.isMissing || isBlacklisted(t)) return -1
        let best = matchScore(t.filename, q)
        for (const alias of aliasesByTrack.get(t.id) ?? []) {
          const s = matchScore(alias.aliasText, q)
          if (s >= 0 && (best < 0 || s < best)) best = s
        }
        return best
      },
      (t) => t.filename.length,
      MAX_SONGS
    ).map(({ item, score }): Result => ({ kind: 'song', key: `s${item.id}`, score, track: item }))

    const tagHits = bestMatches(tags, (t) => matchScore(t.name, q), (t) => t.name.length, MAX_TAGS).map(
      ({ item, score }): Result => ({ kind: 'tag', key: `t${item.id}`, score, tag: item, count: tagCounts.get(item.id) ?? 0 })
    )

    const folderHits = bestMatches(
      folders,
      (f) => {
        const leaf = f.label.slice(f.label.lastIndexOf('\\') + 1)
        const leafScore = matchScore(leaf, q)
        if (leafScore >= 0) return leafScore
        const pathScore = matchScore(f.label, q)
        return pathScore >= 0 ? pathScore + 1 : -1
      },
      (f) => f.label.length,
      MAX_FOLDERS
    ).map(({ item, score }): Result => ({ kind: 'folder', key: `f${item.libraryRootId}:${item.relativePath}`, score, folder: item }))

    // Whichever kind has the closest match comes first — typing "terraria" should
    // put the Terraria tag and folder above songs that merely contain the word.
    const sections = [tagHits, folderHits, songs].filter((s) => s.length > 0)
    sections.sort((a, b) => Math.min(...a.map((r) => r.score)) - Math.min(...b.map((r) => r.score)))
    return sections.flat()
  }, [query, scopedTracks, tags, folders, tagCounts, aliasesByTrack, blacklistedWords, blacklistedFolders])

  useEffect(() => setActiveIndex(0), [query])

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  if (!open) return null

  const close = (): void => setOpen(false)

  /** Puts a tag into the search alongside whatever is already there (or takes it out
   *  again if it's already part of it). Keeps the folder when the search is scoped to
   *  one; otherwise searches the whole library, as a plain Enter on a tag does. */
  function addTagToSearch(tagId: number): void {
    const current = useFilterStore.getState().selectedTagIds
    const next = current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]
    useFilterStore.setState(
      scope
        ? { selectedTagIds: next, searchQuery: '' }
        : { activeView: 'library', selectedFolder: null, selectedProjectId: null, selectedTagIds: next, searchQuery: '' }
    )
    const names = next.map((id) => tags.find((t) => t.id === id)?.name).filter(Boolean)
    setStatus(names.length > 0 ? `Searching for: ${names.join(' + ')}` : 'No tags in the search')
  }

  function run(result: Result, shift: boolean, ctrl: boolean): void {
    if (result.kind === 'tag' && ctrl) {
      if (!currentTrack) {
        setStatus('Play a song first to tag it')
        return
      }
      const hasIt = currentTagIds?.has(result.tag.id) ?? false
      if (hasIt) void removeTrackTag(currentTrack.id, result.tag.id)
      else void addTrackTag(currentTrack.id, result.tag.id)
      setStatus(`${hasIt ? 'Removed' : 'Added'} “${result.tag.name}” ${hasIt ? 'from' : 'to'} ${currentTrack.filename}`)
      setQuery('')
      inputRef.current?.focus()
      return
    }
    if (result.kind === 'tag' && shift) {
      addTagToSearch(result.tag.id)
      setStackedTags(true)
      setQuery('')
      inputRef.current?.focus()
      return
    }
    // Having stacked tags, finishing with a plain Enter adds this one and closes,
    // rather than throwing away the ones just built up.
    if (result.kind === 'tag' && stackedTags) {
      if (!useFilterStore.getState().selectedTagIds.includes(result.tag.id)) addTagToSearch(result.tag.id)
      close()
      return
    }
    if (result.kind === 'song') {
      playTrack(result.track)
    } else if (result.kind === 'tag') {
      // Scoped: filter to the tag within the current folder. Everywhere: the whole library.
      useFilterStore.setState(
        scope
          ? { selectedTagIds: [result.tag.id], searchQuery: '' }
          : { activeView: 'library', selectedFolder: null, selectedProjectId: null, selectedTagIds: [result.tag.id], searchQuery: '' }
      )
    } else {
      useFilterStore.getState().setSelectedFolder({
        libraryRootId: result.folder.libraryRootId,
        relativePath: result.folder.relativePath
      })
    }
    close()
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Tab') {
      event.preventDefault()
      if (selectedFolder && activeView === 'library') setSearchEverywhere((v) => !v)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((i) => Math.min(results.length - 1, i + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const result = results[activeIndex]
      if (result) run(result, event.shiftKey, event.ctrlKey || event.metaKey)
    }
  }

  const sectionLabel = (kind: Result['kind']): string => (kind === 'song' ? 'Songs' : kind === 'tag' ? 'Tags' : 'Folders')

  return (
    <div className={styles.backdrop} onMouseDown={close}>
      <div className={styles.panel} onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className={styles.input}
          placeholder="Search songs, tags and folders…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setStatus(null)
          }}
          onKeyDown={handleInputKeyDown}
          spellCheck={false}
        />
        {selectedFolder && activeView === 'library' && (
          <div className={styles.scope}>
            {scope ? (
              <>
                Searching in <span className={styles.scopeName}>{scopeName}</span> · <kbd>Tab</kbd> search everywhere
              </>
            ) : (
              <>
                Searching <span className={styles.scopeName}>everywhere</span> · <kbd>Tab</kbd> search only {scopeName}
              </>
            )}
          </div>
        )}
        <div className={styles.results} ref={listRef}>
          {query.trim() && results.length === 0 && <div className={styles.empty}>No matches</div>}
          {results.map((result, index) => {
            const startsSection = index === 0 || results[index - 1].kind !== result.kind
            return (
              <div key={result.key}>
                {startsSection && <div className={styles.sectionLabel}>{sectionLabel(result.kind)}</div>}
                <div
                  data-index={index}
                  className={`${styles.item} ${index === activeIndex ? styles.itemActive : ''}`}
                  onMouseMove={() => setActiveIndex(index)}
                  onClick={(e) => run(result, e.shiftKey, e.ctrlKey || e.metaKey)}
                >
                  {result.kind === 'song' && (
                    <>
                      <span className={styles.icon}>♪</span>
                      <span className={styles.main}>
                        <span className={styles.name}>{result.track.filename}</span>
                        <span className={styles.sub}>{result.track.folderPath || '(root)'}</span>
                      </span>
                      <span className={styles.meta}>{formatDuration(result.track.durationSeconds)}</span>
                    </>
                  )}
                  {result.kind === 'tag' && (
                    <>
                      <span className={styles.tagDot} style={{ background: tagColorForId(result.tag.id) }} />
                      <span className={styles.main}>
                        <span className={styles.name}>
                          {result.tag.name}
                          {currentTagIds?.has(result.tag.id) && <span className={styles.check}> ✓</span>}
                        </span>
                        <span className={styles.sub}>
                          {result.tag.groupId !== null ? groupNames.get(result.tag.groupId) ?? 'Tag' : 'Tag'} · {result.count}{' '}
                          {result.count === 1 ? 'song' : 'songs'}
                          {selectedTagIds.includes(result.tag.id) && ' · in the search'}
                        </span>
                      </span>
                    </>
                  )}
                  {result.kind === 'folder' && (
                    <>
                      <span className={styles.icon}>
                        <FolderIcon />
                      </span>
                      <span className={styles.main}>
                        <span className={styles.name}>{result.folder.label.slice(result.folder.label.lastIndexOf('\\') + 1)}</span>
                        <span className={styles.sub}>{result.folder.label}</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
        <div className={styles.footer}>
          {status ?? (
            <>
              <kbd>↑</kbd>
              <kbd>↓</kbd> move · <kbd>Enter</kbd> open · <kbd>Shift</kbd>+<kbd>Enter</kbd> tag → add to search ·{' '}
              <kbd>Ctrl</kbd>+<kbd>Enter</kbd> tag → add to song · <kbd>Esc</kbd> close
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default QuickSearch
