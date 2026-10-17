import { useEffect, useState } from 'react'
import type { AutoTagSuggestion, Track } from '@shared/types'
import { useTagStore } from '../../state/tagStore'
import styles from './AutoTagPanel.module.css'

type Phase = 'idle' | 'running' | 'review' | 'applied' | 'error'

/** "Auto-tag" for one song: runs the Music Tagger's trained model on it in the
 *  background, then shows what it picked as checkboxes — confident tags ticked,
 *  maybes not — and only adds the ones you leave ticked when you press Add. */
function AutoTagPanel({ track }: { track: Track }): React.JSX.Element {
  const loadTags = useTagStore((s) => s.loadAll)
  const [folder, setFolder] = useState<string | null | undefined>(undefined)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [suggestions, setSuggestions] = useState<AutoTagSuggestion[]>([])
  const [ticked, setTicked] = useState<Set<string>>(new Set())

  useEffect(() => {
    void window.api.autoTagInfo().then((info) => setFolder(info.folder))
  }, [])

  async function findTagger(): Promise<void> {
    try {
      const info = await window.api.autoTagPickFolder()
      setFolder(info.folder)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(err))
    }
  }

  async function run(): Promise<void> {
    setPhase('running')
    setError('')
    setProgress('Starting the tagger… the first song takes about a minute while it loads')
    const stop = window.api.onAutoTagProgress(setProgress)
    try {
      const found = await window.api.autoTagSuggest(track.id)
      setSuggestions(found)
      setTicked(new Set(found.filter((s) => s.confident).map((s) => s.name)))
      setPhase('review')
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, '') : String(err))
      setPhase('error')
    } finally {
      stop()
    }
  }

  async function apply(): Promise<void> {
    await window.api.autoTagApply(track.id, [...ticked])
    await loadTags()
    setPhase('applied')
  }

  function toggle(name: string): void {
    setTicked((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  if (folder === undefined) return <></>

  if (folder === null) {
    return (
      <div className={styles.box}>
        <p className={styles.hint}>Auto-tagging uses your Music Tagger app. BijouMusic couldn't find it.</p>
        <button className={styles.button} onClick={() => void findTagger()}>
          Choose the Music Tagger folder…
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    )
  }

  if (phase === 'idle' || phase === 'error') {
    return (
      <div className={styles.box}>
        <button className={styles.button} onClick={() => void run()} title="Suggests tags with the trained model — you confirm them before they're added">
          ✨ Auto-tag
        </button>
        {phase === 'error' && <p className={styles.error}>{error}</p>}
      </div>
    )
  }

  if (phase === 'running') {
    return (
      <div className={styles.box}>
        <p className={styles.hint}>{progress}</p>
      </div>
    )
  }

  if (phase === 'applied') {
    return (
      <div className={styles.box}>
        <p className={styles.done}>✓ Added {ticked.size} tag{ticked.size === 1 ? '' : 's'}.</p>
      </div>
    )
  }

  const confident = suggestions.filter((s) => s.confident)
  const maybes = suggestions.filter((s) => !s.confident)

  function row(s: AutoTagSuggestion): React.JSX.Element {
    return (
      <label key={`${s.kind}:${s.name}`} className={styles.row}>
        <input type="checkbox" checked={ticked.has(s.name)} onChange={() => toggle(s.name)} />
        <span className={styles.name}>{s.name}</span>
        {s.kind === 'game' && <span className={styles.badge}>game</span>}
        {s.kind === 'tag' && <span className={styles.score}>{Math.round(Math.min(1, s.score / (s.threshold || 1)) * 100)}%</span>}
      </label>
    )
  }

  return (
    <div className={styles.box}>
      {suggestions.length === 0 ? (
        <p className={styles.hint}>The tagger had no suggestions for this song.</p>
      ) : (
        <>
          {confident.length > 0 && <div className={styles.group}>Confident</div>}
          {confident.map(row)}
          {maybes.length > 0 && <div className={styles.group}>Maybe</div>}
          {maybes.map(row)}
          <div className={styles.actions}>
            <button className={styles.button} disabled={ticked.size === 0} onClick={() => void apply()}>
              Add {ticked.size} tag{ticked.size === 1 ? '' : 's'}
            </button>
            <button className={styles.link} onClick={() => setPhase('idle')}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export default AutoTagPanel
