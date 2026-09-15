# 第一次独立使用：最小改进与实验准备

2026-09-15，工作记录。改进前基线为 `49e00e0`；下表保留当时方案与旧现状，实施状态见文末。
这是一次有界产品使用观察，不是新架构规范、qualification 或发布承诺。

目标：一个不带本项目对话历史的使用者，只凭用户文档和 CLI 完成普通工作，另一个新会话再从持久 Project 接手。
最重要的记录是：**在哪一步需要猜、查源码、找内部文件或请求作者解释。**

## 先做的最小改进

| 改进 | 建议的最小行为 | 现状与实现位置 |
| --- | --- | --- |
| 安装 / quickstart | 一条可复制的安装路径；说明 Node/Git/Pi/provider 前提；首例没有作者机器路径；用安装后的 `threshold` | 已有 bin，README 仍使用 `node src/cli.mjs` 和本机 `.local/pi-agent`；主要是 package/文档 |
| help / version | 顶层、命令组、子命令各自帮助；列必填参数、默认值和一个例子；不要求服务在线 | 当前两 flag 都报 Unknown option；CLI 层 |
| 稳定 home | OS 用户数据目录为默认；显式 `--home` 继续覆盖并显示实际目录；cwd 不改变服务定位 | 当前 `.local/threshold` 相对 cwd；普通路径配置，不自动搬迁旧数据 |
| Project 定位 | `project create` 可省略 repo，使用当前 Git 根目录；已登记同一路径则显示现有 Project；当前 repo 的唯一匹配用于省略 project 参数 | 当前须传 repo/Project UUID；优先复用现有项目索引与普通 Git 观察，不建 current-project 表 |
| 短 ID | 完整 ID 始终可用；前缀只在明确的实体/Project 范围内解析；0 个或多个匹配给出清楚说明与候选 | 不按标题猜 Task，不自动选最后一项；最近 5 个 Run 不是完整唯一性检索范围 |
| 人类输出 | 默认简短可读；显式 `--json` 保持可脚本消费的数据；Task assessment 与 Run execution 分开；错误结束不能只显示 ended | 复用已有 summary；发布说明明确默认 JSON 的变化，更新依赖旧默认的测试/脚本 |
| 错误定位 | 说明失败动作、已知阶段、能确认的原因和一个下一步；默认无 stack/secret | CLI 可区分参数/path/服务定位/连接；服务/Pi 可以保留已知失败阶段，但未知原因不得猜成 provider 错误 |
| 停止对象 | `run stop ID` 与 `service stop` 明确分开；裸 `stop` 只解释两种命令，不再隐式停整个服务 | 不新增生命周期；旧语法兼容取舍需在实现说明中明示，不能悄悄改变含义 |

保留已有命令主体，不为了这一轮整体重命名所有命令。优先让 `status`、`project create`、`task create`、`run` 等已有路径更自然；`run stop` 是有明确理由的小扩展。
长 instructions/message 可以加普通 `--instructions-file` / `--body-file`，若最初路径已因此繁琐就做，不必同时增加交互向导、编辑器协议和配置系统。

运行和查询仍走 service，CLI 不直接读写 SQLite。若 Run 前缀定位确实需要完整的范围查询，可增加一个普通过滤查询，别用截断列表伪装全量，也不需要新的 core primitive。
遇到同一仓库多个 Project/worktree 匹配时，明确列出候选，要求显式选择。

### 本轮不顺便解决

不增加 integration、TUI、capability registry、自动调度或完整 crash recovery。
三分钟 Run 上限和累计 100 次启动仍是已知长期使用摩擦，本轮先在 help/status 中说清；若实际首次工作因此被截断，原样记录，再作普通产品调整。
不把试用成功写成这些长期限制已经解决。

## 陌生会话实验如何准备

### 安装与环境

- 待改进完成后，从明确版本生成一个本地预发布安装产物。代理用户自己按 README 安装；不预装 threshold、不预建 service/Project/Task。
- 实验工作目录拟用 `E:/Threshold-first-user/`；实际执行前检查是否存在，已有内容不覆盖。安装输入、练习项目和操作者记录分开。
- 优先使用干净 OS 测试用户，使真正的默认数据目录也是空的。若只能使用隔离配置/数据目录，则如实记录，**该次不能证明真实默认 home 的首次选择**；默认 home 的 cwd 独立性另做 focused regression。
- 预置正常 Node/Git 和可用 Pi provider 环境，不复用作者 `.local/pi-agent`。只提供 provider/model 名称与已就绪的配置位置，不向 prompt、文档或日志复制 credential。
- 本轮少量真实 Pi 调用已获得单独授权；credential 仅由进程环境传递，不写入文件或项目状态。
- 使用本地安装产物是预发布安装测试，不声称 npm registry 分发或公网下载已经验证。

