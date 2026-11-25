/**
 * Client runtime: feature registry, activation, RPC, and per-feature isolation.
 *
 * The suite ships one browser artifact for all of its features, so this file is
 * the whole framework a feature author touches on the client side:
 *
 * - `uiEx.define({ id, defaultEnabled, locales, setup })` registers a feature.
 * - `start(ctx)` asks the Host which features are switched on, then activates
 *   the matching ones. Each activation is isolated: a throwing feature is logged
 *   and skipped, and the remaining features still run.
 * - `setup(ctx, api)` receives `api.rpc`, `api.t`, `api.icon`, `api.h`,
 *   `api.onDispose`, and `api.warn`.
 *
 * @module ui-ex/client/shared/core
 */

/**
 * Build the suite runtime.
 * @param options - `React` from the module table and the Host route.
 * @returns the suite object with `define` and `start`.
 */
function createUiEx({ React, ROUTE }) {
  /** Registered feature definitions, in build order. */
  const features = []
  /** Cleanup callbacks collected from activated features. */
  const disposers = []

  /**
   * Report one suite problem without breaking activation.
   * @param message - what failed.
   */
  const warn = message => {
    try {
      console.warn(`ui-ex: ${message}`)
    } catch {
      // A hostile console must not break the suite.
    }
  }

  /**
   * POST one request to the suite route.
   * @param request - `{ feature?, op, payload? }`.
   * @returns the Host `value`, or throws with the Host error.
   */
  const request = async request => {
    const response = await fetch(ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(request),
      cache: 'no-store',
    })
    let body
    try {
      body = await response.json()
    } catch {
      body = undefined
    }
    if (!response.ok || body === undefined || body === null || body.ok !== true) {
      const reason = body !== undefined && body !== null && typeof body.error === 'string' ? ` ${body.error}` : ''
      throw new Error(`${request.feature === undefined ? 'suite' : request.feature}.${request.op} failed (${response.status}${reason})`)
    }
    return body.value
  }

  /**
   * Ask the Host which features are switched on.
   * @returns the enabled ids, or undefined when the Host could not be reached.
   */
  const fetchEnabled = async () => {
    try {
      const value = await request({ op: '$features' })
      return Array.isArray(value?.features) ? value.features.map(String) : undefined
    } catch (error) {
      warn(`feature switches are unknown, using build defaults (${error instanceof Error ? error.message : String(error)})`)
      return undefined
    }
  }

  /**
   * Activate one feature: its locale dictionaries, then its setup.
   * @param ctx - Client context of this plugin.
   * @param feature - the registered definition.
   * @param enabled - ids the Host reports, when known.
   */
  const activate = (ctx, feature, enabled) => {
    const ns = `ui-ex.${feature.id}`
    for (const [locale, dictionary] of Object.entries(feature.locales ?? {})) {
      ctx.effect(() => ctx.locale.register(ns, locale, dictionary), `ui-ex: ${feature.id} ${locale}`)
    }
    const t = ctx.locale.bind(ns)
    const api = {
      id: feature.id,
      /** Run one op of this feature on the Host. */
      rpc: (op, payload) => request({ feature: feature.id, op, payload }),
      /** Translate one key of this feature's namespace. */
      t,
      /** Shared glyphs (see `src/client/shared/icons.js`). */
      icon: uiExIcons,
      react: React,
      h: React.createElement,
      /** Register a cleanup that runs when the suite unloads. */
      onDispose: fn => {
        if (typeof fn === 'function') disposers.push(fn)
      },
      warn: message => warn(`[${feature.id}] ${message}`),
      /** Ids the Host reports as enabled; undefined when unknown. */
      enabledFeatures: enabled,
    }
    const instance = feature.setup(ctx, api)
    if (instance !== undefined && instance !== null && typeof instance.dispose === 'function') disposers.push(instance.dispose)
  }

  /**
   * Register one feature definition.
   * @param definition - `{ id, defaultEnabled?, locales?, setup }`.
   */
  const define = definition => {
    if (definition === null || typeof definition !== 'object') throw new Error('ui-ex: a feature definition must be an object')
    if (typeof definition.id !== 'string' || definition.id === '') throw new Error('ui-ex: a feature needs a non-empty id')
    if (typeof definition.setup !== 'function') throw new Error(`ui-ex: feature '${definition.id}' needs a setup function`)
    features.push(definition)
  }

  /**
   * Start the suite: resolve switches, then activate isolated features.
   * @param ctx - Client context of this plugin.
   */
  const start = ctx => {
    ctx.effect(() => () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch (error) {
          warn(`cleanup failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }, 'ui-ex: feature disposal')

    void (async () => {
      const enabled = await fetchEnabled()
      for (const feature of features) {
        const on = enabled === undefined
          ? feature.defaultEnabled !== false
          : enabled.includes(feature.id)
        if (!on) continue
        try {
          activate(ctx, feature, enabled)
        } catch (error) {
          warn(`[${feature.id}] activation failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
        }
      }
    })()
  }

  return { define, start }
}
