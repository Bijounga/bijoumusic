const ppro = require('premierepro')
const uxp = require('uxp')
const { entrypoints } = uxp

const BRIDGE_URL = 'ws://localhost:8934'
const RECONNECT_DELAY_MS = 2000
const DROP_WATCH_INTERVAL_MS = 500
const DROP_WATCH_TIMEOUT_MS = 20000
// How close (in seconds) a track item's start needs to be to where we asked
// Premiere to place it before we're confident it's the one we just inserted —
// generous enough to absorb frame-boundary rounding, tight enough not to grab a
// neighboring clip.
const MATCH_TOLERANCE_SECONDS = 0.05

let socket = null
let reconnectTimer = null
/** Set by an 'expect-drop' message, cleared once found (or once it times out) —
 *  only one drag is ever in flight at a time, so a fresh expectation simply
 *  replaces whatever was being watched for before. */
let expectedDrop = null

// Requests to BijouMusic — used from THIS panel to trigger the silence-trim/
// LUFS tools, matches the pending/timeout pattern premiereBridge.ts uses for
// requests going the other direction (BijouMusic asking the extension something).
const BRIDGE_REQUEST_TIMEOUT_MS = 25000
const pendingBridgeRequests = new Map()

function sendBridgeRequest(payload) {
  return new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      reject(new Error('Not connected to BijouMusic'))
      return
    }
    const id = crypto.randomUUID()
    const timeout = setTimeout(() => {
      pendingBridgeRequests.delete(id)
      reject(new Error('BijouMusic did not respond in time'))
    }, BRIDGE_REQUEST_TIMEOUT_MS)
    pendingBridgeRequests.set(id, { resolve, reject, timeout })
    socket.send(JSON.stringify({ ...payload, id }))
  })
}

function log(message) {
  const el = document.getElementById('log')
  if (!el) return
  el.textContent += message + '\n'
  el.scrollTop = el.scrollHeight
}

/** Prominent success/error banner near the top of the panel — the detailed
 *  per-step trail still goes to the (now collapsed-by-default) Activity Log
 *  via log(), but a user shouldn't have to open that just to see whether the
 *  button they clicked actually did anything. */
function setLastResult(text, isError) {
  const el = document.getElementById('lastResult')
  if (!el) return
  el.textContent = (isError ? '✗ ' : '✓ ') + text
  el.classList.toggle('error', !!isError)
  el.classList.toggle('ok', !isError)
  el.classList.add('show')
}

function setStatus(connected) {
  const dot = document.getElementById('statusDot')
  const text = document.getElementById('statusText')
  if (dot) dot.classList.toggle('on', connected)
  if (text) text.textContent = connected ? 'Connected to BijouMusic' : 'Not connected — retrying…'
}

function basename(filePath) {
  return filePath.split(/[\\/]/).pop()
}

function stripExtension(name) {
  return name.replace(/\.[^./\\]+$/, '')
}

/** Reads the placement UI — 1-based in the UI (friendlier to read), converted to
 *  the 0-based track index the API expects. */
function getPlacementSetting() {
  const overwriteChecked = document.getElementById('placementModeOverwrite')?.checked
  const trackInput = document.getElementById('trackIndex')
  const oneBasedTrack = trackInput ? parseInt(trackInput.value, 10) : 1
  const trackIndex = Math.max(0, (Number.isFinite(oneBasedTrack) ? oneBasedTrack : 1) - 1)
  return overwriteChecked ? { mode: 'overwrite', trackIndex } : { mode: 'auto' }
}

async function getActiveProjectAndSequence() {
  const proj = await ppro.Project.getActiveProject()
  if (!proj) throw new Error('No active project open in Premiere')
  const sequence = await proj.getActiveSequence()
  if (!sequence) throw new Error('No active sequence — open one in Premiere first')
  return { proj, sequence }
}

/** First audio track with no clip covering [atTime, atTime + durationSeconds), or
 *  one past the last existing track if none — SequenceEditor.createInsertProjectItemAction
 *  creates a new track automatically when handed an index beyond the current count.
 *
 *  durationSeconds may be null (the sending track's duration wasn't known on the
 *  BijouMusic side yet) — in that case this can only check whether the playhead's
 *  exact position is clear, not the clip's full span, so a track that looks empty
 *  here could still have something a bit further along that the placed clip would
 *  reach into. Always pass a real duration when at all possible; this is a
 *  deliberately-accepted fallback, not the normal path. */
async function findEmptyAudioTrackIndex(sequence, atTime, durationSeconds) {
  const rangeEnd = typeof durationSeconds === 'number' && durationSeconds > 0 ? atTime.seconds + durationSeconds : null
  const count = await sequence.getAudioTrackCount()
  for (let i = 0; i < count; i++) {
    const track = await sequence.getAudioTrack(i)
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false)
    let occupied = false
    for (const item of items) {
      const start = await item.getStartTime()
      const end = await item.getEndTime()
      // Two ranges overlap iff each starts before the other ends. With rangeEnd
      // unknown, this degrades to the old point-only check (equivalent to a
      // zero-length range starting at atTime).
      const overlaps = rangeEnd !== null ? atTime.seconds < end.seconds && start.seconds < rangeEnd : atTime.seconds >= start.seconds && atTime.seconds < end.seconds
      if (overlaps) {
        occupied = true
        break
      }
    }
    if (!occupied) return i
  }
  return count
}

/** Imports a file into the project root bin and returns the resulting
 *  ClipProjectItem — importFiles() itself only reports success/failure, not the
 *  item it created, so it's resolved afterward by matching the imported filename
 *  among the bin's contents. */
async function importAndFind(proj, filePath) {
  const rootItem = await proj.getRootItem()
  const before = await rootItem.getItems()
  const beforeIds = new Set(before.map((item) => item.getId()))

  await proj.importFiles([filePath], true, rootItem, false)

  const after = await rootItem.getItems()
  const wantedName = stripExtension(basename(filePath))
  const newItem =
    after.find((item) => !beforeIds.has(item.getId()) && stripExtension(item.name) === wantedName) ||
    after.find((item) => stripExtension(item.name) === wantedName)
  if (!newItem) throw new Error(`Imported "${basename(filePath)}" but couldn't find it in the project afterward`)
  log(`importAndFind: resolved projectItem "${newItem.name}" (id=${newItem.getId()})`)
  // Kept uncast — Adobe's own sample code passes the plain ProjectItem straight into
  // createInsertProjectItemAction/createOverwriteItemAction, never a cast one.
  return newItem
}

/** Renames the imported project item away from the temp file's own name (e.g.
 *  "track-22489-preview.wav", meaningless when browsing the project) to the real
 *  track's filename, so it reads sensibly in the project panel. */
async function renameProjectItem(proj, rawProjectItem, displayName) {
  const clipItem = ppro.ClipProjectItem.cast(rawProjectItem)
  proj.lockedAccess(() => {
    proj.executeTransaction((compoundAction) => {
      compoundAction.addAction(clipItem.createSetNameAction(displayName))
    }, 'BijouMusic: rename imported clip')
  })
}

