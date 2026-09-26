import { useEffect, useRef, useState } from 'react'
import type { Track } from '@shared/types'
import { useAliasStore } from '../../state/aliasStore'
import { useUiSignalStore } from '../../state/uiSignalStore'
import styles from './AliasEditorPopover.module.css'

function AliasEditorPopover({ track }: { track: Track | null }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [newAlias, setNewAlias] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)
  const newAliasInputRef = useRef<HTMLInputElement>(null)

  const aliasesByTrack = useAliasStore((s) => s.aliasesByTrack)
  const addAlias = useAliasStore((s) => s.addAlias)
  const deleteAlias = useAliasStore((s) => s.deleteAlias)
  const openAliasEditorSignal = useUiSignalStore((s) => s.openAliasEditorSignal)

  const aliases = track ? (aliasesByTrack.get(track.id) ?? []) : []

  // Fired by the "add alias" keybind — opens the popover and focuses the input for
  // the current track, so typing can start immediately.
  useEffect(() => {
    if (openAliasEditorSignal === 0 || !track) return
    setOpen(true)
    // The input doesn't exist until this render commits (the popover was just
    // opened), so focusing has to wait a tick.
    requestAnimationFrame(() => newAliasInputRef.current?.focus())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAliasEditorSignal])

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

  async function submitNewAlias(): Promise<void> {
    if (!track || !newAlias.trim()) return
    await addAlias(track.id, newAlias)
    setNewAlias('')
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <button
        className={`${styles.trigger} ${aliases.length > 0 ? styles.triggerActive : ''}`}
        disabled={!track}
        onClick={() => setOpen((v) => !v)}
      >
        {aliases.length > 0 ? `Aliases (${aliases.length})` : 'Aliases'}
      </button>

      {open && track && (
        <div className={styles.popover}>
          {aliases.length === 0 && (
            <p className={styles.emptyHint}>No aliases yet — add one below, e.g. a nickname you'd actually search for</p>
          )}
          {aliases.map((alias) => (
            <div key={alias.id} className={styles.aliasRow}>
              <span className={styles.aliasLabel}>{alias.aliasText}</span>
              <span className={styles.deleteBtn} onClick={() => void deleteAlias(alias.id, track.id)}>
                ×
              </span>
            </div>
          ))}
          <input
            ref={newAliasInputRef}
            className={styles.newAliasInput}
            placeholder="+ new alias…"
            value={newAlias}
            onChange={(e) => setNewAlias(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNewAlias()
            }}
          />
        </div>
      )}
    </div>
  )
}

export default AliasEditorPopover
