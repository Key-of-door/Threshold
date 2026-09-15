# Threshold：当前状态与方向

更新于 **2026-09-14**。写给几个月后重新进入项目的人。

这是一份可以随现实改写的工作参考，不是 roadmap、contract、freeze 或验收标准。它保存当前有用的判断，不要求后续实现维护这些判断的正确性。重新进入时，先检查实际代码、Git 和实验记录；不要把本文的历史快照当作当前事实，也不要把本文当作新的执行或发布授权。

本文区分三件事：**观察**是某次实际发生的结果；**判断**是目前据此采用的工程选择；**假设**仍需要后续使用检验。实验入口用于定位，具体版本与限制以各原记录为准。

## 用户问题：换一个 Agent，项目不必重新开始

使用 Agent 做项目时，工作经常被 conversation 的边界切开：窗口结束、上下文压缩、更换 worker，用户就要重新解释做到哪里、为什么这样做、哪些还没完成。多个 Agent 之间也容易靠操作者搬运背景和 findings。

Threshold 希望减少这种负担：**让项目保留足够的共同状态，使新的 Agent 能重新观察现实、形成自己的判断，并自然继续工作。** 普通开发默认自主进行，留下有项目意义的记录；真正接入受控路径的动作，在缺少必要决定时局部停止。

它不是为了保存所有可观察事件，不是要求所有 Agent 达成一致，也不是让普通开发持续接受审计。用户最终应该感受到的是：换了一个 worker，工作仍然接得上。

“Project is All You Need”可以作为这个假设的表达，但不是字面上的技术完备性声明。模型能力、可用的 runtime、代码、工具和良好的任务描述仍然重要。

## 为什么连续性的中心是 Project

Session 保存某次运行的对话；Project 保存共同工作需要长期知道的事情。两者用途不同。

当前 Project 通过 Task、Run、checkpoint、Message 和 Git/worktree 联系起来。接手者可以读取工作目标、停点、协作输入和旧 Run 状态，然后重新检查实际文件。它不需要恢复另一位 Agent 的完整 conversation，也不应把摘要直接当作代码事实。

这里采用的是 **isolated cognition, shared project state**：认知可以重新形成，共同工作状态可以留下。Message 是协作输入；checkpoint 是停点说明；Task done 是提交者的工作判断；runtime 结束是执行观察。这些不自动相互升级。

Project 也不拥有全部事实。源码与 diff 在 Git/filesystem，运行事实来自 Pi/进程观察，远端结果需要对应服务的信息。共享 worktree 的修改可能无法准确归因给单个 Agent；不以文件所有权体系掩盖这种不确定性。

## 小实验已经支持了什么

以下是有范围的成功观察，不是普遍保证。主要环境为 Windows、Node 24.18、Pi 0.85.1、DeepSeek/deepseek-flash；不同实验绑定各自当时的源码。

| 性质 | 已有观察 | 不能据此推出 |
| --- | --- | --- |
| 跨 session / 正常服务重启接手 | 新 Pi session 实际读取旧 checkpoint，检查 Git/files 并继续；config-checker 的 parser、loader、CLI 逐步衔接 | crash 后恢复原 execution stack，或所有项目都只需很短摘要 |
| 持久 Message 协作 | reviewer 留 findings，后续 worker 实际读取、重新检查并选择性采纳；无需传 conversation | reviewer 总是正确，或任意错误消息都会被发现 |
| per-Run capability | 真实 Pi 加载所选 skill/extension；不同 Run 使用不同组合，新 Run 默认空 | OS 权限隔离、网络隔离，或 skill 正文一定被正确遵从 |
| self-hosting | Threshold 通过自己的 Project/Task/Run/Message 完成一次 CLI 维护与独立 review | 已有数月日常使用可靠性 |
| 并发与可替换 scheduler | scheduler 启动两个独立 worktree 的 peers；两者并发存活；新 scheduler 从 Board/messages/Git 接手并整合 | 大规模调度、复杂冲突处理或性能提升已经验证 |
| 外部能力组合 | 外部 read_doc 被真实调用；github_read + reviewer 完成小型远端 patch review，空 capability 的后继 Run 接手 | 任意 MCP/provider/plugin 都已经适配 |

实验并非一路无误：一次初始 scheduler Run 正常退出却没有留下调度成果，原因未建立；read_doc 初版 wrapper 的错误分类需要普通修复；review 消息出现过比需求更强的解释。GitHub review 中，一位 Agent 把 `nextPage=2` 误写成“共两页”，后继 Run 独立发现了错误。

这些记录值得一起保留。它们说明“运行结束”不等于目标完成，也说明协作输入需要被检查。无需为了让实验漂亮而重写历史，更无需每次发现表达错误就增加一个治理机制。

