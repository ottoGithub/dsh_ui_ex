/**
 * GENERATED FILE — do not edit.
 *
 * Assembled by `node scripts/build.mjs` from `packages/dsh-ui-ex/src/client/`.
 * Edit the sources there and rebuild; `node scripts/check.mjs` fails on a stale artifact.
 */
/**
 * Client-half template for the browser artifact.
 *
 * `scripts/build.mjs` turns this file into `packages/dsh-ui-ex/client.js` by
 * replacing the two markers: the shared helpers land inside the factory, then
 * the suite object is created, then every feature module registers itself.
 *
 * The browser cannot import sibling files at runtime, which is why the artifact
 * is assembled ahead of time. Do not edit `client.js`; edit these sources and
 * run `node scripts/build.mjs`.
 *
 * @module ui-ex/client/entry
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-ui-ex',
  factory(require) {
    const React = require('react')
    /** Must match `ROUTE` in `src/host/runtime.js`; `scripts/check.mjs` enforces it. */
    const ROUTE = '/dsh-ui-ex/rpc'

    // ---- src/client/shared/core.js ----
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

    // ---- src/client/shared/icons.js ----
/**
 * Shared glyphs, so every feature draws the same marks the shipped UI draws.
 *
 * The pin geometry is the Fluent 16px pushpin the Session rows use; keeping one
 * copy here is what makes a workspace pin look exactly like a Session pin.
 *
 * @module ui-ex/client/shared/icons
 */

/** Fluent pushpin body, 16×16 viewBox. */
const UI_EX_PIN_BODY = 'M9.96976 1.70572L13.1554 3.93629L10.9019 8.12317L11.5158 11.605L10.7192 12.7427L2.52767 7.00693L3.3243 5.86922L6.80612 5.25528L9.96976 1.70572Z'

/** Fluent pushpin needle, 16×16 viewBox. */
const UI_EX_PIN_NEEDLE = 'M6.05285 9.47511C6.27284 9.16094 6.70586 9.08458 7.02003 9.30457C7.3342 9.52455 7.41055 9.95757 7.19057 10.2717L3.98587 14.4708L3.21223 13.9291L6.05285 9.47511Z'

const uiExIcons = {
  /**
   * The pushpin, in the same two states the Session rows use.
   * @param options - `{ filled }`: filled marks a pinned target.
   * @param size - rendered edge length in pixels.
   * @returns the icon element.
   */
  pin(options, size = 16) {
    const filled = options !== undefined && options !== null && options.filled === true
    return React.createElement(
      'svg',
      {
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        strokeWidth: 1,
        'aria-hidden': true,
        style: { display: 'block' },
      },
      React.createElement('path', {
        d: UI_EX_PIN_BODY,
        fill: filled ? 'currentColor' : 'none',
        stroke: 'currentColor',
        strokeLinejoin: 'round',
      }),
      React.createElement('path', { d: UI_EX_PIN_NEEDLE, fill: 'currentColor' }),
    )
  },
}

    const uiEx = createUiEx({ React, ROUTE })

    // ---- src/client/features/open-in-dsh.js ----
/**
 * Feature: open a folder from the Windows Explorer context menu (browser half).
 *
 * The browser has no file system, so this half asks the Host for a queued
 * hand-off, registers the folder as a Workspace, and opens it in the current
 * window. Polling is cheap: the Host op reads one small directory and answers
 * `null` while the queue is empty.
 *
 * @module ui-ex/client/features/open-in-dsh
 */
uiEx.define({
  id: 'open-in-dsh',
  setup(ctx, api) {
    /** Hand-off polling period; the route costs one directory read. */
    const POLL_MS = 800

    const workspaces = ctx.get('workspaces')
    const uiWorkspace = ctx.get('uiWorkspace')
    if (workspaces === undefined || uiWorkspace === undefined) {
      api.warn('workspace services are unavailable here, so Explorer hand-offs stay inactive')
      return {}
    }

    let inFlight = false
    /** Consume at most one queued hand-off per tick. */
    const consume = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const value = await api.rpc('next')
        const path = value !== null && typeof value === 'object' ? value.path : undefined
        if (typeof path !== 'string' || path.length === 0) return
        const workspace = await workspaces.create({ path })
        await uiWorkspace.openWorkspace(workspace.workspaceId)
      } catch {
        // A failed open (missing folder, refused creation) is not retried for
        // this hand-off; the Host already consumed the queue entry.
      } finally {
        inFlight = false
      }
    }

    ctx.effect(() => {
      const timer = setInterval(consume, POLL_MS)
      consume()
      return () => clearInterval(timer)
    }, 'ui-ex/open-in-dsh: consume Explorer hand-offs')

    return {}
  },
})

    // ---- src/client/features/workspace-recency.js ----
