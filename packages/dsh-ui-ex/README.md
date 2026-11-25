# @local/dsh-ui-ex

DeepSeek Harness UI 强化套件：一个 bundle，多个可独立开关的功能。

## 功能

| 功能 id | 说明 | 文档 |
|---|---|---|
| `workspace-recency` | 侧栏工作区按「最近更新」排序（规则同会话列表），并支持右键置顶 | [docs/features/workspace-recency.md](../../docs/features/workspace-recency.md) |
| `open-in-dsh` | Windows 资源管理器右键「在 DeepSeek Harness 中打开」 | [docs/features/open-in-dsh.md](../../docs/features/open-in-dsh.md) |

## 安装

把**本目录**（`packages/dsh-ui-ex`）作为本地插件安装：

```text
plugin_manager(action: "install_bundle", target: "E:\\github\\dsh_ui_ex\\packages\\dsh-ui-ex")
```

或在 DSH 里 **设置 → 插件 → 添加本地插件** 选中本目录。

## 开关

功能开关在这个 bundle 的 Host 行配置里（`config.features`），默认全开：

```yaml
config:
  features:
    workspace-recency: true
    open-in-dsh: true
```

用户在自己的 profile patch 里覆盖时，需要整块复制该行（覆盖层替换整个 `config`）。可以写成对象覆盖功能的默认参数，例如：

```yaml
features:
  workspace-recency: { enabled: true, reconcileSeconds: 30 }
  open-in-dsh: { enabled: true, autoInstall: false }
```

## 开发

```powershell
node scripts/build.mjs     # 生成 client.js 与 features.generated.js
node scripts/check.mjs     # 产物新鲜度 / 语法 / id 配对 / 路由 / patch / 图标
node scripts/new-feature.mjs my-feature "我的功能" "My feature"
```

这份 `client.js` 是**生成物**，不要手改：改 `src/client/**` 后重新构建，再刷新页面。Host 代码改动后禁用再启用 `ui-ex` 插件行即可。

架构说明见 [docs/architecture.md](../../docs/architecture.md)，新增功能的流程见 [docs/adding-a-feature.md](../../docs/adding-a-feature.md)。

## 许可

[MIT](../../LICENSE)
