import { WebSocketServer, WebSocket, type RawData } from 'ws'
import { randomUUID } from 'crypto'

// Premiere doesn't accept commands from outside processes — the only way to drive
// it is a UXP panel running inside Premiere itself, which connects out to this
// local server (see premiere-extension/). Loopback-only: nothing here is meant to
// be reachable from anywhere but this machine.
const PORT = 8934

interface PendingRequest {
  resolve: (value: BridgeResponse) => void
  timeout: NodeJS.Timeout
}

export interface BridgeResponse {
  id?: string
  type: string
  [key: string]: unknown
}

let servers: WebSocketServer[] = []
// A Set, not a single socket — the UXP panel (gain/pitch/nudge/etc.) and the
// CEP panel (cut silence, which needs Premiere's QE "extract" ripple-delete
// that UXP has no equivalent for) can both be connected at the same time.
// BijouMusic-initiated requests (sendPremiereRequest) broadcast to all of
// them; whichever one actually implements that command type is the one that
// replies, since the other's handleMessage just won't recognize it. Extension-
// initiated requests (analyze-clip) already work per-socket regardless.
const panelSockets = new Set<WebSocket>()
const pending = new Map<string, PendingRequest>()
const statusListeners = new Set<(connected: boolean) => void>()

/** Handles a request the extension initiated (as opposed to a response to
 *  something BijouMusic itself sent via sendPremiereRequest) — e.g. an
 *  analyze-clip call for silence-trim/LUFS, which needs the renderer's
 *  decodeAudioData and so has to round-trip through main either way. */
type IncomingRequestHandler = (message: BridgeResponse) => Promise<Record<string, unknown>>
let incomingHandler: IncomingRequestHandler | null = null

export function setIncomingRequestHandler(handler: IncomingRequestHandler): void {
  incomingHandler = handler
}

function notifyStatus(connected: boolean): void {
  for (const listener of statusListeners) listener(connected)
}

export function onPremiereStatusChange(listener: (connected: boolean) => void): () => void {
  statusListeners.add(listener)
  return () => statusListeners.delete(listener)
}

export function isPremiereConnected(): boolean {
  for (const socket of panelSockets) {
    if (socket.readyState === WebSocket.OPEN) return true
  }
  return false
}

function handleConnection(socket: WebSocket): void {
  panelSockets.add(socket)
  notifyStatus(true)

  socket.on('message', (raw: RawData) => {
    let message: BridgeResponse
    try {
      message = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id)!
      clearTimeout(request.timeout)
      pending.delete(message.id)
      request.resolve(message)
      return
    }
    // Not a response to anything BijouMusic sent — the extension is initiating
    // its own request (e.g. analyze-clip) and expects an answer back with the
    // same id.
    if (message.id && incomingHandler) {
      incomingHandler(message)
        .then((result) => socket.send(JSON.stringify({ ...result, id: message.id })))
        .catch((err: unknown) => {
          const error = err instanceof Error ? err.message : String(err)
          socket.send(JSON.stringify({ type: 'error', id: message.id, error }))
        })
    }
  })

  socket.on('close', () => {
    panelSockets.delete(socket)
    if (panelSockets.size === 0) notifyStatus(false)
  })
}

export function startPremiereBridge(): void {
  if (servers.length > 0) return

  // "localhost" doesn't reliably resolve to the same address everywhere — Chromium
  // (which the UXP panel runs on) resolved it to the IPv6 loopback (::1) here, while
  // binding a single server to the IPv4 loopback (127.0.0.1) left that connection
  // hanging forever. Listening on both loopback addresses covers either resolution,
  // while staying off the network (unlike binding the IPv6/IPv4 "any" address).
  for (const host of ['127.0.0.1', '::1']) {
    const server = new WebSocketServer({ host, port: PORT })
    server.on('connection', handleConnection)
    server.on('error', (err) => {
      console.error(`[premiereBridge] server error on ${host}:`, err)
    })
    servers.push(server)
  }
}

export function stopPremiereBridge(): void {
  for (const server of servers) server.close()
  servers = []
  panelSockets.clear()
}

// Generous — a send-track command involves the extension doing an import, an
// insert/overwrite edit, a media swap, and an in/out fix-up, several sequential
// awaits against Premiere's own API, not just a quick ping.
const REQUEST_TIMEOUT_MS = 15000

/** Sends a command to every connected Premiere panel and waits for the first
 *  response, correlated by a generated request id. Broadcasting (rather than
 *  picking one) is safe because only the panel that actually implements a
 *  given command type will ever reply to it — the other's handleMessage
 *  simply doesn't recognize it and stays silent. Rejects immediately if
 *  nothing is connected, or after a timeout if nothing answers — callers
 *  surface that as "extension not connected" rather than hanging silently. */
export function sendPremiereRequest(payload: Record<string, unknown>): Promise<BridgeResponse> {
  return new Promise((resolve, reject) => {
    const openSockets = [...panelSockets].filter((s) => s.readyState === WebSocket.OPEN)
    if (openSockets.length === 0) {
      reject(new Error('Premiere extension is not connected'))
      return
    }
    const id = randomUUID()
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error('Premiere extension did not respond in time'))
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, { resolve, timeout })
    const message = JSON.stringify({ ...payload, id })
    for (const socket of openSockets) socket.send(message)
  })
}

export async function pingPremiere(): Promise<boolean> {
  try {
    const response = await sendPremiereRequest({ type: 'ping' })
    return response.type === 'pong'
  } catch {
    return false
  }
}
