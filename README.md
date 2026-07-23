# Codex Usage Monitor for Windows

[![Windows CI](https://github.com/JiaYang-BUAA/Codex-Usage-Monitor-Windows/actions/workflows/ci.yml/badge.svg)](https://github.com/JiaYang-BUAA/Codex-Usage-Monitor-Windows/actions/workflows/ci.yml)
[![Latest Release](https://img.shields.io/github/v/release/JiaYang-BUAA/Codex-Usage-Monitor-Windows)](https://github.com/JiaYang-BUAA/Codex-Usage-Monitor-Windows/releases/latest)

在 Codex Desktop 输入栏底部显示官方订阅与第三方 API 用量。监视器通过本机 CDP 运行，不修改 `WindowsApps`、`app.asar`、Codex 登录信息或模型配置。

> 非官方项目，与 OpenAI 没有隶属、赞助或背书关系。Codex 更新可能改变界面 DOM，升级后请先运行测试并检查监视器位置。

## 推荐：让 Codex 帮你安装

推荐直接把本仓库链接和下面这段话发送给 Windows 版 Codex：

```text
请安装这个项目：https://github.com/JiaYang-BUAA/Codex-Usage-Monitor-Windows
先阅读仓库根目录的 AGENTS.md 和 README.md，在 Windows 上运行根目录 install.ps1 完成当前用户安装。不要修改 Codex 安装目录、WindowsApps 或 app.asar，不要终止或重启我当前的 Codex，也不要让我在聊天中粘贴 API key。安装后请验证版本目录和桌面“Codex 监视器版”快捷方式，并告诉我正常退出当前 Codex 后如何启动。
```

Codex 会克隆或下载项目，执行受版本控制的安装脚本，将约 0.1 MB 的运行文件复制到 `%LOCALAPPDATA%\Programs\CodexUsageMonitor\<版本号>`，再创建桌面快捷方式。安装不会让当前这个未开放 CDP 的 Codex 会话立刻显示监视器；安装完成后请正常退出 Codex，再使用“Codex 监视器版”启动。

官方订阅模式不需要任何额外凭据。如果要配置第三方 API，只需向 Codex 提供接口文档和字段含义，不要在聊天中发送 API key；让 Codex 按 [AGENTS.md](AGENTS.md) 的流程使用剪贴板和 Windows DPAPI 完成配置。

## 下载方式

用户可以根据需要选择 Codex 安装、运行包或源码，三种方式运行的监视器功能相同：

| 选择 | 适合人群 | 获取方式 |
| --- | --- | --- |
| Codex 安装（推荐） | 希望自动完成下载、稳定目录安装和快捷方式验证 | 把上面的仓库链接和提示词发送给 Codex |
| Windows 运行包 | 只想安装和使用监视器 | 从 [Releases](https://github.com/JiaYang-BUAA/Codex-Usage-Monitor-Windows/releases/latest) 下载 `codex-usage-monitor-windows-*.zip` |
| 完整源码 | 需要审查代码、修改 Provider、运行测试或参与开发 | 克隆本仓库，或在 GitHub 的 **Code** 菜单下载 Source code |

运行包不包含 Node.js、Codex 或任何 API key。根目录安装器会复制白名单内的运行文件，不会复制 `.git`、`node_modules`、日志或本地 Provider 配置。

## 功能

- 官方订阅：周期剩余、重置时间、今日 Token、累计 Token、请求状态、下次刷新时间。
- API Provider：已用额度、限额、到期时间、请求状态、下次刷新时间。
- 每个指标均可勾选；折叠栏会自动使用紧凑显示。
- 官方与 API 数据默认每 90 秒刷新；请求期间保留上一份成功数据。
- Provider 由 JSON 描述，可映射嵌套响应字段，不需要修改 JavaScript。
- API key 默认使用当前 Windows 用户 DPAPI 加密保存，启动时只在后台 Node 进程环境中短暂解密，不写入项目、日志、普通状态文件或 renderer 存储。

## 环境要求

- Windows 10/11
- Codex Desktop（Microsoft Store 版会自动发现，其他安装方式可显式配置）
- PowerShell 7（推荐）或 Windows PowerShell 5.1
- Node.js 22 或更高版本

## 使用 Windows 运行包

1. 从 GitHub Releases 下载最新的 `codex-usage-monitor-windows-*.zip`。
2. 解压到任意目录。
3. 在解压后的目录打开 PowerShell，运行：

```powershell
pwsh -NoProfile -File .\install.ps1
```

安装脚本会把当前版本复制到 `%LOCALAPPDATA%\Programs\CodexUsageMonitor`，并在桌面创建“Codex 监视器版”。安装后可以删除下载和解压目录；以后通过快捷方式启动 Codex，即可同时开放仅限本机的 CDP 端口并启动监视器。

## 使用完整源码

```powershell
git clone https://github.com/JiaYang-BUAA/Codex-Usage-Monitor-Windows.git
cd Codex-Usage-Monitor-Windows
pwsh -NoProfile -File .\install.ps1
```

直接使用监视器不需要安装 npm 依赖。只有运行测试或重新构建运行包时才需要执行 `npm ci`。

默认安装使用稳定的版本目录，适合普通用户和 Codex 自动安装。如果正在开发并希望快捷方式直接引用当前源码，可以显式运行 `scripts\install-monitor-launcher.ps1`。

更新时让 Codex 重新执行推荐安装流程，或在新版本源码/运行包中再次运行 `install.ps1`。新版本会进入独立目录并更新桌面快捷方式，不会覆盖 DPAPI 凭据和 Provider 状态。

如果 Codex 已经从原生图标启动且没有 CDP，脚本不会强制结束现有会话。请正常退出 Codex，再使用监视器快捷方式。

非标准安装可以在创建快捷方式前设置以下用户环境变量：

```powershell
[Environment]::SetEnvironmentVariable('CODEX_USAGE_DESKTOP_PATH', 'D:\Apps\Codex\ChatGPT.exe', 'User')
[Environment]::SetEnvironmentVariable('CODEX_USAGE_CODEX_PATH', 'D:\Apps\Codex\codex.exe', 'User')
[Environment]::SetEnvironmentVariable('CODEX_USAGE_NODE_PATH', 'D:\Runtime\node.exe', 'User')
```

也可以用 `CODEX_USAGE_APP_PACKAGE_NAME` 或 `CODEX_USAGE_APP_USER_MODEL_ID` 指定其他 Store 包。修改用户环境变量后需重新打开终端；监视器会校验 Node.js 主版本至少为 22。

## 官方订阅

官方数据不需要额外配置。监视器通过本机 `codex app-server` 读取账户用量：

- 当接口返回多个周期时，只显示持续时间最短的周期，避免把长期余量误当短期余量。
- Token 少于 1 亿时以整数“万”显示，达到 1 亿后以两位小数“亿”显示。
- 读取失败只影响监视器，不影响 Codex 对话。

## 配置 API Provider

项目自带两个无密钥示例：

- `config/providers/cctq.example.json`
- `config/providers/custom.example.json`

复制自定义示例为 `*.local.json`，填写接口地址和响应字段映射。不要把 API key 写进 JSON。

```powershell
Copy-Item .\config\providers\custom.example.json .\config\providers\my-provider.local.json
pwsh -NoProfile -File .\scripts\configure-api-provider.ps1 `
  -ConfigPath .\config\providers\my-provider.local.json
```

如果已复制完整 key，可使用剪贴板模式。脚本读取后会清空剪贴板：

```powershell
pwsh -NoProfile -File .\scripts\configure-api-provider.ps1 `
  -ConfigPath .\config\providers\my-provider.local.json `
  -FromClipboard
```

CCTQ 用户可直接运行：

```powershell
pwsh -NoProfile -File .\scripts\configure-cctq.ps1 -FromClipboard
```

配置命令默认会将 API key 用 Windows DPAPI 按当前用户加密保存，并复制一份已校验的 Provider 配置到 `%LOCALAPPDATA%\CodexUsageMonitor`。以后通过“Codex 监视器版”快捷方式启动，后台监视器会自动恢复，不需要再次输入。

如果只想临时使用，不保存凭据，可以加 `-SessionOnly`：

```powershell
pwsh -NoProfile -File .\scripts\configure-api-provider.ps1 `
  -ConfigPath .\config\providers\my-provider.local.json `
  -FromClipboard -SessionOnly
```

清除已保存的 API key，并将当前监视器切回官方订阅模式：

```powershell
pwsh -NoProfile -File .\scripts\clear-api-provider.ps1
```

DPAPI 凭据绑定当前 Windows 用户和系统。换 Windows 账号、迁移到另一台电脑或删除 `%LOCALAPPDATA%\CodexUsageMonitor` 后，需要重新配置。API key 不会传给 Codex 主进程，也不会写入项目、日志、普通状态文件或 renderer 存储。

### Provider JSON

```json
{
  "schemaVersion": 1,
  "id": "my-provider",
  "label": "我的 API",
  "baseUrl": "https://api.example.com",
  "requests": {
    "usagePath": "/v1/usage",
    "statusPath": null
  },
  "auth": {
    "header": "Authorization",
    "scheme": "Bearer"
  },
  "response": {
    "usageRoot": "data",
    "statusRoot": "data",
    "used": "quota.used",
    "limit": "quota.limit",
    "unlimited": "quota.unlimited",
    "expiresAt": "subscription.expires_at",
    "quotaPerUnit": "display.quota_per_unit",
    "currency": "display.currency",
    "defaultQuotaPerUnit": 1,
    "defaultCurrency": "USD"
  }
}
```

`statusPath` 可以为 `null`；此时状态、币种和换算字段会从用量响应读取。`limit` 与 `unlimited` 都为 `null` 时显示“不限”。到期时间支持 Unix 秒、Unix 毫秒和 ISO 8601 字符串。

配置校验会拒绝 URL 内凭据、跨域请求路径、非法请求头、未知字段和任何试图嵌入密钥的字段。

## 常用命令

```powershell
# 安装到稳定的当前用户目录并创建桌面快捷方式
pwsh -NoProfile -File .\install.ps1

# 已有带 CDP 的 Codex 时启动/复用监视器
pwsh -NoProfile -File .\scripts\start-monitor.ps1

# 停止后台进程并移除当前界面的监视器
pwsh -NoProfile -File .\scripts\restore-monitor.ps1

# 清除持久化 API Provider 和 API key
pwsh -NoProfile -File .\scripts\clear-api-provider.ps1

# 验证 Provider 配置
node .\scripts\validate-provider.mjs .\config\providers\custom.example.json

# 完整测试
npm ci
pwsh -NoProfile -File .\tests\run-tests.ps1

# 测试后生成公开发布 ZIP
pwsh -NoProfile -File .\scripts\build-release.ps1
```

## 安全边界

- CDP 只绑定 Codex 启动参数指定的本机端口。不要把该端口转发到局域网或公网。
- 项目不读取 `%USERPROFILE%\.codex\auth.json` 或 `config.toml`。
- API 请求只发送到 Provider JSON 的 `baseUrl`，请求路径必须是站内路径。
- DPAPI 密文只能由同一台 Windows 上的当前用户解密，防止密钥以明文落盘；它不能防御已经以同一 Windows 用户身份运行的恶意程序。
- 监视器不会自动结束正在运行的 Codex。
- 项目不包含编译 EXE、隐藏脚本下载器或自启动服务。未签名 PowerShell/Node 脚本仍可能触发安全软件启发式提示，请从源码审核后运行。

## 项目结构

```text
AGENTS.md                     Codex 安装、配置与安全指引
install.ps1                   当前用户稳定目录安装器
assets/usage-inject.js         renderer 内的监视器 UI
config/package-files.json      安装与发布文件白名单
config/providers/              无密钥 Provider 示例
scripts/injector.mjs           CDP 连接与热注入
scripts/usage-client.mjs       官方/API 用量客户端
scripts/*monitor*.ps1          启动、安装、停止和公共工具
tests/                         协议、UI 生命周期与发布检查
```

## 使用 Codex 继续定制

本项目由 Codex 协助开发，源码完整公开。如果现有指标不能满足你的监看需求，可以在 Codex 中打开本仓库，说明目标接口、数据字段和展示方式，让 Codex 基于现有 Provider 配置、后台用量客户端和监视器 UI 修改源码并运行测试。

不同第三方服务的接口和认证方式可能不同。运行或发布修改前，请审查代码差异，确认请求只发送到预期服务，并确保 API key 没有写入源码、配置示例或日志。

## 测试范围

发布前测试包括 JavaScript/PowerShell 语法、官方短周期选择、Token 单位、CCTQ 兼容、通用 Provider 映射、恶意配置拒绝、renderer 重绘恢复、动态 API 来源、脚本安全契约、敏感信息扫描和发布 ZIP 白名单。

仓库中的 Windows CI 会在每次推送和 Pull Request 时执行同一套测试。版本标签 `v*` 会触发 Release 工作流，重新测试、构建运行包并上传到对应的 GitHub Release。

## 上游与许可证

本项目从 [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 的运行时注入思路演化而来。当前发布版只保留用量监视功能，不包含上游主题、人物图片或主题管理器。

代码采用 MIT License，详见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。
