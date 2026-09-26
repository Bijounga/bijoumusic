import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IpcChannels } from '@shared/ipcChannels'
import type {
  AppInfo,
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
  VideoInfoPreview
} from '@shared/types'

const api = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IpcChannels.appInfo),
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
  premiereSaveTempAudio: (trackId: number, bytes: Uint8Array): Promise<string> =>
    ipcRenderer.invoke(IpcChannels.premiereSaveTempAudio, trackId, bytes),
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
  getVideoInfo: (url: string): Promise<VideoInfoPreview> => ipcRenderer.invoke(IpcChannels.getVideoInfo, url)
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
