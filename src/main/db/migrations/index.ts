import { sql as migration001 } from './001_init'
import { sql as migration002 } from './002_tag_groups'
import { sql as migration003 } from './003_bookmarks_preview_loudness'
import { sql as migration004 } from './004_settings'
import { sql as migration005 } from './005_tag_order'

export interface Migration {
  version: number
  name: string
  sql: string
}

export const migrations: Migration[] = [
  { version: 1, name: 'init', sql: migration001 },
  { version: 2, name: 'tag_groups', sql: migration002 },
  { version: 3, name: 'bookmarks_preview_loudness', sql: migration003 },
  { version: 4, name: 'settings', sql: migration004 },
  { version: 5, name: 'tag_order', sql: migration005 }
]