/** Places projectItem onto the active sequence per the panel's current placement
 *  setting, returns where it landed so the caller can locate the resulting track
 *  item afterward (place actions don't hand back the track item they created).
 *
 *  Heavily logged on purpose: "Invalid parameter" from Premiere's own API is a
 *  generic message that doesn't say which argument or which call it came from, so
 *  each step logs its inputs before acting — the panel log then pinpoints exactly
 *  where a failure happens instead of us guessing again. */
async function placeOnSequence(proj, sequence, projectItem, durationSeconds) {
  const editor = ppro.SequenceEditor.getEditor(sequence)

  const atTime = await sequence.getPlayerPosition()
  const videoTrackCount = await sequence.getVideoTrackCount()
  const audioTrackCount = await sequence.getAudioTrackCount()
  const placement = getPlacementSetting()
  log(
    `placeOnSequence: atTime=${atTime.seconds}s, videoTracks=${videoTrackCount}, audioTracks=${audioTrackCount}, mode=${placement.mode}, durationSeconds=${durationSeconds}`
  )

  const autoTrackIndex =
    placement.mode === 'overwrite' ? null : await findEmptyAudioTrackIndex(sequence, atTime, durationSeconds)
  const audioTrackIndex = placement.mode === 'overwrite' ? placement.trackIndex : autoTrackIndex
  // True whenever the chosen track doesn't exist yet in the sequence — a brand new
  // track is needed either way. This has to apply to BOTH modes: an explicit
  // "overwrite track N" where N is beyond the sequence's current track count is
  // just as much "no such track yet" as auto mode running out of existing tracks.
  // Forcing overwrite mode down the createOverwriteItemAction path regardless
  // (the previous behavior) targeted a track index Premiere doesn't have, which
  // silently landed the clip on whatever track it fell back to instead — the
  // wrong-track bug this fixes.
  const needsNewTrack = audioTrackIndex >= audioTrackCount
  // videoTrackIndex has no real target here (these are audio-only files). 0 is a
  // normal, always-valid track index per Premiere's own sample code — but if the
  // sequence has zero video tracks, index 0 may not count as "past the last track"
  // the same way it does for audio; logged above so that's visible if it matters.
  const videoTrackIndex = 0
  log(
    `placeOnSequence: chosen videoTrackIndex=${videoTrackIndex}, audioTrackIndex=${audioTrackIndex}, needsNewTrack=${needsNewTrack}`
  )

  // Rebuilt via createWithSeconds rather than passed straight through from
  // getPlayerPosition() — Adobe's own sample code only ever hands these actions a
  // TickTime built from TickTime.TIME_ZERO/createWithSeconds, never one obtained
  // indirectly from another async getter, so this rules that difference out too.
  const insertTime = ppro.TickTime.createWithSeconds(atTime.seconds)

  // create*ItemAction() itself requires locked access, not just the commit — it has
  // to be called from inside this same nested lockedAccess/executeTransaction
  // callback (confirmed via Adobe's own sample code), not built ahead of time.
  let stepError = null
  proj.lockedAccess(() => {
    proj.executeTransaction((compoundAction) => {
      // findEmptyAudioTrackIndex already guarantees atTime is clear on the chosen
      // existing track, so overwrite is correct (and never shifts anything else) for
      // both explicit "overwrite track N" and the common auto case. Insert is used
      // ONLY to create a brand-new track — with ripple off, since that new track is
      // empty anyway (nothing on it to shift) and a ripple edit would otherwise still
      // shove every other clip on every other track forward, which is the exact bug
      // this replaced: "sending a track pushes the whole timeline forward."
      let action
      try {
        action = needsNewTrack
          ? editor.createInsertProjectItemAction(projectItem, insertTime, videoTrackIndex, audioTrackIndex, false)
          : editor.createOverwriteItemAction(projectItem, insertTime, videoTrackIndex, audioTrackIndex)
      } catch (err) {
        stepError = 'create*ItemAction threw: ' + (err && err.message ? err.message : err)
        return
      }
      log('placeOnSequence: action object created, adding to transaction')
      try {
        compoundAction.addAction(action)
      } catch (err) {
        stepError = 'addAction threw: ' + (err && err.message ? err.message : err)
      }
    }, 'BijouMusic: place clip')
  })
  if (stepError) {
    log('placeOnSequence: ' + stepError)
    throw new Error(stepError)
  }
  log('placeOnSequence: committed')

  return { audioTrackIndex, atTime }
}

/** Finds the track item that starts at (approximately) atTime on the given audio
 *  track — used right after placing a clip, since the place actions above don't
 *  return a reference to what they created. */
async function findTrackItemAt(sequence, audioTrackIndex, atTime) {
  const track = await sequence.getAudioTrack(audioTrackIndex)
  const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false)
  for (const item of items) {
    const start = await item.getStartTime()
    if (Math.abs(start.seconds - atTime.seconds) < MATCH_TOLERANCE_SECONDS) return item
  }
  return null
}

/** The core non-destructive trim trick: once a trimmed temp clip is sitting on the
 *  sequence, swap its underlying media for the full original file and correct the
 *  clip's in/out to the same range within that longer file — the visible clip
 *  doesn't move or resize, but it's no longer capped at the temp file's length. */
async function swapInOriginal(proj, trackItem, originalFilePath, trimRange) {
  const originalStart = await trackItem.getStartTime()

  const placedProjectItem = ppro.ClipProjectItem.cast(await trackItem.getProjectItem())
  const changed = await placedProjectItem.changeMediaFilePath(originalFilePath, true)
  if (!changed) throw new Error('Premiere would not accept the swap to the original file')

  const inTick = ppro.TickTime.createWithSeconds(trimRange.start)
  const outTick = ppro.TickTime.createWithSeconds(trimRange.end)

  proj.lockedAccess(() => {
    proj.executeTransaction((compoundAction) => {
      compoundAction.addAction(trackItem.createSetInPointAction(inTick))
      compoundAction.addAction(trackItem.createSetOutPointAction(outTick))
    }, 'BijouMusic: swap in original')
  })

  // Setting the in/out points also repositions the clip on the timeline (its start
  // shifts by however much the in point moved into the source) — move it back so it
  // stays exactly where it was placed instead of drifting by the trim's start time.
  const shiftedStart = await trackItem.getStartTime()
  const correction = originalStart.seconds - shiftedStart.seconds
  if (Math.abs(correction) > 0.001) {
    proj.lockedAccess(() => {
      proj.executeTransaction((compoundAction) => {
        compoundAction.addAction(trackItem.createMoveAction(ppro.TickTime.createWithSeconds(correction)))
      }, 'BijouMusic: reposition after trim')
    })
  }
}

/** Button flow: we drive the whole thing — import, place, and (if a trim range was
 *  given) the swap — since nothing was dragged in for Premiere to place itself. */
