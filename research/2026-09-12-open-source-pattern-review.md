# Next Threshold 开源工程模式比较

**结论：已有实现足以支持一个很薄的 Next Threshold，但没有任何一个参考项目值得被整体继承。最值得借鉴的是 runtime 的现有事件接口、普通 SQLite 数据操作、可信入口鉴权、受控动作内联检查和外部结果不确定时禁止盲目重发。**

外部项目仅作为 implementation reference / pattern library。本文不赋予其需求、设计 Authority 或 acceptance 地位；所有“建议”均为工程判断，不是 schema freeze。

研究基于 2026-09-12 读取的公开源码快照、官方协议和数据库文档。源码链接固定到 commit。没有安装或执行这些项目，没有运行它们的测试，没有移植代码；因此“源码存在某实现或反例测试”不等于本机验证通过，也不等于生产可靠性已得到证明。

## 研究范围与项目身份

| 项目 | 本轮固定 commit | 用作什么参考 |
|---|---|---|
| Pi，当前仓库 earendil-works/pi | `71dca871bc80b6bc97be37f0ca3189399d651fff` | RPC、执行事件、扩展工具、进程结束 |
| OpenCode，anomalyco/opencode | `95daf90670b7c039c436c85537da5fbfe2205b41` | 已运行服务接入、事件流、会话查询、worktree |
| agent-inbox，KI7MT/agent-inbox | `13a81ecfec4aa493f2c25da397cdcf446f90398c` | 单机 SQLite inbox 与明确的信任限制 |
| contenox/contenox | `2f653670f782b0cda42009fa622b761471d5eabb` | 持久待审批记录、条件更新、重启反例 |
| Airlock，airlock-dev/airlock | `68a71c7f0139c823971b95a79cf800e837630d3a` | gateway 检查/执行路径、审批恢复和保留期 |
| HumanLayer ACP，humanlayer/agentcontrolplane | `eaa2a7ed1d9cb4e13dc53defaf420e36f481dcad` | 分布式任务/审批状态机的对照 |
| Approving，cocofhu/approving | `6cc2a479e9958f9e12b37b4e8236c0b000eb6509` | 登录态、Gate 数据记录、SQLite 单连接、artifact |
| Gantry，knacklabs/gantry | `b1e1ac0b0de56fcf82e0b358607c8e8912d9efab` | 凭据范围、消息游标、外部投递歧义处理 |
| AgentOps，AgentOps-AI/agentops | `f8e907b92dabe47232978023fdcb01e2a7d4b752` | tracing/export 与数据过期 |
| LangGraph，langchain-ai/langgraph | `e539ac122f4126f6dd850581c1494948cf620e31` | checkpoint、重放、副作用幂等限制 |
| Agent Handoff，artyomboyko/Agent_Handoff | `22ff8d0256501f024a1ae5384e794dd3b8a47686` | 文件式交接及其流程负担 |

Airlock 和 Agent Handoff Standard 都存在同名或近名项目。上表明确本轮选中的仓库，不主张已确认它们就是此前讨论中的唯一原项目。HumanLayer ACP 在此指 **Agent Control Plane**；下文 runtime 接入中的 ACP 指 **Agent Client Protocol**，两者不可混用。HumanLayer ACP 所读 HEAD 的提交日期为 2025-07-02，不能把近期网页抓取时间当成近期开发活动。

“成熟”在本文中不是按 star 数授予的标签。Git、SQLite 等基础机制与较新的 Agent 项目具有不同的验证历史；后者主要贡献可审查的实现样本。

## 1. Runtime integration：选择现成控制面，不重建 Agent loop

| 路线 | 实际接口与源码 | 接入负担及边界 |
|---|---|---|
| Pi RPC / extension | JSONL 命令与事件；`get_state`、`abort`、session ID；扩展订阅生命周期并注册工具。[1], [2], [3] | 可以启动一个受管理 worker，不需要 fork 或解析终端展示文字。需要适配进程、事件和协作工具；不是仅靠一段 prompt。 |
| OpenCode server | 事件订阅、session 查询/等待/中断、历史与带 `after` 的 session events；处理器记录 tool running/completed/error。[4], [5], [6] | 更适合接入已有服务和客户端。HTTP/SSE、认证、重连及版本适配会比最小进程桥接多一些工作。 |
| Agent Client Protocol | `session/update` 承载 tool 状态；`session/request_permission` 承载请求；会话恢复由能力声明决定。[7], [8] | 适合已有 ACP runtime。协议形状不能证明某实现完整发出事件；必须检查实际 runtime，而不是只检查“支持 ACP”标签。 |

**实际需要多少代码？** 本轮能测量的是上游样本，不能虚构尚未实现的 Threshold adapter 行数：Pi 最小 SDK 示例为 26 行，扩展示例为 99 行，完整 RPC client 为 609 行，RPC 类型文件为 297 行。前两者证明接入点较小，后两者说明进程失败、请求关联和完整 API 支持有真实成本；它们都不等于 Next Threshold 必须自己写的代码量。[1], [2], [3], [3a]

