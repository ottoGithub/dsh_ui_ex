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

    /* __UI_EX_SHARED__ */

    const uiEx = createUiEx({ React, ROUTE })

    /* __UI_EX_FEATURES__ */

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