async function handleSendTrack(message) {
  const { proj, sequence } = await getActiveProjectAndSequence()
  const projectItem = await importAndFind(proj, message.tempFilePath)
  await renameProjectItem(proj, projectItem, basename(message.originalFilePath))
  const { audioTrackIndex, atTime } = await placeOnSequence(proj, sequence, projectItem, message.durationSeconds)

  if (message.trimRange) {
    const trackItem = await findTrackItemAt(sequence, audioTrackIndex, atTime)
    if (!trackItem) throw new Error('Placed the clip but could not find it again to finish setting it up')
    await swapInOriginal(proj, trackItem, message.originalFilePath, message.trimRange)
  }
}

/** Drag flow: BijouMusic already handed the temp file to the OS drag, and the user
 *  drops it wherever they choose — Premiere places it, not us. All this does is
 *  watch for that placed clip to show up and then finish the same swap. */
function watchForDrop(target) {
  const tempName = stripExtension(basename(target.tempFilePath))
  const deadline = Date.now() + DROP_WATCH_TIMEOUT_MS

  async function poll() {
    if (expectedDrop !== target) return // superseded by a newer expectation
    if (Date.now() > deadline) {
      expectedDrop = null
      log('gave up watching for a drop of ' + tempName)
      return
    }

    try {
      const { proj, sequence } = await getActiveProjectAndSequence()
      const count = await sequence.getAudioTrackCount()
      for (let i = 0; i < count; i++) {
        const track = await sequence.getAudioTrack(i)
        const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false)
        for (const item of items) {
          const projectItem = await item.getProjectItem()
          if (projectItem && stripExtension(projectItem.name) === tempName) {
            expectedDrop = null
            await renameProjectItem(proj, projectItem, basename(target.originalFilePath))
            await swapInOriginal(proj, item, target.originalFilePath, target.trimRange)
            log('swapped in the original for dropped ' + tempName)
            return
          }
        }
      }
    } catch (err) {
      log('drop watch error: ' + (err && err.message ? err.message : err))
    }

    setTimeout(poll, DROP_WATCH_INTERVAL_MS)
  }

  poll()
}

// ---------------------------------------------------------------------------
// Selection tools — operate on whatever's currently selected on Premiere's own
// timeline. Pure panel-button actions, no round trip to BijouMusic involved.
// ---------------------------------------------------------------------------

