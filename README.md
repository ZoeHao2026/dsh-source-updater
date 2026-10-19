# DSH Source Updater

Unofficial Windows source updater for DeepSeek Harness. Builds locally from published upstream tags, preserves local plugins, and coordinates guarded installation and recovery.

这是面向 Windows x64 的非官方本地源码更新方案，由独立更新助手、DeepSeek Harness 桌面端集成补丁及三个本地插件的兼容材料组成。构建产物未签名，不代表 DeepSeek 官方发布。本仓库公开源码、固定补丁和插件基线，不发布已安装客户端二进制，不包含 Node、pnpm、npm、Git、编译工具、账户凭据或用户数据。

初始集成基于官方 [dsh-v0.2.1-alpha.5](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-alpha.5)，提交为 [`1517a4dbca0a2789ff1d41ba439600f8547d23fa`](https://github.com/deepseek-ai/deepseek-harness/commit/1517a4dbca0a2789ff1d41ba439600f8547d23fa)。固定源码补丁是可审查的本地改动；本仓库不是官方仓库的 fork。官方客户端的构建要求以其[打包说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-alpha.5/apps/desktop/packaging/README.md)为准。

## 更新行为

- 客户端冷启动及再次打开已运行的实例时检查官方已发布的 `dsh-v*` 版本，纳入 alpha、beta、rc，按完整 SemVer 排序；没有周期性版本轮询。正常打开窗口不等待构建，没有新版时不弹窗。
- 更新前固定发布标签及完整提交，在独立 checkout 中应用已保存的补丁，使用锁定依赖执行完整本机构建，并检查插件兼容性。补丁冲突、工具版本变化或插件不兼容会阻止升级，保留现有客户端；不会调用 AI 自动修复代码。
- 后台检查和构建使用独立 Node 进程与专用输出文件，客户端退出后可继续。再次启动通过 worker 锁及持久状态观察已有任务，避免重复构建。原生“源码构建更新…”菜单提供状态和重试。
- 停止 Host 前先验证当前插件选择、候选指纹、固定补丁和安装包。移除、新增、修改或未经可信清单确认的插件会阻止切换，不会恢复旧插件。构建或交接失败后停止自动重试同一候选，但再次打开仍检查更高发布版本；结果不明时保留状态，检查前不恢复竞争运行时。离线查询不弹窗，下次主动打开可重查。
- 安装要求客户端连续 60 秒无输入、草稿已保存，且不存在运行代理、待审批、排队消息及运行或停止中的后台作业。再次打开客户端会重置计时。Host 的有效提醒（包括未加载会话）会延后源码安装，避免定时器在请求排空后启动新任务；提醒不被修改或删除。Host 状态不明、提醒目录读取失败、请求排空失败、正常退出失败或强制更新策略待定时延后安装。
- 切换前备份程序、共享数据、桌面设置及安装元数据。先在隔离副本中禁用真实调度、验证迁移及插件，再原位安装并执行健康检查。可确定的失败恢复配套的旧程序和旧数据；无法确定的进程或事务状态保留锁与日志，等待人工检查。

保存的插件基线为 adaptive `0.1.14`、code-video `0.1.3`、模型选择折叠 `0.2.3`。配置可以明确选择其中经过审阅的非空子集，例如仅保留模型选择插件；助手不会从活动文件自动批准新插件。升级健康检查通过后，版本和已验证候选的受信记录随同一事务推进，回退也恢复匹配的旧记录。兼容副本保留原有功能及资源，适配版本会记录目标 Harness 版本。基线和兼容归档不是第三方插件的通用升级器，也不保证适用于所有未来版本。

## 文件与安装位置

`patches/source-compatibility.patch` 是更新助手实际应用的完整源码集成补丁；`patches/source-changes.patch` 提供源码差异审查材料。不要把两份差异重复叠加到同一 checkout。插件原始基线、固定文件清单及兼容归档位于 `plugins/`；更新助手和部署工具位于 `updater/`。

永久助手建议放在当前用户的 `Documents\DSHUpdater`，构建缓存单独放在 `Documents\DSHB`。客户端通过 Windows Documents Known Folder 查找助手，支持 Documents 重定向；健康子进程接收已选配置的绝对路径。发现顺序为显式 `DSH_SOURCE_UPDATER_CONFIG`、Documents 下的 `DSHUpdater`、旧版 `%LOCALAPPDATA%\DSH Source Updater`。显式配置缺失时不会回退到另一套助手。

`DSHB` 必须是本机拥有的短物理目录，在 Windows 上绝对路径不超过 64 个字符，并与助手、客户端及用户数据分离。工具拒绝目录重解析、陌生非空缓存和归属冲突。不要在 worker 锁仍被持有时替换助手、补丁或配置，也不要直接删除锁来解决安装状态不明的问题。

## 本机构建与部署

准备 Windows x64、Node 24+、完整 pnpm `11.28.5` 和 npm 包目录、Git、PowerShell，以及官方源码要求的 Visual Studio Build Tools、Windows SDK 和 Python。本仓库不捆绑这些工具。Electron 下载及校验默认共用 15 分钟截止时间，失败时清理本次私有临时下载；命令行打包可用 `DSH_DESKTOP_ELECTRON_DOWNLOAD_TIMEOUT_MS` 显式配置 1 到 3600000 毫秒。构建脚本的 Node 子进程优先使用配置中的独立 Node。依赖下载和后续构建需要网络；离线缓存是否齐全应另行验证。

1. 克隆本仓库，并在短路径检出固定的官方源码。以下 PowerShell 示例中的工作目录需要按本机情况设置。

```powershell
$kit = (Resolve-Path .).Path
git clone --branch dsh-v0.2.1-alpha.5 --depth 1 https://github.com/deepseek-ai/deepseek-harness.git C:\DSH\src
Set-Location C:\DSH\src
git rev-parse HEAD
# 必须为 1517a4dbca0a2789ff1d41ba439600f8547d23fa
git apply --check "$kit\patches\source-compatibility.patch"
git apply "$kit\patches\source-compatibility.patch"
pnpm --version
# 必须为 11.28.5
pnpm install --frozen-lockfile --config.virtual-store-dir-max-length=40
```

2. 按官方打包说明配置本机打包环境，保留应用 ID `com.deepseek.dsh`，选择本地未签名构建。先检查环境，再执行完整 Windows x64 打包；不要只构建 Electron 外壳或仅替换运行时。

可将 `examples/production.env.example` 复制到自行准备的本机配置目录中的 `presets/production.env`，保留已有配置。然后设置该目录的绝对路径；这个示例不含签名或发布凭据：

```powershell
$env:DSH_PACKAGING_CONFIG_DIR = 'C:\DSH\packaging'
$env:DSH_PACKAGING_PRESET = 'production'
pnpm run package:desktop:win:x64:unsigned --check
pnpm run package:desktop:win:x64:unsigned
```

3. 将仓库自带的 `options.example.json` 复制为本机选项文件，填写其中所有绝对路径。`destination` 指向物理 `Documents\DSHUpdater`，`buildCacheDir` 指向独立的 `Documents\DSHB`；`sourceRepository` 指向官方 checkout，`pluginAssets` 指向本仓库 `plugins`，`compatibilityPatch` 指向根目录的 `patches/source-compatibility.patch`。程序安装目录、Electron userData 及共享 Harness 数据目录必须来自实际安装；不要根据示例猜测或覆盖现有数据。工具路径应指向本机提供的 Node、pnpm、npm、Git 和 PowerShell。

4. 先预览部署结果，再部署助手。部署会校验插件固定文件清单，并复制所提供的工具及助手文件；`--dry-run` 不创建助手目录。明确插件子集、保留已推进的受信记录，以及旧助手的安全迁移方式见 [部署说明](updater/DEPLOYMENT.md)。

```powershell
Set-Location $kit
$options = (Resolve-Path .\options.local.json).Path
node .\updater\deploy-updater.mjs --options $options --dry-run
node .\updater\deploy-updater.mjs --options $options
```

**部署助手不会更新客户端。** 仍须安装前面本机构建、包含桌面集成补丁的客户端，普通官方安装包不会因为部署助手而自动获得该菜单和启动逻辑。首次切换需备份现有状态并验证健康检查；后续由已打补丁的客户端提供任务门禁和安装交接。不要通过手写活动计数来绕过客户端门禁调用 `apply`。

安装后从普通 Explorer 启动客户端，检查“源码构建更新…”菜单、实际版本及状态。助手配置和构建输出中可能包含本机路径，发布问题报告前应脱敏。验收范围、已通过项目和未验证边界见 [VERIFICATION.md](VERIFICATION.md)。

## 基础测试

Windows、Node 24+ 下从仓库根运行：

```powershell
npm test
python scripts/verify-public-source.py
```

第一条运行 84 项独立测试，无需安装 npm 依赖、读取真实客户端配置或调用网络；测试使用临时目录与独立随机 HKCU 夹具键，结束后清理自己创建的夹具。第二条需要 Python 3，检查固定文件与兼容归档、补丁散列、许可证和公开路径。CI 执行相同检查。

完整运行时探测和恢复故障夹具另有显式输入要求，见 [updater/README.md](updater/README.md)。它们不属于基础测试，也不默认发现本机生产配置。

## 许可与来源

本仓库采用 MIT 许可，保留 DeepSeek Harness 和包含的 clsx 等第三方材料的版权及许可声明。重新分发源码、补丁或插件归档时应保留对应声明。官方源码及随构建获取的依赖仍遵循各自的许可证；本仓库的 MIT 许可不会替代第三方许可。

公开副本对 README 中的个人绝对路径进行了脱敏，并据此重算固定清单内相应 README 的散列；插件运行时代码与资源字节保持不变。处理范围应在仓库公开说明中记录，不能把公开副本的文档散列与本地原始归档混为一套清单。