contenox 的 ACP 事件转换文件本身为 408 行，且目录还包含 session、permission、transport 等模块。这是把其自身 runtime 暴露为 ACP 的实现，不能被当成“外部消费者最低要写这么多”的证据。它也展示了转换损失：有些内部结束/暂停事件不直接产生协议通知。[9]

**建议：** 如果第一条 vertical slice 允许由 Threshold 启动独立 worker，优先验证 Pi RPC + 一个小 extension；如果要求保留既有交互客户端并附着到其服务，优先验证 OpenCode server。这里只排接入验证优先级，不最终选定 runtime，也不要求改产品去迎合它。

第一版只接入任务需要的命令、状态和事件。不要复制完整 RPC client 或统一所有 runtime 的模型路由、上下文压缩和调度功能。

**需要避免的错误：** `agent_end` 可能表示一次内部运行结束，不代表项目任务完成；进程退出不代表它发出的外部操作没发生；工具返回 error 也不自动代表外部效果为零。Pi 已有“子进程退出时未完成请求应被拒绝”的专用测试，本轮只读了测试，没有执行。[10]

Windows 不是一句“跨平台”就算验证：Pi 文档明确默认使用 Git Bash，也提供可选 PowerShell 工具。当前 Windows、空格路径、取消和子进程清理仍需在后续接入阶段实测。[11]

## 2. Project / Task / Message：普通关系模型足够

**agent-inbox 的实现很接近所需规模。** 核心 `messages` 表包含 ID、时间、sender、recipient、priority、status、subject、body 和 parent_id；发送就是插入，收件箱就是按 recipient/status 查询，离线时数据仍在。它使用 UUID，而不是单调整数游标。[12]

广播在业务层为每个收件人写独立消息行，因此一个人改变已读状态不会改变其他人的状态。等待消息使用有界轮询；这说明少量本机 Agent 的持久通信不天然需要 broker。[13]

**Gantry 的对照：** 消息查询接口带时间、会话和 ID 组成的游标，并处理外部 channel/provider account、thread、附件及投递状态。这些字段服务其跨渠道团队产品；Postgres 和较大的消息仓储不能直接归因于“Agent 需要互相说话”。[14]

**HumanLayer ACP 的对照：** Task/ToolCall 是 Kubernetes 资源，控制器根据持久 phase 反复协调审批、执行、子 Agent 等状态。它明确是分布式外层 Agent 调度系统；其 CRD/controller 对应这一产品要求，而不是本机消息传递的最低要求。[15], [16]

**Next Threshold 可借鉴：** Task 保存目标、状态、assignee、workspace、checkpoint；Message 保存收发对象、任务关联、正文和回复关系。离线投递由持久记录完成，唤醒通知只是便利功能。review request 可以是普通消息或审查任务，不新增 reviewer 治理身份。

消息分页可使用数据库生成的递增 sequence，或带稳定 tie-breaker 的游标。接收游标/ack 表示消费位置，不表示读者已执行或同意消息内容。Task 更新使用普通版本条件更新，避免并发最后写入悄悄覆盖。

**不继承：** agent-inbox 把 `action/urgent` 消息置于 Human 审批后的可见队列，这与默认自主协作不一致；也不继承其将消息读取、工作进度和批准状态混在一个 status 字段中的做法。Task、Message、Decision 在这里分开反而更简单。[12], [13]

## 3. Human decision：真实入口鉴权，不靠名字

| 实现 | 已观察到什么 | 对 Next Threshold 的意义 |
|---|---|---|
| agent-inbox | MCP 的 `mark()` 禁止设置 approved/rejected，另有 operator 路径；但项目明确承认没有 per-agent 认证，sender 可自报，同 OS 用户是信任边界。[13], [17] | 可借鉴 API 分工；不能据此宣称有权限隔离。 |
| Airlock | 审批端点调用公共请求安全检查；Agent HTTP 入口可以使用专属 token，也可以回落到全局 secret。[18], [19], [20] | 单独 credential 可以很小；必须检查实际配置，不能默认存在 Human/Agent 隔离。 |
| Approving | 普通登录 session 经 middleware 校验，用户名由认证状态写入请求上下文；Gate handler 从服务端 actor 取 reviewer。[21], [22] | Human 来源应由服务端认证入口确定，不接受模型传入的 username 作为授权依据。 |
| Gantry | Bearer token 哈希匹配后检查所需 scopes，不足则 forbidden。[23] | 可以借鉴有限的入口权限检查，不必继承整套企业权限体系。 |

**建议：** Agent credential 只能调用协作与受控操作请求接口；可信 Human 客户端才能写 Decision。两者可以由同一个本地服务处理，没有必要拆成微服务。