function loadNumberSetting(key, fallback) {
  const raw = localStorage.getItem(key)
  const n = raw === null ? NaN : parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

function saveSetting(key, value) {
  localStorage.setItem(key, String(value))
}

/** All track items in the current selection, video and audio alike — used by
 *  nudge, which applies equally to either. */
async function getSelectedTrackItems(sequence) {
  const selection = await sequence.getSelection()
  return await selection.getTrackItems()
}

/** Same, filtered to just the audio ones — used by gain/pitch, which only make
 *  sense on audio. AudioClipTrackItem is a real exported class, so instanceof
 *  is reliable here (unlike duck-typing on method names, which both video and
 *  audio track items share). */
async function getSelectedAudioClips(sequence) {
  const items = await getSelectedTrackItems(sequence)
  const audioItems = items.filter((item) => item instanceof ppro.AudioClipTrackItem)
  log(`getSelectedAudioClips: ${items.length} selected, ${audioItems.length} audio`)
  return audioItems
}

/** Finds an already-attached effect on the clip whose display name contains any
 *  of the given candidate substrings (tried in order), or resolves the exact
 *  available display name and creates a fresh (not-yet-attached) one if none is
 *  found. Chain/component lookups here are synchronous per Adobe's docs; only
 *  getDisplayName()/creation are async. Multiple candidates because effect names
 *  can't be guessed reliably up front (Premiere's actual dB-gain effect turned
 *  out to be called "Amplify", not "Gain"). */
async function findOrAddAudioEffect(trackItem, nameCandidates) {
  const chain = await trackItem.getComponentChain()
  const count = chain.getComponentCount()
  for (const substring of nameCandidates) {
    for (let i = 0; i < count; i++) {
      const comp = chain.getComponentAtIndex(i)
      const name = await comp.getDisplayName()
      if (name && name.toLowerCase().includes(substring)) {
        return { chain, component: comp, added: false, effectName: name }
      }
    }
  }
  const available = await ppro.AudioFilterFactory.getDisplayNames()
  let exact = null
  for (const substring of nameCandidates) {
    exact = available.find((n) => n.toLowerCase().includes(substring))
    if (exact) break
  }
  if (!exact) {
    throw new Error(`No audio effect matching ${JSON.stringify(nameCandidates)} (available: ${available.join(', ')})`)
  }
  const newComponent = await ppro.AudioFilterFactory.createComponentByDisplayName(exact, trackItem)
  return { chain, component: newComponent, added: true, effectName: exact }
}

/** First param whose display name contains one of the given substrings (tried
 *  in order); if none match by name, falls back to the first param that accepts
 *  testValue as a keyframe value (createKeyframe throws on a type mismatch, so
 *  this is a safe way to find "a numeric param" without knowing its exact name). */
function findUsableParam(component, nameSubstrings, testValue) {
  const count = component.getParamCount()
  for (const substring of nameSubstrings) {
    for (let i = 0; i < count; i++) {
      const param = component.getParam(i)
      if (param.displayName && param.displayName.toLowerCase().includes(substring)) return param
    }
  }
  for (let i = 0; i < count; i++) {
    const param = component.getParam(i)
    try {
      param.createKeyframe(testValue)
      return param
    } catch {
      // Not a compatible numeric param, try the next one.
    }
  }
  return null
}

/** All of a component's param display names, comma-joined — logged before every
 *  gain/pitch attempt so a wrong pick is diagnosable from the log alone instead
 *  of needing another round trip with a screenshot of Premiere's own effect UI. */
function describeComponentParams(component) {
  const count = component.getParamCount()
  const names = []
  for (let i = 0; i < count; i++) {
    names.push(component.getParam(i).displayName)
  }
  return names.join(', ')
}

/** getValueAtTime() doesn't return a plain number/string/boolean the way its
 *  own docs describe — confirmed by testing, it returns an object wrapping the
 *  real value in a `.value` property (e.g. {value: 0.1778...}). Adding that
 *  object straight to a number silently coerces it to a string via default
 *  toString(), which is what "Illegal Parameter type" downstream turned out to
 *  be — the actual value never got extracted in the first place. */
function extractParamValue(raw) {
  if (raw && typeof raw === 'object' && 'value' in raw) return raw.value
  return raw
}

/** Volume's "Level" param is a linear amplitude multiplier (1.0 = unity/0dB),
 *  not decibels — confirmed by reading an unmodified clip's Level back as
 *  0.1778, which is exactly 10^(-15/20): -15.0dB by the standard linear-to-dB
 *  conversion, matching exactly the clamp boundary this was hitting (any +delta
 *  clamped to +15dB, any -delta to -Infinity) because dB-sized deltas were
 *  being added directly to a linear value. dbFloor guards the -Infinity case
 *  (silence) so a delta can still recover from it instead of staying stuck. */
const SILENCE_DB_FLOOR = -60
function linearToDb(linear) {
  if (!(linear > 0)) return SILENCE_DB_FLOOR
  return 20 * Math.log10(linear)
}
function dbToLinear(db) {
  return Math.pow(10, db / 20)
}

/** A component fresh out of AudioFilterFactory.createComponentByDisplayName()
 *  comes back as an AudioFilterComponent — which, confirmed by direct testing
 *  (not just the docs, which are ambiguous here), exposes none of Component's
 *  methods: getParam/getParamCount aren't callable on it yet. Only a component
 *  read back from the chain via getComponentAtIndex() has those. So a newly
 *  added effect has to be attached (committed) first, then re-fetched from its
 *  own chain, before its params are usable. Mutates each added entry's
 *  `component` in place with the re-fetched, now-usable one. */
function attachPendingEffects(proj, found, transactionLabel) {
  const toAttach = found.filter((f) => f.added)
  if (toAttach.length === 0) return

  let attachError = null
  proj.lockedAccess(() => {
    proj.executeTransaction((compoundAction) => {
      for (const f of toAttach) {
        try {
          compoundAction.addAction(f.chain.createAppendComponentAction(f.component))
        } catch (err) {
          attachError = (attachError ? attachError + '; ' : '') + (err && err.message ? err.message : String(err))
        }
      }
    }, transactionLabel)
  })
  if (attachError) log('attachPendingEffects: ' + attachError)

  for (const f of toAttach) {
    const count = f.chain.getComponentCount()
    f.component = f.chain.getComponentAtIndex(count - 1)
  }
}

/** Applies each clipDelta's deltaDb to its own Volume/Level — the same
 *  underlying value Premiere's own right-click "Audio Gain..." dialog edits
 *  (its "Adjust Gain by" mode is exactly this: current value + delta), rather
 *  than a separate Amplify effect stacked on top. "Volume" is intrinsic to
 *  every audio clip (never needs adding), so this reads as directly as
 *  possible in Premiere's own UI — check it via that same dialog. Shared by
 *  the flat-delta gain buttons and LUFS normalize (whose delta is computed per
 *  clip from analysis instead of being the same for all of them). Each clip is
 *  prepared independently and a bad one is skipped (logged) rather than
 *  aborting the whole batch; all successful ones share one transaction so the
 *  batch still undoes in a single step. */
async function applyGainDeltasToClips(proj, clipDeltas, logPrefix) {
  const found = []
  for (const { trackItem, deltaDb } of clipDeltas) {
    try {
      const result = await findOrAddAudioEffect(trackItem, ['volume', 'amplify', 'gain'])
      found.push({ ...result, deltaDb })
    } catch (err) {
      log(`${logPrefix}: skipping a clip - ` + (err && err.message ? err.message : err))
    }
  }
  if (found.length === 0) throw new Error('Could not find Volume on any selected clip - see log above for why')

  attachPendingEffects(proj, found, 'BijouMusic: add gain effect')

  const prepared = []
  for (const f of found) {
    try {
      log(`${logPrefix}: "${f.effectName}"${f.added ? ' (newly added)' : ''} params: ${describeComponentParams(f.component)}`)
      const param = findUsableParam(f.component, ['level', 'amplif', 'gain', 'db'], 0)
      if (!param) {
        log(`${logPrefix}: "${f.effectName}" has no usable numeric param, skipping a clip`)
        continue
      }
      const isLinearLevel = param.displayName && param.displayName.toLowerCase().includes('level')
      let currentDb = 0
      if (!f.added) {
        try {
          const raw = extractParamValue(await param.getValueAtTime(ppro.TickTime.TIME_ZERO))
          currentDb = isLinearLevel ? linearToDb(raw) : raw
        } catch (err) {
          log(`${logPrefix}: getValueAtTime failed, assuming 0dB: ` + (err && err.message ? err.message : err))
        }
      }
      const newDb = currentDb + f.deltaDb
      const newValue = isLinearLevel ? dbToLinear(newDb) : newDb
      log(`${logPrefix}: using "${param.displayName}", currentDb=${currentDb.toFixed(2)}, newDb=${newDb.toFixed(2)}`)
      prepared.push({ param, newValue })
    } catch (err) {
      log(`${logPrefix}: skipping a clip - ` + (err && err.message ? err.message : err))
    }
  }
  if (prepared.length === 0) throw new Error('Could not apply gain to any selected clip - see log above for why')

  let stepError = null
  proj.lockedAccess(() => {
    proj.executeTransaction((compoundAction) => {
      for (const p of prepared) {
        try {
          // Explicitly pin to non-time-varying — passing a Keyframe into
          // createSetValueAction alone was leaving the param's stopwatch/keyframe
          // toggle switched on in Effect Controls even though the docs describe
          // that call as being for the non-time-varying case.
          compoundAction.addAction(p.param.createSetTimeVaryingAction(false))
          const keyframe = p.param.createKeyframe(p.newValue)
          compoundAction.addAction(p.param.createSetValueAction(keyframe, true))
        } catch (err) {
          stepError = (stepError ? stepError + '; ' : '') + (err && err.message ? err.message : String(err))
        }
      }
    }, 'BijouMusic: adjust gain')
  })
  if (stepError) throw new Error(stepError)
  return prepared.length
}

/** The flat gain buttons: same deltaDb for every selected audio clip. */
async function applyGainToSelection(proj, sequence, deltaDb) {
  const clips = await getSelectedAudioClips(sequence)
  if (clips.length === 0) throw new Error('No audio clips selected in Premiere')
  const clipDeltas = clips.map((trackItem) => ({ trackItem, deltaDb }))
  return applyGainDeltasToClips(proj, clipDeltas, 'applyGainToSelection')
}

/** Converts a desired pitch shift in semitones to the value Pitch Shifter's
 *  "Transpose Ratio" param actually expects. Confirmed by direct calibration
 *  (setting raw values 0, 0.5, 1, 2 and reading back what Premiere's own Clip Fx
 *  Editor displayed): the param is NOT a musical ratio despite its name and its
 *  0.5-2.0-looking UI "Ratio" readout — it's a normalized 0-1 slider position
 *  that Premiere linearly maps to a displayed ratio of 0.5 (=-12 semitones) at 0
 *  to 2.0 (=+12 semitones) at 1, clamping outside that. Data: raw=0 -> -12st/
 *  ratio 0.5; raw=0.5 -> +3.86st/ratio 1.25 (matches 0.5+0.5*1.5 exactly); raw=1
 *  -> +12st/ratio 2.0; raw=2 -> same as raw=1 (clamped). So: displayedRatio =
 *  2^(semitones/12), then rawParam = (displayedRatio - 0.5) / 1.5, clamped to
 *  [0, 1]. This is the actual bug behind pitch always landing on ±12 — earlier
 *  attempts sent either raw semitone numbers or the correct musical ratio
 *  directly, both of which are out of this param's real 0-1 domain. */
function semitonesToTransposeRatioParam(semitones) {
  const displayedRatio = Math.pow(2, semitones / 12)
  const raw = (displayedRatio - 0.5) / 1.5
  return Math.max(0, Math.min(1, raw))
}

/** Removes every component on trackItem's chain whose display name matches one
 *  of nameCandidates. Used right before adding a fresh effect to guarantee a
 *  clean slate rather than inheriting whatever value/keyframe state a prior
 *  (possibly-broken) attempt left behind. */
async function removeMatchingEffects(proj, trackItem, nameCandidates) {
  const chain = await trackItem.getComponentChain()
  const count = chain.getComponentCount()
  const toRemove = []
  for (let i = 0; i < count; i++) {
    const comp = chain.getComponentAtIndex(i)
    const name = await comp.getDisplayName()
    if (name && nameCandidates.some((s) => name.toLowerCase().includes(s))) {
      toRemove.push(comp)
    }
  }
  if (toRemove.length === 0) return

  let removeError = null
  proj.lockedAccess(() => {
    proj.executeTransaction((compoundAction) => {
      for (const comp of toRemove) {
        try {
          compoundAction.addAction(chain.createRemoveComponentAction(comp))
        } catch (err) {
          removeError = (removeError ? removeError + '; ' : '') + (err && err.message ? err.message : String(err))
        }
      }
    }, 'BijouMusic: remove stale effect')
  })
  if (removeError) log('removeMatchingEffects: ' + removeError)
}

/** Gives every selected audio clip an independent random pitch shift within
 *  ±rangeSemitones — each clip gets its own independent random draw. Same
 *  skip-a-bad-clip-and-continue approach as applyGainToSelection; reuses an
 *  existing Pitch Shifter on the clip rather than adding a duplicate. */
async function randomizePitchOnSelection(proj, sequence, rangeSemitones) {
  const clips = await getSelectedAudioClips(sequence)
  if (clips.length === 0) throw new Error('No audio clips selected in Premiere')

  const found = []
  for (const trackItem of clips) {
    try {
      found.push(await findOrAddAudioEffect(trackItem, ['pitch shifter', 'pitch']))
    } catch (err) {
      log('randomizePitchOnSelection: skipping a clip - ' + (err && err.message ? err.message : err))
    }
  }
  if (found.length === 0) {
    throw new Error('Could not find/add Pitch Shifter on any selected clip - see log above for why')
  }

  attachPendingEffects(proj, found, 'BijouMusic: add Pitch Shifter effect')

  const prepared = []
  for (const f of found) {
    try {
      log(
        `randomizePitchOnSelection: "${f.effectName}"${f.added ? ' (newly added)' : ''} params: ${describeComponentParams(f.component)}`
      )
      const randomSemitones = (Math.random() * 2 - 1) * rangeSemitones
      const param = findUsableParam(f.component, ['ratio', 'transpose', 'semi', 'cents'], 0.5)
      if (!param) {
        log(`randomizePitchOnSelection: "${f.effectName}" has no usable numeric param, skipping a clip`)
        continue
      }
      const isRatio = param.displayName && param.displayName.toLowerCase().includes('ratio')
      const newValue = isRatio ? semitonesToTransposeRatioParam(randomSemitones) : randomSemitones
      log(`randomizePitchOnSelection: using param "${param.displayName}", value=${newValue.toFixed(4)}`)
      prepared.push({ param, newValue })
    } catch (err) {
      log('randomizePitchOnSelection: skipping a clip - ' + (err && err.message ? err.message : err))
    }
  }
  if (prepared.length === 0) {
    throw new Error('Could not randomize pitch on any selected clip - see log above for why')
  }

  let stepError = null
  proj.lockedAccess(() => {
    proj.executeTransaction((compoundAction) => {
      for (const p of prepared) {
        try {
          // See applyGainToSelection's matching line — pins the param to a flat
          // value instead of leaving a stray keyframe/stopwatch toggle behind.
          compoundAction.addAction(p.param.createSetTimeVaryingAction(false))
          const keyframe = p.param.createKeyframe(p.newValue)
          compoundAction.addAction(p.param.createSetValueAction(keyframe, true))
        } catch (err) {
          stepError = (stepError ? stepError + '; ' : '') + (err && err.message ? err.message : String(err))
        }
      }
    }, 'BijouMusic: randomize pitch')
  })
  if (stepError) throw new Error(stepError)
  return prepared.length
}

/** Debug-only: sets the first selected audio clip's Transpose Ratio to exactly
 *  rawValue, no conversion at all. Used to empirically pin down what Premiere's
 *  Pitch Shifter actually does with this param — sending correctly-converted
 *  musical ratios (0.5-2.0) hasn't produced matching displayed semitone values,
 *  so the plan is: try a few round numbers here, read what Semi-tones/Cents/
 *  Ratio show in Premiere's own Clip Fx Editor, and derive the real transfer
 *  function from those data points instead of guessing at it. */
async function setRawTransposeRatio(proj, sequence, rawValue) {
  const clips = await getSelectedAudioClips(sequence)
  if (clips.length === 0) throw new Error('No audio clips selected in Premiere')
  const trackItem = clips[0]

  await removeMatchingEffects(proj, trackItem, ['pitch shifter', 'pitch'])
  const result = await findOrAddAudioEffect(trackItem, ['pitch shifter', 'pitch'])
  attachPendingEffects(proj, [result], 'BijouMusic: add Pitch Shifter effect')

  log(`setRawTransposeRatio: "${result.effectName}" params: ${describeComponentParams(result.component)}`)
  const param = findUsableParam(result.component, ['ratio', 'transpose'], rawValue)
  if (!param) throw new Error('No Transpose Ratio-like param found - see log above for the full param list')
  log(`setRawTransposeRatio: writing ${rawValue} to "${param.displayName}"`)

  let stepError = null
  proj.lockedAccess(() => {
    proj.executeTransaction((compoundAction) => {
      try {
        compoundAction.addAction(param.createSetTimeVaryingAction(false))
        const keyframe = param.createKeyframe(rawValue)
        compoundAction.addAction(param.createSetValueAction(keyframe, true))
      } catch (err) {
        stepError = err && err.message ? err.message : String(err)
      }
    }, 'BijouMusic: debug set raw ratio')
  })
  if (stepError) throw new Error(stepError)
}

/** Shifts every selected clip (video or audio) by deltaSeconds — positive is
 *  later, negative is earlier. One transaction, one undo step for the batch.
 *  Moves the WHOLE selection together, preserving relative positions — for
 *  spacing overlapping clips apart from each other, see staggerSelection. */
async function nudgeSelection(proj, sequence, deltaSeconds) {
  const items = await getSelectedTrackItems(sequence)
  if (items.length === 0) throw new Error('No clips selected in Premiere')

  let stepError = null
  proj.lockedAccess(() => {
    proj.executeTransaction((compoundAction) => {
      try {
        for (const item of items) {
          compoundAction.addAction(item.createMoveAction(ppro.TickTime.createWithSeconds(deltaSeconds)))
        }
      } catch (err) {
        stepError = err && err.message ? err.message : String(err)
      }
    }, 'BijouMusic: nudge selection')
  })
  if (stepError) throw new Error(stepError)
  return items.length
}

/** Spreads overlapping/stacked selected clips apart — sorted by current start
 *  time (track index as a tiebreaker for clips stacked at the same position),
 *  the first stays put and each one after it gets pushed an additional
 *  stepSeconds further than the last. Built for separating duplicated SFX that
 *  land on top of each other after a batch import. */
async function staggerSelection(proj, sequence, stepSeconds) {
  const items = await getSelectedTrackItems(sequence)
  if (items.length < 2) throw new Error('Select 2 or more clips to stagger')

  const withTimes = []
  for (const item of items) {
    const start = await item.getStartTime()
    const trackIndex = await item.getTrackIndex()
    withTimes.push({ item, start: start.seconds, trackIndex })
  }
  withTimes.sort((a, b) => a.start - b.start || a.trackIndex - b.trackIndex)

  let stepError = null
  proj.lockedAccess(() => {
    proj.executeTransaction((compoundAction) => {
      withTimes.forEach((entry, index) => {
        if (index === 0) return
        try {
          compoundAction.addAction(entry.item.createMoveAction(ppro.TickTime.createWithSeconds(stepSeconds * index)))
        } catch (err) {
          stepError = (stepError ? stepError + '; ' : '') + (err && err.message ? err.message : String(err))
        }
      })
    }, 'BijouMusic: stagger selection')
  })
  if (stepError) throw new Error(stepError)
  return withTimes.length
}

/** Grows every selected clip's in/out by paddingSeconds on both ends, rippling
 *  everything after to make room — a general-purpose "give this a bit more
 *  breathing room" tool, useful for softening clips that Cut Silence trimmed
 *  a little too tight.
 *
 *  Selected clips are grouped by track, then split into maximal runs of
 *  clips that are both selected AND actually touching in the original layout
 *  (confirmed by position, not object reference — UXP doesn't reliably return
 *  the same reference for the same clip across separate queries). Within a
 *  run, every internal junction gets the FULL padding on both sides — clip[i]
 *  commits to extending its out-edge by the full amount, and clip[i+1]
 *  commits to extending its in-edge by the full amount, with clip[i+1] (and
 *  everything after it in the run) shifted later to absorb both extensions
 *  without overlapping. Only the run's own outer edges are clamped to
 *  whatever real room exists before/after it (a genuine gap, or nothing) —
 *  exactly like a lone clip would be. This is what makes it an actual ripple
 *  instead of the earlier version, which clamped every internal junction to
 *  zero since a back-to-back layout never has room to grow into without one. */
async function extendEdgesOnSelection(proj, sequence, paddingSeconds) {
  const selectedClips = await getSelectedAudioClips(sequence)
  if (selectedClips.length === 0) throw new Error('No audio clips selected in Premiere')

  const selectedFingerprints = new Set()
  const trackIndicesInvolved = new Set()
  for (const trackItem of selectedClips) {
    const start = await trackItem.getStartTime()
    const end = await trackItem.getEndTime()
    const trackIndex = await trackItem.getTrackIndex()
    selectedFingerprints.add(`${trackIndex}:${start.seconds.toFixed(4)}:${end.seconds.toFixed(4)}`)
    trackIndicesInvolved.add(trackIndex)
  }

  const planned = []
  for (const trackIndex of trackIndicesInvolved) {
    const track = await sequence.getAudioTrack(trackIndex)
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false)

    const info = []
    for (const item of items) {
      const start = await item.getStartTime()
      const end = await item.getEndTime()
      const inPoint = await item.getInPoint()
      const outPoint = await item.getOutPoint()
      const fingerprint = `${trackIndex}:${start.seconds.toFixed(4)}:${end.seconds.toFixed(4)}`
      info.push({
        item,
        start: start.seconds,
        end: end.seconds,
        inPoint: inPoint.seconds,
        outPoint: outPoint.seconds,
        selected: selectedFingerprints.has(fingerprint)
      })
    }
    info.sort((a, b) => a.start - b.start)

    let i = 0
    while (i < info.length) {
      if (!info[i].selected) {
        i++
        continue
      }
      let j = i
      while (j + 1 < info.length && info[j + 1].selected && Math.abs(info[j + 1].start - info[j].end) < 0.001) {
        j++
      }
      const run = info.slice(i, j + 1)

      const frontNeighbor = info[i - 1]
      const frontRoom = frontNeighbor
        ? Math.max(0, Math.min(paddingSeconds, run[0].start - frontNeighbor.end))
        : paddingSeconds
      const backNeighbor = info[j + 1]
      const backRoom = backNeighbor
        ? Math.max(0, Math.min(paddingSeconds, backNeighbor.start - run[run.length - 1].end))
        : paddingSeconds

      let runningStart = run[0].start - frontRoom
      run.forEach((entry, index) => {
        const extendIn = index === 0 ? frontRoom : paddingSeconds
        const extendOut = index === run.length - 1 ? backRoom : paddingSeconds
        const newIn = Math.max(0, entry.inPoint - extendIn)
        const newOut = entry.outPoint + extendOut
        const newDuration = entry.end - entry.start + extendIn + extendOut
        planned.push({ trackItem: entry.item, newIn, newOut, targetStart: runningStart })
        runningStart += newDuration
      })

      i = j + 1
    }
  }
  if (planned.length === 0) throw new Error('Nothing to extend')

  // Phase 1: set every clip's new in/out together — safe to batch (unlike the
  // earlier full-length-placement bug elsewhere in this file) since this only
  // adjusts existing clips' own in/out, never places anything at a temporary
  // full-source-length size first.
  let stepError = null
  proj.lockedAccess(() => {
    proj.executeTransaction((compoundAction) => {
      for (const p of planned) {
        try {
          compoundAction.addAction(p.trackItem.createSetInPointAction(ppro.TickTime.createWithSeconds(p.newIn)))
          compoundAction.addAction(p.trackItem.createSetOutPointAction(ppro.TickTime.createWithSeconds(p.newOut)))
        } catch (err) {
          stepError = (stepError ? stepError + '; ' : '') + (err && err.message ? err.message : String(err))
        }
      }
    }, 'BijouMusic: extend edges')
  })
  if (stepError) throw new Error(stepError)

  // Phase 2: correct each clip's resulting position back to its planned
  // target — setting in/out shifts a clip's start by however much the
  // in-point moved (confirmed elsewhere this session), so without this,
  // every clip after the first extended one in a run would land wrong.
  const corrections = []
  for (const p of planned) {
    const actualStart = await p.trackItem.getStartTime()
    const correction = p.targetStart - actualStart.seconds
    if (Math.abs(correction) > 0.001) corrections.push({ trackItem: p.trackItem, correction })
  }
  if (corrections.length > 0) {
    let moveError = null
    proj.lockedAccess(() => {
      proj.executeTransaction((compoundAction) => {
        for (const c of corrections) {
          try {
            compoundAction.addAction(c.trackItem.createMoveAction(ppro.TickTime.createWithSeconds(c.correction)))
          } catch (err) {
            moveError = (moveError ? moveError + '; ' : '') + (err && err.message ? err.message : String(err))
          }
        }
      }, 'BijouMusic: reposition after extend')
    })
    if (moveError) log('extendEdgesOnSelection: reposition step - ' + moveError)
  }

  return planned.length
}

