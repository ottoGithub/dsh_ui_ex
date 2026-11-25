/**
 * Client half of workspace-recency-pin.
 *
 * The built-in sidebar draws workspaces in the Host's durable registry order,
 * so the visible sort is performed by the Host half. This half contributes
 * everything the Host half cannot reach:
 *
 * - the workspace row's "..." menu action that pins and unpins a workspace,
 *   drawn with the same pin glyph the Session rows use, and
 * - the recency feed: the browser already holds every Session summary the
 *   sidebar sorts by, including Sessions this process has not activated.
 *
 * Neither half replaces a shipped slot; the menu action is an additive
 * contribution to the existing workspace menu.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-workspace-recency-pin',
  factory(require) {
    const React = require('react')

    /** Client locale namespace of this plugin. */
    const NS = 'workspace-pin'
    /** Same-origin route the Host half serves. */
    const ENDPOINT = '/workspace-recency-pin/rpc'
    /** Menu icon keys, registered into `contextMenu.icon`. */
    const ICON_OUTLINE = 'workspace-pin.outline'
    const ICON_FILLED = 'workspace-pin.filled'
    /** How long activity bursts are collected before one recency push. */
    const SYNC_DELAY_MS = 1200

    /**
     * The pin glyph, copied from the Fluent 16px pushpin the Session rows use
     * so a pinned workspace reads exactly like a pinned Session.
     */
    const PIN_BODY = 'M9.96976 1.70572L13.1554 3.93629L10.9019 8.12317L11.5158 11.605L10.7192 12.7427L2.52767 7.00693L3.3243 5.86922L6.80612 5.25528L9.96976 1.70572Z'
    const PIN_NEEDLE = 'M6.05285 9.47511C6.27284 9.16094 6.70586 9.08458 7.02003 9.30457C7.3342 9.52455 7.41055 9.95757 7.19057 10.2717L3.98587 14.4708L3.21223 13.9291L6.05285 9.47511Z'

    const DICTIONARIES = {
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
    }

    /**
     * Render the pin glyph.
     * @param props - `filled` selects the solid variant used for a pinned row.
     * @returns the icon element.
     */
    function PinGlyph(props) {
      const filled = props !== undefined && props.filled === true
      return React.createElement(
        'svg',
        {
          xmlns: 'http://www.w3.org/2000/svg',
          viewBox: '0 0 16 16',
          width: 16,
          height: 16,
          fill: 'none',
          strokeWidth: 1,
          'aria-hidden': true,
          style: { display: 'block' },
        },
        React.createElement('path', {
          d: PIN_BODY,
          fill: filled ? 'currentColor' : 'none',
          stroke: 'currentColor',
          strokeLinejoin: 'round',
        }),
        React.createElement('path', { d: PIN_NEEDLE, fill: 'currentColor' }),
      )
    }

    /** Outline variant: the workspace is not pinned yet. */
    function PinOutline() {
      return React.createElement(PinGlyph, { filled: false })
    }

    /** Solid variant: the workspace is pinned. */
    function PinFilled() {
      return React.createElement(PinGlyph, { filled: true })
    }

    return {
      inject: ['slots', 'locale', 'contextMenus', 'workspaces', 'sessions', 'remoteAccess'],
      apply(ctx) {
        for (const [locale, dictionary] of Object.entries(DICTIONARIES)) {
          ctx.effect(() => ctx.locale.register(NS, locale, dictionary), `workspace-pin: ${locale} dictionary`)
        }
        const t = ctx.locale.bind(NS)

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
         * Publish one pin set from a Host response.
         * @param value - `pinned` field of the Host response.
         */
        const publish = value => {
          const next = new Set(Array.isArray(value) ? value.map(String) : [])
          if (next.size === pinned.size) {
            let same = true
            for (const id of next) {
              if (!pinned.has(id)) {
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
         * Call the Host half and adopt the returned pin set.
         * @param request - request payload.
         * @returns the Host response.
         */
        const call = async request => {
          const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(request),
            cache: 'no-store',
          })
          if (!response.ok) throw new Error(`workspace pin request failed (${response.status})`)
          const value = await response.json()
          if (value === null || typeof value !== 'object') throw new Error('workspace pin request returned no object')
          if (value.pinned !== undefined) publish(value.pinned)
          return value
        }

        let refreshing = false
        /** Re-read the pin set from the Host half, coalescing concurrent calls. */
        const refresh = () => {
          if (refreshing) return
          refreshing = true
          void call({ op: 'state' })
            .catch(() => {})
            .finally(() => {
              refreshing = false
            })
        }

        let syncTimer = null
        let lastPushed = ''
        /** Send the Session recency map the sidebar already sorts by. */
        const pushRecency = async () => {
          const snapshot = ctx.sessions.list.getSnapshot()
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
            await call({ op: 'sync', entries })
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

        /**
         * Subscribe to a store handle when it exposes one.
         * @param source - snapshot source.
         * @param listener - change listener.
         * @returns the unsubscribe function, or undefined when the handle is not subscribable.
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

        ctx.effect(() => {
          const unsubscribe = subscribe(ctx.sessions.list, schedulePush)
          schedulePush()
          // A handle without a subscription still needs a periodic recency push.
          const timer = unsubscribe === undefined ? setInterval(schedulePush, 5000) : null
          return () => {
            if (unsubscribe !== undefined) unsubscribe()
            if (timer !== null) clearInterval(timer)
            if (syncTimer !== null) {
              clearTimeout(syncTimer)
              syncTimer = null
            }
          }
        }, 'workspace-pin: recency feed')

        ctx.effect(() => {
          const unsubscribe = subscribe(ctx.workspaces.list, refresh)
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
        }, 'workspace-pin: pin state feed')

        ctx.slots.inject('contextMenu.icon', function* registerMenuIcons() {
          yield ctx.slots.register({ name: 'contextMenu.icon', key: ICON_OUTLINE }, PinOutline)
          yield ctx.slots.register({ name: 'contextMenu.icon', key: ICON_FILLED }, PinFilled)
        })

        /**
         * Resolve one menu target payload to a workspace id.
         * @param value - context menu target payload.
         * @returns the workspace id, or an empty string.
         */
        const workspaceIdOf = value => {
          if (value === null || typeof value !== 'object') return ''
          const workspaceId = value.workspaceId
          return typeof workspaceId === 'string' ? workspaceId : ''
        }

        /**
         * Whether this peer may reorder workspaces, mirroring the access the
         * shipped drag gesture needs. An unknown answer keeps the action.
         * @param workspaceId - target workspace.
         * @returns false only when access was explicitly refused.
         */
        const canReorder = workspaceId => {
          try {
            const source = ctx.remoteAccess?.source?.('workspace', workspaceId, 'workspace/insertBefore')
            if (source === undefined || typeof source.getSnapshot !== 'function') return true
            return source.getSnapshot() !== false
          } catch {
            return true
          }
        }

        ctx.effect(() => ctx.contextMenus.register({
          id: 'workspace.pin',
          target: 'workspace',
          order: 200,
          observe: value => {
            const workspaceId = workspaceIdOf(value)
            const sources = [pinStore, ctx.locale, ctx.workspaces.list]
            if (workspaceId !== '') {
              try {
                const access = ctx.remoteAccess?.source?.('workspace', workspaceId, 'workspace/insertBefore')
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
              label: t(isPinned ? 'unpin' : 'pin'),
              icon: { key: isPinned ? ICON_FILLED : ICON_OUTLINE },
              failureLabel: t('failed'),
              run: async () => {
                const result = await call({ op: 'toggle', workspaceId })
                const nowPinned = Array.isArray(result.pinned) && result.pinned.includes(workspaceId)
                try {
                  // A pinned workspace moves, but not always visibly; confirm it.
                  ctx.contextMenus.notify?.(t(nowPinned ? 'pinned' : 'unpinned'), true)
                } catch {
                  // Feedback is optional; the reorder already happened.
                }
              },
            }]
          },
        }), 'workspace-pin: workspace menu action')
      },
    }
  },
})
