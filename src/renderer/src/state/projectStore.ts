import { create } from 'zustand'
import type { Project } from '@shared/types'
import { useRecentActivityStore } from './recentActivityStore'

interface ProjectState {
  projects: Project[]
  /** projectId -> track ids in it, for "is this track already in project X" checks
   *  and sidebar counts. */
  projectTracks: Map<number, Set<number>>
  /** Ordered track ids for whichever project is currently being browsed. */
  activeProjectTrackIds: number[]
  loadAll: () => Promise<void>
  loadProjectTrackIds: (projectId: number) => Promise<void>
  createProject: (name: string) => Promise<Project>
  renameProject: (id: number, name: string) => Promise<void>
  deleteProject: (id: number) => Promise<void>
  addTrackToProject: (projectId: number, trackId: number) => Promise<void>
  removeTrackFromProject: (projectId: number, trackId: number) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  projectTracks: new Map(),
  activeProjectTrackIds: [],

  loadAll: async () => {
    const [projects, assignments] = await Promise.all([
      window.api.listProjects(),
      window.api.listAllProjectTrackAssignments()
    ])
    const projectTracks = new Map<number, Set<number>>()
    for (const a of assignments) {
      if (!projectTracks.has(a.projectId)) projectTracks.set(a.projectId, new Set())
      projectTracks.get(a.projectId)!.add(a.trackId)
    }
    set({ projects, projectTracks })
  },

  loadProjectTrackIds: async (projectId: number) => {
    const ids = await window.api.listTrackIdsForProject(projectId)
    set({ activeProjectTrackIds: ids })
  },

  createProject: async (name: string) => {
    const project = await window.api.createProject(name.trim())
    await get().loadAll()
    return project
  },

  renameProject: async (id: number, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    await window.api.renameProject(id, trimmed)
    await get().loadAll()
  },

  deleteProject: async (id: number) => {
    await window.api.deleteProject(id)
    await get().loadAll()
  },

  addTrackToProject: async (projectId: number, trackId: number) => {
    await window.api.addTrackToProject(projectId, trackId)
    const projectTracks = new Map(get().projectTracks)
    const set_ = new Set(projectTracks.get(projectId))
    set_.add(trackId)
    projectTracks.set(projectId, set_)
    set({ projectTracks })
    // A track just got "used" in a project — Most Used ranks by this, so refresh it.
    void useRecentActivityStore.getState().loadMostUsed()
  },

  removeTrackFromProject: async (projectId: number, trackId: number) => {
    await window.api.removeTrackFromProject(projectId, trackId)
    const projectTracks = new Map(get().projectTracks)
    const set_ = new Set(projectTracks.get(projectId))
    set_.delete(trackId)
    projectTracks.set(projectId, set_)
    set({
      projectTracks,
      activeProjectTrackIds: get().activeProjectTrackIds.filter((id) => id !== trackId)
    })
    void useRecentActivityStore.getState().loadMostUsed()
  }
}))