### 测试者与材料

使用两个新建、非 fork 的 Codex 会话 A/B，初始材料分别为下面的用户 brief。
不给它们本文件、方向稿、历史报告、开发会话、上一位 transcript、内部 API/数据库说明或已知答案。
待执行时只补实际安装入口、练习目录、README 和已就绪的环境事实；不补具体操作命令或已有实体 ID。

它们是 CLI 使用者，真正项目编辑由 Threshold 启动的 Pi worker 完成。它们可以检查练习项目、运行独立检查，但不能自己代写 Pi 未完成的功能以掩盖运行失败。
禁止修改 Threshold 或 capability 源码；不用内部 HTTP API、数据库或实现源码完成用户步骤。若认为必须这样做，记录为何需要并停在该处；这不是要求永远不读源码，而是本轮黑盒观察的边界。

新会话仍可能有模型固有工具知识、宿主说明和 Codex memory。启动时应尽量避免项目历史注入；无法排除的内容记在报告中，不能声称真人盲测或完全无先验。
同机器的只读限制是行为约束，不宣称文件访问隔离。

### 小项目与交接

练习为零依赖 Node 小工具 `log-summary`：读取 UTF-8 NDJSON 日志，统计 info/warn/error 数量；忽略空行；坏 JSON、缺失/不支持 level 报输入行号；CLI 成功向 stdout 输出 JSON，错误向 stderr 输出说明并非零退出。
操作者准备普通 Git seed、几条输入样例和明确需求，不预写答案。正常空项目没有历史 Task、checkpoint 或 code。

A 获得完整产品需求，只要求第一轮先完成解析/汇总模块及测试，并通过产品留下后续工作，然后正常停止服务并结束会话。
B 不获得 A 做了哪些步骤的转述；只知道这个项目已有未完成工作，请从用户入口发现并继续。完整需求应已经由 A 放入 Task，而不是操作者在 B prompt 再复制一遍。
B 从练习 repo 的一个子目录开始，既不靠旧 cwd 也不靠作者提供的 Task UUID找到项目；正常重新启动 service 后接手。

只暂停 Codex 页面不等于会话隔离。以创建新的 B、不给 A 对话作为测试方式；A 的 Pi worker 与 service 是否正常退出由操作者另核实。没有停止成功则记录，不替它静默清场。

## 如何观察，何时停止

不做评分系统。逐次记下：用户想做什么、首先尝试什么、实际输出、是否找到文档解答、是否必须求助、最后仍有什么不确定。
区分“通过 README/help 自行恢复”“需要猜测/调查”“作者介入后恢复”。作者回答一次问题不等于实验作废，但后续结果必须标为 assisted，不能抹掉原阻断。

本轮不现场修产品。卡住就保存观察；实现窗口之后修，再作为另一轮使用记录。不要偷偷替用户启动服务、搬数据、解析 UUID 或调用内部 API。
不故意破坏 provider、触发 UNKNOWN 或制造失败矩阵；正常路径遇到的错误足以提供信息。没有观察到的取消/错误类型写未测试。
裸 stop 的歧义主要由 help/CLI regression 检查；若自然使用没有取消活跃 Run，不声称 live cancellation 已验证。
平台安全中断照既有约定立即停止，保留可得错误和现场，不换路径重试。

结束后操作者检查实际 Git diff、A 的有效工作是否保留、最终 CLI 行为与退出码；用几条独立输入验证正常、多行、空行和错误行号。原 seed 样例是否被不合理改写也要看。
Task done、Agent 自报、独立测试结果分别记录。无需完整 telemetry bundle，也不为本轮增加持久事件表。

产出只需短报告：版本/环境、两会话与 Runs、实际路径、摩擦、介入、独立结果与未测范围。
若成功，结论是“这两个代理用户在这些环境条件下可以从文档完成路径”；是否能服务真人长期使用，仍需后续观察。

## 当前准备状态

最小 CLI 改进已实现，版本为 `0.2.0-alpha.1`；23 项测试通过。本地 npm 安装产物在独立 prefix 安装成功，安装后的 Pi RPC 状态查询和正常退出已验证，未为该检查调用模型。
实验采用两个独立、非 resume/fork 的 Codex CLI exec 会话；不声称是两个桌面窗口。禁用历史 memory/插件注入，保留正常工具规则与账户认证。只收集公开消息和命令结果，不保存 reasoning item。
同一 OS 用户下的默认 Threshold home 在实验准备时不存在，因此使用真实默认位置；这不是 OS 权限隔离。Pi 使用新建公开配置，不复制旧 `.local/pi-agent`。A/B 各自决定 README 阅读量。
两次独立会话现已完成；实际结果与摩擦见 [first-user-report.md](first-user-report.md)。这份准备稿保留方案背景，不能用来代替观察。
