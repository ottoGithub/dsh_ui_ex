# dsh_ui_ex

DeepSeek Harness（DSH）UI 强化套件。仓库里只有一个可安装的 bundle：`packages/dsh-ui-ex`，里面按功能模块切成一块一块，后续功能不断加在这里。

## 功能

| 功能 id | 说明 |
|---|---|
| `workspace-recency` | 侧栏工作区按「最近更新」排序（规则同会话列表），支持右键 / 「⋯」菜单置顶，图标与会话行一致 —— [文档](docs/features/workspace-recency.md) |
| `open-in-dsh` | Windows 资源管理器右键「在 DeepSeek Harness 中打开」，把该文件夹作为工作区在当前窗口打开 —— [文档](docs/features/open-in-dsh.md) |

## 安装

```text
plugin_manager(action: "install_bundle", target: "E:\\github\\dsh_ui_ex\\packages\\dsh-ui-ex")
```

或在 DSH 里 **设置 → 插件 → 添加本地插件** 选中 `packages/dsh-ui-ex`。

装好后：

- 工作区排序与置顶立即生效；
- 「从资源管理器打开」首次启动会弹一次 UAC 注册右键菜单（不想被自动提权，见下方开关）。

## 开关

功能开关在 bundle 的 Host 行配置里（`config.features`，默认全开）：

```yaml
config:
  features:
    workspace-recency: true
    open-in-dsh: true
```

在自己的 profile patch 里覆盖时**整块复制该行**（覆盖层替换整个 `config`），可以顺带改功能参数：

```yaml
features:
  workspace-recency: { enabled: true, reconcileSeconds: 30 }
  open-in-dsh: { enabled: true, autoInstall: false }
```

## 仓库结构

```text
dsh_ui_ex/
├─ packages/dsh-ui-ex/      唯一的 bundle（Host 入口 + 生成的浏览器产物 + 功能模块 + 资源）
│  ├─ src/host/features/    一个功能一个 Host 模块
│  ├─ src/client/features/  一个功能一个 Client 模块
│  ├─ assets/               功能需要的原生资源（如 Windows 安装脚本）
│  └─ cordis.patch.yml      插件行 + 默认功能开关
├─ scripts/                 build / check / new-feature（零依赖，纯 Node）
├─ docs/                    架构、新增功能、验证、逐功能文档
└─ LICENSE
```

设计要点：**一个 bundle 里跑多个功能模块**。原因很实际 —— DSH 的浏览器半边是单文件产物，工厂函数不能 import 同仓库的其他文件；profile 用 `link:` 安装本地目录，跨包共享代码也不可能。所以共享运行时放在 bundle 内部，功能之间靠开关隔离、靠 `try/catch` 隔离故障。详见 [docs/architecture.md](docs/architecture.md)。

## 开发

```powershell
node scripts/build.mjs                                # 重写 client.js 与 features.generated.js
node scripts/check.mjs                                # 产物新鲜度 / 语法 / id 配对 / 路由 / patch / 图标
node scripts/new-feature.mjs sidebar-clock "侧栏时钟" "Sidebar clock"
```

> 如果 PATH 里没有 `node`，用 DSH 自带的运行时：
> `$env:ELECTRON_RUN_AS_NODE=1; & "D:\App\dsh\DeepSeek Harness.exe" scripts\build.mjs`

改动生效方式：Host 代码 → 禁用再启用 `ui-ex` 插件行；Client 代码 → 重新构建后**刷新页面**。见 [docs/verification.md](docs/verification.md)。

加新功能：读 [docs/adding-a-feature.md](docs/adding-a-feature.md)，两条命令内就能拿到可跑的骨架。

## 许可

[MIT](LICENSE)
