# 故障排查指南

本文档提供 Codex Usage Monitor 的日志位置、动态端口检查和常见恢复步骤。优先采用只读检查，不要直接修改 WindowsApps、`app.asar`、Codex 登录文件或模型配置。

## 1. 点击快捷方式没有反应

1. 正常退出已经打开的 Codex。
2. 检查 Node.js：

   ```powershell
   node -v
   ```

3. 确认版本为 22 或更高。
4. 从当前版本目录重新运行安装器：

   ```powershell
   pwsh -NoProfile -File .\install.ps1
   ```

隐藏启动器会把脚本缺失、启动异常或非零退出码写入：

```text
%LOCALAPPDATA%\CodexUsageMonitor\launcher-error.log
```

## 2. Codex 启动但没有监视栏

必须从桌面的 `Codex Usage Monitor` 快捷方式启动。原生 Codex 图标不会开放 CDP 端口。

等待最多 30 秒后，读取实际动态端口：

```powershell
$state = Get-Content -Raw -LiteralPath "$env:LOCALAPPDATA\CodexUsageMonitor\state.json" | ConvertFrom-Json
$state.port
```

检查 CDP 是否可连接：

```powershell
Invoke-RestMethod "http://127.0.0.1:$($state.port)/json/list"
```

首选端口被占用时，启动器会自动选择后续可用端口，因此不要硬编码历史端口。

## 3. Codex 更新后监视栏消失或位置异常

Codex 更新可能改变 Composer DOM。先检查：

- `%LOCALAPPDATA%\CodexUsageMonitor\state.json` 中的 `runtimeVersion`、`port` 和 `injectorPid`。
- `injectorPid` 对应进程是否仍在运行。
- CDP `/json/list` 是否仍能看到 Codex 页面。
- 监视器日志是否出现 `insufficient-composer-width`、`composer-not-found` 或注入异常。

只替换监视器后台、不重启 Codex：

```powershell
pwsh -NoProfile -File .\scripts\start-monitor.ps1 -Port <实际端口> -Replace
```

不要反复重装或强制关闭当前 Codex；先确认是启动失败、端口变化还是页面布局不兼容。

## 4. 官方订阅指示灯反复变红

红色表示已有数据因本次官方请求失败而暂时过期，不代表额度耗尽。可能原因包括：

- 本机 app-server 暂时未响应。
- 独立 Codex CLI 与桌面捆绑 CLI 版本不兼容。
- Microsoft Store 更新后运行时副本需要刷新。
- 网络或本机代理临时异常。

监视器会优先使用用户安装的兼容 CLI；用户设置的 `CODEX_USAGE_CODEX_PATH` 具有最高优先级。Microsoft Store CLI 无法由 Node 直接从 WindowsApps 启动时，会复制到 `%LOCALAPPDATA%\CodexUsageMonitor\runtime\codex-cli` 后运行。

## 5. API Key 重启后失败

检查下列文件是否存在，不要输出文件内容：

```text
%LOCALAPPDATA%\CodexUsageMonitor\provider.json
%LOCALAPPDATA%\CodexUsageMonitor\api-key.dpapi
```

DPAPI 凭据只能由保存时的 Windows 用户在同一台电脑上解密。换用户、换电脑或删除本地状态后需要重新配置。

如果显示“请求受限”，说明用量接口返回 `HTTP 429`，不等于 Key 失效。等待 60、120、240 或 300 秒自动重试，避免反复重启、手动刷新或重复保存配置。

## 6. API 账户请求失败

确认：

- 用户 ID 是数字。
- Base URL 与服务商公开文档一致。
- 访问令牌是完整单行文本。
- 账户接口返回 JSON。
- 远程接口使用 HTTPS。

不要把真实令牌、完整私有响应或用户 ID 发到聊天或提交到仓库。需要适配字段时，只提供公开文档或脱敏后的响应结构。

## 7. 设置没有记住

显示项和六个界面开关保存在：

```text
%LOCALAPPDATA%\CodexUsageMonitor\ui-settings.json
```

文件应只包含白名单设置，不包含账号凭据。如果设置文件损坏，后台会回退到安全默认值：“7天剩余”和“当前会话累计 Token”。

## 8. 额度恢复后没有自动续跑

确认原任务展开面板中的“额度恢复续跑”已开启，并检查：

- 原任务是否明确以官方 `usage_limit_exceeded` 结束。
- 错误给出的重置时间是否已经到达，官方订阅对应周期是否重新大于 `0%`。
- 原任务是否已经停止运行；监视器会按任务 ID 发送，无需停留在原任务页面。可见输入框内容不会阻止内部续跑请求。
- 是否已经手动发送了新消息；手动开始新一轮会取消旧的自动等待。
- “续跑发送内容”是否为非空单行文本；留空或填写无效内容时会恢复默认值“继续”。

等待状态保存在 `%LOCALAPPDATA%\CodexUsageMonitor\auto-resume-state.json`，只含事件 ID、会话 ID、重置时间和防重复状态，不含发送内容、对话正文或凭据。自定义发送内容保存在 `ui-settings.json`，请勿填写密码或令牌。自动发送通过 Codex Desktop 内部请求客户端完成，不读取或覆盖可见输入框；失败时会保留等待状态并稍后重试。

## 9. 安全软件拦截

项目没有编译 EXE、自启动服务或下载器，但隐藏 PowerShell、Node 后台进程和 CDP 参数可能触发启发式检测。添加相关行为放行，或直接关闭杀毒软件。

检查安全软件隔离记录后，重新运行 `install.ps1` 并验证桌面快捷方式。

## 10. 完整测试

在源码目录运行：

```powershell
npm ci
pwsh -NoProfile -File .\tests\run-tests.ps1
```

测试包括协议解析、UI 生命周期、设置持久化、额度恢复状态机、Codex Desktop 输入发送保护、DPAPI、配置校验、启动器、安全扫描和发布包白名单。如果完整测试通过但实时界面异常，应继续检查动态 CDP 端口和当前 Codex DOM。
