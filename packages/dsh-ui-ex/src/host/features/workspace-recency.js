/**
 * Feature: workspace recency order and pinning.
 *
 * The sidebar renders workspaces in the Host's durable registry order, so this
 * feature keeps that order sorted the way the Session list sorts itself: pinned
 * workspaces lead, and both partitions fall back to the newest member-Session
 * activity.
 *
 * Two sources feed the recency map:
 * - Session activity observed in this process (`api-session/added`,
 *   `api-session/activity`), and
 * - the map the browser half pushes: it already holds every Session summary the
 *   sidebar sorts by, including Sessions this process never activated.
 *
 * Reordering uses the public `workspaceRegistry.insertBefore`, so no shipped
 * Client slot is replaced.
 *
 * The registry finishes its own asynchronous startup (session-header index plus
 * the one-time history bootstrap) after this bundle has loaded, so a plain
 * `ctx.get('workspaceRegistry')` at setup time reads `undefined` on a cold start
 * and would disable the feature for the whole process. The RPC surface therefore
 * exists immediately and the sorter itself is activated through
 * `ctx.inject(['workspaceRegistry'], …)`, which runs as soon as the service is
 * active: pins and recency that arrive earlier are buffered and replayed.
 *
 * @module ui-ex/host/features/workspace-recency
 */

export const id = 'workspace-recency'

/** Switches and options a profile patch may override. */
export const defaults = {
  enabled: true,
  /** Safety reconciliation period; activity and pin changes sort immediately. */
  reconcileSeconds: 60,
}

/** Persisted state format of this feature. */
const STORE_VERSION = 1

/** Recency entries kept on disk; the sidebar never shows more Sessions than this. */
const RECENCY_LIMIT = 4000

/** How many startup attempts may fail while the registry finishes its own start. */
const BOOTSTRAP_ATTEMPTS = 20

/** How long one RPC waits for the registry before reporting it as not started. */
const READY_TIMEOUT_MS = 5000

/** How long a registry that never appears stays silent before one warning. */
const MISSING_SERVICE_WARN_MS = 30000

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
 * Validate one persisted snapshot.
 * @param value - stored JSON value.
 * @returns `{ pinned, recency }` with validated field types.
 */
function parseStored(value) {
  const empty = { pinned: [], recency: new Map() }
  if (value === null || typeof value !== 'object') return empty
  if (value.version !== STORE_VERSION) return empty
  const pinned = Array.isArray(value.pinned) ? value.pinned.filter(id => typeof id === 'string' && id !== '') : []
  const recency = new Map()
  if (value.recency !== null && typeof value.recency === 'object') {
    for (const [sessionId, raw] of Object.entries(value.recency)) {
      const timestamp = Number(raw)
      if (sessionId !== '' && Number.isFinite(timestamp) && timestamp > 0) recency.set(sessionId, timestamp)
    }
  }
  return { pinned, recency }
}

/**
 * Activate the sorter against a live registry.
 * @param ctx - Host context that injects `workspaceRegistry`.
 * @param registry - the durable workspace registry.
 * @param api - suite runtime api for this feature.
 * @returns the feature's RPC ops.
 */
