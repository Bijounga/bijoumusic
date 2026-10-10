// Pure merge logic for "sync through the cloud folder" — no electron, no database,
// so it can be tested on its own.
//
// Everything a user adds by hand (tags, tag groups, projects, which tags a song
// has, ratings, aliases, bookmarks, project membership) is flattened into one
// map of  key -> value  where songs are named by their content hash (the same on
// every machine, whatever the file path), never by a local row number. Each
// machine writes its own snapshot of that map to its own file in the sync folder
// and merges the other machines' files into its database. One writer per file
// means the cloud drive can never produce a "conflicted copy".
//
// The merge is three-way, per key: local value (L), the other machine's value
// now (R), and what that machine's file said the last time we merged it (B, the
// "base"). That is what makes deletions work — "in B but gone from R" means the
// other machine removed it, which a plain union of two snapshots can't tell
// apart from "never had it".

export type Entries = Record<string, string>

export interface SyncSnapshot {
  version: 1
  machineId: string
  machineName: string
  writtenAt: number
  /** When this machine first took part in syncing. When two machines changed the
   *  same thing, the one that joined first wins (see mergeEntries). */
  startedAt: number
  /** Every content hash this machine's library knows about. A fact about a song
   *  that is missing from the file only counts as "deleted" if the song itself is
   *  listed here — otherwise the machine simply doesn't have that song (yet). */
  tracks: string[]
  entries: Entries
}

/** Normalizes a name into a key (same tag on every machine, any accent form/case). */
export function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

const HASH_KINDS = new Set(['tt', 'al', 'bm', 'rt', 'pt'])

export function kindOf(key: string): string {
  return key.slice(0, key.indexOf('|'))
}

/** The song a key is about, or null for tags / groups / projects themselves. */
export function hashOfKey(key: string): string | null {
  const kind = kindOf(key)
  if (!HASH_KINDS.has(kind)) return null
  if (kind === 'pt') return key.slice(key.lastIndexOf('|') + 1)
  const rest = key.slice(kind.length + 1)
  const bar = rest.indexOf('|')
  return bar < 0 ? rest : rest.slice(0, bar)
}

/** The tag a track-tag key points at ("tt|<hash>|<tagKey>"). */
export function tagKeyOfAssignment(key: string): string {
  const afterKind = key.slice(3)
  return afterKind.slice(afterKind.indexOf('|') + 1)
}

/** The project a project-membership key points at ("pt|<projectKey>|<hash>"). */
export function projectKeyOfMembership(key: string): string {
  return key.slice(3, key.lastIndexOf('|'))
}

function ratingStamp(value: string): number {
  try {
    return (JSON.parse(value) as { u?: number }).u ?? 0
  } catch {
    return 0
  }
}

/** Both sides changed the same thing since they last agreed. Both machines must
 *  reach the same answer or they'd swap values forever, so the choice depends only
 *  on the two values, never on which machine is deciding. */
function resolveConflict(key: string, local: string, remote: string, preferRemote: boolean): string {
  // Ratings carry the time they were set, so the newer one wins.
  if (kindOf(key) === 'rt') {
    const l = ratingStamp(local)
    const r = ratingStamp(remote)
    if (l !== r) return r > l ? remote : local
  }
  return preferRemote ? remote : local
}

export interface MergeInput {
  local: Entries
  remote: Entries
  /** The other machine's entries as of our last merge with it (only the ones we agreed on). */
  base: Entries
  localTracks: ReadonlySet<string>
  remoteTracks: ReadonlySet<string>
  /** Wins ties between two changed values: true when the other machine is the one
   *  that joined syncing first (see preferRemoteMachine). */
  preferRemote: boolean
}

/** Same answer on both machines: the one that joined first (ids break an exact tie). */
export function preferRemoteMachine(
  local: { startedAt: number; machineId: string },
  remote: { startedAt: number; machineId: string }
): boolean {
  if (remote.startedAt !== local.startedAt) return remote.startedAt < local.startedAt
  return remote.machineId < local.machineId
}

export function mergeEntries({ local, remote, base, localTracks, remoteTracks, preferRemote }: MergeInput): Entries {
  const merged: Entries = {}
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)])

  for (const key of keys) {
    const L = local[key]
    const R = remote[key]
    const B = base[key]
    const hash = hashOfKey(key)
    // Can this machine hold a fact about that song / can the other side vouch it's gone?
    const haveSong = hash === null || localTracks.has(hash)
    const remoteKnowsSong = hash === null || remoteTracks.has(hash)

    let value: string | undefined
    if (L === R) {
      value = L
    } else if (R === B) {
      // The other machine hasn't touched this since we last agreed: ours stands
      // (including "we deleted it").
      value = L
    } else if (L === B) {
      // We haven't touched it: take the other machine's version.
      if (R === undefined) value = remoteKnowsSong ? undefined : L
      else value = haveSong ? R : L
    } else if (L === undefined) {
      // We deleted it, they changed it: keeping their change is the safe side.
      value = haveSong ? R : undefined
    } else if (R === undefined) {
      value = L
    } else {
      value = resolveConflict(key, L, R, preferRemote)
    }
    if (value !== undefined) merged[key] = value
  }

  // A tag or project that ended up deleted takes its assignments with it, and an
  // assignment can't point at a tag/project that doesn't exist.
  for (const key of Object.keys(merged)) {
    const kind = kindOf(key)
    if (kind === 'tt' && merged[`t|${tagKeyOfAssignment(key)}`] === undefined) delete merged[key]
    else if (kind === 'pt' && merged[`p|${projectKeyOfMembership(key)}`] === undefined) delete merged[key]
  }
  return merged
}

/** What to remember about the other machine's file after merging it: only things
 *  both sides now agree on (plus deletions we made and they haven't contradicted),
 *  so that anything we couldn't apply yet — a song not scanned here so far — is
 *  still treated as new next time rather than as something we deliberately removed. */
export function nextBase(
  remote: Entries,
  oldBase: Entries,
  localAfter: Entries,
  localTracks: ReadonlySet<string>
): Entries {
  const base: Entries = {}
  for (const [key, value] of Object.entries(remote)) {
    const hash = hashOfKey(key)
    if (hash !== null && !localTracks.has(hash)) continue
    const mine = localAfter[key]
    if (mine === value || (mine === undefined && oldBase[key] === value)) base[key] = value
  }
  return base
}
