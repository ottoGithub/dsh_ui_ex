/**
 * Host half of workspace-recency-pin.
 *
 * The sidebar renders workspaces in the durable registry order, which only
 * changes when someone drags a row or a workspace is created. This half keeps
 * that durable order sorted the way the Session list already sorts: pinned
 * workspaces first in pin order, then workspaces by their most recent member
 * Session activity.
 *
 * Two facts feed the recency map:
 * - Session activity observed in this process (`api-session/added`,
 *   `api-session/activity`), and
 * - the map the Client half pushes: the browser already holds every Session
 *   summary the sidebar sorts by, including Sessions this process has not
 *   activated, so it is the only complete source of `updatedAt` values.
 *
 * The map and the pin set live in one small JSON file under the profile, so a
 * restart keeps the pins and still sorts before any browser connects.
 *
 * Reordering uses the public `workspaceRegistry.insertBefore` method, so the
 * built-in sidebar renders the new order without the plugin replacing any
 * Client slot.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const name = 'workspace-recency-pin'

export const inject = ['workspaceRegistry', 'webServer', 'connection']

/** Same-origin endpoint the Client half posts to. */
const ROUTE = '/workspace-recency-pin/rpc'

/** Request bodies are a small list of Session timestamps; anything larger is refused. */
const MAX_BODY_BYTES = 256 * 1024

/** Recency entries kept on disk; the sidebar never shows more Sessions than this. */
const RECENCY_LIMIT = 4000

/** Persisted state format. */
const STORE_VERSION = 1

/** Delay that coalesces activity bursts into one durable write and one sort. */
const PERSIST_DELAY_MS = 400

/** Delay before the periodic reconciliation sort runs. */
const SAFETY_SORT_MS = 60_000

/** How many bootstrap attempts may fail on a registry that is not started yet. */
const BOOTSTRAP_ATTEMPTS = 20

/**
 * The state file this plugin owns.
 * @returns absolute path of `state.json` under the Harness home.
 */
function stateFile() {
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'workspace-recency-pin', 'state.json')
}

/**
 * Read the persisted state; an absent or malformed file reads as empty state.
 * @param path - state file path.
 * @returns `{ pinned, recency }` with validated field types.
 */
function readState(path) {
  const empty = { pinned: [], recency: new Map() }
  let parsed
  try {
    // A hand-edited file may carry a byte-order mark; JSON.parse rejects it.
    parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return empty
  }
  if (parsed === null || typeof parsed !== 'object') return empty
  if (parsed.version !== STORE_VERSION) return empty
  const pinned = Array.isArray(parsed.pinned) ? parsed.pinned.filter(id => typeof id === 'string' && id !== '') : []
  const recency = new Map()
  if (parsed.recency !== null && typeof parsed.recency === 'object') {
    for (const [id, value] of Object.entries(parsed.recency)) {
      const timestamp = Number(value)
      if (id !== '' && Number.isFinite(timestamp) && timestamp > 0) recency.set(id, timestamp)
    }
  }
  return { pinned, recency }
}

/**
 * Parse one ISO timestamp defensively.
 * @param value - candidate timestamp text.
 * @returns milliseconds, or 0 when unusable.
 */
