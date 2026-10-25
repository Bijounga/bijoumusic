/** What "Move library folder" found in the new location, before anything changes. */
export interface MoveRootReport {
  oldPath: string
  newPath: string
  total: number
  found: number
  missing: number
  /** A few relative paths that weren't found, to show what's different. */
  missingSamples: string[]
  /** If the picked folder contains a subfolder with the old folder's name, this
   *  is its full path — the usual mistake is picking one level too high. */
  suggestedPath?: string
  error?: string
}

export interface MoveRootResult {
  moved: number
  missing: number
  skippedConflicts: number
  /** Where the safety copy of the database made before the move was saved. */
  backupPath: string
}

/** What was dropped onto a project: song files (as the OS drag reports them) or a
 *  library folder dragged from the sidebar. */
export interface DroppedOnProject {
  paths?: string[]
  folder?: { libraryRootId: number; relativePath: string }
}

export interface DroppedOnProjectResult {
  /** How many of the dropped songs were new to the project. */
  added: number
  /** How many songs the drop contained that the library knows. */
  total: number
}

/** One tag the AI tagger proposes for a song. */
export interface AutoTagSuggestion {
  name: string
  /** 0-1-ish model score and the level at which the model trusts the tag. */
  score: number
  threshold: number
  /** The model is sure enough to apply this one by itself; the rest are offers. */
  confident: boolean
  /** 'game' = the game the filename seems to belong to, offered as a tag if you have one by that name. */
  kind: 'tag' | 'game'
}

export interface AutoTagInfo {
  /** The Music Tagger folder in use, or null when none has been found yet. */
  folder: string | null
}

/** Whether the Premiere panels that ship with the app are installed and current. */
export type PremiereExtState =
  | 'unknown'
  | 'dev'
  | 'not-installed'
  | 'up-to-date'
  | 'updating'
  | 'restart'
  | 'manual'
  | 'error'

export interface PremiereExtStatus {
  state: PremiereExtState
  /** The panel version this app carries. */
  version?: string
  message?: string
}

/** Where syncing tags etc. between machines (through a cloud folder) stands. */
export type SyncState = 'off' | 'unavailable' | 'syncing' | 'ok' | 'error'

export interface SyncStatus {
  state: SyncState
  /** The sync folder, once set up. */
  folder?: string
  lastSyncAt?: number
  /** How many facts the last sync changed on this machine. */
  changed?: number
  message?: string
}

/** Where the app's self-update stands, shown by the logo at the top of the sidebar.
 *  'dev' = running from source, where there's no update feed to check. */
export type UpdateState =
  | 'idle'
  | 'dev'
  | 'checking'
  | 'not-available'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'available-manual'
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  /** The version the running app is. */
  currentVersion: string
  /** The newer version, once one is found. */
  version?: string
  /** 0-100 while downloading, when known. */
  percent?: number
  message?: string
}

/** What the pop-out mini player shows — sent from the main window, which owns
 *  playback, to the mini player window. */
export interface MiniPlayerState {
  track: Track | null
  isPlaying: boolean
  currentTime: number
  duration: number
  /** The main window's theme id, so the mini player always matches it. */
  theme: string
  /** 0 to MAX_VOLUME (2 = 200%). */
  volume: number
}

export type MiniPlayerCommand =
  | { type: 'toggle' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; fraction: number }
  | { type: 'volume'; value: number }

export interface Track {
  id: number
  libraryRootId: number
  contentHash: string
  currentPath: string
  filename: string
  folderPath: string
  extension: string
  durationSeconds: number | null
  fileSizeBytes: number
  addedAt: number
  lastSeenAt: number
  isMissing: boolean
  /** Best-part preview clip range — both null until set from the waveform. */
  previewStartSeconds: number | null
  previewEndSeconds: number | null
  /** Overall RMS level (0-1) from the same decode pass as the waveform peaks, used
   *  for volume normalization. Null until that track's waveform has been generated. */
  loudnessRms: number | null
  /** Tempo in beats per minute. Null until worked out; 0 when the song has no steady
   *  beat (or is too short for one, like a sound effect). */
  bpm: number | null
}

