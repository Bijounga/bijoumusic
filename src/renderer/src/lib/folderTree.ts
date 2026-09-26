import type { Track, LibraryRoot } from '@shared/types'

export interface FolderNode {
  name: string
  /** Unique React key: `${libraryRootId}::${relativePath}`. */
  path: string
  libraryRootId: number
  /** '' for the root node itself, else a folderPath-relative segment path. */
  relativePath: string
  count: number
  children: FolderNode[]
  /** Set only by filterFolderTree: this node doesn't match the query itself, but a
   *  descendant does, so it must render expanded for the match to be reachable. */
  forceExpanded?: boolean
}

function splitSegments(folderPath: string): string[] {
  if (!folderPath || folderPath === '.') return []
  return folderPath.split(/[\\/]/).filter(Boolean)
}

/**
 * One top-level node per library root (named after the root folder, e.g. "Music",
 * "SFX"), so adding a second root doesn't interleave its subfolders with the first
 * root's — each root is its own collapsible tree, and filtering stays scoped to the
 * right root even if two roots happen to share a subfolder name.
 */
export function buildFolderTree(tracks: Track[], libraryRoots: LibraryRoot[]): FolderNode[] {
  const rootNodes = new Map<number, FolderNode>()
  for (const root of libraryRoots) {
    rootNodes.set(root.id, {
      name: root.name,
      path: `${root.id}::`,
      libraryRootId: root.id,
      relativePath: '',
      count: 0,
      children: []
    })
  }

  for (const track of tracks) {
    const rootNode = rootNodes.get(track.libraryRootId)
    if (!rootNode) continue

    const segments = splitSegments(track.folderPath)
    let node = rootNode
    let relSoFar = ''
    for (const segment of segments) {
      relSoFar = relSoFar ? `${relSoFar}\\${segment}` : segment
      let child = node.children.find((c) => c.name === segment)
      if (!child) {
        child = {
          name: segment,
          path: `${track.libraryRootId}::${relSoFar}`,
          libraryRootId: track.libraryRootId,
          relativePath: relSoFar,
          count: 0,
          children: []
        }
        node.children.push(child)
      }
      node = child
    }
    node.count++
  }

  function finalize(node: FolderNode): number {
    node.children.sort((a, b) => a.name.localeCompare(b.name))
    const childSum = node.children.reduce((sum, c) => sum + finalize(c), 0)
    node.count += childSum
    return node.count
  }

  const result = [...rootNodes.values()]
  result.forEach(finalize)
  return result
}

/**
 * Prunes the tree to folders matching `query` by name, plus their ancestors (so a
 * match stays reachable). A folder whose own name matches is kept whole, with its
 * full subtree untouched — searching "Game" should let you browse everything under
 * Game, not just child folders that also happen to contain "game". A folder that
 * doesn't match but has a matching descendant is kept pruned to only that path, and
 * flagged forceExpanded so the match is visible without the user drilling in manually.
 */
export function filterFolderTree(nodes: FolderNode[], query: string): FolderNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return nodes

  function filterNode(node: FolderNode): FolderNode | null {
    if (node.name.toLowerCase().includes(q)) {
      return node
    }
    const filteredChildren = node.children
      .map(filterNode)
      .filter((c): c is FolderNode => c !== null)
    if (filteredChildren.length === 0) return null
    return { ...node, children: filteredChildren, forceExpanded: true }
  }

  return nodes.map(filterNode).filter((n): n is FolderNode => n !== null)
}

export interface FlatFolderOption {
  libraryRootId: number
  relativePath: string
  label: string
}

/** Flattens the tree (including root nodes themselves) into a searchable flat list
 *  for the folder-keybind picker — "Music\Game\Terraria" style labels. */
export function flattenFolderTree(nodes: FolderNode[]): FlatFolderOption[] {
  const out: FlatFolderOption[] = []
  function walk(node: FolderNode, labelPrefix: string): void {
    const label = labelPrefix ? `${labelPrefix}\\${node.name}` : node.name
    out.push({ libraryRootId: node.libraryRootId, relativePath: node.relativePath, label })
    for (const child of node.children) walk(child, label)
  }
  for (const node of nodes) walk(node, '')
  return out
}
