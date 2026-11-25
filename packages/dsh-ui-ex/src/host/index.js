/**
 * Host entry of the suite.
 *
 * The suite is one DSH bundle with one Host row. Everything it contributes is a
 * *feature module* under `features/`: this file only reads the row's config,
 * decides which features are enabled, gives each one a small runtime api, and
 * dispatches the shared RPC route to it.
 *
 * The feature table is generated (`features.generated.js`) from the directory, so
 * adding a feature is: write `features/<id>.js`, write `src/client/features/<id>.js`,
 * run `node scripts/build.mjs`. See `docs/adding-a-feature.md`.
 *
 * @module @local/dsh-ui-ex
 */
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ROUTE,
  createStateStore,
  readJsonBody,
  rejectUntrusted,
  sendJson,
} from './runtime.js'
import { FEATURES } from './features.generated.js'

export const name = 'ui-ex'

/**
 * The route needs the web server and the browser-trust fence; both exist in
 * every browser-capable profile. Features that need more services look them up
 * with `ctx.get()` and degrade to a logged no-op instead of blocking activation.
 */
export const inject = ['webServer', 'connection']

/**
 * Resolve one feature's effective switches: defaults, then row overrides.
 * A bare boolean in `config.features[id]` means `{ enabled: <boolean> }`.
 * @param defaults - the feature's declared defaults.
 * @param override - the row's value for this feature.
 * @returns the merged switches.
 */
function resolveOptions(defaults, override) {
  if (override === false) return { ...defaults, enabled: false }
  if (override === true || override === undefined || override === null) return { ...defaults }
  if (typeof override !== 'object') return { ...defaults }
  return { ...defaults, ...override }
}

/**
 * Activate the enabled feature modules and serve their RPC ops on one route.
 * @param ctx - Host context with webServer and connection.
 * @param config - the row's config; `config.features` switches features.
 */
export function apply(ctx, config) {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const rowConfig = config !== null && typeof config === 'object' ? config : {}
  const overrides = rowConfig.features !== null && typeof rowConfig.features === 'object' ? rowConfig.features : {}

  const warn = message => {
    try {
      ctx.logger?.warn?.(`ui-ex: ${message}`)
    } catch {
      // Logging must never break the suite.
    }
  }

  const state = createStateStore({ directory: join(home, 'dsh-ui-ex'), warn })

  /** id -> { rpc } for every feature that activated successfully. */
  const active = new Map()
  /** ids the browser half should activate; the source of truth for switches. */
  const enabled = []

  for (const feature of FEATURES) {
    const options = resolveOptions(feature.defaults ?? {}, overrides[feature.id])
    if (options.enabled === false) continue
    const api = {
      ctx,
      options,
      packageRoot,
      state: {
        read: () => state.read(feature.id),
        write: value => state.write(feature.id, value),
      },
      warn: message => warn(`[${feature.id}] ${message}`),
    }
    enabled.push(feature.id)
    try {
      const instance = feature.setup(ctx, api)
      active.set(feature.id, instance ?? {})
    } catch (error) {
      // One broken feature must not take its neighbours down.
      warn(`[${feature.id}] setup failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
      enabled.splice(enabled.indexOf(feature.id), 1)
    }
  }

  if (active.size === 0) {
    warn('no feature activated; the suite stays idle')
    return
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
      const body = await readJsonBody(req)
      if (!body.ok) {
        sendJson(res, body.status, { ok: false, error: body.status === 413 ? 'too-large' : 'bad-json' })
        return
      }
      const request = body.value
      if (request === null || typeof request !== 'object') {
        sendJson(res, 400, { ok: false, error: 'bad-request' })
        return
      }
      // Suite-level op: the browser half asks which features are on.
      if (request.op === '$features') {
        sendJson(res, 200, { ok: true, value: { features: enabled } })
        return
      }
      const feature = active.get(String(request.feature ?? ''))
      if (feature === undefined) {
        sendJson(res, 404, { ok: false, error: 'unknown-feature', value: { features: enabled } })
        return
      }
      const handler = feature.rpc?.[String(request.op ?? '')]
      if (typeof handler !== 'function') {
        sendJson(res, 400, { ok: false, error: 'unknown-op' })
        return
      }
      try {
        const value = await handler(request.payload ?? {}, ctx)
        sendJson(res, 200, { ok: true, value: value ?? null })
      } catch (error) {
        warn(`[${String(request.feature)}] op '${String(request.op)}' failed: ${error instanceof Error ? error.message : String(error)}`)
        sendJson(res, 500, { ok: false, error: 'operation-failed', message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), `ui-ex: POST ${ROUTE}`)

  ctx.effect(() => () => {
    for (const instance of active.values()) {
      try {
        instance.dispose?.()
      } catch (error) {
        warn(`dispose failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    void state.flushAll()
  }, 'ui-ex: feature disposal')
}
