# Codex Usage Monitor for Windows

- View session tokens, cache usage, and subscription limits inside Codex Desktop.
- Set a global default for the message sent when a session resumes after its quota resets.
- Keep custom messages and resume switches separate for each conversation.

## Contents

- [Fork changes: global resume message](#fork-changes-global-resume-message)
- [Getting started](#1-三步开始使用)
- [Daily use](#2-日常使用)
- [Data sources and configuration](#3-数据源与配置)
- [Updates, installation, and maintenance](#4-更新安装与维护)
- [Security and privacy](#5-安全与隐私)
- [Troubleshooting](#6-常见问题与排查)
- [Development and tests](#7-开发与测试)
- [FAQ](#8-faq)
- [Project origins and contributors](#9-项目来源与贡献者)

> In-app usage monitor and status bar for OpenAI Codex Desktop on Windows

[![Windows CI](https://github.com/JiaYang-BUAA/Codex-Desktop-Usage-Monitor-Windows/actions/workflows/ci.yml/badge.svg)](https://github.com/JiaYang-BUAA/Codex-Desktop-Usage-Monitor-Windows/actions/workflows/ci.yml)
[![Latest Release](https://img.shields.io/github/v/release/JiaYang-BUAA/Codex-Desktop-Usage-Monitor-Windows)](https://github.com/JiaYang-BUAA/Codex-Desktop-Usage-Monitor-Windows/releases/latest)

Codex Usage Monitor 把官方订阅周期、当前会话 Token、社区重置概率、Tibo 最新 X 动态，以及可选的 API 账户和 API Key 用量，直接放到 Windows 版 Codex Desktop 的输入区域旁。

监视器通过仅绑定本机的 Chrome DevTools Protocol（CDP）运行时注入，不是独立悬浮窗，也不修改 WindowsApps、`app.asar`、Codex 登录文件或模型配置。

> 本项目是非官方项目，与 OpenAI 没有隶属、赞助或背书关系。社区重置概率和 Tibo 动态也不是 OpenAI 官方数据。Codex 更新可能改变页面结构；项目会持续通过兼容性测试适配新版界面。

![Codex Usage Monitor 展开面板示意图](docs/images/monitor-expanded.png)

主要功能：

- 在一个面板中查看“本会话”“官方订阅”“重置概率预测（仅供参考）”，并按需开启 API 账户和 API Key 两栏。
- 查看当前会话累计 Token、上次回答消耗 Token、缓存命中率、自动压缩上下文次数和当前状态。
- 查看 5 小时与 7 天官方周期、重置时间、今日 Token、近7天 Token和累计 Token。
- 每 5 分钟显示社区重置概率和 Tibo（[`@thsottiaux`](https://x.com/thsottiaux)）最新 X 动态摘要。
- 支持普通模式、极简模式、倒计时可视化、中文与 English UI、自动更新和按任务独立的额度恢复续跑。
- 使用当前 Windows 用户的 DPAPI 加密保存 API 凭据，不把凭据写入源码、页面设置或日志。

## Fork changes: global resume message

Open the monitor bar, select **Settings** in **Official Subscription**, and edit
**Default resume message (global)**. The value is saved when the field loses focus.
Messages support up to 500 characters on one line; invalid input keeps the previous value.

New conversations inherit this default. Changing it also updates saved messages
that match the previous global default or the built-in defaults (`继续` / `Continue`).
Other custom messages and all per-conversation resume switches are preserved.
Use **Resume message** in **Session** to customize one conversation.

The default is stored in `autoResumeMessage` in
`%LOCALAPPDATA%\CodexUsageMonitor\ui-settings.json`, alongside the existing
per-conversation settings. No personal settings are included in this fork.

Install this fork [from source](#43-从源码安装) to use the customization.
The release links and automatic updater still follow the upstream project;
installing an upstream release can replace the customization.
The original documentation follows below.

## 1. 三步开始使用

### 1.1 准备环境

- Windows 10 或 Windows 11。
- 已安装并能正常登录的 Codex Desktop。
- Node.js 22 或更高版本。
- 推荐使用 PowerShell 7，并确认命令 `pwsh` 可用。
- 安全软件：项目使用隐藏 PowerShell、Node.js 后台进程和 CDP 参数，可能触发启发式误报。确认安装包来自本仓库后，为项目目录、启动脚本或相关进程添加精确信任规则，或者直接关闭杀毒软件。

### 1.2 下载、安装、启动

1. 从 [最新 Release](https://github.com/JiaYang-BUAA/Codex-Desktop-Usage-Monitor-Windows/releases/latest) 下载 `codex-usage-monitor-windows-*.zip`。
2. 解压 ZIP，在解压目录中运行：

   ```powershell
   pwsh -NoProfile -File .\install.ps1
   ```

3. 正常退出已经打开的 Codex，然后双击桌面的 `Codex Usage Monitor` 快捷方式。

专用快捷方式会同时启动 Codex 和监视器，并隐藏正常的黑色命令行窗口。原生 Codex 图标不会开放本机 CDP 端口，因此从原生图标启动时不会显示监视栏。

### 1.3 让 Codex 帮你安装

不熟悉 PowerShell 时，可以把下面这段话直接发送给 Windows 版 Codex：

```text
请安装这个项目：https://github.com/JiaYang-BUAA/Codex-Desktop-Usage-Monitor-Windows
先阅读仓库根目录的 AGENTS.md 和 README.md，再运行 install.ps1。自动寻找 Microsoft Store 和常见非 Store Codex 路径；找不到时才询问我选择真实的 ChatGPT.exe 或 codex.exe。不要猜路径，不要修改 WindowsApps、app.asar、Codex 登录文件或模型配置，也不要强制终止或重启我当前的 Codex。安装后验证桌面的“Codex Usage Monitor”快捷方式。
官方订阅无需配置。API 账户和 API Key 请优先指导我在监视栏展开面板中填写；密钥不能粘贴到聊天、源码、JSON 或日志。找不到服务商字段时，请根据公开文档或脱敏截图解释，不要猜测接口。
```

## 2. 日常使用

### 2.1 折叠监视栏

监视栏位于 Codex 输入区域底部。新安装默认勾选“7天剩余”和“当前会话累计 Token”，普通模式最多显示 8 项。

指标会严格按照勾选顺序从左到右排列；取消后重新勾选的项目会移动到末尾。展开面板中的“5小时剩余”和“7天剩余”显示为“重置时间 · 剩余百分数”，折叠栏只保留百分数。

![Codex Usage Monitor 普通模式示意图](docs/images/monitor-collapsed.png)

### 2.2 极简模式

极简模式隐藏指标名称，只保留数值、单位和必要开关，最多选择 14 项；选中 9 项及以上时自动使用双行布局。

![Codex Usage Monitor 极简模式示意图](docs/images/monitor-minimal.png)

### 2.3 展开面板

点击监视栏即可展开面板。新安装默认显示三栏：

| 栏位 | 默认状态 | 主要内容 |
| --- | --- | --- |
| 本会话 | 显示 | 当前会话累计 Token、上次回答消耗 Token、缓存命中率、自动压缩上下文次数、当前状态和额度恢复续跑。 |
| 官方订阅 | 显示 | 5 小时/7 天周期、重置时间、今日/近7天/累计 Token 和全局设置。 |
| 重置概率预测（仅供参考） | 显示 | 12/24/48/72 小时社区概率，以及 Tibo 最新 X 动态缩略卡片。 |
| API 账户 | 隐藏 | 第三方用户账户余额、请求日志和累计 Token。 |
| API Key | 隐藏 | 某个 API Key 的额度、限额、到期时间和请求状态。 |

每栏使用独立固定宽度，不会因为其他栏显示或隐藏而被压窄。面板会根据已启用栏位向左扩展，并优先保证右边缘和每栏内容完整显示。

“上次回答消耗 Token”只在回答完成后更新。回答生成期间，它会继续显示最近一次已完成回答的数据，不会混入当前尚未完成的内容。

### 2.4 设置与保存

点击“官方订阅”栏底部的“设置”，可以调整：

| 设置 | 作用 |
| --- | --- |
| 极简模式 | 只显示数值、单位和必要开关。 |
| 倒计时可视化 | 使用圆形表盘显示刷新进度。 |
| English UI | 切换中英文界面。 |
| 自动更新 | 每 24 小时检查一次最新正式 Release。 |
| API 栏 | 同时显示或隐藏 API 账户与 API Key。新安装默认关闭。 |
| 重置概率预测栏 | 显示或隐藏社区概率与 Tibo 动态。新安装默认开启。 |

显示项、勾选顺序和上述全局设置保存在：

```text
%LOCALAPPDATA%\CodexUsageMonitor\ui-settings.json
```

已有用户升级时保留原来的显示选择；新安装才使用默认布局。

### 2.5 额度恢复续跑

“额度恢复续跑”默认关闭，并按 Codex 任务分别保存。任务 A 的开关和发送内容不会影响任务 B。

开启后，监视器只会在以下条件全部成立时发送续跑内容：

1. 当前任务明确以 `usage_limit_exceeded` 结束。
2. 错误中给出的额度恢复时间已经到达。
3. 官方订阅周期重新显示为有剩余额度。

默认发送内容为“继续”，可修改为最多 500 字符的单行文本。监视器在 Codex Desktop 内部按原任务 ID 调用 `thread/resume` 和 `turn/start`，不会填写或占用可见输入框，不会调用模型 API、侧边聊天或快速聊天，也不会删除或覆盖原有排队消息。同一额度事件使用稳定的客户端消息 ID 防止重复提交。

等待记录保存在 `%LOCALAPPDATA%\CodexUsageMonitor\auto-resume-state.json`，不包含发送内容、对话正文或凭据。

## 3. 数据源与配置

### 3.1 数据源总览

| 数据源 | 数据内容 | 需要准备 |
| --- | --- | --- |
| 官方订阅 | 5 小时/7 天周期、重置时间、今日/近7天/累计 Token。 | 无需额外凭据。 |
| 重置概率预测（仅供参考） | Codex Reset Observatory 的社区概率和 Tibo 最新 X 动态。 | 无需凭据；可在设置中隐藏。 |
| API 账户 | 第三方账户余额、累计已用额度、请求日志和 Token 账本。 | Base URL、数字用户 ID、账户访问令牌、累计 Token 基准。 |
| API Key | 单个 Key 的已用额度、限额、到期时间和请求状态。 | API Key；首次配置还需服务地址和用量接口路径。 |

更完整的指标口径、Token 累计逻辑、状态灯和 Provider 字段映射见 [数据源与指标说明](docs/data-sources.md)。

### 3.2 官方订阅

官方订阅通过 Codex Desktop 本机 app-server 读取，无需填写任何凭据。红色指示灯表示本轮请求失败但仍保留上一次成功数据，不代表额度耗尽或模型不可用。

### 3.3 重置概率与 Tibo 动态

重置概率来自 MIT License 开源项目 [Codex Reset Observatory](https://github.com/gussuri/codex-reset-observatory)。本项目只读取并显示它汇总的 12/24/48/72 小时社区概率，不训练预测模型，也不使用预测结果触发自动续跑。

监视器每 5 分钟向以下固定 HTTPS 接口发送一次无凭据 GET 请求：

```text
https://codex.gussuriworks.com/api/current?locale=zh
```

请求不包含 Codex 登录信息、任务 ID、对话内容、Token 统计、API Key 或账户令牌。上游返回 `stale=true` 时，该栏显示红灯并保留最近数据。

同一响应中的 `latestTiboActivity` 用于缩略展示 Tibo 在 X 上的最新公开动态。监视器不会登录或单独抓取 X；动态和概率同步每 5 分钟更新，只显示三行正文摘要、发布时间，以及限定为 `x.com/thsottiaux/status/...` 的原帖链接。该字段由第三方项目整理，仍属于非官方信息。

### 3.4 API 账户

开启“API 栏”，点击“API 账户”标题后的“配置”，填写：

- API 服务 Base URL。
- 数字用户 ID。
- 账户访问令牌（Access Token）。
- 当前真实的累计 Token 基准；不知道精确值时填 `0`。

保存前会验证账户接口并读取当前日志建立检查点，成功后使用 DPAPI 加密保存访问令牌。账户访问令牌不一定等于 API Key。

### 3.5 API Key

开启“API 栏”，点击“API Key”标题后的“配置”：

- 已有连接配置时，通常只需填写或更换 API Key。
- 首次配置时，填写 API Key、API 服务地址和用量接口路径。
- 认证头和响应字段映射位于“高级设置（通常无需修改）”。
- 密钥框不会回填；已经配置时留空可保留原密钥。

![API Key 小白配置界面](docs/images/configure-api-key.png)

如果服务商返回 `HTTP 429`，界面会显示“请求受限”，并保留旧数据。这不一定表示 Key 失效；监视器会按 60、120、240、300 秒逐步退避，成功后恢复为 60 秒刷新。

## 4. 更新、安装与维护

### 4.1 自动更新

自动更新开启后，运行中的监视器最多每 24 小时检查一次本项目的 GitHub Release。发现正式新版本时，它会：

1. 下载名称和版本严格匹配的 Windows ZIP。
2. 核对 GitHub 提供的 SHA-256 摘要。
3. 校验通过后安装并热替换监视器后台。

更新不会重启 Codex。检查、下载或校验失败时继续使用当前版本，并在下个周期重试。

### 4.2 安装位置与运行包

安装器把白名单运行文件复制到：

```text
%LOCALAPPDATA%\Programs\CodexUsageMonitor\<版本号>
```

运行包不包含 Node.js、Codex、API Key、用户日志或本地 Provider 配置。桌面快捷方式会始终指向对应版本的启动脚本。

### 4.3 从源码安装

```powershell
git clone https://github.com/uayten/Codex-Desktop-Usage-Monitor-Windows.git
cd Codex-Desktop-Usage-Monitor-Windows
pwsh -NoProfile -File .\install.ps1
```

安装器会优先寻找 Microsoft Store 和常见非 Store 路径；找不到时才询问实际文件。也可以提前设置真实路径：

```powershell
[Environment]::SetEnvironmentVariable('CODEX_USAGE_DESKTOP_PATH', 'D:\Apps\Codex\ChatGPT.exe', 'User')
[Environment]::SetEnvironmentVariable('CODEX_USAGE_CODEX_PATH', 'D:\Apps\Codex\codex.exe', 'User')
[Environment]::SetEnvironmentVariable('CODEX_USAGE_NODE_PATH', 'D:\Runtime\node.exe', 'User')
```

### 4.4 高级命令行配置

展开面板是推荐配置入口。以下命令保留给自动化和高级用户：

```powershell
pwsh -NoProfile -File .\scripts\configure-api-account.ps1 -FromClipboard -UserId <用户ID> -BaseUrl https://api.example.com
pwsh -NoProfile -File .\scripts\configure-token-baseline.ps1 -InitialTokens <完整整数>

Copy-Item .\config\providers\custom.example.json .\config\providers\my-provider.local.json
pwsh -NoProfile -File .\scripts\configure-api-provider.ps1 -ConfigPath .\config\providers\my-provider.local.json -FromClipboard
```

清除配置：

```powershell
pwsh -NoProfile -File .\scripts\clear-api-provider.ps1
pwsh -NoProfile -File .\scripts\clear-api-account.ps1
pwsh -NoProfile -File .\scripts\clear-token-baseline.ps1
```

## 5. 安全与隐私

### 5.1 数据去向

| 数据 | 处理方式 |
| --- | --- |
| Codex 官方订阅与会话数据 | 只在本机通过 Codex Desktop app-server 和本地会话事件读取。 |
| 重置概率与 Tibo 动态 | 只向 README 公开的 Codex Reset Observatory 固定 HTTPS 接口发送无凭据 GET 请求。 |
| API Key 和账户访问令牌 | 使用当前 Windows 用户的 DPAPI 加密保存。 |
| UI 设置和续跑文案 | 保存在监视器自己的本地设置文件中。 |

### 5.2 安全边界

- CDP 仅绑定 `127.0.0.1`，不会向局域网或互联网开放调试端口。
- 携带凭据的远程 API 请求强制使用 HTTPS；只有本机回环地址允许 HTTP。
- 远程请求拒绝重定向，并限制单个 JSON 响应体最大为 2 MiB。
- API Key 和访问令牌不会进入源码、页面设置、日志或测试产物；换用户、换电脑或删除本地状态后需要重新配置。
- 明文凭据只在当前表单和本机配置进程内存中短暂存在。
- 项目不读取 `%USERPROFILE%\.codex\auth.json` 或 `config.toml`。
- 项目不会修改 WindowsApps、`app.asar`、Codex 登录文件或模型配置，也不会强制结束正在运行的 Codex。
- 自动续跑发送内容以明文保存在监视器自己的 UI 设置文件中，请勿填写密码、令牌或其他秘密。

完整安装、配置与安全契约见 [AGENTS.md](AGENTS.md)。

## 6. 常见问题与排查

1. **点击快捷方式没有反应**：确认 Codex 已正常退出，检查 `node -v` 是否为 22+，然后重新运行 `install.ps1`。
2. **Codex 启动但没有监视栏**：必须使用 `Codex Usage Monitor` 快捷方式，并等待最多 30 秒。实际 CDP 端口记录在 `%LOCALAPPDATA%\CodexUsageMonitor\state.json`。
3. **官方订阅指示灯变红**：当前请求失败但仍有缓存数据，不代表额度耗尽。等待后台自动刷新即可。
4. **重置概率预测指示灯变红**：Codex Reset Observatory 数据过期或本轮请求失败；它与官方订阅额度无关，等待下一次 5 分钟刷新即可。
5. **API Key 显示请求受限**：等待 60～300 秒自动退避，避免反复重启或重复保存配置。
6. **API 账户失败**：确认用户 ID 是数字、令牌是完整单行文本且接口返回 JSON；不要把令牌或私有响应发到聊天。
7. **额度恢复后没有自动续跑**：确认该任务已开启“额度恢复续跑”、任务确实以官方额度耗尽结束，并保持 Codex 与监视器运行。
8. **安全软件拦截**：项目没有编译 EXE、自启动服务或下载器，但隐藏 PowerShell、Node 后台进程和 CDP 参数可能触发启发式检测。添加相关行为放行，或直接关闭杀毒软件。

完整诊断命令、日志位置和恢复步骤见 [故障排查指南](docs/troubleshooting.md)。

## 7. 开发与测试

```powershell
npm ci
pwsh -NoProfile -File .\tests\run-tests.ps1
pwsh -NoProfile -File .\scripts\build-release.ps1
```

实时开发与恢复命令：

```powershell
pwsh -NoProfile -File .\scripts\start-monitor.ps1
pwsh -NoProfile -File .\scripts\restore-monitor.ps1
node .\scripts\validate-provider.mjs .\config\providers\custom.example.json
```

测试覆盖 JavaScript/PowerShell 语法、官方周期、Token 单位、账户分页与累计基线、通用 Provider 映射、Tibo 动态刷新、额度恢复状态机、Codex Desktop 内部发送保护、恶意配置拒绝、DPAPI 持久化、UI 生命周期、设置恢复、启动器、安全扫描和运行包白名单。Windows CI 会在推送和 Pull Request 时运行同一套测试。

## 8. FAQ

### 监视器是独立悬浮窗吗？

不是。它直接插入 Codex Desktop 输入区域，会随 Codex 页面一起显示和隐藏。

### 为什么必须使用专用快捷方式？

监视器需要 Codex 启动时开放仅绑定本机的 CDP 端口。原生图标不会开放该端口，因此无法注入。

### 是否支持 Microsoft Store 和非 Store 版本？

支持。安装器会自动寻找两类路径，找不到时才询问真实的 `ChatGPT.exe` 或 `codex.exe`。

### 官方订阅、API 账户和 API Key 有什么区别？

官方订阅读取 Codex 本机账户与任务事件；API 账户读取第三方用户账户和请求日志；API Key 读取单个密钥的额度接口。后两者由不同凭据和接口驱动。

### 升级会覆盖我的设置吗？

不会。版本化运行文件与 `%LOCALAPPDATA%\CodexUsageMonitor` 中的本地设置分开保存；自动更新和重新安装会保留现有配置。

## 9. 项目来源与贡献者

项目从 [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 的运行时注入思路演化而来，当前发布版只保留用量监视功能。代码采用 MIT License，详见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。

- [+羊（@JiaYang-BUAA）](https://github.com/JiaYang-BUAA)：项目发起、产品设计与维护。
- [Codex（@codex）](https://github.com/codex)：协作完成界面设计、功能实现、问题诊断、测试与文档。
