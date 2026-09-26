import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipcChannels'
import type { TagGroup, Tag, TrackTagAssignment, TagStorageInfo } from '@shared/types'
import { listTagGroups, createTagGroup, renameTagGroup, deleteTagGroup } from '../db/repositories/tagGroupsRepo'
import {
  listTags,
  createTag,
  renameTag,
  reorderTags,
  deleteTag,
  listAllTrackTagAssignments,
  addTrackTag,
  removeTrackTag,
  moveTagToGroup,
  getTagStorageInfo
} from '../db/repositories/tagsRepo'

export function registerTagsIpc(): void {
  ipcMain.handle(IpcChannels.listTagGroups, (): TagGroup[] => {
    return listTagGroups().map((g) => ({ id: g.id, name: g.name }))
  })

  ipcMain.handle(IpcChannels.createTagGroup, (_event, name: string): TagGroup => {
    const g = createTagGroup(name)
    return { id: g.id, name: g.name }
  })

  ipcMain.handle(IpcChannels.renameTagGroup, (_event, id: number, name: string): void => {
    renameTagGroup(id, name)
  })

  ipcMain.handle(IpcChannels.deleteTagGroup, (_event, id: number): void => {
    deleteTagGroup(id)
  })

  ipcMain.handle(IpcChannels.listTags, (): Tag[] => {
    return listTags().map((t) => ({ id: t.id, name: t.name, groupId: t.group_id }))
  })

  ipcMain.handle(IpcChannels.createTag, (_event, name: string, groupId: number | null): Tag => {
    const t = createTag(name, groupId)
    return { id: t.id, name: t.name, groupId: t.group_id }
  })

  ipcMain.handle(IpcChannels.renameTag, (_event, id: number, name: string): void => {
    renameTag(id, name)
  })

  ipcMain.handle(IpcChannels.reorderTags, (_event, orderedIds: number[]): void => {
    reorderTags(orderedIds)
  })

  ipcMain.handle(IpcChannels.moveTagToGroup, (_event, id: number, groupId: number | null): void => {
    moveTagToGroup(id, groupId)
  })

  ipcMain.handle(IpcChannels.deleteTag, (_event, id: number): void => {
    deleteTag(id)
  })

  ipcMain.handle(IpcChannels.getTagStorageInfo, (_event, id: number): TagStorageInfo => {
    return getTagStorageInfo(id)
  })

  ipcMain.handle(IpcChannels.listAllTrackTagAssignments, (): TrackTagAssignment[] => {
    return listAllTrackTagAssignments().map((a) => ({ trackId: a.track_id, tagId: a.tag_id }))
  })

  ipcMain.handle(IpcChannels.addTrackTag, (_event, trackId: number, tagId: number): void => {
    addTrackTag(trackId, tagId)
  })

  ipcMain.handle(IpcChannels.removeTrackTag, (_event, trackId: number, tagId: number): void => {
    removeTrackTag(trackId, tagId)
  })
}
