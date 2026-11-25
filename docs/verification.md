# 验证

本仓库的改动分三层，验证手段不同。

## 1. 静态检查（每次都跑）

```powershell
node scripts/build.mjs
node scripts/check.mjs
```

`check.mjs` 覆盖：

- 两个生成产物是否**与源码同步**（`build.mjs --check`）；
- `package.json`、`locale/*.json` 能否解析；
- `client.js` 是否是可解析的 JS；
- 每个 Host 功能模块能否 `import`，是否导出 `id` 与 `setup`；
- Host 与 Client 的功能 id 是否一一对应（有则报 host-only / client-only）；
- 两端 RPC 路由字面量是否一致；
- `cordis.patch.yml` 是否插入了包名、是否为每个功能留了开关；
- `icon.svg` 是否为单根 SVG 且在 256 KiB 内；
- 清单是否声明了 `dsh.bundle.patch` 与 `dsh.client.platform`。

## 2. Host 侧运行时验证

装好后确认插件行活着：

```text
plugin_manager(action: "list_plugins", limit: 10, offset: 205)   # 找到 include:ui-ex
```

期望 `enabled: true`、`fiberPhase: "active"`。改过 Host 代码后**禁用再启用**该行，Loader 会重新导入模块。

路由是否挂上（未认证访问应得到 401 而不是 404）：

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:8917/dsh-ui-ex/rpc' -Method POST -Body '{"op":"$features"}' -ContentType 'application/json'
# 401 = 路由存在但被同源栅栏拒绝；404 = 没挂上
```

持久状态文件：

```powershell
Get-Content "$env:USERPROFILE\.dsh\dsh-ui-ex\workspace-recency.json"
```

工作区顺序（`workspace-recency` 功能的直接证据）：

```powershell
$ws = Get-Content "$env:USERPROFILE\.dsh\storages\workspace.json" -Raw | ConvertFrom-Json
$ws.global.workspaceIds | ForEach-Object { $ws.tables.workspaces.$_.title }
```

## 3. 浏览器侧验证

- 刷新页面后看控制台：正常情况没有任何 `ui-ex:` 报错；功能内部失败会打印 `ui-ex: [<id>] ...`。
- 槽位是否注册成功：`cordis_inspect_query`（client `Slots.listSubTree`，`root` 传槽位名）看 occupants。
- 右键菜单类功能：菜单项注册在 `ctx.contextMenus`，无法通过 inspect 查看，只能在实际 UI 上右键确认。

没有浏览器控制权时，明确区分 **已验证**（静态检查、Host 状态、持久化顺序）与 **未验证**（渲染、点击、主题表现），不要凭安装成功推断视觉效果。

## 4. 改动传播速查

| 改了什么 | 生效方式 |
|---|---|
| `src/host/**` | 禁用 → 启用 `ui-ex` 插件行 |
| `src/client/**` | `node scripts/build.mjs` 后**刷新页面** |
| `cordis.patch.yml` 的默认开关 | 重新启用插件行；用户的 profile patch 覆盖优先 |
| `locale/*.json` | 重新启用插件行（Plugin Manager 读导出资源） |
| `icon.svg` | 重新启用插件行，必要时重新打开设置页 |
| `assets/**`（如 Windows 安装脚本） | 直接生效（每次调用时读盘） |