不同 URL、不同表、隐藏工具名都不够。如果 Agent 的任意 shell 能读取 Human token、访问同一已登录浏览器或修改 SQLite，它仍可能绕过入口。所需保护应来自现有 OS/runtime 的文件、凭据和执行权限；同用户完全访问环境中，应明确保证较弱，而不是再发明签名对象来掩盖这一点。

**revoke / replace 的证据限制：** 本轮核查了审批创建、回答、过期和入口鉴权，但没有为上述每个项目建立完整的长期 scope grant 撤销语义。因此不能说“某项目已经完整解决我们的 Decision”。Next Threshold 可用普通记录保留授予、撤销、替代关系；未来执行时读取当前适用决定。撤销不能追回已经发生的外部效果。

## 4. Controlled external action：检查与执行处于同一调用路径

Airlock 的 gateway middleware 先判断是否需要审批；需要时建立 ticket，等结果，再进入后续执行 middleware。拒绝和等待超时返回明确结果；等待时断连会取消相应请求。这是可以直接理解的 control flow，不需要 proof universe。[24]

但完整 Airlock 还包含 allowlist、shell/command policy、参数检查、sandbox、检测器和输出处理。其产品是通用权限 gateway，因此它试图覆盖的效果面远大于 Next Threshold 的少量 adapter。不能把整条 middleware chain 当成我们的标准成本。[25]

HumanLayer ACP 也有明确的审批后执行 phase，但把每次调用包装成 Kubernetes ToolCall 并由 controller 协调；这适合其分布式异步产品，不适合作为 v0 的默认部署方式。[15], [16]

**Next Threshold 建议路径：** adapter 解析实际操作及 target → core 匹配当前 Decision → 必要时留下局部 Block → 获准后在同一受控入口协调执行 → 更新 operation/result。等待 Human 时可以返回待处理标识，不必让一个 HTTP 请求或数据库事务一直挂着。

one-shot 许可可用事务内的消费字段或 operation 关联防止两次本地领取；task-scoped 许可只按明确的任务和目标范围匹配。两者解决本地授权适用性，不等于远端执行 exactly-once。产品默认允许的普通开发无需生成 grants。

ACP 的 `allow_always` 只提供协议选项，不能自行定义我们的 task scope、参数范围或撤销行为。是否需要某一字段，应由首个具体 adapter 的实际后果决定。[7]

**凭据限制：** 让受控 adapter 持有实际外部凭据；如果 Agent 另有同等凭据，gateway 只能保证经过它的调用。不要增加任意 shell 静态解释器去弥补这个诚实限制。

## 5. 外部 UNKNOWN、幂等与恢复：保留小状态，不许盲目重发

Gantry 是本轮最有用的失败处理对照。其外部投递记录包括 idempotency key/fingerprint、claim token/expiry、sendBegunAt、provider message ID 等。过期 claim 被区分为尚未进入发送与可能已发出；后者禁用自动重发。Postgres 使用行锁与 `skipLocked` 支持并发领取。[26], [27]

值得特别说明：在读取的代码中，歧义投递被写成 `partially_delivered`，某些恢复统计还计入 failed。它没有统一使用字面值 UNKNOWN。可借鉴的是“不自动重新发送”的行为；我们不应继承把未知、部分成功和失败混在一起的状态表达。[27], [28]

LangGraph 在 SQLite 保存 checkpoints 与 writes，使用锁、事务和键约束。这可以避免重复计算已保存结果，但不能把 SQLite 和外部系统变成原子事务。其官方文档明确要求可重执行副作用使用幂等设计；开始后未成功保存结果的 task 仍可能再次执行。[29], [30]

作为远端真实契约的补充，Stripe 的幂等接口会在同 key 下复用第一次结果并核对参数；key 清除后重用会成为新请求。它证明的是“远端协作的幂等”，不是本地生成 UUID 就自动获得幂等性。这里仅把它作为 API 行为参考，不建议给 v0 接入支付功能。[31]

**建议的最小 operations 数据：** 稳定 operation ID、具体 adapter/目标/请求身份、适用 Decision 引用、当前状态、可选远端幂等 key/reference、执行开始及结果时间、错误或 UNKNOWN 原因。字段不是冻结 schema。

| 恢复时的实际证据 | 可以怎么做 |
|---|---|
| 能确认尚未进入效果调用，且旧执行者不能继续发送 | 可以重新领取 |
| 已确认远端结果 | 补齐本地结果 |
| 远端提供适用且仍有效的幂等契约 | 用原 key 和原请求恢复或重试 |
| 有可靠查询接口 | 先查询，再按结果处理 |
| 可能已发送，但无法确认结果 | 保留 UNKNOWN，阻止可能重复该效果的自动重发 |

单机服务可用一次条件更新领取操作，不需要分布式 lease 系统。进程重启或 claim 过期本身不证明安全重试；写下“开始”与真正调用之间也有窗口。允许保守 UNKNOWN，比虚构 exactly-once 更准确。

