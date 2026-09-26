import { useEffect, useMemo, useRef, useState } from 'react'
import type { FolderNode } from '../../lib/folderTree'
import { flattenFolderTree } from '../../lib/folderTree'
import { useSearchBlacklistStore } from '../../state/searchBlacklistStore'
import styles from './SearchBlacklistControl.module.css'

interface SearchBlacklistControlProps {
  folderTree: FolderNode[]
}

/** Words/folders that get excluded from *search* results specifically — not from
 *  plain folder browsing, which is a deliberate "show me this folder" action, not
 *  search casting a wide net. Built for the case where a huge folder of SFX (e.g.
 *  a thousand Mario Kart clips) keeps flooding unrelated searches. */
function SearchBlacklistControl({ folderTree }: SearchBlacklistControlProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [newWord, setNewWord] = useState('')
  const [folderQuery, setFolderQuery] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)

  const words = useSearchBlacklistStore((s) => s.words)
  const folders = useSearchBlacklistStore((s) => s.folders)
  const addWord = useSearchBlacklistStore((s) => s.addWord)
  const removeWord = useSearchBlacklistStore((s) => s.removeWord)
  const addFolder = useSearchBlacklistStore((s) => s.addFolder)
  const removeFolder = useSearchBlacklistStore((s) => s.removeFolder)

  const flatFolders = useMemo(() => flattenFolderTree(folderTree), [folderTree])
  const filteredFolders = useMemo(() => {
    const q = folderQuery.trim().toLowerCase()
    if (!q) return []
    return flatFolders
      .filter((f) => f.label.toLowerCase().includes(q))
      .filter((f) => !folders.some((bf) => bf.libraryRootId === f.libraryRootId && bf.relativePath === f.relativePath))
      .slice(0, 20)
  }, [flatFolders, folderQuery, folders])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(event: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false)
    }
    function handleEscape(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  function submitWord(): void {
    if (!newWord.trim()) return
    addWord(newWord)
    setNewWord('')
  }

  const isActive = words.length > 0 || folders.length > 0

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        className={`${styles.trigger} ${isActive ? styles.triggerActive : ''}`}
        onClick={() => setOpen((v) => !v)}
        title="Exclude words or folders from search results"
      >
        Blacklist{isActive ? ` (${words.length + folders.length})` : ''}
      </button>

      {open && (
        <div className={styles.popover}>
          <p className={styles.sectionLabel}>Excluded words</p>
          {words.length > 0 && (
            <div className={styles.chipList}>
              {words.map((word) => (
                <span key={word} className={styles.chip}>
                  {word}
                  <span className={styles.chipRemove} onClick={() => removeWord(word)}>
                    ×
                  </span>
                </span>
              ))}
            </div>
          )}
          <input
            className={styles.textInput}
            placeholder="+ word…"
            value={newWord}
            onChange={(e) => setNewWord(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitWord()
            }}
            onBlur={submitWord}
          />

          <p className={styles.sectionLabel}>Excluded folders</p>
          {folders.length > 0 && (
            <div className={styles.chipList}>
              {folders.map((folder) => (
                <span key={`${folder.libraryRootId}::${folder.relativePath}`} className={styles.chip} title={folder.label}>
                  {folder.label}
                  <span
                    className={styles.chipRemove}
                    onClick={() => removeFolder(folder.libraryRootId, folder.relativePath)}
                  >
                    ×
                  </span>
                </span>
              ))}
            </div>
          )}
          <input
            className={styles.textInput}
            placeholder="Search folders to exclude…"
            value={folderQuery}
            onChange={(e) => setFolderQuery(e.target.value)}
          />
          {filteredFolders.length > 0 && (
            <div className={styles.folderResults}>
              {filteredFolders.map((f) => (
                <div
                  key={`${f.libraryRootId}::${f.relativePath}`}
                  className={styles.folderOption}
                  title={f.label}
                  onClick={() => {
                    addFolder(f)
                    setFolderQuery('')
                  }}
                >
                  {f.label}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SearchBlacklistControl
