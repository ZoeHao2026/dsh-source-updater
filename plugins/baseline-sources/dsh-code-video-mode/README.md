# DSH 代码视频模式（Code Video）

用户自定义模式：显示名「代码视频」，preset id `code-video`，显示顺序 6。选中后只需一句主题描述（例如「做一个 30 秒介绍 XXX 的视频」），Agent 自行完成创意、文案、分镜、时间线、动画指南、场景拆分、技术方案、代码实现、配音字幕 BGM SFX、渲染、自检修正，交付最终 MP4 与工程源码。

## 结构

| 文件 | 作用 |
| --- | --- |
| `cordis.patch.yml` | 模式声明，由 `scripts/build-preset.mjs` 生成，勿手改 |
| `mode/persona.md` | 模式系统提示词正文（构建时注入 `persona.config.prefix`） |
| `mode/operating-contract.md` | 跨任务不变量：授权边界、单一事实源、渲染确定性、验证证据、止损、诚实交付 |
| `mode/pipeline.md` | 八阶段流水线与各阶段产物 |
| `mode/tech-stack.md` | 技术栈选择矩阵、确定性渲染、渲染预算、离线降级 |
| `mode/visual-language.md` | 允许/禁止技法清单、效果预算、排版与安全区、节奏 |
| `mode/audio-and-sync.md` | 配音、字幕、BGM、SFX 与同步量测 |
| `templates/storyboard.template.yml` | 统一 Storyboard 冻结结构（唯一事实源） |
| `templates/animation-guide.template.md` | 统一 Animation Guide 冻结结构 |
| `verification/qc-checklist.md` | 成片验收门禁（文件规格/动画/转场/节奏/音频/字幕/规范/渲染完整性） |
| `playbooks/*.md` | 短内容、解说、数据叙事、产品品牌四类策略 |
| `skills/video-render-check/SKILL.md` | 只读渲染链路核查技能（模式内可见） |
| `lib/plan-entry.js` | `enter_plan_mode` 工具行（原生计划模式入口） |
| `lib/render-capabilities.js` | `video_render_capabilities` 只读工具行（一次性探测本机工具链） |
| `scripts/build-preset.mjs` | 从当前安装的桌面版 `app.asar` 中校验并提取标准模式补丁，生成 `cordis.patch.yml` |
| `scripts/run-smoke.mjs` / `scripts/smoke-lib.mjs` | 使用桌面版 Electron Node 与 `@deepseek-ai/dsh-tools` 校验两个工具行的 schema 与输出形状 |

## 与标准模式的关系

模式完整继承桌面版 DSH 0.2.0-rc.2 标准模式的 32 个声明 ID（顺序一致），只做五处改动：

1. preset 行：`preset-standard` → `preset-code-video`，`id: code-video`、`name: 代码视频`、`order: 6`，另加 `description`。
2. `persona`：`prefix` 替换为 `mode/persona.md` 正文；`suffix` 增加模式资源根路径（`!!js` + `createRequire` 解析自身包目录）。
3. `skill-filesystem`：新增 `customSkillDirs` 指向本包 `skills/`，使模式自有技能可见，且不影响宿主技能。
4. `planning` 组内 `plan-mode` 之后新增 `code-video-plan-entry`。
5. 新增只读工具行 `code-video-render-capabilities`。

`build-preset.mjs` 在生成时校验「继承的声明 id 集合与顺序必须与标准模式完全一致」，不一致即报错退出，避免升级 DSH 后静默丢能力。

## 构建与安装

```powershell
# 1) 从当前桌面版 app.asar 提取标准模式并核验归档 SHA-256，也可显式传补丁路径
node scripts/build-preset.mjs

# 2) 使用桌面版 0.2.0-rc.2 的工具 schema 校验两半运行时代码
npm run smoke

# 3) 打包（版本号必须递增，否则 pnpm 会认为依赖未变化而不刷新）
npm pack --pack-destination ..\releases
```

安装使用 Harness 自带的插件管理器（不要用 shell 复刻 pnpm 步骤）：`plugin_manager` → `action: install_bundle` → `target` 指向刚生成的 tgz 绝对路径。它会完成 pnpm 安装与 profile bundle 登记。

**升级后必须重启 DSH 实例**：新增 bundle 行属于重启生效类别，安装结果会返回 `restart-required`；重启前的运行实例仍使用旧插件修订，新会话看不到 `code-video-render-capabilities` 行。

## 验收

静态（本包源码目录内可复查）：

- `node scripts/build-preset.mjs` 输出 `inherited ids: 32 (identical set and order to the standard preset)`。
- `npm run smoke` 输出 `SMOKE OK`：两行工具的 `parameters`/`output.schema` 通过桌面版 0.2.0-rc.2 的 `assertSupportedJsonSchema`，`video_render_capabilities` 的实际输出通过 `validateJsonSchemaValue`。
- `cordis.patch.yml` 可被 YAML 解析，`parameters` 无制表符，persona 无未注册的模板占位符。

运行态（需重启后在新会话复查）：

- `plugin_manager list_bundles` 出现 `@local/dsh-code-video-mode`，其行 `preset-code-video`。
- 模式选择器出现「代码视频」（order 6，位于「自适应模式」之后）；已有模式与旧会话不迁移。
- 新会话中 `video_render_capabilities` 与 `enter_plan_mode` 可调用，技能目录出现 `video-render-check`。
- `video_render_capabilities` 在本机的离线探测结论（2026-09-30）：Chrome 可用于帧渲染；`edge-tts` CLI 可用；系统未发现 ffmpeg/ffprobe，MP4 导出需在工程内准备本地编码器或使用框架自带编码。

## 回退

1. 历史本地迁移示例：备份通常位于当前账户的 `Documents/DSH-Preserved` 时间戳目录。此段仅说明当时的目录约定，不应照搬为当前更新配置；以本机实际迁移记录为准。
2. 从桌面 profile 移除模式：`plugin_manager` → `action: remove_bundle`，`target: @local/dsh-code-video-mode`；必要时只恢复备份中的桌面 profile 配置。
3. 重启 DSH 实例使变更生效。`local-plugins/releases/` 中的 tgz 保留，可随时重新安装。
4. 本包只新增一个 bundle 与一个 preset 行，不改写标准模式或既有会话。

## 维护

- 升级 DSH 后重新运行 `build-preset.mjs` 并复核差异摘要，不要沿用旧版本生成的补丁作为新版本基线。
- `mode/` 下的文档是模式自身的长期资产：修改后必须重建补丁（`persona.md` 变化需要重新生成并重装），并递增版本号。
- 新增技能或文档时同步更新 `package.json` 的 `files` 白名单，否则不会被 `npm pack` 收入。
