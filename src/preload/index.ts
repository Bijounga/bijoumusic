import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels } from '@shared/ipcChannels'
import type {
  Track,
  LibraryRoot,
  ScanResult,
  ScanProgressPayload,
  TagGroup,
  Tag,
  TagStorageInfo,
  TrackTagAssignment,
  TrackRating,
  Alias,
  Project,
  ProjectTrackAssignment,
  TrackBookmark,
  SendToPremierePayload,
  PremiereAnalyzeRequest,
  PremiereAnalyzeResult,
  DownloadTrackPayload,
  DownloadProgressPayload,
  DownloadResult,
  VideoInfoPreview,
  MiniPlayerState,
  MiniPlayerCommand,
  UpdateStatus,
  SyncStatus,
  AutoTagInfo,
  AutoTagSuggestion,
  PremiereExtStatus,
  MoveRootReport,
  MoveRootResult
} from '@shared/types'

const api = {
  pickLibraryFolder: (): Promise<string | null> => ipcRenderer.invoke(IpcChannels.pickLibraryFolder),
  scanLibrary: (rootPath: string): Promise<ScanResult> => ipcRenderer.invoke(IpcChannels.scanLibrary, rootPath),
  scanFolder: (libraryRootId: number, relativePath: string): Promise<ScanResult> =>
    ipcRenderer.invoke(IpcChannels.scanFolder, libraryRootId, relativePath),
  listTracks: (): Promise<Track[]> => ipcRenderer.invoke(IpcChannels.listTracks),
  listLibraryRoots: (): Promise<LibraryRoot[]> => ipcRenderer.invoke(IpcChannels.listLibraryRoots),
  onScanProgress: (callback: (progress: ScanProgressPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgressPayload): void => callback(progress)
    ipcRenderer.on(IpcChannels.scanProgress, listener)
    return () => ipcRenderer.removeListener(IpcChannels.scanProgress, listener)
  },
  onDatabaseRefreshed: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IpcChannels.databaseRefreshed, listener)
    return () => ipcRenderer.removeListener(IpcChannels.databaseRefreshed, listener)
  },
  logPlaybackEvent: (trackId: number, eventType: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.logPlaybackEvent, trackId, eventType),
  getWaveformPeaks: (contentHash: string): Promise<Float32Array | null> =>
    ipcRenderer.invoke(IpcChannels.getWaveformPeaks, contentHash),
  saveWaveformPeaks: (contentHash: string, peaks: Float32Array): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.saveWaveformPeaks, contentHash, peaks),
  updateTrackDuration: (trackId: number, durationSeconds: number): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.updateTrackDuration, trackId, durationSeconds),
  listTagGroups: (): Promise<TagGroup[]> => ipcRenderer.invoke(IpcChannels.listTagGroups),
  createTagGroup: (name: string): Promise<TagGroup> => ipcRenderer.invoke(IpcChannels.createTagGroup, name),
  renameTagGroup: (id: number, name: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.renameTagGroup, id, name),
  deleteTagGroup: (id: number): Promise<void> => ipcRenderer.invoke(IpcChannels.deleteTagGroup, id),
  listTags: (): Promise<Tag[]> => ipcRenderer.invoke(IpcChannels.listTags),
  createTag: (name: string, groupId: number | null): Promise<Tag> =>
    ipcRenderer.invoke(IpcChannels.createTag, name, groupId),
  renameTag: (id: number, name: string): Promise<void> => ipcRenderer.invoke(IpcChannels.renameTag, id, name),
  reorderTags: (orderedIds: number[]): Promise<void> => ipcRenderer.invoke(IpcChannels.reorderTags, orderedIds),
  moveTagToGroup: (id: number, groupId: number | null): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.moveTagToGroup, id, groupId),
  deleteTag: (id: number): Promise<void> => ipcRenderer.invoke(IpcChannels.deleteTag, id),
  getTagStorageInfo: (id: number): Promise<TagStorageInfo> => ipcRenderer.invoke(IpcChannels.getTagStorageInfo, id),
  listAllTrackTagAssignments: (): Promise<TrackTagAssignment[]> =>
    ipcRenderer.invoke(IpcChannels.listAllTrackTagAssignments),
  addTrackTag: (trackId: number, tagId: number): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.addTrackTag, trackId, tagId),
  removeTrackTag: (trackId: number, tagId: number): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.removeTrackTag, trackId, tagId),
  listAllRatings: (): Promise<TrackRating[]> => ipcRenderer.invoke(IpcChannels.listAllRatings),
  setFavoriteLevel: (trackId: number, level: number | null): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.setFavoriteLevel, trackId, level),
  setEnergyLevel: (trackId: number, level: number | null): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.setEnergyLevel, trackId, level),
  listAllAliases: (): Promise<Alias[]> => ipcRenderer.invoke(IpcChannels.listAllAliases),
  addAlias: (trackId: number, aliasText: string): Promise<Alias> =>
    ipcRenderer.invoke(IpcChannels.addAlias, trackId, aliasText),
  deleteAlias: (id: number): Promise<void> => ipcRenderer.invoke(IpcChannels.deleteAlias, id),
  getRecentlyPlayed: (): Promise<number[]> => ipcRenderer.invoke(IpcChannels.getRecentlyPlayed),
  getMostUsed: (): Promise<number[]> => ipcRenderer.invoke(IpcChannels.getMostUsed),
  listProjects: (): Promise<Project[]> => ipcRenderer.invoke(IpcChannels.listProjects),
  createProject: (name: string): Promise<Project> => ipcRenderer.invoke(IpcChannels.createProject, name),
  renameProject: (id: number, name: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.renameProject, id, name),
  deleteProject: (id: number): Promise<void> => ipcRenderer.invoke(IpcChannels.deleteProject, id),
  listTrackIdsForProject: (projectId: number): Promise<number[]> =>
    ipcRenderer.invoke(IpcChannels.listTrackIdsForProject, projectId),
  listAllProjectTrackAssignments: (): Promise<ProjectTrackAssignment[]> =>
    ipcRenderer.invoke(IpcChannels.listAllProjectTrackAssignments),
  addTrackToProject: (projectId: number, trackId: number): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.addTrackToProject, projectId, trackId),
  removeTrackFromProject: (projectId: number, trackId: number): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.removeTrackFromProject, projectId, trackId),
  getAlbumArt: (trackId: number): Promise<string | null> => ipcRenderer.invoke(IpcChannels.getAlbumArt, trackId),
  showInExplorer: (filePath: string): Promise<void> => ipcRenderer.invoke(IpcChannels.showInExplorer, filePath),
  updateTrackLoudness: (trackId: number, rms: number): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.updateTrackLoudness, trackId, rms),
  updateTrackPreviewRange: (trackId: number, start: number | null, end: number | null): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.updateTrackPreviewRange, trackId, start, end),
  listDuplicateGroups: (): Promise<Track[][]> => ipcRenderer.invoke(IpcChannels.listDuplicateGroups),
  findSimilarTracks: (
    targetContentHash: string,
    candidates: { trackId: number; contentHash: string }[]
  ): Promise<{ trackId: number; distance: number }[]> =>
    ipcRenderer.invoke(IpcChannels.findSimilarTracks, targetContentHash, candidates),
  deleteTrackFile: (trackId: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IpcChannels.deleteTrackFile, trackId),
  startTrackDrag: (filePaths: string[]): void => ipcRenderer.send(IpcChannels.startTrackDrag, filePaths),
  listAllBookmarks: (): Promise<TrackBookmark[]> => ipcRenderer.invoke(IpcChannels.listAllBookmarks),
  addBookmark: (trackId: number, positionSeconds: number, label: string | null): Promise<TrackBookmark> =>
    ipcRenderer.invoke(IpcChannels.addBookmark, trackId, positionSeconds, label),
  deleteBookmark: (id: number): Promise<void> => ipcRenderer.invoke(IpcChannels.deleteBookmark, id),
  settingsGetAll: (): Promise<Record<string, string>> => ipcRenderer.invoke(IpcChannels.settingsGetAll),
  settingsSet: (key: string, value: string): Promise<void> => ipcRenderer.invoke(IpcChannels.settingsSet, key, value),
  premierePing: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.premierePing),
  premiereGetStatus: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.premiereGetStatus),
  onPremiereStatusChanged: (callback: (connected: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, connected: boolean): void => callback(connected)
    ipcRenderer.on(IpcChannels.premiereStatusChanged, listener)
    return () => ipcRenderer.removeListener(IpcChannels.premiereStatusChanged, listener)
  },
  premiereSaveTempAudio: (trackId: number, start: number, end: number, bytes: Uint8Array): Promise<string> =>
    ipcRenderer.invoke(IpcChannels.premiereSaveTempAudio, trackId, start, end, bytes),
  premiereSendTrack: (payload: SendToPremierePayload): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IpcChannels.premiereSendTrack, payload),
  premiereExpectDrop: (payload: SendToPremierePayload): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IpcChannels.premiereExpectDrop, payload),
  onPremiereAnalyzeRequest: (callback: (request: PremiereAnalyzeRequest) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: PremiereAnalyzeRequest): void => callback(request)
    ipcRenderer.on(IpcChannels.premiereAnalyzeRequest, listener)
    return () => ipcRenderer.removeListener(IpcChannels.premiereAnalyzeRequest, listener)
  },
  premiereAnalyzeResponse: (requestId: string, result: PremiereAnalyzeResult | null, error?: string): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.premiereAnalyzeResponse, requestId, result, error),
  downloadTrack: (payload: DownloadTrackPayload): Promise<DownloadResult> =>
    ipcRenderer.invoke(IpcChannels.downloadTrack, payload),
  onDownloadProgress: (callback: (progress: DownloadProgressPayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: DownloadProgressPayload): void => callback(progress)
    ipcRenderer.on(IpcChannels.downloadProgress, listener)
    return () => ipcRenderer.removeListener(IpcChannels.downloadProgress, listener)
  },
  getVideoInfo: (url: string): Promise<VideoInfoPreview> => ipcRenderer.invoke(IpcChannels.getVideoInfo, url),
  windowMinimize: (): Promise<void> => ipcRenderer.invoke(IpcChannels.windowMinimize),
  windowToggleMaximize: (): Promise<void> => ipcRenderer.invoke(IpcChannels.windowToggleMaximize),
  windowClose: (): Promise<void> => ipcRenderer.invoke(IpcChannels.windowClose),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.windowIsMaximized),
  miniToggle: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.miniToggle),
  onMiniOpenChanged: (callback: (open: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, open: boolean): void => callback(open)
    ipcRenderer.on(IpcChannels.miniOpenChanged, listener)
    return () => ipcRenderer.removeListener(IpcChannels.miniOpenChanged, listener)
  },
  miniSendState: (state: MiniPlayerState): void => ipcRenderer.send(IpcChannels.miniState, state),
  miniGetState: (): Promise<MiniPlayerState> => ipcRenderer.invoke(IpcChannels.miniGetState),
  onMiniState: (callback: (state: MiniPlayerState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: MiniPlayerState): void => callback(state)
    ipcRenderer.on(IpcChannels.miniState, listener)
    return () => ipcRenderer.removeListener(IpcChannels.miniState, listener)
  },
  miniSendCommand: (command: MiniPlayerCommand): void => ipcRenderer.send(IpcChannels.miniCommand, command),
  onMiniCommand: (callback: (command: MiniPlayerCommand) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: MiniPlayerCommand): void => callback(command)
    ipcRenderer.on(IpcChannels.miniCommand, listener)
    return () => ipcRenderer.removeListener(IpcChannels.miniCommand, listener)
  },
  miniShowMain: (): void => ipcRenderer.send(IpcChannels.miniShowMain),
  miniClose: (): void => ipcRenderer.send(IpcChannels.miniClose),
  perfLog: (line: string): void => ipcRenderer.send(IpcChannels.perfLog, line),
  libraryAnalyzeMoveRoot: (rootId: number, newPath: string): Promise<MoveRootReport> =>
    ipcRenderer.invoke(IpcChannels.libraryAnalyzeMoveRoot, rootId, newPath),
  libraryApplyMoveRoot: (rootId: number, newPath: string): Promise<MoveRootResult> =>
    ipcRenderer.invoke(IpcChannels.libraryApplyMoveRoot, rootId, newPath),
  updateGetStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke(IpcChannels.updateGetStatus),
  updateCheckNow: (): Promise<void> => ipcRenderer.invoke(IpcChannels.updateCheckNow),
  updateInstallNow: (): Promise<void> => ipcRenderer.invoke(IpcChannels.updateInstallNow),
  updateOpenReleases: (): void => ipcRenderer.send(IpcChannels.updateOpenReleases),
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void => callback(status)
    ipcRenderer.on(IpcChannels.updateStatus, listener)
    return () => ipcRenderer.removeListener(IpcChannels.updateStatus, listener)
  },
  /** 'darwin' on a Mac, 'win32' on Windows — for the few places the look differs. */
  platform: process.platform,
  premiereExtGetStatus: (): Promise<PremiereExtStatus> => ipcRenderer.invoke(IpcChannels.premiereExtGetStatus),
  premiereExtInstall: (): Promise<PremiereExtStatus> => ipcRenderer.invoke(IpcChannels.premiereExtInstall),
  onPremiereExtStatus: (callback: (status: PremiereExtStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: PremiereExtStatus): void => callback(status)
    ipcRenderer.on(IpcChannels.premiereExtStatus, listener)
    return () => ipcRenderer.removeListener(IpcChannels.premiereExtStatus, listener)
  },
  autoTagInfo: (): Promise<AutoTagInfo> => ipcRenderer.invoke(IpcChannels.autoTagInfo),
  autoTagPickFolder: (): Promise<AutoTagInfo> => ipcRenderer.invoke(IpcChannels.autoTagPickFolder),
  autoTagSuggest: (trackId: number): Promise<AutoTagSuggestion[]> =>
    ipcRenderer.invoke(IpcChannels.autoTagSuggest, trackId),
  autoTagApply: (trackId: number, names: string[]): Promise<void> =>
    ipcRenderer.invoke(IpcChannels.autoTagApply, trackId, names),
  onAutoTagProgress: (callback: (detail: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, detail: string): void => callback(detail)
    ipcRenderer.on(IpcChannels.autoTagProgress, listener)
    return () => ipcRenderer.removeListener(IpcChannels.autoTagProgress, listener)
  },
  syncGetStatus: (): Promise<SyncStatus> => ipcRenderer.invoke(IpcChannels.syncGetStatus),
  syncSetup: (): Promise<SyncStatus> => ipcRenderer.invoke(IpcChannels.syncSetup),
  syncNow: (): Promise<SyncStatus> => ipcRenderer.invoke(IpcChannels.syncNow),
  onSyncStatus: (callback: (status: SyncStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: SyncStatus): void => callback(status)
    ipcRenderer.on(IpcChannels.syncStatus, listener)
    return () => ipcRenderer.removeListener(IpcChannels.syncStatus, listener)
  },
  onWindowZoomChanged: (callback: (zoom: number) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, zoom: number): void => callback(zoom)
    ipcRenderer.on(IpcChannels.windowZoomChanged, listener)
    return () => ipcRenderer.removeListener(IpcChannels.windowZoomChanged, listener)
  },
  onWindowMaximizedChanged: (callback: (maximized: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, maximized: boolean): void => callback(maximized)
    ipcRenderer.on(IpcChannels.windowMaximizedChanged, listener)
    return () => ipcRenderer.removeListener(IpcChannels.windowMaximizedChanged, listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

export type Api = typeof api