function activate(ctx, registry, api) {
  const reconcileMs = Math.max(10, Number(api.options.reconcileSeconds) || 60) * 1000
  const stored = parseStored(api.state.read())

  /** Pinned workspace ids, most recently pinned first. */
  let pinnedOrder = [...stored.pinned]
  /** sessionId -> latest activity time in milliseconds. */
  const recency = stored.recency
  /** Set once the registry answered a listing; gates the startup retries. */
  let ready = false

  /** Build the serializable snapshot this feature persists. */
  const serialize = () => ({ version: STORE_VERSION, pinned: pinnedOrder, recency: Object.fromEntries(recency) })

  /** Schedule one durable save of the current snapshot. */
  const persist = () => {
    api.state.write(serialize())
  }

  /** Whether the registry still knows one workspace id. */
  const known = workspaceId => {
    try {
      return registry.get(workspaceId) !== undefined
    } catch {
      return false
    }
  }

  /** Record one Session's activity time and schedule a sort plus a save. */
  const noteActivity = (sessionId, updatedAt) => {
    if (typeof sessionId !== 'string' || sessionId === '') return
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return
    if (recency.get(sessionId) === updatedAt) return
    recency.set(sessionId, updatedAt)
    persist()
    requestSort()
  }

  /** Compute the order this feature wants, as workspace id strings. */
  const targetOrder = () => {
    const workspaces = registry.list()
    const archived = new Set(registry.archivedSessionIds.map(String))
    const pinned = new Set(pinnedOrder)
    const rows = workspaces.map(workspace => {
      const workspaceId = String(workspace.id)
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
      return { id: workspaceId, partition: pinned.has(workspaceId) ? 0 : 1, newest }
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
      const workspaceId = target[index]
      if (!current.includes(workspaceId)) continue
      const anchor = current[index]
      if (anchor === undefined) continue
      await registry.insertBefore(workspaceId, anchor)
      current = registry.list().map(workspace => String(workspace.id))
      if (current[index] !== workspaceId) {
        api.warn(`the registry kept '${workspaceId}' away from index ${index}; leaving the order untouched`)
        return false
      }
    }
    return true
  }

  let inFlight = null
  let dirty = false

  /**
   * Coalesced sort: one pass at a time, and one more when a request arrived
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
        api.warn(`sort skipped: ${error instanceof Error ? error.message : String(error)}`)
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
    const kept = [...recency.entries()].filter(([sessionId]) => members.has(sessionId))
    kept.sort((left, right) => right[1] - left[1])
    recency.clear()
    for (const [sessionId, value] of kept.slice(0, RECENCY_LIMIT)) recency.set(sessionId, value)
  }

  /** The browser half's view of this feature. */
  const snapshot = () => ({
    pinned: ready ? pinnedOrder.filter(known) : [...pinnedOrder],
    ready,
  })

  /** Pin a workspace to the top, or unpin it. */
  const togglePin = async workspaceId => {
    if (typeof workspaceId !== 'string' || workspaceId === '' || !known(workspaceId)) {
      return { status: 'unknown-workspace', ...snapshot() }
    }
    const pinned = pinnedOrder.includes(workspaceId)
    pinnedOrder = pinned ? pinnedOrder.filter(entry => entry !== workspaceId) : [workspaceId, ...pinnedOrder]
    persist()
    await requestSort()
    return { status: pinned ? 'unpinned' : 'pinned', ...snapshot() }
  }

  /** Merge a browser-sent recency map of `[sessionId, updatedAt]` pairs. */
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
    pruneRecency()
    persist()
    void requestSort()
  }

  ctx.effect(() => ctx.on('api-session/activity', (sessionId, updatedAt) => {
    noteActivity(String(sessionId ?? ''), Number(updatedAt))
  }), 'ui-ex/workspace-recency: session activity')

  ctx.effect(() => ctx.on('api-session/added', summary => {
    if (summary === null || typeof summary !== 'object') return
    noteActivity(String(summary.sessionId ?? ''), Number(summary.updatedAt))
  }), 'ui-ex/workspace-recency: session summary')

  ctx.effect(() => ctx.on('workspace/session-archived', () => {
    void requestSort()
  }), 'ui-ex/workspace-recency: session archived')

  ctx.effect(() => ctx.on('workspace/session-unarchiving', () => {
    void requestSort()
  }), 'ui-ex/workspace-recency: session unarchiving')

  ctx.effect(() => {
    const timer = setInterval(() => {
      void requestSort()
    }, reconcileMs)
    return () => clearInterval(timer)
  }, 'ui-ex/workspace-recency: reconciliation timer')

  /** Retry the first sort while the registry finishes its own startup. */
  const bootstrap = attempt => {
    void requestSort().then(settled => {
      if (settled) return
      if (attempt >= BOOTSTRAP_ATTEMPTS) {
        api.warn('the order could not be sorted at startup; the next activity retries it')
        return
      }
      setTimeout(() => bootstrap(attempt + 1), 500)
    })
  }

  bootstrap(0)

  return {
    rpc: {
      state: () => snapshot(),
      sync: payload => {
        mergeRecency(payload?.entries)
        return snapshot()
      },
      toggle: payload => togglePin(String(payload?.workspaceId ?? '')),
    },
  }
}

/**
 * Activate the feature: serve the pin/recency RPC immediately, and start the
 * sorter as soon as `workspaceRegistry` is active.
 * @param ctx - Host context.
 * @param api - suite runtime api for this feature.
 * @returns the feature's RPC ops.
 */
export function setup(ctx, api) {
  /** The activated sorter; undefined while the registry finishes starting. */
  let feature
  /** Recency entries the browser sent before the sorter existed, replayed once. */
  let bufferedSync
  /** Callers parked in `whenReady`, each with its own deadline. */
  const waiting = new Set()

  /** Wake every parked caller once the sorter exists. */
  const settle = () => {
    for (const deliver of [...waiting]) deliver()
    waiting.clear()
  }

  ctx.effect(() => {
    // A profile without a workspace registry still degrades to a logged no-op,
    // but only after the service had every chance to finish its startup.
    const timer = setTimeout(() => {
      if (feature === undefined) {
        api.warn('workspaceRegistry never became available, so the workspace order stays manual')
      }
    }, MISSING_SERVICE_WARN_MS)
    return () => clearTimeout(timer)
  }, 'ui-ex/workspace-recency: missing registry warning')

  // Runs now when the registry is already active, and later on a cold start.
  ctx.inject(['workspaceRegistry'], (inner) => {
    feature = activate(inner, inner.workspaceRegistry, api)
    inner.effect(() => () => {
      feature = undefined
    }, 'ui-ex/workspace-recency: activation window')
    if (bufferedSync !== undefined) {
      try {
        feature.rpc.sync({ entries: bufferedSync })
      } catch {
        // A replay that fails only loses recency the next push repeats.
      }
      bufferedSync = undefined
    }
    settle()
  })

  /**
   * Resolve with the sorter, giving the registry a short grace period so a pin
   * clicked during startup is not reported as broken.
   * @returns the feature, or undefined when it did not activate in time.
   */
  const whenReady = () => new Promise((resolve) => {
    if (feature !== undefined) {
      resolve(feature)
      return
    }
    const deliver = () => {
      clearTimeout(timer)
      resolve(feature)
    }
    const timer = setTimeout(() => {
      waiting.delete(deliver)
      resolve(feature)
    }, READY_TIMEOUT_MS)
    waiting.add(deliver)
  })

  return {
    rpc: {
      state: () => (feature === undefined ? { ready: false } : feature.rpc.state()),
      sync: payload => {
        if (feature === undefined) {
          // Each push is a complete map, so the newest one supersedes older ones.
          if (Array.isArray(payload?.entries)) bufferedSync = payload.entries
          return { ready: false }
        }
        feature.rpc.sync(payload)
        return feature.rpc.state()
      },
      toggle: async payload => {
        const active = await whenReady()
        if (active === undefined) {
          throw new Error('workspaceRegistry has not finished starting, so the pin cannot be saved yet')
        }
        return active.rpc.toggle(payload)
      },
    },
  }
}
