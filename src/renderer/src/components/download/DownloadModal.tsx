import { useEffect, useMemo, useRef, useState } from 'react'
import type { FolderNode } from '../../lib/folderTree'
import { flattenFolderTree, type FlatFolderOption } from '../../lib/folderTree'
import type { AutoTagBatchItem, DownloadProgressPayload, PlaylistInfo } from '@shared/types'
import { useLibraryStore } from '../../state/libraryStore'
import { useEmbedThumbnailStore } from '../../state/embedThumbnailStore'
import { useTagStore } from '../../state/tagStore'
import TagEditorPopover from '../tags/TagEditorPopover'
import FavoriteSelector from '../favorites/FavoriteSelector'
import EnergySelector from '../favorites/EnergySelector'
import AliasEditorPopover from '../aliases/AliasEditorPopover'
import AutoTagPanel from './AutoTagPanel'
import styles from './DownloadModal.module.css'

interface DownloadModalProps {
  folderTree: FolderNode[]
  onClose: () => void
}

type Status = 'idle' | 'running' | 'done' | 'error'
type ThumbnailStatus = 'idle' | 'loading' | 'found' | 'none'

const THUMBNAIL_LOOKUP_DEBOUNCE_MS = 700

/** A link that points into a playlist (a playlist page, or a video opened from one). */
function hasPlaylist(url: string): boolean {
  return /[?&]list=/.test(url)
}

/** A playlist page itself, as opposed to one video that happens to be in a playlist. */
function isPlaylistPage(url: string): boolean {
  return hasPlaylist(url) && !/[?&]v=/.test(url)
}

function progressLabel(progress: DownloadProgressPayload | null): string {
  if (!progress) return ''
  if (progress.stage === 'preparing') return 'Preparing…'
  if (progress.stage === 'scanning') return 'Adding to your library…'
  const which = progress.item !== undefined && progress.total !== undefined ? `Song ${progress.item} of ${progress.total} · ` : ''
  const pct = progress.percent !== undefined ? `${progress.percent.toFixed(0)}%` : ''
  const speed = progress.speed ? ` · ${progress.speed}` : ''
  const eta = progress.eta ? ` · ETA ${progress.eta}` : ''
  return `${which}Downloading… ${pct}${speed}${eta}`
}

/** Paste a URL, pick a destination folder (searchable, same flattened list the
 *  keybind wizard's folder picker uses), and yt-dlp drops the extracted audio
 *  straight into that folder — a library rescan afterward picks it up like any
 *  other file dropped in manually. */