/** Resolves the absolute path of the media file backing a track item — used to
 *  hand BijouMusic something it can read and decode for analysis. */
async function getMediaFilePath(trackItem) {
  const projectItem = ppro.ClipProjectItem.cast(await trackItem.getProjectItem())
  return await projectItem.getMediaFilePath()
}

// Silence cutting moved to premiere-cep-extension/ — it needs Premiere's native
// ripple-delete (the QE DOM's extract()), which UXP has no equivalent for.
// This panel's place-then-trim-then-correct workaround caused persistent
// waveform-thumbnail corruption at scale; see robust-watching-lightning.md
// for the full story.

/** Batch LUFS normalize: for each selected audio clip, sends its media file to
 *  BijouMusic for a loudness measurement (scoped to the clip's current in/out,
 *  same reasoning as the CEP extension's silence-cut scoping) against targetLufs, then applies
 *  the returned gain delta via the same Volume/Level mechanism as the gain
 *  buttons. */
async function normalizeLoudnessOnSelection(proj, sequence, targetLufs) {
  const clips = await getSelectedAudioClips(sequence)
  if (clips.length === 0) throw new Error('No audio clips selected in Premiere')

  const clipDeltas = []
  for (const trackItem of clips) {
    try {
      const filePath = await getMediaFilePath(trackItem)
      const inPoint = await trackItem.getInPoint()
      const outPoint = await trackItem.getOutPoint()
      log(`normalizeLoudnessOnSelection: analyzing "${basename(filePath)}" (${inPoint.seconds.toFixed(2)}s-${outPoint.seconds.toFixed(2)}s)`)
      const response = await sendBridgeRequest({
        type: 'analyze-clip',
        mode: 'lufs',
        filePath,
        targetLufs,
        searchStart: inPoint.seconds,
        searchEnd: outPoint.seconds
      })
      const { measuredLufs, gainDeltaDb } = response.result
      log(`normalizeLoudnessOnSelection: measured ${measuredLufs.toFixed(1)} LUFS, applying ${gainDeltaDb.toFixed(2)}dB`)
      clipDeltas.push({ trackItem, deltaDb: gainDeltaDb })
    } catch (err) {
      log('normalizeLoudnessOnSelection: skipping a clip - ' + (err && err.message ? err.message : err))
    }
  }
  if (clipDeltas.length === 0) throw new Error('Could not analyze any selected clip - see log above for why')

  return applyGainDeltasToClips(proj, clipDeltas, 'normalizeLoudnessOnSelection')
}

