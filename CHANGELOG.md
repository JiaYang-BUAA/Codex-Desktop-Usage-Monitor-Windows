# Changelog

## 1.2.0 - 2026-07-23

- 增加面向 Codex 安装流程的根目录 `install.ps1`，将运行文件复制到当前用户的稳定版本目录后创建桌面快捷方式。
- 增加 `AGENTS.md`，为 Codex 提供安装、安全、API key 保护和测试指引。
- 使用统一的 `config/package-files.json` 驱动安装器、发布包和发布测试，减少文件清单漂移。

## 1.1.0 - 2026-07-23

- API key 默认使用当前 Windows 用户 DPAPI 加密持久化，Codex 或 Windows 重启后自动恢复。
- 增加 `-SessionOnly` 临时会话模式和 `clear-api-provider.ps1` 凭据清除命令。
- 增加 DPAPI 轮换、明文保护、自动导入和清除测试。

## 1.0.0 - 2026-07-23

- 将项目收敛为独立的 Windows Codex 用量监视器。
- 支持官方订阅的短周期余量、重置时间和 Token 统计。
- 支持声明式 API Provider、CCTQ 示例与动态来源名称。
- API key 改为仅在后台进程内存中使用。
- 新增 Provider 安全校验、renderer 生命周期测试、敏感信息扫描和发布包白名单。
- 数据刷新只更新现有面板，renderer 断开后可自动重新连接。
- API 状态接口失败时保留主用量接口的新数据与最近一次状态配置。
- 增加启动互斥、运行版本识别、非标准安装路径和 WindowsApps manifest 回退。
- 移除主题、图片素材、主题管理器、EXE 构建器和自动强制重启逻辑。
- 增加源码与运行包两种下载说明，以及 Windows CI 和自动 Release 构建流程。