## 6. Handoff / resume：持久任务与重新观察，区别于恢复执行栈

contenox 的持久审批设计明确记录了旧版内存 map 在重启时丢失待审批请求的问题。新实现先写 `hitl_approvals`，再通知；回答使用 `WHERE state = 'pending'` 条件更新。测试包含重启后回答、请求者已不在等待时保存回答，以及到期扫描不覆盖已回答结果。[32], [33], [34]

它还使用 `chain_checkpoints` 保存版本化执行状态、resume claim 和 failure。这服务“恢复同一个 chain”的要求。Next Threshold 的项目接手不需要自动等同于恢复旧执行栈。[32]

Airlock 能从持久记录恢复待审批列表与通知，但恢复代码重新建立的 promise 不等于恢复了此前的真实 tool execution continuation。应分别核查“请求仍可回答”和“动作可安全继续”；不能从前者推出后者。[35]

Agent Handoff 的文件式方案确实让接手者读取 Git、Issue/PR 和短期交接信息；但它同时带来强制 work claim、阶段报告、流程文件等要求。它是一套团队流程标准，不是可以直接当作轻量恢复服务的代码库。[36]

**建议：** 持久 Task、Message、Decision、Block、未决 operation；checkpoint 只汇总目标、已做事项、Git/patch、检查结果与下一依赖。新 worker 读取这些记录，再检查实际 Git/worktree 与原 worker 状态。没有 checkpoint 的意外退出会增加重建成本，但不应导致项目状态只能从旧上下文恢复。

当前样本中，没有一个被完整验证为同时实现“薄项目交接、现实重查、最小权限分离、UNKNOWN 恢复”的现成组件。这部分仍需要我们用普通服务代码组合，而不是移植一个交接协议宇宙。

## 7. Git / worktree：目录隔离解决覆盖，Git 负责合并

OpenCode 的 worktree 实现使用普通 `git worktree add`、分支与目录命名、启动及失败处理；所读文件为 623 行，包括创建之外的管理功能，并非最低实现行数。[37]

Git 本身支持同一仓库的多个工作树，每个工作树有自身 HEAD/index 等状态，同时共享仓库的部分数据。它能降低多个 Agent 直接覆盖同一目录的概率，但不会替项目解决逻辑冲突或隔离共享凭据。[38]

**Next Threshold 可借鉴：** 并行写任务优先分配不同 worktree，Task 保存目录与分支引用；合并使用普通 Git 流程。review 可以读同一提交或 patch。一个 Agent 的多次 session 可以继续使用同一任务工作树，不必每次换 session 都新建 worktree。

checkpoint 可保存 HEAD、dirty paths、必要 patch 与未跟踪 artifact 引用。普通 diff 不包含所有 untracked 文件；仅记录 HEAD + dirty=true 也无法复原当时测试的完整字节。确有复现需求时才保存对应材料，不扩成每次读取都做快照。

**不继承：** 文件 custody、每路径所有权协议、自动强制清理工作树、为了让状态“整洁”而丢弃 dirty 内容。普通 merge conflict 首先由 Agent 按项目意图解决；只有真实产品选择或无法恢复的冲突才需要 Human。

## 8. Telemetry → 项目历史：保留期和汇总是两个不同问题

AgentOps 的实现围绕 OpenTelemetry span/export，带认证失败处理；其所读 ClickHouse 初始 migration 已为不同 telemetry 表设置 TTL。这直接反驳“可观察数据必须永久保存”，但不代表它已经提供了 Next Threshold 所需的长期项目 Action 汇总。[39], [40]

Airlock 的 SQLite 代码包含 audit_log、hitl_queue 等，并按 retentionDays 清理旧 audit 与已完成审批记录。它仍以工具级 audit 为产品功能，不能直接作为项目历史模型。[41]

OpenCode 的 session summary 根据执行步骤引用的 snapshot 计算文件 diff；Approving 则把 artifact 产品记录与截断的 McpCall 调试信息分开。这些都提供了“呈现工作结果，而非只呈现调用流水”的局部模式，但没有证明完整满足我们的 telemetry/history 分层。[42], [43]

**建议：** 短期 telemetry 使用有大小和保留期限制的日志；长期 actions 由少量明确规则生成：文件修改汇总、重要检查、commit/patch/artifact、外部操作、checkpoint。Agent 可以提供说明，但命令结果与 Git 事实的来源另外标注。

不必第一版就引入 tracing collector、ClickHouse 或 LLM summarizer。语义汇总是否完备不需要新的证明机制；记录缺口应该可见。

**重要区别：** “原始事件删除得很快”不等于“已经生成了有意义的项目历史”。本轮没有找到可直接搬用、同时满足我们取舍的完整实现。特别是“哪些测试值得长期保存”，可以先由明确的检查调用和 checkpoint 选择，避免识别任意 shell 意图。

