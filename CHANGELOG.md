# Changelog

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
