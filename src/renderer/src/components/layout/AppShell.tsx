import { useEffect, useMemo, useState } from 'react'
import type { AppInfo } from '@shared/types'
import { useLibraryStore } from '../../state/libraryStore'
import { useFilterStore } from '../../state/filterStore'
import { usePlaybackStore } from '../../state/playbackStore'
import { useTagStore } from '../../state/tagStore'
import { useRatingStore } from '../../state/ratingStore'
import { useAliasStore } from '../../state/aliasStore'
import { useRecentActivityStore } from '../../state/recentActivityStore'
import { useProjectStore } from '../../state/projectStore'
import { useBookmarkStore } from '../../state/bookmarkStore'
import { useDuplicateStore } from '../../state/duplicateStore'
import { useSortStore, type SortBy } from '../../state/sortStore'
import { useVisibleTracks } from '../../state/useVisibleTracks'
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts'
import { useCustomKeybinds } from '../../hooks/useCustomKeybinds'
import { useMediaSession } from '../../hooks/useMediaSession'
import { usePremiereAnalysisResponder } from '../../hooks/usePremiereAnalysisResponder'
import { useBackgroundWaveformGeneration } from '../../audio/useBackgroundWaveformGeneration'
import { usePlaybackBoundaryEnforcer } from '../../hooks/usePlaybackBoundaryEnforcer'
import { useUiSignalStore } from '../../state/uiSignalStore'
import { buildFolderTree, filterFolderTree } from '../../lib/folderTree'
import FolderTree from '../library/FolderTree'
import TrackList from '../library/TrackList'
import NowPlayingBar from '../player/NowPlayingBar'
import WaveformPanel from '../player/WaveformPanel'
import TagSidebarSection from '../tags/TagSidebarSection'
import TagFilterSearch from '../tags/TagFilterSearch'
import DurationFilterControl from './DurationFilterControl'
import SearchBlacklistControl from './SearchBlacklistControl'
import FavoritesSidebarSection from '../favorites/FavoritesSidebarSection'
import EnergySidebarSection from '../favorites/EnergySidebarSection'
import ProjectsSidebarSection from '../projects/ProjectsSidebarSection'
import KeybindsSection from './KeybindsSection'
import DownloadModal from '../download/DownloadModal'
import ReactiveVisualizer from '../player/ReactiveVisualizer'
import AudioAnalyzerPanels from '../player/AudioAnalyzerPanels'
import SidebarSection from './SidebarSection'
import styles from './AppShell.module.css'

const AUTO_RESCAN_INTERVAL_MS = 15 * 60 * 1000

function hasAnyFilterActive(
  selectedFolder: unknown,
  selectedTagIds: unknown[],
  selectedFavoriteLevel: unknown,
  selectedEnergyLevel: unknown,
  searchQuery: string,
  activeView: string,
  minDurationSeconds: unknown,
  maxDurationSeconds: unknown
): boolean {
  return (
    selectedFolder !== null ||
    selectedTagIds.length > 0 ||
    selectedFavoriteLevel !== null ||
    selectedEnergyLevel !== null ||
    searchQuery.trim().length > 0 ||
    activeView !== 'library' ||
    minDurationSeconds !== null ||
    maxDurationSeconds !== null
  )
}