## 9. SQLite / 本地服务：优先普通配置与短事务

| 项目 | 源码里的普通做法 | 取舍 |
|---|---|---|
| agent-inbox | SQLite、WAL、busy timeout；migration 的 `BEGIN IMMEDIATE` 与事务内重查避免并发初始化竞争。[12] | 适合学习小数据库操作；其多个进程直接打开数据库增加了本轮不必照搬的初始化协调。 |
| Approving | 默认 SQLite；WAL、busy timeout、foreign keys；连接池限制为一个打开连接。[44] | 即使承载工作流产品也能采用简单本地 writer 模型；不需要因此采用它的工作流模型和完整 migration 集。 |
| LangGraph SqliteSaver | checkpoints/writes 表、进程锁、短数据库操作。[29] | 数据库 primitive 可借鉴，workflow 恢复语义不必继承。 |

SQLite 官方资料说明同一数据库同时只有一个 writer，多数短写事务可以排队完成。这与一个本地服务、少量 Agent 的 v0 假设匹配。[45]

**建议：** 一个服务拥有数据库写入；CLI 和 Agent 走 API；迁移由服务启动时处理；网络调用不放在数据库事务中。消息写入与本地状态改变能用同库事务就使用事务，不额外发明事件总线。

如果没有既有 IPC 技术约束，本地 HTTP 是可验证的起点；监听 loopback 并不等于身份认证。是否使用 named pipe/Unix socket，取决于实际部署与权限需求，而不是为了接口更“底层”。

**不能照抄的配置：** agent-inbox 使用 `synchronous=NORMAL`。SQLite 文档说明 WAL 下 FULL 在每次提交增加同步，而 NORMAL 的多数事务不做该同步。若 operations 依赖断电后仍保留已提交的开始标记，应按这一需求选择持久化配置；对于小流量，优先评估 FULL。这是普通数据库选择，不是建立新证明层。[12], [46]

SQLite 事务不覆盖 artifact 文件或 Git。初版可以先完成文件写入再登记引用，崩溃后识别缺失/孤立文件；不要宣称全局原子。Approving 文档也明确要求数据库与 blob 备份配套，避免只恢复数据库留下悬空引用。[47]

## 10. Capability / guarantee boundaries：把缺口写清楚

| 已观察的边界 | Next Threshold 应怎样表达 |
|---|---|
| ACP 的 tool 通知与 permission 请求有协议可选性；恢复能力需协商。[7], [8] | 按 runtime 实际能力报告，不把“兼容协议”当完整观察或拦截保证。 |
| OpenCode 全局订阅使用有界队列，溢出会失败；另有持久事件与 session after 查询。[4], [5], [48] | 实时断流后做支持范围内的补查；不能声称全局 SSE 永不丢失，也不能把所有事件当持久事件。 |
| agent-inbox 明确允许自报 sender，并依赖单一 OS 用户信任。[17] | sender 是协作元数据；Human Decision 需要更强入口。 |
| gateway 的 token 和宿主权限决定能否绕行。[18], [19], [20] | 只承诺受支持路径的控制，公开实际 credential 边界。 |
| SQLite 不能替远端实现幂等；checkpoint 不能消除副作用与结果保存的窗口。[29], [30], [31] | UNKNOWN 是合法结果，不包装成零效果或安全重试。 |
| 工具结果与 checkpoint 不是工作区的原子快照 | 记录对应 Git/patch 与观察时间，不捏造未保存的中间状态。 |
| Worker 失联与进程已退出不同 | 记录最后观察和未知状态；控制操作是否重试另行判断。 |

其中后两项是普通工程推论，并非声称所有参考项目已实现了所需行为。也没有证据表明上述项目能够在同 OS 用户完全访问条件下可靠阻止 Agent 修改其 Human 授权材料。

## 重型实现为什么重，以及哪些不迁移

| 项目/模式 | 有来源支撑的产品要求或实现目标 | v0 不继承的部分 |
|---|---|---|
| HumanLayer ACP | 分布式外层 Agent、异步审批与 Kubernetes reconciliation。[15], [16] | CRD、controller、集群部署 |
| Gantry | 团队、多渠道、多 provider、受控 worker 和外部投递。[14], [23], [26] | Postgres 控制面、广泛 capability 管理、调度体系 |
| AgentOps | span 查询、成本/运行可观察性、遥测分析。[39], [40] | 分析型数据库和全量 tracing 产品 |
| Approving | 可视化工作流、版本化 workflow、节点 Gate、sandbox 与 artifacts。[43], [47] | WorkflowVersion/StateRun 宇宙、Docker 平台、流程编辑器 |
| contenox | 声明式 chain、模型/backend 管理、ACP、多种工具和持久暂停。[9], [32] | Chain DSL、模型编排、通用 shell/文件策略 |
| Airlock | 通用 MCP/CLI/HTTP gateway，面向多种工具做权限与输出处理。[24], [25] | 全套 middleware、风险分类器、通用 shell 解释 |
| Agent Handoff | 团队 GitHub 工作规范与文档式连续性。[36] | 强制文件套件、每项工作 claim/阶段报告制度 |

