import { useEffect, useMemo, useState } from 'react'
import type { FolderNode } from '../../lib/folderTree'
import { flattenFolderTree } from '../../lib/folderTree'
import { useKeybindStore, type CustomKeybindAction } from '../../state/keybindStore'
import { useTagStore } from '../../state/tagStore'
import styles from './KeybindsSection.module.css'

const FIXED_KEYBINDS: { label: string; keys: string[] }[] = [
  { label: 'Play / pause', keys: ['Space'] },
  { label: 'Previous / next track', keys: ['↑', '↓'] },
  { label: 'Seek −5s / +5s', keys: ['←', '→'] },
  { label: 'Return to folders', keys: ['Backspace'] }
]

const ACTION_LABELS: Record<CustomKeybindAction, string> = {
  clearTags: 'Clear tags',
  clearAllFilters: 'Clear all filters',
  jumpToFolder: 'Jump to folder…',
  focusAliasInput: 'Add alias to current track',
  applyTag: 'Apply a tag to current track…',
  clearTrackTags: "Clear current track's tags",
  shuffle: 'Play a random track',
  toggleShuffleMode: 'Toggle shuffle mode',
  toggleAutoplay: 'Toggle keep playing',
  openDownloadModal: 'Open download to library',
  setPreviewStart: 'Set in point (preview start)',
  setPreviewEnd: 'Set out point (preview end)',
  toggleDrawRange: 'Toggle draw-range mode'
}

// Actions that need an extra picker step before capturing the key.
const ACTIONS_NEEDING_FOLDER: CustomKeybindAction[] = ['jumpToFolder']
const ACTIONS_NEEDING_TAG: CustomKeybindAction[] = ['applyTag']

function displayKey(code: string): string {
  // KeyboardEvent.code values like "Digit1"/"KeyH" aren't great to show as-is.
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Key')) return code.slice(3)
  return code
}

type WizardStep = 'idle' | 'chooseAction' | 'chooseFolder' | 'chooseTag' | 'awaitingKey'

