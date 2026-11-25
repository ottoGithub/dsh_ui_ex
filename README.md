# dsh_ui_ex

DeepSeek Harness（DSH）UI 相关插件实验合集。每个子目录都是一个可直接安装的 DSH bundle（`package.json` + `cordis.patch.yml` + Host/Client 两半）。

## 目录

| 目录 | 说明 |
|---|---|
| [`workspace-recency-pin/`](workspace-recency-pin/README.md) | 侧栏工作区按「最近更新」排序（规则同会话列表），并支持置顶；置顶图标与会话置顶图标一致 |

## 安装

在 DSH 里打开 **设置 → 插件 → 添加本地插件**，选中对应子目录；或让 agent 调用 `plugin_manager` 的 `install_bundle`，`target` 传该子目录的绝对路径。

```text
plugin_manager(action: "install_bundle", target: "E:\\github\\dsh_ui_ex\\workspace-recency-pin")
```

安装会把该目录 link 进当前 profile，改动源码后重新启用该插件行即可生效；Client 半的改动需要刷新页面。

## 许可

[MIT](LICENSE)
