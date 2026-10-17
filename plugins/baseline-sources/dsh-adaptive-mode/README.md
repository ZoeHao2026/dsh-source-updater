# DSH 自适应模式

这是从 DSH 0.2.0-rc.2 桌面应用内置的 `standard.patch.yml` 完整生成的新用户模式。基准文件的 SHA-256 为 `6cd2f197737fc94a45e487d0bb57869461dd6f392d45f6429b576e75d973eda8`。模式 ID 为 `adaptive`，显示名为“自适应模式”。此包不更改“标准模式”的默认设置，也不迁移会话。

## 独立 Max 功能与 DPIRA

聊天栏选择“自适应模式”后，在 `conversation.input.right` 位置显示独立的 **Max** 功能开关，默认关闭。打开时，会话投影 `adaptiveMax` 记录启用状态；本包在该会话后续请求组装系统提示词时加入 `framework/dpira.md`。关闭后，后续请求恢复原自适应流程。也可使用 `/adaptive-max on`、`/adaptive-max off` 切换。这一功能不依赖模型是否提供思考强度选项，也不读取或修改 `reasoningEffort`；例如选择 LongCat 时仍应显示并可启用。

Max 开启后，现有“计划”入口与 `/plan` 直接进入 **Max 的 DPIRA Plan**，这是用户显式选择，必须进入，不再经过任务难度判断。自动调用的 `enter_plan_mode` 满足下述两项条件后也进入同一状态。Max 在系统提示词组装时以完整的 DPIRA Plan 策略**替换**原生 `plan:policy`，不把两套计划指令叠加。DPIRA Plan 只做只读探索、D（设计与定义）和 P（计划审查），用 DSH 原有 `exit_plan_mode` 提交完整计划供用户审阅；批准后才进入 I/R 实施及 A 整批审计。它借用 DSH Plan 的会话状态、“计划”控件、`/plan off` 退出和 `exit_plan_mode` 审批机制。Max 关闭时，现有入口仍使用完整的原生 Plan 策略。

Max 开启但用户未选择 Plan 时，agent 在实施前评估任务是否**同时**存在实质性模糊和异常困难。两项都成立，才自动调用 `enter_plan_mode` 进入 DPIRA Plan；仅有一项或两项都不成立，就直接按普通 DPIRA 流程处理。这里的“未进入 Plan”不等于跳过 DPIRA 内部的 D/P。工具会校验模型提交的两项布尔判断，缺一则不切换；任务本身的语义判断仍由模型作出，不能保证每一次主观判断都正确。活动 Goal 优先于 DPIRA Plan，暂停 DPIRA 专属提示词并遵循 Goal 规则。Max 不改变模型的思考强度。

针对工程工作项，DPIRA 执行 `D 设计与定义 → P 计划审查 → (I 实施 ↔ R 单项审查) × N → A 整批审计`。每个工作项按功能、模块或子系统划分，单项审查通过后标记 `draft_complete`；所有工作项完成后才做整批审计。A 必须在宣称项目完成前单独核对整批结果与 D 阶段验收条件，运行适用的测试、构建、静态检查和实际启动或使用路径，并读取结果；失败则修复、重审和重做 A，未执行的检查记为 Unknown。A 发现局部实施缺陷时回到同批 I/R；方向性或系统性问题才开启新一批 D/P。切换其他模式后，Max 控件不显示，DPIRA 不注入。非工程任务仍使用自适应模式原有流程。普通 DPIRA 流程中的 P 是设计审查，不额外要求逐项批准；进入 Max 的 DPIRA Plan 后，仍须经 `exit_plan_mode` 审批才能实施。

在普通自适应模式中，即使 Max 关闭，完成项目或有实现结果的交付物后也要求单独的项目级自检：回看用户目标与验收条件，检查整合结果，运行适用的验证并读取结果，修复失败项，明确标出无法验证的部分。单纯问答不需要这道项目交付检查。

## 原结构分析与重构决定

原版标准模式包含 33 个声明 ID（含预设行与嵌套插件行），覆盖读写文件、命令与作业、检索、原生计划模式、任务列表、技能加载、子代理、用户提问和呈现。旧 `~/.dsh/.agent-presets/factory` 属于此前格式，在当前 DSH 中已不参与模式扫描；它的四个大而全 Skill 把路由、执行、验证重复写入多处，且有与当前子代理行为不符的描述。

重构采用完整复制标准模式声明，再只增加轻量决策层和一个原生计划模式入口。没有修改标准模式或它的插件配置。路由和评估由模式提示词执行，SOP 文件只定义跨任务约束，Playbook 提供各类任务策略，Workflow 文件定义按证据调整下一步的循环；具体执行仍复用标准模式的工具与状态机制。

| 层 | 实现 | 边界 |
| --- | --- | --- |
| Router | `framework/adaptive-router.md` 的动态系统提示词 | 仅在普通自适应模式注入；判断任务类型、复杂度、风险和所需能力；简单任务直接执行，项目完成前做整体验收 |
| Playbook | `playbooks/` 六个任务策略 | 只保存类别特有的策略、切换信号与专项验收证据 |
| Dynamic Workflow | `workflow/dynamic.md` + 标准模式的计划、todo、子代理与现有工具 | Max 关闭时保留原生 Plan 路由；Max 开启时显式选择直接进入 DPIRA Plan，自动进入需同时满足实质性模糊与异常困难，执行中按证据调整 |
| Skills | 完整继承标准模式的技能机制，另加 `dsh-runtime-check` | 新 Skill 仅负责 DSH 运行态只读核查；通用能力继续复用原工具 |
| Evaluator | `sop/operating-contract.md` 的证据边界、各 Playbook 的专项验收与 Workflow 的反馈循环 | 在关键节点和完成前核查实际结果；失败时修正、有限重试或重规划 |
| State/Memory | `sop/operating-contract.md` + 标准模式的 todo、会话状态与压缩机制 | 只记录任务必要的决策、进度和证据；不自动写入持久记忆 |