“服务某种产品目标”不等于证明其每一层都必不可少。本轮未审计各项目完整演化史，不能把相关性写成某种架构被现实强迫产生的因果结论。

## 对第一条 vertical slice 的建议

建议继续保持现有八张普通表作为可调整起点：projects、tasks、runs、messages、actions、decisions、blocks、operations。不因本次研究新增 first-class ontology。

| 优先处理 | 可借鉴模式 | 删掉后首条真实流程会坏在哪里 |
|---|---|---|
| 一个真实 runtime adapter | Pi RPC/extension 或 OpenCode server | 无法可靠关联实际执行与任务，也难以识别 worker 结束 |
| Task + 持久 inbox | agent-inbox 的普通插入/查询；必要游标 | Agent 离线、换窗口后任务与通信断裂 |
| 独立可信 Human 入口 | 服务端认证 + 小范围入口权限 | Agent 可自称 Human 并写入授权 |
| 局部 Block | 普通状态表和目标关联 | 一个待决外部动作阻塞所有无关开发，或被遗忘 |
| 小 operations 表 | 条件领取、远端 key/ref、UNKNOWN 不重发 | 响应丢失后容易重复外部效果 |
| Git/worktree reconciliation | 现有 Git primitive | 并行覆盖和交接时误读代码状态 |
| telemetry/history 分层 | 有期限日志 + 少量明确汇总 | 调试细节淹没项目历史，或只剩 Agent 自报 |
| 基本恢复与有限回归 | 重启待决记录、断连、重复领取、并发回答 | 常见本地失败造成丢状态或重复操作 |

不建议现在加入 workflow engine、分布式 broker、形式化权限对象、组织 RBAC、全量事件溯源或独立 qualification runtime。第一条流程可以不依赖它们成立。

建议后续实现的受控动作先选择一个确定的测试环境操作。其目的只是验证请求、缺少授权、可信批准、执行、结果丢失与恢复路径；不选择真实生产发布或真实消息发送来充当接入测试。

## 本轮仍未建立的结论

1. **最终 runtime 选择未定。** Pi 与 OpenCode 是可验证候选，不是被选定架构。
2. **Threshold adapter 的实际行数、工时和维护成本未知。** 上游行数仅为样本，不能代替接入实测。
3. **Human 入口的本机强隔离未建立。** 要结合选定 runtime 的真实宿主权限和凭据分发判断。
4. **长期 task-scoped Decision 的全部 revoke/replace 行为未从某个项目完整验证。** 不能以通用 approval 功能代替。
5. **没有找到完全匹配的 telemetry→长期项目历史现成模块。** 建议用小规模明确映射实现，而不是购买或搬入整个观测平台。
6. **没有把测试存在写成测试通过。** 读取的测试证明作者考虑了相应反例；本文没有验证它们在当前环境运行的结果。
7. **未执行平台、断电、跨进程或任意 shell 绕行测试。** 源码与官方文档支持接口判断，不支持完整运行保证。
8. **许可证仅做仓库元数据筛查。** Agent Handoff 显示 GPL-3.0，HumanLayer ACP 显示 NOASSERTION；其余多数 MIT，contenox 为 Apache-2.0。未据此授权复制，未做完整许可证/依赖审查。模式参考与直接移植代码应分开决定。

## 自我复核

本文没有把“其他项目有”当成 Next Threshold 的需求，没有以开源项目的规模、测试或流程完整度保护其复杂度。对没有充分依据的能力保留 UNKNOWN；没有把重启恢复等同于 exactly-once，也没有把身份字段当成认证。

特别修正一个易误读的观察：Gantry 的歧义投递在所读持久模型中主要使用 `partially_delivered`，而非字面 `UNKNOWN`；failed 也出现在恢复统计中。本文借鉴的是禁用盲目重发，不是把这些标签直接作为我们的事实分类。

本次成果是可讨论的研究报告。没有执行 Next Threshold 实现，没有更改 legacy Threshold，也没有新增治理机制、测试、migration、部署或 push。

## 来源与源码索引

以下源码来自项目自身仓库，固定到上表 commit；协议与基础设施资料来自官方文档。除单独指出的源码片段计数外，不把 README 功能声明当成执行验证。

