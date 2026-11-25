# 新增一个功能

## 0. 先想清楚边界

- **Host 半**：文件、进程、持久状态、Workspace/Session 注册表 —— 浏览器做不到的事。
- **Client 半**：槽位渲染、右键菜单、快捷键、提示 —— 只要用户看得见的东西。
- 两者通过 `api.rpc(op, payload)` 通信，**不要**在 Client 半直接写 DOM 或猜测别的插件内部结构。

## 1. 生成骨架

```powershell
node scripts/new-feature.mjs sidebar-clock "侧栏时钟" "Sidebar clock"
```

它会：

- 生成 `packages/dsh-ui-ex/src/host/features/sidebar-clock.js`（含一个可用的 `ping` op）；
- 生成 `packages/dsh-ui-ex/src/client/features/sidebar-clock.js`（含 en/zh 文案骨架，启动时调用 `ping`）；
- 在 `cordis.patch.yml` 的 `features:` 下补一行 `sidebar-clock: true`（缺省时）；
- 自动重新构建两个产物。

> 脚本只在 id 首次出现时改 patch；如果你手动删了那一行，再跑一次即可补回。

## 2. 写 Host 半

```js
export const id = 'sidebar-clock'
export const defaults = { enabled: true, format: '24h' }

export function setup(ctx, api) {
  const stored = api.state.read()          // 上次持久化的 JSON，可能是 undefined
  return {
    rpc: {
      state: () => ({ format: api.options.format }),
      setFormat: payload => {
        const format = payload?.format === '12h' ? '12h' : '24h'
        api.state.write({ format })
        return { format }
      },
    },
  }
}
```

要点：

- 需要额外服务：`ctx.get('service')`，缺失时 `api.warn` + 返回 `{}`（软降级），别让整个套件挂掉。
- 任何监听器/定时器都用 `ctx.effect` 注册，卸载自动清理。
- 持久状态只用 `api.state`，不要自己拼路径。
- 需要原生资源（脚本、exe 源码）：放 `packages/dsh-ui-ex/assets/<id>/`，用 `join(api.packageRoot, 'assets', '<id>', ...)` 定位。

## 3. 写 Client 半

```js
uiEx.define({
  id: 'sidebar-clock',
  locales: {
    en: { label: 'Clock' },
    zh: { label: '时钟' },
  },
  setup(ctx, api) {
    const format = api.t('label')
    ctx.effect(() => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'ui-ex.clock',
      order: 40,
    }, () => api.h('span', { title: format }, new Date().toLocaleTimeString())),
    'ui-ex/sidebar-clock: footer clock')
    return {}
  },
})
```

要点：

- 先查槽位：用 `cordis_inspect_query`（`Slots.listSubTree`）确认槽位名、注册参数、owner props；**优先可加挂的 list 槽**，避免替换内置单槽（会 shadow 整个内置 UI）。
- 文案走 `api.t`，字典放本功能的 `locales`，命名空间自动是 `ui-ex.<id>`。
- 图标优先复用 `api.icon`；确实需要新图形时优先用主题 token 着色的内联 SVG，并放在功能文件里。
- 需要的客户端服务用 `ctx.get('contextMenus')` / `ctx.get('workspaces')` 等；`inject` 只加运行时硬依赖。
- 每个注册都用 `ctx.effect` 或 `api.onDispose`，保证卸载干净。

## 4. 构建与自检

```powershell
node scripts/build.mjs     # 重写 client.js 与 features.generated.js
node scripts/check.mjs     # 产物新鲜度、JSON、语法、id 配对、路由一致、patch、图标
```

`check` 必须全绿再继续。

## 5. 装上验证

```text
plugin_manager(action: "install_bundle", target: "E:\\github\\dsh_ui_ex\\packages\\dsh-ui-ex")
```

- 已经装过的话：改动 Host 代码后**禁用再启用** `ui-ex` 插件行（Loader 会重新导入模块）。
- **Client 代码改动必须刷新页面**（`client.js` 是启动时加载的产物）。
- 浏览器侧问题看页面控制台：套件日志统一以 `ui-ex:` 开头，功能内错误带 `[<id>]` 前缀。

具体可用的验证手段见 [verification.md](verification.md)。

## 6. 收尾

- 功能文档：`docs/features/<id>.md`（做什么、怎么用、限制）。
- 更新根 `README.md` 的功能表。
- `locale/{en,zh}.json` 的 `meta.description` 若功能集变了，同步改写。
- 提交前跑一次 `node scripts/build.mjs && node scripts/check.mjs`。
