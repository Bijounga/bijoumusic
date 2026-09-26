import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipcChannels'
import type { TrackRating } from '@shared/types'
import { listAllRatings, setFavoriteLevel, setEnergyLevel } from '../db/repositories/ratingsRepo'

export function registerRatingsIpc(): void {
  ipcMain.handle(IpcChannels.listAllRatings, (): TrackRating[] => {
    return listAllRatings().map((r) => ({
      trackId: r.track_id,
      favoriteLevel: r.favorite_level,
      energyLevel: r.energy_level
    }))
  })

  ipcMain.handle(IpcChannels.setFavoriteLevel, (_event, trackId: number, level: number | null): void => {
    setFavoriteLevel(trackId, level)
  })

  ipcMain.handle(IpcChannels.setEnergyLevel, (_event, trackId: number, level: number | null): void => {
    setEnergyLevel(trackId, level)
  })
}
