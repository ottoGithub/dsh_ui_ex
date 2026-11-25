# 架构

本仓库是一个 **bundle + 功能模块** 的 DSH 插件套件。这一篇解释为什么这么切、两半各自的契约是什么、以及新增功能时哪些地方绝对不能破。

## 为什么是「一个 bundle」

DSH 里一个 bundle 对应：

- `package.json` 的 `dsh.bundle.patch` —— 一条（或多条）Host 插件行；
- `package.json` 的 `dsh.client` —— **一个**浏览器产物，由 `window.__ModuleLoader__.load` 加载。

浏览器产物是单文件脚本，工厂函数里的 `require` 只能解析运行时模块表（`react`、`@deepseek-ai/dsh-client-*` 静态表）和已注册的插件包，**不能 import 同仓库的其他文件**。而 profile 用 `link:` 安装本地目录，Host 侧也无法跨包解析同仓库的兄弟包依赖。

所以「多个包共享一套运行时」在这套安装模型下不可行。把 N 个 UI 强化功能做成一个 bundle（一个安装项、一个图标、一份共享运行时）才是省事且可维护的做法。代价是整包一起启用/禁用 —— 用**功能开关**补回来。

## 目录职责

```text
packages/dsh-ui-ex/
├─ index.js                     Host 入口，仅 re-export src/host/index.js
├─ client.js                    浏览器产物（脚本生成，勿手改）
├─ src/host/
│  ├─ index.js                  Host 运行时装配：读 config、启停功能、派发 RPC
│  ├─ runtime.js                共享设施：路由 + 同源栅栏 + 请求体上限 + 状态存储
│  ├─ features/<id>.js          一个功能一个文件
│  └─ features.generated.js     功能表（脚本生成）
├─ src/client/
│  ├─ entry.js                  浏览器产物模板（含两个构建标记）
│  ├─ shared/core.js            功能注册表、激活、RPC、故障隔离
│  ├─ shared/icons.js           共享图标（sessions 同款 pin）
│  └─ features/<id>.js          一个功能一个文件
├─ assets/<id>/                 某功能需要的原生资源（如 Windows 安装脚本）
├─ locale/{en,zh}.json          plugin 页标题与说明（meta）
└─ cordis.patch.yml             Host 行 + 默认功能开关
```

## 两端契约

### Host 功能模块

```js
export const id = 'workspace-recency'
export const defaults = { enabled: true, reconcileSeconds: 60 }
export function setup(ctx, api) {
  return {
    rpc: { state: () => ..., toggle: payload => ... },
    dispose: () => {},
  }
}
```

`api`：

| 字段 | 用途 |
|---|---|
| `options` | `defaults` 与 `config.features[<id>]` 合并后的开关/参数 |
| `state.read()` / `state.write(value)` | 该功能独占的持久 JSON（`<harness home>/dsh-ui-ex/<id>.json`，写入去抖） |
| `packageRoot` | 包根绝对路径，用于 `assets/` |
| `warn(message)` | 带功能前缀的日志 |
| `ctx` | Host Cordis 上下文；副作用一律用 `ctx.effect` / `ctx.on` 注册 |

约定与陷阱：

- 需要额外服务时用 `ctx.get('workspaceRegistry')` 之类的**软依赖**，缺失时 `api.warn` 并返回 `{}`，不要 throw —— 否则整个套件会因一个功能而停摆。
- `setup` 抛错会被运行时捕获，该功能记为未启用，其他功能照常。
- 状态的读写都走 `api.state`，不要自己算路径、不要自己写文件。

### Client 功能模块

```js
uiEx.define({
  id: 'workspace-recency',
  locales: { en: {...}, zh: {...} },
  setup(ctx, api) { return {} },
})
```

`api`：

| 字段 | 用途 |
|---|---|
| `rpc(op, payload)` | 调用本功能 Host 侧的 `rpc[op]`，返回 Host 的 `value`，失败 throw |
| `t(key, params)` | 本功能命名空间（`ui-ex.<id>`）下的文案 |
| `icon` | 共享图标，例如 `api.icon.pin({ filled: true })` |
| `h` / `react` | `React.createElement` 与 React 本体 |
| `onDispose(fn)` | 套件卸载时执行 |
| `warn(message)` | 带功能前缀的 `console.warn` |
| `enabledFeatures` | Host 报告的功能列表（拿不到时为 `undefined`） |

- 槽位、菜单图标等一律用 `ctx.slots.inject(...)` 声明，卸载时自动清掉。
- 需要的客户端服务用 `ctx.get('contextMenus')`；`inject` 里只保留 `slots` 与 `locale` 这两个运行时自身硬依赖。
- 激活被逐个 `try/catch` 包裹：一个功能抛错只影响它自己。

## RPC

两端共用一个同源路由 `/dsh-ui-ex/rpc`（`src/host/runtime.js` 与 `src/client/entry.js` 各有一份字面量，`scripts/check.mjs` 会校验一致）。

请求：`{ feature?: string, op: string, payload?: unknown }`

- `op: '$features'` —— 套件级，返回 `{ features: ['workspace-recency', 'open-in-dsh'] }`。
- 其余 —— 派发到 `feature.rpc[op](payload, ctx)`。

响应：`{ ok: true, value }` 或 `{ ok: false, error, message? }`。路由带 `connection.requestRejection` 同源栅栏，并限制请求体大小（1 MiB）。

## 功能开关

`cordis.patch.yml` 里默认全开：

```yaml
config:
  features:
    workspace-recency: true
    open-in-dsh: true
```

- `true` / `false`：启用或停用。
- 对象：在启用之外覆盖 `defaults`，例如 `open-in-dsh: { enabled: true, autoInstall: false }`。
- 用户的 profile patch 若要改，必须**整块复制**该行（覆盖层会替换整个 `config`）。
- 浏览器侧只激活 Host 报告为启用的功能；Host 不可达时退回构建期默认值（每个功能 `defaultEnabled`，缺省为启用）。

## 构建

两个产物都由 `node scripts/build.mjs` 生成：

1. `client.js`：`src/client/shared/*.js`（按文件名排序）+ `src/client/features/*.js` 依次拼进 `entry.js` 模板的两个标记处。
2. `src/host/features.generated.js`：把 `src/host/features/*.js` 逐个 import 成一张表。

因此新增功能不需要在任何地方登记 —— 放对目录、跑构建即可。`node scripts/check.mjs` 会在产物过期时失败，避免「源码改了、装上去的还是旧的」。
