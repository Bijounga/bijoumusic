import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipcChannels'
import type { Project, ProjectTrackAssignment } from '@shared/types'
import {
  listProjects,
  createProject,
  renameProject,
  deleteProject,
  listTrackIdsForProject,
  listAllProjectTrackAssignments,
  addTrackToProject,
  removeTrackFromProject
} from '../db/repositories/projectsRepo'

function toProject(row: { id: number; name: string; created_at: number; updated_at: number }): Project {
  return { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at }
}

export function registerProjectsIpc(): void {
  ipcMain.handle(IpcChannels.listProjects, (): Project[] => {
    return listProjects().map(toProject)
  })

  ipcMain.handle(IpcChannels.createProject, (_event, name: string): Project => {
    return toProject(createProject(name))
  })

  ipcMain.handle(IpcChannels.renameProject, (_event, id: number, name: string): void => {
    renameProject(id, name)
  })

  ipcMain.handle(IpcChannels.deleteProject, (_event, id: number): void => {
    deleteProject(id)
  })

  ipcMain.handle(IpcChannels.listTrackIdsForProject, (_event, projectId: number): number[] => {
    return listTrackIdsForProject(projectId)
  })

  ipcMain.handle(IpcChannels.listAllProjectTrackAssignments, (): ProjectTrackAssignment[] => {
    return listAllProjectTrackAssignments().map((a) => ({ projectId: a.project_id, trackId: a.track_id }))
  })

  ipcMain.handle(IpcChannels.addTrackToProject, (_event, projectId: number, trackId: number): void => {
    addTrackToProject(projectId, trackId)
  })

  ipcMain.handle(IpcChannels.removeTrackFromProject, (_event, projectId: number, trackId: number): void => {
    removeTrackFromProject(projectId, trackId)
  })
}
