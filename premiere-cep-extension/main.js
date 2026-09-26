const csInterface = new CSInterface()

const BRIDGE_URL = 'ws://localhost:8934'
const RECONNECT_DELAY_MS = 2000
const BRIDGE_REQUEST_TIMEOUT_MS = 25000

let socket = null
let reconnectTimer = null
const pendingBridgeRequests = new Map()

function log(message) {
  const el = document.getElementById('log')
  if (!el) return
  el.textContent += message + '\n'
  el.scrollTop = el.scrollHeight
}

function setProgress(text) {
  const el = document.getElementById('progress')
  if (el) el.textContent = text
}

/** Prominent success/error banner — see the matching function in the UXP
 *  panel's main.js for the same reasoning. */
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

/** Same pending/timeout pattern as the UXP panel's sendBridgeRequest — this
 *  panel only ever initiates its own requests (analyze-clip), never needs to
 *  receive BijouMusic-initiated commands, so there's no inbound handleMessage
 *  side here at all. */
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

function connect() {
  socket = new WebSocket(BRIDGE_URL)

  socket.addEventListener('open', () => {
    setStatus(true)
    log('connected to ' + BRIDGE_URL)
  })

  socket.addEventListener('message', (event) => {
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
    }
    // Any other message is a BijouMusic-initiated command this panel doesn't
    // implement (ping, send-track, etc.) — those are for the UXP panel, which
    // may be connected at the same time. Silently ignored here on purpose.
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

/** Wraps CSInterface's callback-based evalScript in a Promise, and parses the
 *  JSON string every hostscript.jsx function returns. */
function evalScript(script) {
  return new Promise((resolve, reject) => {
    csInterface.evalScript(script, (result) => {
      if (result === undefined || result === 'undefined' || result === '') {
        reject(new Error('ExtendScript returned nothing — check the JSX for a syntax error'))
        return
      }
      try {
        const parsed = JSON.parse(result)
        if (parsed && parsed.error) reject(new Error(parsed.error))
        else resolve(parsed)
      } catch {
        reject(new Error('ExtendScript returned unparseable data: ' + result))
      }
    })
  })
}

function loadNumberSetting(key, fallback) {
  const raw = localStorage.getItem(key)
  const n = raw === null ? NaN : parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

function saveSetting(key, value) {
  localStorage.setItem(key, String(value))
}

/** Grows each audible segment by paddingSeconds on both ends (clamped to
 *  [inPoint, outPoint]) before gaps are derived from them — a straight cut
 *  right at the detected loud/quiet boundary can feel harsh (clips a breath
 *  or the natural attack/decay of a word), so this leaves a little of the
 *  detected "silence" in place on each side instead of removing all of it.
 *  Two segments that grow into each other (a short gap between them shrinks
 *  to nothing once padded) are merged into one rather than left overlapping. */
function padSegments(segments, paddingSeconds, inPoint, outPoint) {
  if (paddingSeconds <= 0) return segments
  const padded = segments
    .map((s) => ({
      start: Math.max(inPoint, s.start - paddingSeconds),
      end: Math.min(outPoint, s.end + paddingSeconds)
    }))
    .sort((a, b) => a.start - b.start)

  const merged = []
  for (const seg of padded) {
    const last = merged[merged.length - 1]
    if (last && seg.start <= last.end) last.end = Math.max(last.end, seg.end)
    else merged.push(seg)
  }
  return merged
}

/** The kept (audible) segments detectSilenceSegments returns are the
 *  complement of what we actually want here — the SILENT gaps to cut. Derives
 *  them, including any leading gap before the first segment and trailing gap
 *  after the last (both source-relative, matching inPoint/outPoint), so "Cut
 *  Silence" removes dead air at the edges too, not just internal gaps. */
function gapsFromSegments(segments, inPoint, outPoint) {
  const gaps = []
  let cursor = inPoint
  for (const segment of segments) {
    if (segment.start > cursor) gaps.push({ start: cursor, end: segment.start })
    cursor = Math.max(cursor, segment.end)
  }
  if (cursor < outPoint) gaps.push({ start: cursor, end: outPoint })
  return gaps
}

async function cutSilenceOnSelectedClip(thresholdDb, minSilenceSeconds, paddingSeconds) {
  setProgress('Reading selected clip…')
  const clipData = await evalScript('getActiveClipData()')
  log(`cutSilence: clip "${clipData.filePath}" (${clipData.inPoint.toFixed(2)}s-${clipData.outPoint.toFixed(2)}s of source)`)

  setProgress('Analyzing via BijouMusic…')
  const response = await sendBridgeRequest({
    type: 'analyze-clip',
    mode: 'silence',
    filePath: clipData.filePath,
    searchStart: clipData.inPoint,
    searchEnd: clipData.outPoint,
    thresholdDb,
    minSilenceSeconds
  })
  const { segments } = response.result
  log(`cutSilence: ${segments.length} audible segment(s) found`)

  const paddedSegments = padSegments(segments, paddingSeconds, clipData.inPoint, clipData.outPoint)
  if (paddingSeconds > 0) {
    log(`cutSilence: padded to ${paddedSegments.length} segment(s) (±${paddingSeconds.toFixed(3)}s)`)
  }

  const sourceGaps = gapsFromSegments(paddedSegments, clipData.inPoint, clipData.outPoint)
  if (sourceGaps.length === 0) {
    log('cutSilence: no silence gaps to cut')
    return 0
  }

  // Source-relative -> sequence-relative: a source position X maps to
  // sequence time clipStart + (X - inPoint), since the clip's visible start
  // on the timeline corresponds to inPoint in the source file.
  const sequenceGaps = sourceGaps.map((gap) => ({
    start: clipData.clipStart + (gap.start - clipData.inPoint),
    end: clipData.clipStart + (gap.end - clipData.inPoint)
  }))
  log(
    `cutSilence: cutting ${sequenceGaps.length} gap(s) - ${sequenceGaps.map((g) => `${g.start.toFixed(2)}-${g.end.toFixed(2)}`).join(', ')}`
  )

  setProgress(`Ripple-deleting ${sequenceGaps.length} gap(s)…`)
  const gapsJson = JSON.stringify(sequenceGaps)
  const result = await evalScript(`cutGapsOnSelectedClip(${JSON.stringify(gapsJson)})`)
  log(`cutSilence: removed ${result.gapsRemoved} gap(s)`)
  return result.gapsRemoved
}

function setupUI() {
  const thresholdInput = document.getElementById('silenceThreshold')
  const minGapInput = document.getElementById('silenceMinGap')
  const paddingInput = document.getElementById('silencePadding')
  const paddingFpsInput = document.getElementById('silencePaddingFps')
  thresholdInput.value = loadNumberSetting('bijou.silenceThreshold', parseFloat(thresholdInput.value))
  minGapInput.value = loadNumberSetting('bijou.silenceMinGap', parseFloat(minGapInput.value))
  paddingInput.value = loadNumberSetting('bijou.silencePadding', parseFloat(paddingInput.value))
  paddingFpsInput.value = loadNumberSetting('bijou.silencePaddingFps', parseFloat(paddingFpsInput.value))
  thresholdInput.addEventListener('change', () => saveSetting('bijou.silenceThreshold', thresholdInput.value))
  minGapInput.addEventListener('change', () => saveSetting('bijou.silenceMinGap', minGapInput.value))
  paddingInput.addEventListener('change', () => saveSetting('bijou.silencePadding', paddingInput.value))
  paddingFpsInput.addEventListener('change', () => saveSetting('bijou.silencePaddingFps', paddingFpsInput.value))

  document.getElementById('cutSilenceApply').addEventListener('click', () => {
    const thresholdDb = parseFloat(thresholdInput.value)
    const minSilenceSeconds = parseFloat(minGapInput.value)
    const paddingFrames = parseFloat(paddingInput.value)
    const paddingFps = parseFloat(paddingFpsInput.value)
    if (!Number.isFinite(thresholdDb) || !Number.isFinite(minSilenceSeconds)) return
    if (!Number.isFinite(paddingFrames) || !Number.isFinite(paddingFps) || paddingFps <= 0) return
    const paddingSeconds = Math.max(0, paddingFrames) / paddingFps

    cutSilenceOnSelectedClip(thresholdDb, minSilenceSeconds, paddingSeconds)
      .then((gapsRemoved) => {
        const message = gapsRemoved > 0 ? `Cut ${gapsRemoved} silence gap(s)` : 'No silence gaps to cut'
        setLastResult(message, false)
      })
      .catch((err) => {
        const message = err && err.message ? err.message : String(err)
        log('cutSilence failed: ' + message)
        setLastResult(message, true)
      })
      .finally(() => setProgress(''))
  })
}

connect()
setupUI()
