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
