# Codex Usage Monitor for Windows

[![Windows CI](https://github.com/JiaYang-BUAA/codex-usage-monitor-windows/actions/workflows/ci.yml/badge.svg)](https://github.com/JiaYang-BUAA/codex-usage-monitor-windows/actions/workflows/ci.yml)
[![Latest Release](https://img.shields.io/github/v/release/JiaYang-BUAA/codex-usage-monitor-windows)](https://github.com/JiaYang-BUAA/codex-usage-monitor-windows/releases/latest)

在 Codex Desktop 输入栏底部显示官方订阅与第三方 API 用量。监视器通过本机 CDP 运行，不修改 `WindowsApps`、`app.asar`、Codex 登录信息或模型配置。

> 非官方项目，与 OpenAI 没有隶属、赞助或背书关系。Codex 更新可能改变界面 DOM，升级后请先运行测试并检查监视器位置。

## 下载方式

用户可以根据需要选择运行包或源码，两者功能相同：

| 选择 | 适合人群 | 获取方式 |
| --- | --- | --- |
| Windows 运行包 | 只想安装和使用监视器 | 从 [Releases](https://github.com/JiaYang-BUAA/codex-usage-monitor-windows/releases/latest) 下载 `codex-usage-monitor-windows-*.zip` |
| 完整源码 | 需要审查代码、修改 Provider、运行测试或参与开发 | 克隆本仓库，或在 GitHub 的 **Code** 菜单下载 Source code |

运行包不包含 Node.js、Codex 或任何 API key。下载后请解压到一个长期保留的目录，不要直接从 ZIP 或临时目录运行；桌面快捷方式会继续引用该目录中的脚本。

## 功能

- 官方订阅：周期剩余、重置时间、今日 Token、累计 Token、请求状态、下次刷新时间。
- API Provider：已用额度、限额、到期时间、请求状态、下次刷新时间。
- 每个指标均可勾选；折叠栏会自动使用紧凑显示。
- 官方与 API 数据默认每 90 秒刷新；请求期间保留上一份成功数据。
- Provider 由 JSON 描述，可映射嵌套响应字段，不需要修改 JavaScript。
- API key 只通过环境变量传给后台进程，不写入项目、日志、状态文件或 renderer 存储。

## 环境要求

- Windows 10/11
- Codex Desktop（Microsoft Store 版会自动发现，其他安装方式可显式配置）
- PowerShell 7（推荐）或 Windows PowerShell 5.1
- Node.js 22 或更高版本

## 使用 Windows 运行包

1. 从 GitHub Releases 下载最新的 `codex-usage-monitor-windows-*.zip`。
2. 解压到一个长期保留的目录。
3. 在解压后的目录打开 PowerShell，运行：

```powershell
pwsh -NoProfile -File .\scripts\install-monitor-launcher.ps1
```

安装脚本会在桌面创建“Codex 监视器版”。以后通过这个快捷方式启动 Codex，即可同时开放仅限本机的 CDP 端口并启动监视器。

## 使用完整源码

```powershell
git clone https://github.com/JiaYang-BUAA/codex-usage-monitor-windows.git
cd codex-usage-monitor-windows
pwsh -NoProfile -File .\scripts\install-monitor-launcher.ps1
```

直接使用监视器不需要安装 npm 依赖。只有运行测试或重新构建运行包时才需要执行 `npm ci`。

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

API key 不持久化。后台监视进程或 Windows 重启后，需要重新运行配置命令；官方订阅监视不受影响。

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
# 已有带 CDP 的 Codex 时启动/复用监视器
pwsh -NoProfile -File .\scripts\start-monitor.ps1

# 停止后台进程并移除当前界面的监视器
pwsh -NoProfile -File .\scripts\restore-monitor.ps1

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
- 监视器不会自动结束正在运行的 Codex。
- 项目不包含编译 EXE、隐藏脚本下载器或自启动服务。未签名 PowerShell/Node 脚本仍可能触发安全软件启发式提示，请从源码审核后运行。

## 项目结构

```text
assets/usage-inject.js         renderer 内的监视器 UI
config/providers/              无密钥 Provider 示例
scripts/injector.mjs           CDP 连接与热注入
scripts/usage-client.mjs       官方/API 用量客户端
scripts/*monitor*.ps1          启动、安装、停止和公共工具
tests/                         协议、UI 生命周期与发布检查
```

## 测试范围

发布前测试包括 JavaScript/PowerShell 语法、官方短周期选择、Token 单位、CCTQ 兼容、通用 Provider 映射、恶意配置拒绝、renderer 重绘恢复、动态 API 来源、脚本安全契约、敏感信息扫描和发布 ZIP 白名单。

仓库中的 Windows CI 会在每次推送和 Pull Request 时执行同一套测试。版本标签 `v*` 会触发 Release 工作流，重新测试、构建运行包并上传到对应的 GitHub Release。

## 上游与许可证

本项目从 [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) 的运行时注入思路演化而来。当前发布版只保留用量监视功能，不包含上游主题、人物图片或主题管理器。

代码采用 MIT License，详见 [LICENSE](LICENSE) 与 [NOTICE.md](NOTICE.md)。