SOP 是横跨各层的共同约束，不增加架构中的第七个串行关卡。简单任务不必加载 SOP 或 Workflow 文件；非简单任务读取 SOP 和一份主 Playbook。Max 关闭时保留原自适应模式按复杂度及风险选择原生 Plan 的规则；Max 开启时使用上述 DPIRA Plan 规则。六份 Playbook 不再重复通用的规划、委托和重试规则。

## 文件与构建

- `scripts/build-preset.mjs`：从**当前安装版本**的标准模式补丁生成 `cordis.patch.yml`。锚点不匹配会报错，避免升级后悄悄遗漏标准能力。
- `cordis.patch.yml`：可直接装载的模式声明，保留标准模式全部 33 个声明 ID（预设 ID 改为 `preset-adaptive`），另加入 `adaptive-plan-entry` 与 `adaptive-dpira-max`；预设 persona 只保留基础身份，Router 由功能插件按当前会话状态注入。
- `lib/plan-entry.js`：`enter_plan_mode` 自动选择工具；Max 开启时需同时提交“实质性模糊”和“异常困难”为真，之后通过 DSH 原生 `planMode.set` 进入 DPIRA Plan；手动入口绕过此工具的难度判断。Max 关闭时沿用原生 Plan 规则，实际进入可能在下一步生效。
- `lib/dpira-max.js`：按预设、独立的会话投影 `adaptiveMax` 和 Plan/Goal 状态，动态注入自适应 Router 与普通 DPIRA 指令；Max+Plan 时通过 `system-prompt/assemble` 将 `plan:policy` 的文本替换为 `framework/dpira-plan.md`，不是另加一段计划策略。`framework/adaptive-router.md` 含路由及项目级自检，`framework/dpira.md` 含普通 Max 流程及 A 阶段整批核查。活动 Goal 优先并暂停 Max 专属计划策略。
- `playbooks/`：修改、诊断、研究、系统操作、审查、内容交付的类别特有策略和验收证据。
- `sop/operating-contract.md`：跨任务 SOP 的授权、兼容、外部效果、证据与最小状态约束。
- `workflow/dynamic.md`：复杂任务如何按证据选择下一步、委托、核查及重规划。
- `skills/dsh-runtime-check/SKILL.md`：唯一新增原子 Skill。
- `tests/plan-entry.test.mjs`：原生计划模式入口的聚焦测试。

重新生成时，从实际运行的 DSH 包中定位 `@deepseek-ai/dsh-web-app/presets/standard.patch.yml`，执行：

```powershell
node .\scripts\build-preset.mjs '<标准模式 standard.patch.yml 的绝对路径>'
npm test
npm pack --pack-destination '<发行目录>'
```

安装时由桌面端插件管理器把打包所得 tgz 装入 `desktop` profile；原 Web profile 及其旧版插件包应保持原样。包内的 `dsh.bundle.patch` 会向所选 profile 添加新模式。升级 DSH 后应重新从新版标准模式生成、比较并验证，不能把本版本的补丁直接当作以后版本的标准模式。

## 验收与边界

- 静态比较：除预设 ID 更名和新增计划入口、Max 功能入口外，新模式与原标准模式的 33 个声明 ID 顺序一致；仅新增按需读取的策略和一个 Skill。
- 隔离 `DSH_HOME`：插件安装、配置合成与桌面实例挂载需重新验证。
- 实机验收：确认标准模式仍为默认；仅选择自适应模式时显示 Max；LongCat 等无模型 Max 推理等级的模型可独立切换；关闭和跨会话默认状态符合预期；Max 开启时点击“计划”或输入 `/plan` 直接进入 DPIRA Plan，自动调用 `enter_plan_mode` 须两项判断均为真才进入；Max 关闭时现有入口仍进入原生 Plan。
- 提示词验收：通过真实请求核对 Max 开/关两种状态下的 Router、普通 DPIRA 和项目级自检要求；Max+Plan 中暂停普通 Router/DPIRA 指令，确认最终系统提示只有 Max 的完整 DPIRA Plan 策略而没有原生 `plan:policy` 文本，同时仍可只读探索并使用 `exit_plan_mode` 审批；退出 Plan 后恢复普通 DPIRA；活动 Goal 时暂停 Max 专属计划策略。用“模糊且异常困难”“仅模糊”“仅异常困难”“两者皆否”四类任务核对自动路由，记录模型误判；核对请求的 `reasoningEffort` 不因本功能改变。
- 项目级自检与 DPIRA 阶段质量依靠系统提示词引导 agent 执行；插件尚未用代码强制每一步的验证或事务门禁。需用实际项目结果检验遵循情况，不能将提示词存在或一次示例视为所有任务必定合规。

## 回退

在桌面 profile 中安装前，应先备份该 profile 的配置、锁文件与插件依赖。若需要撤销新模式，先停止桌面 Host，再通过桌面端插件管理器移除本包或恢复受影响的配置及依赖；保留迁入后新增的共享会话。旧 Web profile 及其插件包不随桌面端回退而更改。