1. Pi：RPC client，进程、请求与事件接入。[源码][1]
2. Pi：RPC commands/state 类型。[源码][2]
3. Pi：最小 SDK 与扩展接入。[最小 SDK][3]、[扩展示例][3a]
4. OpenCode：全局事件 HTTP/SSE handler。[源码][4]
5. OpenCode：session API handler。[源码][5]
6. OpenCode：tool lifecycle processor。[源码][6]
7. Agent Client Protocol：tool 状态与权限协议。[官方文档][7]
8. Agent Client Protocol：session setup/load/resume 能力。[官方文档][8]
9. contenox：内部执行事件到 ACP 的转换。[源码][9]
10. Pi：RPC 子进程退出反例测试。[源码][10]
11. Pi：Windows 接入说明。[项目文档][11]
12. agent-inbox：SQLite schema、迁移、写入、收件箱查询。[源码][12]
13. agent-inbox：发送、广播、等待、状态与 operator 路径。[源码][13]
14. Gantry：持久消息仓储与游标输入。[源码][14]
15. HumanLayer ACP：ToolCall 数据类型。[源码][15]
16. HumanLayer ACP：审批与执行状态机；产品定位。[源码][16]、[README][16a]
17. agent-inbox：明确的单用户信任模型。[项目文档][17]
18. Airlock：Human 审批 API。[源码][18]
19. Airlock：Agent HTTP credential 路径。[源码][19]
20. Airlock：请求认证检查。[源码][20]
21. Approving：登录态 middleware。[源码][21]
22. Approving：Gate handler 与服务端 actor。[源码][22]
23. Gantry：Control API token/scope 检查。[源码][23]
24. Airlock：审批到下游执行的 middleware。[源码][24]
25. Airlock：完整 middleware chain。[源码][25]
26. Gantry：外部投递数据模型。[源码][26]
27. Gantry：claim、过期和发送歧义处理。[源码][27]
28. Gantry：投递恢复与非重试结算。[源码][28]
29. LangGraph：SQLite checkpoint 实现。[源码][29]
30. LangGraph：恢复、重执行与幂等限制。[官方文档][30]
31. Stripe：远端幂等 key 的实际行为。[官方文档][31]
32. contenox：hitl_approvals 与 chain_checkpoints schema。[源码][32]
33. contenox：审批条件更新。[源码][33]
34. contenox：持久审批与重启反例测试。[源码][34]
35. Airlock：待审批请求恢复。[源码][35]
36. Agent Handoff：交接与工作流程文件。[项目文档][36]
37. OpenCode：worktree 管理。[源码][37]
38. Git：worktree 行为与限制。[官方文档][38]
39. AgentOps：认证 OTLP exporter。[源码][39]
40. AgentOps：含 TTL 的 ClickHouse 初始 migration。[源码][40]
41. Airlock：SQLite audit/HITL schema 与 retention cleanup。[源码][41]
42. OpenCode：session diff summary。[源码][42]
43. Approving：Project/Run/Gate/Artifact/McpCall 模型。[源码][43]
44. Approving：SQLite connection 与 migration。[源码][44]
45. SQLite：适用范围与单 writer。[官方文档][45]
46. SQLite：synchronous 配置。[官方文档][46]
47. Approving：产品范围、数据库/blob 部署限制。[项目文档][47]
48. OpenCode：有界订阅、溢出错误与 durable events。[源码][48]

