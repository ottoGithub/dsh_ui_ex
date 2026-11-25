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
