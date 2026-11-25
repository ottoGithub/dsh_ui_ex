/**
 * Host runtime shared by every feature in this suite.
 *
 * Three concerns live here so a feature never repeats them:
 * - the one same-origin RPC route (`ROUTE`) with its browser-trust fence and
 *   body bound,
 * - a tiny debounced JSON state store, one file per feature namespace,
 * - the response helpers.
 *
 * @module ui-ex/host/runtime
 */
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The one route this suite serves. `src/client/entry.js` carries the same
 * literal for the browser half; `scripts/check.mjs` fails when they drift.
 */
export const ROUTE = '/dsh-ui-ex/rpc'

/** A request body larger than this is refused instead of buffered. */
const MAX_BODY_BYTES = 1024 * 1024

/** Delay that coalesces a burst of writes into one durable save. */
const SAVE_DELAY_MS = 400

/**
 * Send one uncached JSON response.
 * @param res - Node response from the webServer handler.
 * @param status - HTTP status code.
 * @param payload - JSON-serializable body.
 */
export function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * Answer a request that did not come from an authenticated same-origin page.
 * @param ctx - Host context exposing `connection`.
 * @param req - incoming request.
 * @param res - outgoing response.
 * @returns true when the request was rejected and already answered.
 */
export function rejectUntrusted(ctx, req, res) {
  const rejection = ctx.get('connection')?.requestRejection?.(req)
  if (rejection === undefined) return false
  res.statusCode = rejection
  res.end()
  return true
}

/**
 * Read a bounded JSON request body.
 * @param req - incoming request.
 * @returns `{ ok: true, value }`, or `{ ok: false, status }` for an unusable body.
 */
export async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) return { ok: false, status: 413 }
    chunks.push(chunk)
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { ok: false, status: 400 }
  }
}

/**
 * One file-backed JSON store per feature namespace.
 *
 * Features keep their working structures in memory (maps, sets) and hand a
 * serializable snapshot to `write` whenever it changes; reads happen once at
 * setup. Files live under `<harness home>/dsh-ui-ex/<namespace>.json`, so a
 * restart recovers the last state before any browser connects.
 *
 * @param options - `directory` for the files and `warn` for failures.
 * @returns the store handle.
 */
export function createStateStore({ directory, warn }) {
  /** namespace -> { value } */
  const loaded = new Map()
  /** namespace -> pending timer */
  const timers = new Map()

  const fileFor = namespace => join(directory, `${namespace}.json`)

  /**
   * Read one namespace synchronously; an absent or malformed file reads as undefined.
   * @param namespace - feature-owned name.
   * @returns the last saved value, or undefined.
   */
  const read = namespace => {
    if (loaded.has(namespace)) return loaded.get(namespace).value
    let value
    try {
      // A hand-edited file may carry a byte-order mark; JSON.parse rejects it.
      value = JSON.parse(readFileSync(fileFor(namespace), 'utf8').replace(/^\uFEFF/, ''))
    } catch {
      value = undefined
    }
    loaded.set(namespace, { value })
    return value
  }

  /**
   * Publish one namespace value and schedule its save.
   * @param namespace - feature-owned name.
   * @param value - JSON-serializable snapshot.
   */
  const write = (namespace, value) => {
    loaded.set(namespace, { value })
    if (timers.has(namespace)) return
    timers.set(namespace, setTimeout(() => {
      timers.delete(namespace)
      void save(namespace)
    }, SAVE_DELAY_MS))
  }

  /**
   * Save one namespace now, replacing its file atomically.
   * @param namespace - feature-owned name.
   */
  const save = async namespace => {
    const entry = loaded.get(namespace)
    if (entry === undefined) return
    try {
      await mkdir(directory, { recursive: true })
      const file = fileFor(namespace)
      const temporary = `${file}.tmp`
      await writeFile(temporary, JSON.stringify(entry.value), 'utf8')
      await rename(temporary, file)
    } catch (error) {
      warn(`state '${namespace}' could not be saved: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Save every touched namespace immediately; used when the suite unloads.
   * @returns resolution after all saves settle.
   */
  const flushAll = async () => {
    const pending = [...timers.values()]
    timers.clear()
    for (const timer of pending) clearTimeout(timer)
    await Promise.all([...loaded.keys()].map(namespace => save(namespace)))
  }

  return { read, write, flushAll, directory }
}