export interface SendToPremierePayload {
  tempFilePath: string
  originalFilePath: string
  /** Range within the original file the temp clip represents — null (send the
   *  temp file as-is, no swap) when the track has no preview range set. */
  trimRange: { start: number; end: number } | null
  /** How long the clip will actually be once placed (trimRange's own span when
   *  set, otherwise the track's known full duration) — null only when that's
   *  genuinely unknown (duration hasn't been computed for this track yet). Lets
   *  the extension check a real time *range* for free space before placing,
   *  not just whether the playhead's exact position happens to be clear. */
  durationSeconds: number | null
}

/** Sent main -> renderer to ask for audio analysis on behalf of a Premiere
 *  selection-tool request — decodeAudioData only exists in the renderer, so the
 *  main process (which owns the Premiere bridge) can't do this analysis itself. */
export interface PremiereAnalyzeRequest {
  requestId: string
  mode: 'silence' | 'lufs'
  /** Raw audio file bytes, read by main so the renderer never needs filesystem
   *  or protocol access to an arbitrary path outside BijouMusic's own library. */
  bytes: Uint8Array
  /** 'lufs' mode only — the loudness target to compute a gain delta against. */
  targetLufs?: number
  /** The clip's current in/out (seconds, relative to the full source file) to
   *  constrain the search to, since the underlying file can be much longer
   *  than what's actually placed on the timeline. */
  searchStart?: number
  searchEnd?: number
  /** 'silence' mode only, both user-configurable in the panel. */
  thresholdDb?: number
  /** Gaps shorter than this are left alone (treated as a natural pause, not a
   *  cut point) rather than chopped out. */
  minSilenceSeconds?: number
}

/** Audible content segments within the searched range, in seconds — everything
 *  between them is silence to be cut out and ripple-closed. Always at least one
 *  segment (falls back to the full search range if nothing crosses threshold). */
export interface PremiereSilenceResult {
  segments: { start: number; end: number }[]
}

export interface PremiereLufsResult {
  measuredLufs: number
  /** dB to add to reach targetLufs — apply directly via the same Volume/Level
   *  gain mechanism the gain buttons use. */
  gainDeltaDb: number
}

export type PremiereAnalyzeResult =
  | { mode: 'silence'; result: PremiereSilenceResult }
  | { mode: 'lufs'; result: PremiereLufsResult }

export interface TrackBookmark {
  id: number
  trackId: number
  positionSeconds: number
  label: string | null
  createdAt: number
}

export interface LibraryRoot {
  id: number
  path: string
  name: string
}

export interface ScanResult {
  added: number
  moved: number
  updated: number
  unchanged: number
  missing: number
  externalTagsApplied: number
  externalTagsCreated: number
  insertedTrackIds: number[]
}

export interface ScanProgressPayload {
  scanned: number
  total: number
  currentFile: string
}

export interface TagGroup {
  id: number
  name: string
}

export interface Tag {
  id: number
  name: string
  groupId: number | null
}

export interface TagStorageInfo {
  dbPath: string
  cachedCount: number
  freshCount: number
}

export interface TrackTagAssignment {
  trackId: number
  tagId: number
}

/** 0=Don't Use, 1=Situational, 2=Good, 3=Favorite */
export interface TrackRating {
  trackId: number
  favoriteLevel: number | null
  energyLevel: number | null
}

export interface Alias {
  id: number
  trackId: number
  aliasText: string
}

export interface DownloadTrackPayload {
  url: string
  libraryRootId: number
  /** '' downloads straight into the root itself. */
  relativePath: string
  /** Embed the source's thumbnail as the mp3's cover art via yt-dlp's own
   *  --embed-thumbnail (muxed in with ffmpeg, no extra dependency). */
  embedThumbnail: boolean
}

export interface VideoInfoPreview {
  thumbnail: string | null
  title: string | null
  error?: string
}

export interface DownloadProgressPayload {
  stage: 'preparing' | 'downloading' | 'scanning'
  percent?: number
  speed?: string
  eta?: string
}

export interface DownloadResult {
  success: boolean
  filePath?: string
  /** The scan that runs right after a successful download creates this track's
   *  row — included so the UI can jump straight to tagging it without the user
   *  having to go find it in the library themselves. */
  trackId?: number
  error?: string
}

export interface Project {
  id: number
  name: string
  createdAt: number
  updatedAt: number
}

export interface ProjectTrackAssignment {
  projectId: number
  trackId: number
}