function KeybindsSection({ folderTree }: { folderTree: FolderNode[] }): React.JSX.Element {
  const binds = useKeybindStore((s) => s.binds)
  const addBind = useKeybindStore((s) => s.addBind)
  const removeBind = useKeybindStore((s) => s.removeBind)
  const rebindKey = useKeybindStore((s) => s.rebindKey)
  const setCapturingKeybind = useKeybindStore((s) => s.setCapturingKeybind)
  const tags = useTagStore((s) => s.tags)

  const [step, setStep] = useState<WizardStep>('idle')
  const [pendingAction, setPendingAction] = useState<CustomKeybindAction | null>(null)
  const [pendingFolder, setPendingFolder] = useState<{
    libraryRootId: number
    relativePath: string
    label: string
  } | null>(null)
  const [pendingTag, setPendingTag] = useState<{ id: number; name: string } | null>(null)
  const [folderQuery, setFolderQuery] = useState('')
  const [tagQuery, setTagQuery] = useState('')
  const [rebindingId, setRebindingId] = useState<string | null>(null)

  const flatFolders = useMemo(() => flattenFolderTree(folderTree), [folderTree])
  const filteredFolders = useMemo(() => {
    const q = folderQuery.trim().toLowerCase()
    if (!q) return flatFolders.slice(0, 30)
    return flatFolders.filter((f) => f.label.toLowerCase().includes(q)).slice(0, 30)
  }, [flatFolders, folderQuery])

  const filteredTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase()
    if (!q) return tags
    return tags.filter((t) => t.name.toLowerCase().includes(q))
  }, [tags, tagQuery])

  const awaitingKey = step === 'awaitingKey' || rebindingId !== null

  useEffect(() => {
    setCapturingKeybind(awaitingKey)
    return () => setCapturingKeybind(false)
  }, [awaitingKey, setCapturingKeybind])

  useEffect(() => {
    if (!awaitingKey) return

    function handleKeyDown(event: KeyboardEvent): void {
      event.preventDefault()
      if (event.code === 'Escape') {
        resetWizard()
        return
      }

      if (rebindingId) {
        rebindKey(rebindingId, event.code)
        setRebindingId(null)
        return
      }

      if (pendingAction === 'jumpToFolder' && pendingFolder) {
        addBind({
          key: event.code,
          action: 'jumpToFolder',
          label: `Jump to ${pendingFolder.label}`,
          folderLibraryRootId: pendingFolder.libraryRootId,
          folderRelativePath: pendingFolder.relativePath
        })
      } else if (pendingAction === 'applyTag' && pendingTag) {
        addBind({
          key: event.code,
          action: 'applyTag',
          label: `Apply "${pendingTag.name}"`,
          tagId: pendingTag.id
        })
      } else if (pendingAction && ACTIONS_NEEDING_FOLDER.indexOf(pendingAction) === -1 && ACTIONS_NEEDING_TAG.indexOf(pendingAction) === -1) {
        addBind({ key: event.code, action: pendingAction, label: ACTION_LABELS[pendingAction] })
      }
      resetWizard()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingKey, rebindingId, pendingAction, pendingFolder, pendingTag])

  function resetWizard(): void {
    setStep('idle')
    setPendingAction(null)
    setPendingFolder(null)
    setPendingTag(null)
    setFolderQuery('')
    setTagQuery('')
    setRebindingId(null)
  }

  return (
    <div>
      <div className={styles.list}>
        {FIXED_KEYBINDS.map((bind) => (
          <div key={bind.label} className={styles.row}>
            <span className={styles.label}>{bind.label}</span>
            <span className={styles.keys}>
              {bind.keys.map((k) => (
                <span key={k} className={styles.key}>
                  {k}
                </span>
              ))}
            </span>
          </div>
        ))}

        {binds.length > 0 && <hr className={styles.divider} />}

        {binds.map((bind) => (
          <div key={bind.id} className={styles.row}>
            <span className={styles.label} title={bind.label}>
              {bind.label}
            </span>
            <span className={styles.keys}>
              <span
                className={`${styles.keyButton} ${rebindingId === bind.id ? styles.keyAwaiting : ''}`}
                onClick={() => {
                  resetWizard()
                  setRebindingId(bind.id)
                }}
                title="Click, then press a new key"
              >
                {rebindingId === bind.id ? '…' : displayKey(bind.key)}
              </span>
              <span className={styles.deleteBtn} onClick={() => removeBind(bind.id)}>
                ×
              </span>
            </span>
          </div>
        ))}
      </div>

      {step === 'idle' && rebindingId === null && (
        <button className={styles.addButton} onClick={() => setStep('chooseAction')}>
          + Add keybind
        </button>
      )}

      {step === 'chooseAction' && (
        <div className={styles.wizard}>
          <p className={styles.wizardStepLabel}>What should this key do?</p>
          <div className={styles.actionOptions}>
            {(Object.keys(ACTION_LABELS) as CustomKeybindAction[]).map((action) => (
              <button
                key={action}
                className={styles.actionOption}
                onClick={() => {
                  setPendingAction(action)
                  if (ACTIONS_NEEDING_FOLDER.indexOf(action) !== -1) setStep('chooseFolder')
                  else if (ACTIONS_NEEDING_TAG.indexOf(action) !== -1) setStep('chooseTag')
                  else setStep('awaitingKey')
                }}
              >
                {ACTION_LABELS[action]}
              </button>
            ))}
          </div>
          <button className={styles.cancelBtn} onClick={resetWizard}>
            Cancel
          </button>
        </div>
      )}

      {step === 'chooseFolder' && (
        <div className={styles.wizard}>
          <p className={styles.wizardStepLabel}>Which folder?</p>
          <input
            className={styles.folderSearchInput}
            placeholder="Search folders…"
            value={folderQuery}
            onChange={(e) => setFolderQuery(e.target.value)}
            autoFocus
          />
          <div className={styles.folderResults}>
            {filteredFolders.map((f) => (
              <div
                key={`${f.libraryRootId}::${f.relativePath}`}
                className={styles.folderOption}
                title={f.label}
                onClick={() => {
                  setPendingFolder(f)
                  setStep('awaitingKey')
                }}
              >
                {f.label}
              </div>
            ))}
          </div>
          <button className={styles.cancelBtn} onClick={resetWizard}>
            Cancel
          </button>
        </div>
      )}

      {step === 'chooseTag' && (
        <div className={styles.wizard}>
          <p className={styles.wizardStepLabel}>Which tag?</p>
          <input
            className={styles.folderSearchInput}
            placeholder="Search tags…"
            value={tagQuery}
            onChange={(e) => setTagQuery(e.target.value)}
            autoFocus
          />
          <div className={styles.folderResults}>
            {filteredTags.length === 0 && <p className={styles.wizardStepLabel}>No tags yet</p>}
            {filteredTags.map((t) => (
              <div
                key={t.id}
                className={styles.folderOption}
                title={t.name}
                onClick={() => {
                  setPendingTag({ id: t.id, name: t.name })
                  setStep('awaitingKey')
                }}
              >
                {t.name}
              </div>
            ))}
          </div>
          <button className={styles.cancelBtn} onClick={resetWizard}>
            Cancel
          </button>
        </div>
      )}

      {step === 'awaitingKey' && (
        <div className={styles.wizard}>
          <p className={styles.awaitingKeyPrompt}>
            Press a key to bind
            {pendingFolder ? ` → ${pendingFolder.label}` : ''}
            {pendingTag ? ` → ${pendingTag.name}` : ''}…
          </p>
          <button className={styles.cancelBtn} onClick={resetWizard}>
            Cancel
          </button>
        </div>
      )}

      {rebindingId !== null && (
        <div className={styles.wizard}>
          <p className={styles.awaitingKeyPrompt}>Press a new key…</p>
          <button className={styles.cancelBtn} onClick={resetWizard}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

export default KeybindsSection
