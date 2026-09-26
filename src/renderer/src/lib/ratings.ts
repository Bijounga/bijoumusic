export interface FavoriteLevelMeta {
  level: number
  label: string
  cssVar: string
  glyph: string
}

// Ordered highest-to-lowest for UI display (Favorite first).
export const FAVORITE_LEVELS: FavoriteLevelMeta[] = [
  { level: 3, label: 'Favorite', cssVar: '--favorite-level-3', glyph: '★' },
  { level: 2, label: 'Good', cssVar: '--favorite-level-2', glyph: '●' },
  { level: 1, label: 'Situational', cssVar: '--favorite-level-1', glyph: '◐' },
  { level: 0, label: "Don't Use", cssVar: '--favorite-level-0', glyph: '✕' }
]

export const ENERGY_LEVELS = [1, 2, 3, 4, 5]