function parseTime(value) {
  if (typeof value !== 'string') return 0
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

/**
 * Compare two id sequences.
 * @param left - first order.
 * @param right - second order.
 * @returns whether they are element-wise equal.
 */
function sameOrder(left, right) {
  if (left.length !== right.length) return false
  return left.every((id, index) => id === right[index])
}

/**
 * Trusted request rejection used by the same-origin route.
 * @param ctx - Host context with the connection service.
 * @param req - incoming request.
 * @param res - outgoing response.
 * @returns true when the request was rejected and answered.
 */
function rejectUntrusted(ctx, req, res) {
  const rejection = Reflect.get(ctx, 'connection')?.requestRejection?.(req)
  if (rejection === undefined) return false
  res.statusCode = rejection
  res.end()
  return true
}

/**
 * Send one uncached JSON response.
 * @param res - outgoing response.
 * @param status - HTTP status.
 * @param payload - JSON-serializable body.
 */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * Read a bounded request body as text.
 * @param req - incoming request.
 * @returns body text, or undefined when the body exceeds the cap.
 */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Register the sorted workspace order, the pin set, and the Client route.
 * @param ctx - Host context with workspaceRegistry, webServer, and connection.
 */
export function apply(ctx) {
  const registry = ctx.workspaceRegistry
  const file = stateFile()
  const stored = readState(file)

  /** Pinned workspace ids, most recently pinned first. */
  let pinnedOrder = []
  /** sessionId -> latest activity time in milliseconds. */
  const recency = stored.recency
  /** Set once the registry is confirmed listable; guards the first sort attempts. */
  let ready = false


  const warn = message => {
    try {
      ctx.logger?.warn?.(`workspace-recency-pin: ${message}`)
    } catch {
      // Logging must never break ordering.
    }
  }

  const known = id => {
    try {
      return registry.get(id) !== undefined
    } catch {
      return false
    }
  }

  // Ids are validated where they are used: the registry may still be starting up here.
  pinnedOrder = [...stored.pinned]

  /** Record one Session's activity time and schedule a sort plus a save. */
  const noteActivity = (sessionId, updatedAt) => {
    if (typeof sessionId !== 'string' || sessionId === '') return
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return
    if (recency.get(sessionId) === updatedAt) return
    recency.set(sessionId, updatedAt)
    schedulePersist()
    requestSort()
  }

  /** Compute the order this plugin wants, as workspace id strings. */
  const targetOrder = () => {
    const workspaces = registry.list()
    const archived = new Set(registry.archivedSessionIds.map(String))
    const pinned = new Set(pinnedOrder)
    const rows = workspaces.map(workspace => {
      const id = String(workspace.id)
      let newest = 0
      for (const sessionId of workspace.sessionIds) {
        const key = String(sessionId)
        if (archived.has(key)) continue
        const value = recency.get(key)
        if (typeof value === 'number' && value > newest) newest = value
      }
      if (newest === 0) newest = parseTime(workspace.updatedAt) || parseTime(workspace.createdAt) || 0
      // Pinned workspaces form the leading partition, exactly like the pinned
      // Session partition: inside it, and inside the remainder, recency decides.
      return { id, partition: pinned.has(id) ? 0 : 1, newest }
    })
    rows.sort((left, right) => (left.partition - right.partition) || (right.newest - left.newest) || left.id.localeCompare(right.id))
    return rows.map(row => row.id)
  }

  /** Run one reconciliation pass; resolves to whether the order is settled. */
  const sortOnce = async () => {
    const target = targetOrder()
    let current = registry.list().map(workspace => String(workspace.id))
    ready = true
    if (sameOrder(current, target)) return true
    for (let index = 0; index < target.length; index += 1) {
      if (current[index] === target[index]) continue
      const id = target[index]
      if (!current.includes(id)) continue
      const anchor = current[index]
      if (anchor === undefined) continue
      await registry.insertBefore(id, anchor)
      current = registry.list().map(workspace => String(workspace.id))
      if (current[index] !== id) {
        warn(`registry kept '${id}' away from index ${index}; leaving the current order untouched`)
        return false
      }
    }
    return true
  }

  let inFlight = null
  let dirty = false

  /**
   * Coalesced sort: one pass at a time, and one more when requests arrived
   * while it ran.
   * @returns whether the settled order matched the computed one.
   */
  const requestSort = () => {
    if (inFlight !== null) {
      dirty = true
      return inFlight
    }
    inFlight = (async () => {
      try {
        do {
          dirty = false
          const settled = await sortOnce()
          if (!settled) return false
        } while (dirty)
        return true
      } catch (error) {
        warn(`sort skipped: ${error instanceof Error ? error.message : String(error)}`)
        return false
      } finally {
        inFlight = null
      }
    })()
    return inFlight
  }

  /** Keep only entries a registered workspace can still reference, newest first. */
  const pruneRecency = () => {
    const members = new Set()
    for (const workspace of registry.list()) {
      for (const sessionId of workspace.sessionIds) members.add(String(sessionId))
    }
    const kept = [...recency.entries()].filter(([id]) => members.has(id))
    kept.sort((left, right) => right[1] - left[1])
    recency.clear()
    for (const [id, value] of kept.slice(0, RECENCY_LIMIT)) recency.set(id, value)
  }

  let persistTimer = null

  /** Write the current state, replacing the file atomically. */
  const persistNow = async () => {
    try {
      pruneRecency()
      const recencyObject = Object.fromEntries(recency)
      const payload = JSON.stringify({ version: STORE_VERSION, pinned: pinnedOrder, recency: recencyObject })
      await mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.tmp`
      await writeFile(temporary, payload, 'utf8')
      await rename(temporary, file)
    } catch (error) {
      warn(`state could not be saved: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Defer one save so a burst of activity costs one write. */
  const schedulePersist = () => {
    if (persistTimer !== null) return
    persistTimer = setTimeout(() => {
      persistTimer = null
      void persistNow()
    }, PERSIST_DELAY_MS)
  }

  /** The Client's view of the plugin state. */
  const snapshot = () => ({
    pinned: ready ? pinnedOrder.filter(id => known(id)) : [...pinnedOrder],
    ready,
  })

  /** Pin a workspace to the top, or unpin it. */
  const togglePin = async workspaceId => {
    if (typeof workspaceId !== 'string' || workspaceId === '' || !known(workspaceId)) {
      return { status: 'unknown-workspace' }
    }
    const pinned = pinnedOrder.includes(workspaceId)
    pinnedOrder = pinned ? pinnedOrder.filter(id => id !== workspaceId) : [workspaceId, ...pinnedOrder]
    schedulePersist()
    await requestSort()
    return { status: pinned ? 'unpinned' : 'pinned' }
  }

  /** Merge a Client-sent recency map; entries are `[sessionId, updatedAt]` pairs. */
  const mergeRecency = entries => {
    if (!Array.isArray(entries)) return
    let changed = false
    for (const entry of entries.slice(0, RECENCY_LIMIT * 2)) {
      if (!Array.isArray(entry) || entry.length < 2) continue
      const sessionId = typeof entry[0] === 'string' ? entry[0] : String(entry[0] ?? '')
      const updatedAt = Number(entry[1])
      if (sessionId === '' || !Number.isFinite(updatedAt) || updatedAt <= 0) continue
      if (recency.get(sessionId) === updatedAt) continue
      recency.set(sessionId, updatedAt)
      changed = true
    }
    if (!changed) return
    schedulePersist()
    void requestSort()
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      if (rejectUntrusted(ctx, req, res)) return
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('allow', 'POST')
        res.end()
        return
      }
      const body = await readBody(req)
      if (body === undefined) {
        sendJson(res, 413, { error: 'too-large' })
        return
      }
      let request
      try {
        request = JSON.parse(body)
      } catch {
        sendJson(res, 400, { error: 'bad-json' })
        return
      }
      if (request === null || typeof request !== 'object') {
        sendJson(res, 400, { error: 'bad-request' })
        return
      }
      try {
        switch (request.op) {
          case 'state':
            sendJson(res, 200, { ...snapshot(), status: 'ok' })
            return
          case 'sync':
            mergeRecency(request.entries)
            sendJson(res, 200, { ...snapshot(), status: 'ok' })
            return
          case 'toggle': {
            const result = await togglePin(String(request.workspaceId ?? ''))
            sendJson(res, result.status === 'unknown-workspace' ? 404 : 200, { ...snapshot(), ...result })
            return
          }
          default:
            sendJson(res, 400, { error: 'bad-op' })
            return
        }
      } catch (error) {
        warn(`request failed: ${error instanceof Error ? error.message : String(error)}`)
        sendJson(res, 500, { error: 'internal', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), `workspace-recency-pin: POST ${ROUTE}`)

  ctx.effect(() => ctx.on('api-session/activity', (sessionId, updatedAt) => {
    noteActivity(String(sessionId ?? ''), Number(updatedAt))
  }), 'workspace-recency-pin: session activity')

  ctx.effect(() => ctx.on('api-session/added', summary => {
    if (summary === null || typeof summary !== 'object') return
    noteActivity(String(summary.sessionId ?? ''), Number(summary.updatedAt))
  }), 'workspace-recency-pin: session summary')

  ctx.effect(() => ctx.on('workspace/session-archived', () => {
    void requestSort()
  }), 'workspace-recency-pin: session archived')

  ctx.effect(() => ctx.on('workspace/session-unarchiving', () => {
    void requestSort()
  }), 'workspace-recency-pin: session unarchiving')

  ctx.effect(() => {
    const timer = setInterval(() => {
      void requestSort()
    }, SAFETY_SORT_MS)
    return () => clearInterval(timer)
  }, 'workspace-recency-pin: reconciliation timer')

  ctx.effect(() => () => {
    if (persistTimer !== null) {
      clearTimeout(persistTimer)
      persistTimer = null
      void persistNow()
    }
  }, 'workspace-recency-pin: final save')

  /** Retry the first sort while the registry finishes its own startup. */
  const bootstrap = attempt => {
    void requestSort().then(settled => {
      if (settled) return
      if (attempt >= BOOTSTRAP_ATTEMPTS) {
        warn('workspace order could not be sorted at startup; later activity retries it')
        return
      }
      setTimeout(() => bootstrap(attempt + 1), 500)
    })
  }

  bootstrap(0)
}
