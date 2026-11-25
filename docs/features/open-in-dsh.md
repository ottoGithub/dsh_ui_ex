# 功能：从资源管理器打开文件夹

- 功能 id：`open-in-dsh`
- 默认状态：启用
- 可调参数：`autoInstall`（默认 `true`）、`queueTtlHours`（默认 `24`）、`autoInstallDelayMs`（默认 `4000`）
- 平台：Windows

## 做什么

在 Windows 资源管理器右键菜单里加一项带图标的 **在 DeepSeek Harness 中打开**：右键任意文件夹、文件夹空白处或驱动器，该文件夹就会作为工作区在**当前** DSH 窗口里打开，新会话直接以它为工作目录。

## 安装菜单

插件装好后**不需要手动运行任何脚本**：首次启动时若发现菜单项还没注册，插件会自己弹出一次 UAC 提权请求，点「是」即完成，之后不再询问。

三种入口：

1. **自动（推荐）**：装上本 bundle，重启后点一次 UAC「是」。
2. **双击**：`packages/dsh-ui-ex/assets/open-in-dsh/install-machine.cmd`（或同目录 `windows\install-machine.cmd`），脚本自我提权。
3. **手动**：管理员 PowerShell 执行
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\packages\dsh-ui-ex\assets\open-in-dsh\windows\install.ps1 -Scope Machine
   ```
   应用不在默认位置时加 `-AppPath "…\DeepSeek Harness.exe"`；`-Scope User` 装到当前用户（不需要管理员，但 Windows 11 新版右键菜单里通常看不到）。

文件装在 `%ProgramData%\DeepSeekHarness\shell-integration`（机器范围）或 `%LOCALAPPDATA%\DeepSeekHarness\shell-integration`（用户范围）。

## 工作方式

1. 菜单项启动 `dsh-open.exe "<文件夹>"`。这个无控制台启动器只做两件事：把路径写进按用户隔离的队列 `%LOCALAPPDATA%\DeepSeekHarness\dsh-open\`，再拉起或聚焦 DeepSeek Harness。
2. Host 半通过套件路由的 `next` op 读出最旧的一条请求并立即删除 —— 每次右键只打开一个工作区。
3. Client 半每 0.8 秒轮询一次；拿到路径后创建工作区并打开。

应用没在运行时，启动器会先把它拉起，请求留在队列里等界面就绪后再被消费；超过 `queueTtlHours` 的请求会被丢弃。

队列目录是**跨 bundle 稳定**的：如果之前装过独立的 `open-in-dsh` 插件，它的 launcher 与本功能完全兼容，不需要重装菜单。

## 自动安装与「不再询问」

- 判断依据：`HKCU` 或 `HKLM` 下任意一个 `…\Directory\shell\DeepSeekHarness` 存在即认为已安装。
- 只尝试一次：无论成功、取消还是失败，都会在 `%LOCALAPPDATA%\DeepSeekHarness\shell-integration\auto-install.json` 留下记录，**不会重复打扰**。
- 想重新触发：删掉该 json，或先跑 `uninstall.ps1`（它一并清掉记录）。
- 提权只用于「写 HKLM 菜单项 + 把启动器复制到 ProgramData」，不联网。
- 不想被自动提权：把该功能配置成 `open-in-dsh: { enabled: true, autoInstall: false }`，改用双击脚本。

## 已知限制

- **Windows 11 新版右键菜单只显示机器级（HKLM）注册的旧式动词。** `HKCU` 下的同结构动词要「显示更多选项」才看得到 —— 这就是默认要管理员权限的原因。
- 一级新菜单不接受非打包应用的自定义项，这是系统设计；要绕开只能重做 `IExplorerCommand` + 签名 MSIX 稀疏包。
- 「文件夹空白处」的菜单项不能写 `MultiSelectModel=Single`（选中项为 0 时 Explorer 会隐藏该项），安装脚本已按此处理。
- 插件以目录链接方式安装，本目录移动或删除后需要重新添加；应用升级换了目录后重跑一次安装脚本更新 `app-path.txt`。
- 队列目录只对当前用户可写：本机同用户进程都能投递请求，效果仅是打开一个工作区。

## 卸载

```powershell
# 管理员 PowerShell
powershell -ExecutionPolicy Bypass -File .\packages\dsh-ui-ex\assets\open-in-dsh\windows\uninstall.ps1 -Scope Machine
```

只删菜单、启动器和队列；插件与 profile 不动。