[1]: https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/modes/rpc/rpc-client.ts
[2]: https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/src/modes/rpc/rpc-types.ts
[3]: https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/examples/sdk/01-minimal.ts
[3a]: https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/examples/sdk/06-extensions.ts
[4]: https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/server/src/handlers/event.ts
[5]: https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/server/src/handlers/session.ts
[6]: https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/session/processor.ts
[7]: https://agentclientprotocol.com/protocol/v1/tool-calls
[8]: https://agentclientprotocol.com/protocol/v1/session-setup
[9]: https://github.com/contenox/contenox/blob/2f653670f782b0cda42009fa622b761471d5eabb/internal/surfaces/acpsvc/events.go
[10]: https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/test/rpc-client-process-exit.test.ts
[11]: https://github.com/earendil-works/pi/blob/71dca871bc80b6bc97be37f0ca3189399d651fff/packages/coding-agent/docs/windows.md
[12]: https://github.com/KI7MT/agent-inbox/blob/13a81ecfec4aa493f2c25da397cdcf446f90398c/src/agent_inbox/db.py
[13]: https://github.com/KI7MT/agent-inbox/blob/13a81ecfec4aa493f2c25da397cdcf446f90398c/src/agent_inbox/core.py
[14]: https://github.com/knacklabs/gantry/blob/b1e1ac0b0de56fcf82e0b358607c8e8912d9efab/apps/core/src/adapters/storage/postgres/repositories/canonical-message-repository.postgres.ts
[15]: https://github.com/humanlayer/agentcontrolplane/blob/eaa2a7ed1d9cb4e13dc53defaf420e36f481dcad/acp/api/v1alpha1/toolcall_types.go
[16]: https://github.com/humanlayer/agentcontrolplane/blob/eaa2a7ed1d9cb4e13dc53defaf420e36f481dcad/acp/internal/controller/toolcall/state_machine.go
[16a]: https://github.com/humanlayer/agentcontrolplane/blob/eaa2a7ed1d9cb4e13dc53defaf420e36f481dcad/README.md
[17]: https://github.com/KI7MT/agent-inbox/blob/13a81ecfec4aa493f2c25da397cdcf446f90398c/README.md
[18]: https://github.com/airlock-dev/airlock/blob/68a71c7f0139c823971b95a79cf800e837630d3a/src/hitl/api.ts
[19]: https://github.com/airlock-dev/airlock/blob/68a71c7f0139c823971b95a79cf800e837630d3a/src/transport/http-server.ts
[20]: https://github.com/airlock-dev/airlock/blob/68a71c7f0139c823971b95a79cf800e837630d3a/src/security/request.ts
[21]: https://github.com/cocofhu/approving/blob/6cc2a479e9958f9e12b37b4e8236c0b000eb6509/server/internal/auth/middleware.go
[22]: https://github.com/cocofhu/approving/blob/6cc2a479e9958f9e12b37b4e8236c0b000eb6509/server/internal/handlers/gate.go
[23]: https://github.com/knacklabs/gantry/blob/b1e1ac0b0de56fcf82e0b358607c8e8912d9efab/apps/core/src/control/server/auth.ts
[24]: https://github.com/airlock-dev/airlock/blob/68a71c7f0139c823971b95a79cf800e837630d3a/src/middleware/core/hitl-gate.ts
[25]: https://github.com/airlock-dev/airlock/blob/68a71c7f0139c823971b95a79cf800e837630d3a/src/middleware/chain-builder.ts
[26]: https://github.com/knacklabs/gantry/blob/b1e1ac0b0de56fcf82e0b358607c8e8912d9efab/apps/core/src/domain/outbound-delivery/outbound-delivery.ts
[27]: https://github.com/knacklabs/gantry/blob/b1e1ac0b0de56fcf82e0b358607c8e8912d9efab/apps/core/src/adapters/storage/postgres/repositories/outbound-delivery-repository.postgres.claims.ts
[28]: https://github.com/knacklabs/gantry/blob/b1e1ac0b0de56fcf82e0b358607c8e8912d9efab/apps/core/src/jobs/outbound-delivery-recovery.ts
[29]: https://github.com/langchain-ai/langgraph/blob/e539ac122f4126f6dd850581c1494948cf620e31/libs/checkpoint-sqlite/langgraph/checkpoint/sqlite/__init__.py
[30]: https://docs.langchain.com/oss/javascript/langgraph/functional-api
[31]: https://docs.stripe.com/api/idempotent_requests
[32]: https://github.com/contenox/contenox/blob/2f653670f782b0cda42009fa622b761471d5eabb/internal/store/runtimetypes/schema_sqlite.sql
[33]: https://github.com/contenox/contenox/blob/2f653670f782b0cda42009fa622b761471d5eabb/internal/store/runtimetypes/hitl_approvals.go
[34]: https://github.com/contenox/contenox/blob/2f653670f782b0cda42009fa622b761471d5eabb/internal/services/hitlservice/durable_approval_test.go
[35]: https://github.com/airlock-dev/airlock/blob/68a71c7f0139c823971b95a79cf800e837630d3a/src/hitl/engine.ts
[36]: https://github.com/artyomboyko/Agent_Handoff/blob/22ff8d0256501f024a1ae5384e794dd3b8a47686/ai/HANDOFF_PROTOCOL.md
[37]: https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/worktree/index.ts
[38]: https://git-scm.com/docs/git-worktree
[39]: https://github.com/AgentOps-AI/agentops/blob/f8e907b92dabe47232978023fdcb01e2a7d4b752/agentops/sdk/exporters.py
[40]: https://github.com/AgentOps-AI/agentops/blob/f8e907b92dabe47232978023fdcb01e2a7d4b752/app/clickhouse/migrations/0000_init.sql
[41]: https://github.com/airlock-dev/airlock/blob/68a71c7f0139c823971b95a79cf800e837630d3a/src/audit/db.ts
[42]: https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/opencode/src/session/summary.ts
[43]: https://github.com/cocofhu/approving/blob/6cc2a479e9958f9e12b37b4e8236c0b000eb6509/server/internal/models/models.go
[44]: https://github.com/cocofhu/approving/blob/6cc2a479e9958f9e12b37b4e8236c0b000eb6509/server/internal/database/database.go
[45]: https://www.sqlite.org/whentouse.html
[46]: https://www.sqlite.org/pragma.html#pragma_synchronous
[47]: https://github.com/cocofhu/approving/blob/6cc2a479e9958f9e12b37b4e8236c0b000eb6509/README.md
[48]: https://github.com/anomalyco/opencode/blob/95daf90670b7c039c436c85537da5fbfe2205b41/packages/core/src/event.ts
