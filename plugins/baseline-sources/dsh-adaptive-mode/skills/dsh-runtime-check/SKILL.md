---
name: dsh-runtime-check
description: Read-only inspection of a running DSH instance's real process, package version, active profile and preset declaration. Use only for DSH runtime or preset troubleshooting.
whenToUse: 用户要求排查 DSH 本身的版本、模式、插件或 profile 是否真正生效时。
---

# DSH 运行态核查

先识别监听端口的 PID，再读取该进程命令行与实际 `@deepseek-ai/dsh/package.json`；桌面端也核对正在运行的 app.asar 版本。以真实解析路径为准，不能把 profile `node_modules` 的旧缓存版本当成运行版本。读取当前 Host 对应 profile 的 `package.json`、bundle 顺序与 profile patch，核对模式声明是否实际插入。`~/.dsh/.agent-presets` 是旧格式，当前版本不再扫描。

无凭据的 HTTP 401 可能是正常认证状态。对功能可用性的结论需要认证后的页面、对应服务或新会话验证。`--dump-config` 可能更新时间戳；需要它时使用隔离 `DSH_HOME`。此 Skill 只负责采证，不安装、重启或清理。