主要入口：

- [持久接手](persistent-handoff.md)、[Run objective / Task status](run-objective-task-status.md)
- [Message review → revise](minimal-messages.md)、[per-Run capabilities](per-run-capabilities.md)
- [首次 self-hosting](self-hosting-2026-09-13.md)、[并发与替换 scheduler](project-scheduling-2026-09-13.md)
- [外部 read_doc 实验](https://github.com/Key-of-door/Threshold-capability/blob/8094854f01d04b83d62f413cbc81b0517d038bdd/docs/read-doc-experiment-2026-09-14.md)
- [GitHub read + reviewer 实验](https://github.com/Key-of-door/Threshold-capability/blob/8094854f01d04b83d62f413cbc81b0517d038bdd/docs/github-read-experiment-2026-09-14.md)

部分更细的实验工件只在被忽略的本地目录中；仓库报告不能替代缺失的原始工件。不要将旧 development 观察重新绑定到后来的源码，也不要将没有对照的实验写成成本或效率优势。

## 当前边界：core 保存共同事实，capability 提供行为

当前分工是一个工程判断：尽量使用成熟 primitive，不重复拥有已经由其他组件负责的复杂度。

| 部分 | 当前责任 |
| --- | --- |
| Pi | 模型调用、上下文、Agent loop、普通工具、skill/extension 执行 |
| Git / worktree | 代码、diff、分支与普通并行工作目录 |
| SQLite / 本地 service | 项目状态持久化和普通事务 |
| Threshold core | Project/Task/Run、checkpoint/Message、运行观察与接手连接、具体 Risk STOP；受管 Run 生命周期、Project 范围和资源限制 |
| Threshold-capability | 可选的工作方法与领域集成；当前包含 scheduler、read_doc、github_read |
| 模型与 reviewer | 根据共享状态和实际项目重新理解、判断、工作；判断可能有误 |

**Installed ≠ Active. Capability belongs to the Run, not the Project.** 安装某个能力不自动激活它，某个 Run 用过也不意味着后继 Run 继承。主仓库不默认安装外围仓库，不按官方能力的名称或固定文件路径赋予特殊地位。

Zero-capability Run 仍有正常的项目协作连接与 Pi 普通工具。“空”指没有额外选择的能力，并非没有任何 extension。未选网络工具也不表示 shell 不能联网。

当前有意留在外围的行为包括：如何拆任务和安排 peers、review 的方法、代码整理风格、文档读取、GitHub 领域操作及参考 workflow。它们不要求 core 建立 Manager/Reviewer 身份、父子 Agent 树、固定工作流、plugin registry 或通用工具网关。MCP 是可考虑的接入方式，当前这两个仓库还没有真实 MCP 实验支持。

### 值得保留的一条观察

> **Capability growth should not require core growth.**

scheduler 的 skill/extension 已从主仓库外移，并去除了官方路径依赖；core 仍负责共享启动与运行事实。随后 read_doc 的实现与使用未再增加 core 逻辑。GitHub read + reviewer 又组合出 core 不理解其业务含义的 workflow，主仓库零改动，七个 `src/` 文件前后哈希一致。

这是目前很有价值的具体观察。它不是“任何能力永远都不需要改 core”的证明；此前为受管并发增加 workspace/启动来源和共享资源检查，确实回应了新的运行需要。不要为了追求零 diff，把本应共享处理的真实问题复制进每个 extension。

一个仍然有用的判断问题是：这是新的行为，还是一个所有相关 Run 都需要可靠理解、而现有 Project 状态确实无法表达的事实？前者优先放外围；后者先拿出真实 workflow 再讨论。

## Risk STOP，以及未来可能的 Threshold-Governance

**当前实现：**具体的 `fake_deploy` adapter 检查同一 Task/target 的 Human Decision，并在同一路径追加本地模拟结果。Human CLI 与 Agent API credential 入口分开；普通编辑、测试、Message/checkpoint 不经过这个部署决定。

这还不是通用真实外部操作保障。它没有证明真实 push、发布、支付或远端请求的 crash/retry 行为。Threshold 不解析任意 shell 的全部后果；同 OS 用户可以读取彼此凭据，API 入口分离不等于宿主安全隔离。

**当前方向判断：**具体 adapter 解析真实动作、检查所需决定并执行；技术错误仍是技术错误，局部风险只阻塞相关动作。不要把普通开发重新放进逐项审批，也不要为网络读取建立万能风险解释器。

**未来假设：**如果后续确有更高保证的审计、治理或验证需求，可以讨论独立、可选的 Threshold-Governance。这里保存的是边界倾向，不是已实现的产品、接口或确定分工。更强需求不能因为名字出现就变成每个 Project 的默认负担；纯 advisory review 也不能被宣称为强制执行边界。

旧远端 `threshold-governance` 是历史研究原型，应与上述未来方向区别对待。可以继承其真实失败经验，例如“超时不等于效果未发生”“Agent 通信不等于 Human 授权”；不自动继承 Authority graph、proof/witness、frozen package chain、qualification universe 或 session custody。历史投入、测试数量和冻结关系不为新产品创造需求。

## 现在为什么不急着寻找下一个 core feature

**当前判断：**已有 primitive 足以支撑这些小型真实工作流，近期压力更多来自使用方式，而非缺少项目概念。暂时没有下一项 core 架构任务，是合理状态。

core 可以继续修 bug、改善性能和兼容性。这并不要求把所有新改动赶出 `src/`；“Core only changes under real pressure”表达的是需求来源，不是代码行数指标。也不要为避免过度工程化再增加一个检查过度工程化的治理层。

更值得学习的是：陌生开发者能否在没有操作者口头补充的情况下，安装、完成第一次工作，第二天再回来继续。

> **最值得记录的不是新增了多少代码，而是：他在哪一步不得不停下来问你。**

目前值得优先考虑的事项如下，顺序可以被真实使用改变，不构成实施清单：

- **CLI 与首次使用。** 帮助/version、稳定的数据目录、短 ID、清楚的项目定位与状态输出、长文本输入。provider 配置示例应能在干净环境使用，不依赖本机 `.local/pi-agent`。capability 显式选择仍需保持。
- **诊断与长期运行。** 固定三分钟回合、home 累计 100 次启动、笼统 runtime 错误、stale lock 和 unknown Run 的恢复路径，目前都带有实验工具色彩。产品化应处理这些普通问题，不把恢复等同于自动重放或假定成功。
- **发布与维护。** 明确安装方式、默认分支、许可证、支持平台、最小 CI、升级/备份说明。README 先提供用户路线，架构和实验历史按需展开。
- **少量好用的官方参考能力。** 本地 working-tree reviewer 很有价值：现有样本默认按 PR 思考，已造成实际摩擦。保留 scheduler、文档读取、GitHub review 的组合示例；MCP 等新集成逐个按真实用途验证。它们是 cookbook，不是强制工作流。

不需要先做全屏 TUI、安装市场、完整 workflow engine 或持续审计系统。一个能独立走通的 quickstart、一段真实接手的终端演示，可能比再增加几个能力更有产品价值。

## 尚未建立的结论

以下范围不能从当前成功直接外推：

- 连续数周或数月的大项目；大量历史积累后的检索、摘要过时和信息遗漏。
- 高冲突并行修改、复杂整合、大规模并发，以及跨进程/跨机器协作。
- 不同 provider/model 之间的普遍可替换性、质量提升、成本优势或 token 效率。
- 任意进程树清理、异常服务退出后的完整恢复、真实外部效果的可靠 reconcile/retry。
- 任意第三方 extension/MCP 的行为正确性、隔离性、兼容性或安全性。
- 陌生用户无需指导即可长期使用，以及 Linux/macOS 等计划支持平台上的完整体验。

已有实验也出现重复调查、较长消息和 operator 同时编辑导致的困惑。目前没有证据要求 memory engine、文件 custody 或新的协作协议；是否需要补什么，取决于下一次真实工作具体缺少哪条信息。

## 再次进入时的定位信息

写稿时，两个工作区的实现起点是：

| 仓库 | 当前本机目录 | 分支与 HEAD |
| --- | --- | --- |
| Threshold | `E:/Threshold lite` | `codex/pi-integration-spikes` · `49e00e033bc6017dff379afb9fb7f332eaa1e6b4` |
| Threshold-capability | `E:/Threshold-capability` | `codex/external-capabilities` · `8094854f01d04b83d62f413cbc81b0517d038bdd` |

这些是日期快照，不是要求保持的 anchor。本稿编写前的发布 review 发现：两远端仍私有，默认 `main` 只有初始 README，尚无 LICENSE；公开或安装前需要重新检查，不能假设这些状态仍未变化。

重新进入时，先读当前 [README](../README.md)，核对工作区/remote/branch/dirty state，再按问题查看最近实验与源文件。更早的 [Working Architecture](working-architecture.md) 保存设计理由，但其中的计划、旧限制和未来设想不等于当前实现。无需为了接手重读全部历史，更不要从遗留治理原型反推新需求。

如果未来事实改变了本文，更新本文即可。项目需要的是更容易继续的工作，不是维护这份方向稿永远正确。