async function runSelectionTool(actionFn, successMessage) {
  try {
    const { proj, sequence } = await getActiveProjectAndSequence()
    const count = await actionFn(proj, sequence)
    const message = successMessage(count)
    log(message)
    setLastResult(message, false)
  } catch (err) {
    const message = err && err.message ? err.message : String(err)
    log('selection tool failed: ' + message)
    setLastResult(message, true)
  }
}

/** Sets the panel's core input/button visuals via inline !important — plain
 *  stylesheet !important wasn't reliably beating whatever default chrome this
 *  host webview injects (a persistent blue-ish border on inputs, muddy button
 *  fills instead of solid colors). Inline !important (set here via
 *  style.setProperty(prop, value, 'important')) is the one thing with higher
 *  cascade priority than a stylesheet's own !important. Because inline styles
 *  also beat CSS :hover/:focus rules, hover/focus have to be handled the same
 *  way here instead of in the stylesheet. */
function enforceControlStyles() {
  const apply = (el, props) => {
    for (const prop in props) el.style.setProperty(prop, props[prop], 'important')
  }

  // appearance:none is the key one — the pill shape and persistent blue glow
  // (present even when nothing is focused) look like Windows' native Fluent
  // widget rendering showing through, which border/outline/box-shadow alone
  // can't override since it isn't a CSS-drawn layer until appearance is reset.
  const RESET_NATIVE = { appearance: 'none', '-webkit-appearance': 'none' }

  const INPUT_BASE = {
    ...RESET_NATIVE,
    background: '#101012',
    color: '#e6e6ea',
    border: '1px solid #333338',
    'border-radius': '5px',
    'box-shadow': 'none',
    outline: 'none'
  }
  const INPUT_FOCUS = { border: '1px solid #5b9dff' }
  document.querySelectorAll('input[type="number"], select').forEach((el) => {
    apply(el, INPUT_BASE)
    el.addEventListener('focus', () => apply(el, { ...INPUT_BASE, ...INPUT_FOCUS }))
    el.addEventListener('blur', () => apply(el, INPUT_BASE))
  })

  const BTN_BASE = {
    ...RESET_NATIVE,
    background: '#2a2a30',
    'background-image': 'none',
    color: '#e6e6ea',
    border: '1px solid #38383f',
    'border-radius': '5px',
    'box-shadow': 'none',
    outline: 'none'
  }
  const BTN_HOVER = { background: '#34343b', border: '1px solid #48484f' }
  const PRIMARY_BASE = {
    ...RESET_NATIVE,
    outline: 'none',
    background: '#3a72c4',
    'background-image': 'none',
    color: '#ffffff',
    border: '1px solid #5b9dff',
    'box-shadow': 'none'
  }
  const PRIMARY_HOVER = { background: '#5b9dff' }

  document.querySelectorAll('button').forEach((el) => {
    const isPrimary = el.classList.contains('primary')
    const base = isPrimary ? PRIMARY_BASE : BTN_BASE
    const hover = isPrimary ? PRIMARY_HOVER : BTN_HOVER
    apply(el, base)
    el.addEventListener('mouseenter', () => apply(el, { ...base, ...hover }))
    el.addEventListener('mouseleave', () => apply(el, base))
  })
}

