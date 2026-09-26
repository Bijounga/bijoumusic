export interface AppInfo {
  version: string
  platform: NodeJS.Platform
}

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