/**
 * Feature: workspace recency order and pinning (browser half).
 *
 * The Host keeps the durable order; this half contributes what the Host cannot
 * reach from a browser:
 *
 * - the workspace context-menu action that pins and unpins a workspace, drawn
 *   with the same pushpin glyph the Session rows use, and
 * - the recency feed: the browser already holds every Session summary the
 *   sidebar sorts by, including Sessions the Host never activated.
 *
 * @module ui-ex/client/features/workspace-recency
 */
uiEx.define({
  id: 'workspace-recency',
  locales: {
    en: {
      pin: 'Pin workspace',
      unpin: 'Unpin workspace',
      pinned: 'Workspace pinned',
      unpinned: 'Workspace unpinned',
      failed: 'The workspace pin could not be updated. Try again.',
    },
    zh: {
      pin: '置顶工作区',
      unpin: '取消置顶工作区',
      pinned: '工作区已置顶',
      unpinned: '已取消置顶',
      failed: '无法更新工作区置顶，请稍后重试。',
    },
  },
  setup(ctx, api) {
    /** Menu icon keys this feature owns inside `contextMenu.icon`. */
    const ICON_OUTLINE = 'ui-ex.workspace-pin.outline'
    const ICON_FILLED = 'ui-ex.workspace-pin.filled'
    /** How long activity bursts are collected before one recency push. */
    const SYNC_DELAY_MS = 1200

    const contextMenus = ctx.get('contextMenus')
    const sessions = ctx.get('sessions')
    const workspaces = ctx.get('workspaces')
    if (contextMenus === undefined || sessions === undefined || workspaces === undefined) {
      api.warn('the sidebar services are unavailable here, so workspace pins stay inactive')
      return {}
    }

    /** Pinned workspace ids, replaced (never mutated) on every publish. */
    let pinned = new Set()
    const listeners = new Set()
    /** Snapshot source the menu observes so a toggle re-resolves it. */
    const pinStore = {
      getSnapshot: () => pinned,
      subscribe: listener => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    }

    /**
     * Subscribe to a store handle when it exposes one.
     * @param source - snapshot source.
     * @param listener - change listener.
     * @returns the unsubscribe function, or undefined when not subscribable.
     */
    const subscribe = (source, listener) => {
      if (source === null || typeof source !== 'object') return undefined
      if (typeof source.subscribe !== 'function') return undefined
      try {
        const dispose = source.subscribe(listener)
        return typeof dispose === 'function' ? dispose : () => {}
      } catch {
        return undefined
      }
    }

    /**
     * Publish one pin set from a Host answer.
     * @param value - `pinned` field of the Host value.
     */
    const publish = value => {
      const next = new Set(Array.isArray(value) ? value.map(String) : [])
      if (next.size === pinned.size) {
        let same = true
        for (const workspaceId of next) {
          if (!pinned.has(workspaceId)) {
            same = false
            break
          }
        }
        if (same) return
      }
      pinned = next
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch {
          // One broken observer must not stop the others.
        }
      }
    }

    /**
     * Call one op and adopt the pin set it returns.
     * @param op - feature op name.
     * @param payload - op payload.
     * @returns the Host value.
     */
    const call = async (op, payload) => {
      const value = await api.rpc(op, payload)
      if (value !== null && typeof value === 'object' && value.pinned !== undefined) publish(value.pinned)
      return value
    }

    let refreshing = false
    /** Re-read the pin set from the Host, coalescing concurrent calls. */
    const refresh = () => {
      if (refreshing) return
      refreshing = true
      void call('state')
        .catch(() => {})
        .finally(() => {
          refreshing = false
        })
    }

    let syncTimer = null
    let lastPushed = ''
    /** Send the Session recency map the sidebar already sorts by. */
    const pushRecency = async () => {
      const snapshot = sessions.list.getSnapshot()
      const byId = snapshot !== null && typeof snapshot === 'object' ? snapshot.byId : undefined
      if (byId === null || typeof byId !== 'object') return
      const entries = []
      for (const [sessionId, row] of Object.entries(byId)) {
        const updatedAt = Number(row?.updatedAt)
        if (!Number.isFinite(updatedAt) || updatedAt <= 0) continue
        entries.push([sessionId, updatedAt])
      }
      if (entries.length === 0) return
      const signature = JSON.stringify(entries)
      if (signature === lastPushed) return
      lastPushed = signature
      try {
        await call('sync', { entries })
      } catch {
        lastPushed = ''
      }
    }

    /** Defer one recency push so a burst of activity costs one request. */
    const schedulePush = () => {
      if (syncTimer !== null) return
      syncTimer = setTimeout(() => {
        syncTimer = null
        void pushRecency()
      }, SYNC_DELAY_MS)
    }

    ctx.effect(() => {
      const unsubscribe = subscribe(sessions.list, schedulePush)
      schedulePush()
      // A handle without a subscription still needs a periodic push.
      const timer = unsubscribe === undefined ? setInterval(schedulePush, 5000) : null
      return () => {
        if (unsubscribe !== undefined) unsubscribe()
        if (timer !== null) clearInterval(timer)
        if (syncTimer !== null) {
          clearTimeout(syncTimer)
          syncTimer = null
        }
      }
    }, 'ui-ex/workspace-recency: recency feed')

    ctx.effect(() => {
      const unsubscribe = subscribe(workspaces.list, refresh)
      refresh()
      const timer = unsubscribe === undefined ? setInterval(refresh, 5000) : null
      const onVisibility = () => {
        if (document.visibilityState === 'visible') refresh()
      }
      document.addEventListener('visibilitychange', onVisibility)
      return () => {
        if (unsubscribe !== undefined) unsubscribe()
        if (timer !== null) clearInterval(timer)
        document.removeEventListener('visibilitychange', onVisibility)
      }
    }, 'ui-ex/workspace-recency: pin state feed')

    api.onDispose(() => {
      if (syncTimer !== null) {
        clearTimeout(syncTimer)
        syncTimer = null
      }
    })

    ctx.slots.inject('contextMenu.icon', function* registerMenuIcons() {
      yield ctx.slots.register({ name: 'contextMenu.icon', key: ICON_OUTLINE }, () => api.icon.pin({ filled: false }))
      yield ctx.slots.register({ name: 'contextMenu.icon', key: ICON_FILLED }, () => api.icon.pin({ filled: true }))
    })

    /**
     * Resolve one menu target payload to a workspace id.
     * @param value - context menu target payload.
     * @returns the workspace id, or an empty string.
     */
    const workspaceIdOf = value => {
      if (value === null || typeof value !== 'object') return ''
      return typeof value.workspaceId === 'string' ? value.workspaceId : ''
    }

    /**
     * Whether this peer may reorder workspaces, mirroring the access the shipped
     * drag gesture needs. An unknown answer keeps the action available.
     * @param workspaceId - target workspace.
     * @returns false only when access was explicitly refused.
     */
    const canReorder = workspaceId => {
      const remoteAccess = ctx.get('remoteAccess')
      try {
        const source = remoteAccess?.source?.('workspace', workspaceId, 'workspace/insertBefore')
        if (source === undefined || typeof source.getSnapshot !== 'function') return true
        return source.getSnapshot() !== false
      } catch {
        return true
      }
    }

    ctx.effect(() => contextMenus.register({
      id: 'workspace.pin',
      target: 'workspace',
      order: 200,
      observe: value => {
        const workspaceId = workspaceIdOf(value)
        const sources = [pinStore, ctx.locale, workspaces.list]
        if (workspaceId !== '') {
          try {
            const access = ctx.get('remoteAccess')?.source?.('workspace', workspaceId, 'workspace/insertBefore')
            if (access !== undefined) sources.push(access)
          } catch {
            // An unreadable access source must not hide the action.
          }
        }
        return sources
      },
      resolve: value => {
        const workspaceId = workspaceIdOf(value)
        if (workspaceId === '') return []
        if (!canReorder(workspaceId)) return []
        const isPinned = pinStore.getSnapshot().has(workspaceId)
        return [{
          id: 'toggle',
          label: api.t(isPinned ? 'unpin' : 'pin'),
          icon: { key: isPinned ? ICON_FILLED : ICON_OUTLINE },
          failureLabel: api.t('failed'),
          run: async () => {
            const result = await call('toggle', { workspaceId })
            const nowPinned = Array.isArray(result?.pinned) && result.pinned.includes(workspaceId)
            try {
              // A pinned workspace moves, but not always visibly; confirm it.
              contextMenus.notify?.(api.t(nowPinned ? 'pinned' : 'unpinned'), true)
            } catch {
              // Feedback is optional; the reorder already happened.
            }
          },
        }]
      },
    }), 'ui-ex/workspace-recency: workspace menu action')

    return {}
  },
})

    return {
      // Hard dependencies of the runtime itself. Every other service is looked
      // up with `ctx.get()` by the feature that needs it, so a profile without
      // one degrades that feature instead of the whole suite.
      inject: ['slots', 'locale'],
      apply(ctx) {
        uiEx.start(ctx)
      },
    }
  },
})