function setupSelectionToolsUI() {
  enforceControlStyles()

  const gainRows = document.querySelectorAll('.gain-row')
  gainRows.forEach((row, index) => {
    const input = row.querySelector('.gain-value')
    const key = `bijou.gainSlot.${index}`
    input.value = loadNumberSetting(key, parseFloat(input.value))
    input.addEventListener('change', () => saveSetting(key, input.value))
    row.querySelector('.gain-apply').addEventListener('click', () => {
      const deltaDb = parseFloat(input.value)
      if (!Number.isFinite(deltaDb)) return
      void runSelectionTool(
        (proj, sequence) => applyGainToSelection(proj, sequence, deltaDb),
        (count) => `applied ${deltaDb > 0 ? '+' : ''}${deltaDb}dB gain to ${count} clip(s)`
      )
    })
  })

  const pitchRangeInput = document.getElementById('pitchRange')
  pitchRangeInput.value = loadNumberSetting('bijou.pitchRange', parseFloat(pitchRangeInput.value))
  pitchRangeInput.addEventListener('change', () => saveSetting('bijou.pitchRange', pitchRangeInput.value))
  document.getElementById('pitchApply').addEventListener('click', () => {
    const range = Math.abs(parseFloat(pitchRangeInput.value))
    if (!Number.isFinite(range)) return
    void runSelectionTool(
      (proj, sequence) => randomizePitchOnSelection(proj, sequence, range),
      (count) => `randomized pitch (±${range} semitones) on ${count} clip(s)`
    )
  })

  document.getElementById('debugRatioApply').addEventListener('click', () => {
    const rawValue = parseFloat(document.getElementById('debugRatioValue').value)
    if (!Number.isFinite(rawValue)) return
    void runSelectionTool(
      async (proj, sequence) => {
        await setRawTransposeRatio(proj, sequence, rawValue)
        return 1
      },
      () => `set raw Transpose Ratio to ${rawValue} — check Semi-tones/Cents/Ratio in Premiere's Clip Fx Editor`
    )
  })

  const nudgeAmountInput = document.getElementById('nudgeAmount')
  const nudgeUnitSelect = document.getElementById('nudgeUnit')
  const nudgeFpsInput = document.getElementById('nudgeFps')
  nudgeAmountInput.value = loadNumberSetting('bijou.nudgeAmount', parseFloat(nudgeAmountInput.value))
  nudgeFpsInput.value = loadNumberSetting('bijou.nudgeFps', parseFloat(nudgeFpsInput.value))
  const savedUnit = localStorage.getItem('bijou.nudgeUnit')
  if (savedUnit) nudgeUnitSelect.value = savedUnit
  nudgeAmountInput.addEventListener('change', () => saveSetting('bijou.nudgeAmount', nudgeAmountInput.value))
  nudgeFpsInput.addEventListener('change', () => saveSetting('bijou.nudgeFps', nudgeFpsInput.value))
  nudgeUnitSelect.addEventListener('change', () => saveSetting('bijou.nudgeUnit', nudgeUnitSelect.value))

  function nudgeDeltaSeconds() {
    const amount = parseFloat(nudgeAmountInput.value)
    if (!Number.isFinite(amount)) return null
    if (nudgeUnitSelect.value === 'frames') {
      const fps = parseFloat(nudgeFpsInput.value)
      if (!Number.isFinite(fps) || fps <= 0) return null
      return amount / fps
    }
    return amount
  }

  document.getElementById('nudgeBack').addEventListener('click', () => {
    const delta = nudgeDeltaSeconds()
    if (delta === null) return
    void runSelectionTool(
      (proj, sequence) => nudgeSelection(proj, sequence, -delta),
      (count) => `nudged ${count} clip(s) back ${delta}s`
    )
  })
  document.getElementById('nudgeFwd').addEventListener('click', () => {
    const delta = nudgeDeltaSeconds()
    if (delta === null) return
    void runSelectionTool(
      (proj, sequence) => nudgeSelection(proj, sequence, delta),
      (count) => `nudged ${count} clip(s) forward ${delta}s`
    )
  })

  const staggerStepInput = document.getElementById('staggerStep')
  staggerStepInput.value = loadNumberSetting('bijou.staggerStep', parseFloat(staggerStepInput.value))
  staggerStepInput.addEventListener('change', () => saveSetting('bijou.staggerStep', staggerStepInput.value))
  document.getElementById('staggerApply').addEventListener('click', () => {
    const frames = parseFloat(staggerStepInput.value)
    if (!Number.isFinite(frames)) return
    const fps = parseFloat(nudgeFpsInput.value)
    if (!Number.isFinite(fps) || fps <= 0) return
    const stepSeconds = frames / fps
    void runSelectionTool(
      (proj, sequence) => staggerSelection(proj, sequence, stepSeconds),
      (count) => `staggered ${count} clip(s), ${frames} frames apart`
    )
  })

  const extendEdgesAmountInput = document.getElementById('extendEdgesAmount')
  extendEdgesAmountInput.value = loadNumberSetting('bijou.extendEdgesAmount', parseFloat(extendEdgesAmountInput.value))
  extendEdgesAmountInput.addEventListener('change', () =>
    saveSetting('bijou.extendEdgesAmount', extendEdgesAmountInput.value)
  )
  document.getElementById('extendEdgesApply').addEventListener('click', () => {
    const frames = parseFloat(extendEdgesAmountInput.value)
    if (!Number.isFinite(frames)) return
    const fps = parseFloat(nudgeFpsInput.value)
    if (!Number.isFinite(fps) || fps <= 0) return
    const paddingSeconds = frames / fps
    void runSelectionTool(
      (proj, sequence) => extendEdgesOnSelection(proj, sequence, paddingSeconds),
      (count) => `extended ${count} clip(s) by ${frames} frames on each side`
    )
  })

  const lufsTargetInput = document.getElementById('lufsTarget')
  lufsTargetInput.value = loadNumberSetting('bijou.lufsTarget', parseFloat(lufsTargetInput.value))
  lufsTargetInput.addEventListener('change', () => saveSetting('bijou.lufsTarget', lufsTargetInput.value))
  document.getElementById('lufsApply').addEventListener('click', () => {
    const target = parseFloat(lufsTargetInput.value)
    if (!Number.isFinite(target)) return
    void runSelectionTool(
      (proj, sequence) => normalizeLoudnessOnSelection(proj, sequence, target),
      (count) => `normalized ${count} clip(s) toward ${target} LUFS`
    )
  })
}