function AppShell(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [collapseSignal, setCollapseSignal] = useState(0)
  const [folderSearchQuery, setFolderSearchQuery] = useState('')
  const [showDownloadModal, setShowDownloadModal] = useState(false)
  const openDownloadModalSignal = useUiSignalStore((s) => s.openDownloadModalSignal)

  useEffect(() => {
    if (openDownloadModalSignal > 0) setShowDownloadModal(true)
  }, [openDownloadModalSignal])

  const tracks = useLibraryStore((s) => s.tracks)
  const libraryRoots = useLibraryStore((s) => s.libraryRoots)
  const isLoadingInitial = useLibraryStore((s) => s.isLoadingInitial)
  const isScanning = useLibraryStore((s) => s.isScanning)
  const scanProgress = useLibraryStore((s) => s.scanProgress)
  const scanError = useLibraryStore((s) => s.scanError)
  const loadError = useLibraryStore((s) => s.loadError)
  const tagImportNote = useLibraryStore((s) => s.tagImportNote)
  const loadInitial = useLibraryStore((s) => s.loadInitial)
  const addFolder = useLibraryStore((s) => s.addFolder)
  const rescanAll = useLibraryStore((s) => s.rescanAll)

  const activeView = useFilterStore((s) => s.activeView)
  const setActiveView = useFilterStore((s) => s.setActiveView)
  const selectedFolder = useFilterStore((s) => s.selectedFolder)
  const setSelectedFolder = useFilterStore((s) => s.setSelectedFolder)
  const selectedTagIds = useFilterStore((s) => s.selectedTagIds)
  const toggleTag = useFilterStore((s) => s.toggleTag)
  const clearTags = useFilterStore((s) => s.clearTags)
  const selectedFavoriteLevel = useFilterStore((s) => s.selectedFavoriteLevel)
  const selectedEnergyLevel = useFilterStore((s) => s.selectedEnergyLevel)
  const clearAllFilters = useFilterStore((s) => s.clearAllFilters)
  const searchQuery = useFilterStore((s) => s.searchQuery)
  const setSearchQuery = useFilterStore((s) => s.setSearchQuery)
  const minDurationSeconds = useFilterStore((s) => s.minDurationSeconds)
  const maxDurationSeconds = useFilterStore((s) => s.maxDurationSeconds)

  const sortBy = useSortStore((s) => s.sortBy)
  const setSortBy = useSortStore((s) => s.setSortBy)
  const sortDirection = useSortStore((s) => s.sortDirection)
  const toggleSortDirection = useSortStore((s) => s.toggleSortDirection)

  const currentTrack = usePlaybackStore((s) => s.currentTrack)
  const playTrack = usePlaybackStore((s) => s.playTrack)

  const tags = useTagStore((s) => s.tags)
  const loadTags = useTagStore((s) => s.loadAll)
  const loadRatings = useRatingStore((s) => s.loadAll)
  const loadAliases = useAliasStore((s) => s.loadAll)
  const loadRecentlyPlayed = useRecentActivityStore((s) => s.loadRecentlyPlayed)
  const loadMostUsed = useRecentActivityStore((s) => s.loadMostUsed)
  const loadProjects = useProjectStore((s) => s.loadAll)
  const loadBookmarks = useBookmarkStore((s) => s.loadAll)
  const loadDuplicates = useDuplicateStore((s) => s.loadDuplicates)

  const visibleTracks = useVisibleTracks()
  useKeyboardShortcuts(visibleTracks)

  const folderTree = useMemo(() => buildFolderTree(tracks, libraryRoots), [tracks, libraryRoots])
  const filteredFolderTree = useMemo(
    () => filterFolderTree(folderTree, folderSearchQuery),
    [folderTree, folderSearchQuery]
  )

  useCustomKeybinds(visibleTracks)
  useMediaSession(visibleTracks)
  useBackgroundWaveformGeneration(tracks)
  usePlaybackBoundaryEnforcer(visibleTracks)
  usePremiereAnalysisResponder()

  useEffect(() => {
    window.api.getAppInfo().then(setAppInfo)
    // Rescan once on open so anything added since the app last ran shows up without
    // a manual click, then keep repeating in the background — rescan() no-ops on its
    // own if a scan is already running, so overlapping ticks can't stack up.
    loadInitial().then(() => rescanAll())
    void loadTags()
    void loadRatings()
    void loadAliases()
    void loadProjects()
    void loadBookmarks()
    const intervalId = setInterval(() => rescanAll(), AUTO_RESCAN_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [loadInitial, rescanAll, loadTags, loadRatings, loadAliases, loadProjects, loadBookmarks])

  // The main process force-reopens its database connection on every window
  // focus (a confirmed-real bug where that connection could otherwise keep
  // reading stale data — see refreshDatabaseConnection in the main process) —
  // this re-fetches everything through the fresh connection so the UI actually
  // reflects it, rather than continuing to show whatever was loaded before.
  useEffect(() => {
    return window.api.onDatabaseRefreshed(() => {
      void loadInitial()
      void loadTags()
      void loadRatings()
      void loadAliases()
      void loadProjects()
      void loadBookmarks()
    })
  }, [loadInitial, loadTags, loadRatings, loadAliases, loadProjects, loadBookmarks])

  const anyFilterActive = hasAnyFilterActive(
    selectedFolder,
    selectedTagIds,
    selectedFavoriteLevel,
    selectedEnergyLevel,
    searchQuery,
    activeView,
    minDurationSeconds,
    maxDurationSeconds
  )

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <SidebarSection title="Download" accentColor="var(--section-download)" storageKey="download">
          <button className={styles.textButton} onClick={() => setShowDownloadModal(true)}>
            Download from URL…
          </button>
        </SidebarSection>

        <SidebarSection title="Library" accentColor="var(--section-library)" storageKey="library">
          <div
            className={`${styles.sidebarItem} ${activeView === 'recentlyPlayed' ? styles.sidebarItemActive : ''}`}
            onClick={() => {
              setActiveView('recentlyPlayed')
              void loadRecentlyPlayed()
            }}
          >
            Recently Played
          </div>
          <div
            className={`${styles.sidebarItem} ${activeView === 'mostUsed' ? styles.sidebarItemActive : ''}`}
            onClick={() => {
              setActiveView('mostUsed')
              void loadMostUsed()
            }}
          >
            Most Used
          </div>
          <div
            className={`${styles.sidebarItem} ${activeView === 'duplicates' ? styles.sidebarItemActive : ''}`}
            onClick={() => {
              setActiveView('duplicates')
              void loadDuplicates()
            }}
          >
            Duplicates
          </div>
        </SidebarSection>

        <SidebarSection title="Favorites" accentColor="var(--section-favorites)" storageKey="favorites">
          <FavoritesSidebarSection />
        </SidebarSection>

        <SidebarSection title="Energy" accentColor="var(--section-energy)" storageKey="energy">
          <EnergySidebarSection />
        </SidebarSection>

        <SidebarSection title="Tags" accentColor="var(--section-tags)" storageKey="tags">
          <TagSidebarSection />
        </SidebarSection>

        <SidebarSection title="Projects" accentColor="var(--section-projects)" storageKey="projects">
          <ProjectsSidebarSection />
        </SidebarSection>

        <SidebarSection
          title="Folders"
          accentColor="var(--section-folders)"
          storageKey="folders"
          extra={
            <button className={styles.textButton} onClick={() => addFolder()} disabled={isScanning}>
              + Add
            </button>
          }
        >
          {libraryRoots.length > 0 && (
            <>
              <input
                className={styles.folderSearchInput}
                placeholder="Find a folder…"
                value={folderSearchQuery}
                onChange={(e) => setFolderSearchQuery(e.target.value)}
              />
              <div
                className={`${styles.sidebarItem} ${selectedFolder === null ? styles.sidebarItemActive : ''}`}
                onClick={() => setSelectedFolder(null)}
              >
                All ({tracks.length})
              </div>
            </>
          )}
          <FolderTree
            nodes={filteredFolderTree}
            collapseSignal={collapseSignal}
            isFiltered={folderSearchQuery.trim().length > 0}
          />
          {libraryRoots.length > 0 && (
            <div className={styles.folderActions}>
              <button className={styles.textButton} disabled={isScanning} onClick={() => rescanAll()}>
                Rescan
              </button>
              <button className={styles.textButton} onClick={() => setCollapseSignal((n) => n + 1)}>
                Collapse all
              </button>
            </div>
          )}
        </SidebarSection>

        <SidebarSection title="Keybinds" accentColor="var(--section-keybinds)" storageKey="keybinds">
          <KeybindsSection folderTree={folderTree} />
        </SidebarSection>
      </aside>

      <div className={styles.search}>
        <input
          className={styles.searchInput}
          placeholder="Search tracks, tags, aliases…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <TagFilterSearch />
        <DurationFilterControl />
        <SearchBlacklistControl folderTree={folderTree} />
        {selectedTagIds.length > 0 && (
          <div className={styles.activeTagChips}>
            {selectedTagIds.map((tagId) => {
              const tag = tags.find((t) => t.id === tagId)
              if (!tag) return null
              return (
                <span key={tagId} className={styles.activeTagChip} onClick={() => toggleTag(tagId)}>
                  {tag.name} ×
                </span>
              )
            })}
            <span className={styles.clearFiltersBtn} onClick={() => clearTags()}>
              Clear tags
            </span>
          </div>
        )}
        {anyFilterActive && (
          <span className={styles.clearFiltersBtn} onClick={() => clearAllFilters()}>
            Clear all filters
          </span>
        )}
        {isScanning && (
          <span className={styles.scanStatus}>
            Scanning… {scanProgress ? `${scanProgress.scanned}/${scanProgress.total}` : ''}
          </span>
        )}
        {scanError && <span className={styles.scanError}>{scanError}</span>}
        {loadError && <span className={styles.scanError}>Couldn't load your library: {loadError}</span>}
        {tagImportNote && <span className={styles.scanStatus}>{tagImportNote}</span>}

        <div className={styles.sortControl} title={activeView !== 'library' ? 'Sort only applies to library browsing' : undefined}>
          <select
            className={styles.sortSelect}
            value={sortBy}
            disabled={activeView !== 'library'}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
          >
            <option value="folder">Folder</option>
            <option value="name">Name</option>
            <option value="recentlyAdded">Recently added</option>
          </select>
          <button
            className={styles.sortDirectionBtn}
            disabled={activeView !== 'library'}
            onClick={() => toggleSortDirection()}
            aria-label={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
            title={sortDirection === 'asc' ? 'Ascending' : 'Descending'}
          >
            {sortDirection === 'asc' ? '↑' : '↓'}
          </button>
        </div>
      </div>

      <main className={styles.list}>
        {isLoadingInitial ? (
          <div className={styles.emptyHint}>Loading your library…</div>
        ) : loadError ? (
          <div className={styles.emptyHint}>Couldn't load your library — see the error above</div>
        ) : tracks.length === 0 && !isScanning ? (
          <div className={styles.emptyHint}>No library scanned yet — click “+ Add” to pick a folder</div>
        ) : (
          <TrackList
            tracks={visibleTracks}
            activeTrackId={currentTrack?.id ?? null}
            onSelectTrack={(track) => playTrack(track)}
          />
        )}
        <AudioAnalyzerPanels track={currentTrack} />
        <ReactiveVisualizer track={currentTrack} />
      </main>

      <footer className={styles.nowPlaying}>
        <div className={styles.waveformArea}>
          <WaveformPanel />
        </div>
        <div className={styles.transportRow}>
          <NowPlayingBar />
          <span className={styles.badge}>
            {appInfo ? `v${appInfo.version} · ${appInfo.platform}` : 'connecting…'}
          </span>
        </div>
      </footer>

      {showDownloadModal && (
        <DownloadModal folderTree={folderTree} onClose={() => setShowDownloadModal(false)} />
      )}
    </div>
  )
}

export default AppShell