function DownloadModal({ folderTree, onClose }: DownloadModalProps): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [folderQuery, setFolderQuery] = useState('')
  const [selectedFolder, setSelectedFolder] = useState<FlatFolderOption | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState<DownloadProgressPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resultPath, setResultPath] = useState<string | null>(null)
  const [downloadedTrackId, setDownloadedTrackId] = useState<number | null>(null)
  const [thumbnailStatus, setThumbnailStatus] = useState<ThumbnailStatus>('idle')
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null)
  // Playlists: what the link holds, whether to take all of it, and what came of it.
  const [playlistInfo, setPlaylistInfo] = useState<PlaylistInfo | null>(null)
  const [wholePlaylist, setWholePlaylist] = useState(false)
  const [playlistFolder, setPlaylistFolder] = useState(true)
  const [autoTag, setAutoTag] = useState(true)
  const [taggerFolder, setTaggerFolder] = useState<string | null | undefined>(undefined)
  const [playlistResult, setPlaylistResult] = useState<{ trackIds: number[]; failed: number } | null>(null)
  const [batchPhase, setBatchPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [batchProgress, setBatchProgress] = useState('')
  const [batchItems, setBatchItems] = useState<AutoTagBatchItem[]>([])
  const [batchError, setBatchError] = useState('')
  const loadTags = useTagStore((s) => s.loadAll)

  useEffect(() => {
    void window.api.autoTagInfo().then((info) => setTaggerFolder(info.folder))
  }, [])

  const tracks = useLibraryStore((s) => s.tracks)
  const downloadedTrack = tracks.find((t) => t.id === downloadedTrackId) ?? null

  const embedThumbnail = useEmbedThumbnailStore((s) => s.enabled)
  const toggleEmbedThumbnail = useEmbedThumbnailStore((s) => s.toggle)

  // Debounced lookup: as soon as typing/pasting pauses on a non-empty URL, ask
  // yt-dlp for just the metadata (no download) so a thumbnail preview can show
  // whether this source actually has cover art worth embedding. A request id
  // guards against a slow earlier lookup overwriting a newer one's result.
  const thumbnailRequestId = useRef(0)
  useEffect(() => {
    const trimmed = url.trim()
    setPlaylistInfo(null)
    setWholePlaylist(isPlaylistPage(trimmed))
    if (!trimmed) {
      setThumbnailStatus('idle')
      setThumbnailUrl(null)
      return
    }
    // A playlist page has no single thumbnail to preview - only what it holds.
    const pageOnly = isPlaylistPage(trimmed)
    setThumbnailStatus(pageOnly ? 'none' : 'loading')
    const requestId = ++thumbnailRequestId.current
    const timer = setTimeout(() => {
      if (hasPlaylist(trimmed)) {
        window.api.getPlaylistInfo(trimmed).then((info) => {
          if (thumbnailRequestId.current === requestId) setPlaylistInfo(info)
        })
      }
      if (pageOnly) return
      window.api.getVideoInfo(trimmed).then((info) => {
        if (thumbnailRequestId.current !== requestId) return
        if (info.thumbnail) {
          setThumbnailUrl(info.thumbnail)
          setThumbnailStatus('found')
        } else {
          setThumbnailUrl(null)
          setThumbnailStatus('none')
        }
      })
    }, THUMBNAIL_LOOKUP_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [url])

  const flatFolders = useMemo(() => flattenFolderTree(folderTree), [folderTree])
  const filteredFolders = useMemo(() => {
    const q = folderQuery.trim().toLowerCase()
    if (!q) return flatFolders.slice(0, 30)
    return flatFolders.filter((f) => f.label.toLowerCase().includes(q)).slice(0, 30)
  }, [flatFolders, folderQuery])

  const canDownload = url.trim().length > 0 && selectedFolder !== null && status !== 'running'
  const downloadingPlaylist = wholePlaylist && hasPlaylist(url.trim())

  /** Tags every song the playlist brought in with the Music Tagger, in one run. */
  async function runBatchTagging(trackIds: number[]): Promise<void> {
    setBatchPhase('running')
    setBatchError('')
    setBatchProgress('Starting the tagger… it takes about a minute to load')
    const stop = window.api.onAutoTagProgress(setBatchProgress)
    try {
      setBatchItems(await window.api.autoTagBatch(trackIds))
      await loadTags()
      setBatchPhase('done')
    } catch (err) {
      setBatchError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(err))
      setBatchPhase('error')
    } finally {
      stop()
    }
  }

  function handleDownload(): void {
    if (!selectedFolder) return
    setStatus('running')
    setError(null)
    setProgress({ stage: 'preparing' })

    const unsubscribe = window.api.onDownloadProgress((p) => setProgress(p))

    window.api
      .downloadTrack({
        url: url.trim(),
        libraryRootId: selectedFolder.libraryRootId,
        relativePath: selectedFolder.relativePath,
        embedThumbnail,
        playlist: downloadingPlaylist,
        playlistFolder
      })
      .then(async (result) => {
        if (result.success) {
          // downloadTrack scans main-process side only — the renderer's own
          // track list needs an explicit refresh before the new track can be
          // looked up here to hand to the tag picker.
          const [freshTracks, libraryRoots] = await Promise.all([window.api.listTracks(), window.api.listLibraryRoots()])
          useLibraryStore.setState({ tracks: freshTracks, libraryRoots })

          setStatus('done')
          setResultPath(result.filePath ?? null)
          if (downloadingPlaylist) {
            const trackIds = result.trackIds ?? []
            setPlaylistResult({ trackIds, failed: result.failed ?? 0 })
            if (autoTag && taggerFolder && trackIds.length > 0) void runBatchTagging(trackIds)
          } else {
            setDownloadedTrackId(result.trackId ?? null)
          }
        } else {
          setStatus('error')
          setError(result.error ?? 'Download failed')
        }
      })
      .catch((err) => {
        setStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => unsubscribe())
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>Download to library</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            ×
          </button>
        </div>

        {status !== 'done' && (
          <>
            <label className={styles.label}>URL</label>
            <div className={styles.urlRow}>
              <input
                className={styles.urlInput}
                placeholder="Paste a video/audio URL…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={status === 'running'}
                autoFocus
              />
              <div className={styles.thumbnailBox} title="Whether this source has a thumbnail to embed as cover art">
                {thumbnailStatus === 'loading' && <span className={styles.thumbnailHint}>…</span>}
                {thumbnailStatus === 'none' && <span className={styles.thumbnailHint}>No art</span>}
                {thumbnailStatus === 'found' && thumbnailUrl && (
                  <img className={styles.thumbnailImg} src={thumbnailUrl} alt="Source thumbnail" />
                )}
              </div>
            </div>

            <label className={styles.checkboxRow}>
              <input type="checkbox" checked={embedThumbnail} onChange={toggleEmbedThumbnail} />
              Embed thumbnail as cover art
            </label>

            {hasPlaylist(url.trim()) && (
              <>
                <label className={styles.checkboxRow}>
                  <input
                    type="checkbox"
                    checked={wholePlaylist}
                    onChange={(e) => setWholePlaylist(e.target.checked)}
                    disabled={status === 'running'}
                  />
                  {playlistInfo?.title ? `Download the whole playlist “${playlistInfo.title}”` : 'Download the whole playlist'}
                  {playlistInfo?.count != null ? ` (${playlistInfo.count} songs)` : ''}
                </label>
                {wholePlaylist && (
                  <>
                    <label className={styles.checkboxRow}>
                      <input
                        type="checkbox"
                        checked={playlistFolder}
                        onChange={(e) => setPlaylistFolder(e.target.checked)}
                        disabled={status === 'running'}
                      />
                      Put the songs in a folder named after the playlist
                    </label>
                    {taggerFolder ? (
                      <label className={styles.checkboxRow}>
                        <input
                          type="checkbox"
                          checked={autoTag}
                          onChange={(e) => setAutoTag(e.target.checked)}
                          disabled={status === 'running'}
                        />
                        Auto-tag the songs when they&apos;re downloaded
                      </label>
                    ) : (
                      taggerFolder === null && (
                        <p className={styles.batchNote}>Auto-tagging needs your Music Tagger app, which BijouMusic couldn&apos;t find.</p>
                      )
                    )}
                  </>
                )}
              </>
            )}

            <label className={styles.label}>Destination folder</label>
            <input
              className={styles.folderSearchInput}
              placeholder="Search folders…"
              value={selectedFolder ? selectedFolder.label : folderQuery}
              onChange={(e) => {
                setSelectedFolder(null)
                setFolderQuery(e.target.value)
              }}
              disabled={status === 'running'}
            />
            {!selectedFolder && folderQuery.trim().length > 0 && (
              <div className={styles.folderResults}>
                {filteredFolders.length === 0 && <div className={styles.folderEmpty}>No matching folders</div>}
                {filteredFolders.map((f) => (
                  <div
                    key={`${f.libraryRootId}::${f.relativePath}`}
                    className={styles.folderOption}
                    title={f.label}
                    onClick={() => {
                      setSelectedFolder(f)
                      setFolderQuery('')
                    }}
                  >
                    {f.label}
                  </div>
                ))}
              </div>
            )}

            <button className={styles.downloadBtn} disabled={!canDownload} onClick={handleDownload}>
              {status === 'running'
                ? 'Downloading…'
                : downloadingPlaylist
                  ? `Download playlist${playlistInfo?.count != null ? ` (${playlistInfo.count} songs)` : ''}`
                  : 'Download'}
            </button>

            {status === 'running' && <p className={styles.progressText}>{progressLabel(progress)}</p>}
            {status === 'error' && <p className={styles.errorText}>⚠ {error}</p>}
          </>
        )}

        {status === 'done' && playlistResult && (
          <>
            <p className={styles.successText}>
              ✓ Downloaded {playlistResult.trackIds.length} song{playlistResult.trackIds.length === 1 ? '' : 's'} and added them to your library.
            </p>
            {playlistResult.failed > 0 && (
              <p className={styles.batchNote}>
                {playlistResult.failed} song{playlistResult.failed === 1 ? '' : 's'} couldn&apos;t be downloaded (private, removed or blocked videos).
              </p>
            )}

            {batchPhase === 'running' && <p className={styles.progressText}>{batchProgress}</p>}
            {batchPhase === 'error' && (
              <>
                <p className={styles.errorText}>⚠ {batchError}</p>
                <button className={styles.downloadBtn} onClick={() => void runBatchTagging(playlistResult.trackIds)}>
                  Try auto-tagging again
                </button>
              </>
            )}
            {batchPhase === 'done' && (
              <>
                <p className={styles.successText}>
                  ✓ Tagged {batchItems.filter((i) => i.tags.length > 0).length} of {batchItems.length} songs. Only the tags the model is sure about were added.
                </p>
                <div className={styles.batchList}>
                  {batchItems.map((item) => (
                    <div key={item.trackId} className={styles.batchRow}>
                      <span className={styles.batchName} title={item.filename}>
                        {item.filename}
                      </span>
                      <span className={styles.batchTags}>{item.error ? item.error : item.tags.length > 0 ? item.tags.join(', ') : 'no confident tags'}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <button className={styles.downloadBtn} onClick={onClose} disabled={batchPhase === 'running'}>
              Close
            </button>
          </>
        )}

        {status === 'done' && !playlistResult && (
          <>
            <p className={styles.successText}>✓ Downloaded and added to your library.</p>
            {resultPath && <p className={styles.pathText}>{resultPath}</p>}

            {downloadedTrack && (
              <>
                <label className={styles.label}>Preview</label>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio
                  className={styles.previewPlayer}
                  controls
                  src={`app-audio://t${downloadedTrack.id}`}
                  autoPlay
                />

                <div className={styles.reviewRow}>
                  <EnergySelector track={downloadedTrack} />
                  <FavoriteSelector track={downloadedTrack} />
                </div>

                <div className={styles.tagRow}>
                  <span className={styles.label} style={{ margin: 0 }}>
                    Tag it now
                  </span>
                  <div className={styles.tagRowActions}>
                    <AliasEditorPopover track={downloadedTrack} />
                    <TagEditorPopover track={downloadedTrack} />
                  </div>
                </div>

                <AutoTagPanel track={downloadedTrack} />
              </>
            )}

            <button className={styles.downloadBtn} onClick={onClose}>
              Close
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default DownloadModal