async function handleMessage(message) {
  if (message.type === 'ping') {
    return { type: 'pong', id: message.id }
  }
  if (message.type === 'send-track') {
    try {
      await handleSendTrack(message)
      return { type: 'ack', id: message.id }
    } catch (err) {
      log('send-track failed: ' + (err && err.message ? err.message : err))
      return { type: 'error', id: message.id, error: err && err.message ? err.message : String(err) }
    }
  }
  if (message.type === 'expect-drop') {
    expectedDrop = {
      tempFilePath: message.tempFilePath,
      originalFilePath: message.originalFilePath,
      trimRange: message.trimRange
    }
    watchForDrop(expectedDrop)
    return { type: 'ack', id: message.id }
  }
  return { type: 'error', id: message.id, error: `Unknown command: ${message.type}` }
}

function connect() {
  socket = new WebSocket(BRIDGE_URL)

  socket.addEventListener('open', () => {
    setStatus(true)
    log('connected to ' + BRIDGE_URL)
  })

  socket.addEventListener('message', async (event) => {
    let message
    try {
      message = JSON.parse(event.data)
    } catch {
      return
    }

    if (message.id && pendingBridgeRequests.has(message.id)) {
      const pendingRequest = pendingBridgeRequests.get(message.id)
      clearTimeout(pendingRequest.timeout)
      pendingBridgeRequests.delete(message.id)
      if (message.type === 'error') pendingRequest.reject(new Error(message.error || 'Unknown error'))
      else pendingRequest.resolve(message)
      return
    }

    const response = await handleMessage(message)
    socket.send(JSON.stringify(response))
  })

  socket.addEventListener('close', () => {
    setStatus(false)
    scheduleReconnect()
  })

  socket.addEventListener('error', () => {
    // 'close' fires right after; reconnect is handled there.
  })
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connect()
  }, RECONNECT_DELAY_MS)
}

let selectionToolsReady = false

entrypoints.setup({
  panels: {
    bridgePanel: {
      show() {
        connect()
        if (!selectionToolsReady) {
          selectionToolsReady = true
          setupSelectionToolsUI()
        }
      },
      hide() {
        if (reconnectTimer) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }
        socket?.close()
        socket = null
      }
    }
  }
})
