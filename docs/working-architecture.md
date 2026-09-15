# Next Threshold — Working Architecture Reference

> **Status: Working Reference**
>
> 本文不是 freeze、contract、acceptance criteria 或不可修改的 architecture specification。
>
> 它的目的只是保存当前已经形成的产品方向、设计理由和实施边界，避免长会话、上下文压缩或 Agent replacement 后重新从旧 Threshold 的历史结构推导需求。
>
> 实际实现、真实 failure 和用户体验用于检验本文中的工程选择。
> 如果它们证明某项选择不合适，应直接修改本文，而不是为了保持一致去复杂化代码。
> 代码、测试和 failure observation 不会自行改写产品目标或扩大 Human 授权；涉及产品方向或授权范围的变化，仍由 Human 决定。
> 本文也不表示其中描述的能力已经实现或验证。

---

## 1. Product purpose

Next Threshold 当前只围绕三个核心目标设计：

1. **Project collaboration**

   * Agent 可以跨 session、跨窗口、跨 Agent 长期推进软件项目。
   * Agent 之间可以分配任务、交换进度、review、handoff。
   * 不要求不同 Agent 共享完整上下文或内部 reasoning。

2. **Risk STOP**

   * 普通软件开发默认自主执行。
   * 只有具体、高后果、缺少必要 Human 决定或无法安全继续的动作才暂停。

3. **Behavior and Human decision record**

   * 保存足够的项目行为记录，使工作可追查、可接手。
   * Human 的真实决定与 Agent 的描述必须可区分。

一句话：

> **让 Agent 长期把项目做下去，留下足够记录，并且只在真的该停时停。**

---

## 2. Product posture

默认行为：

> **Work by default.**
> **Record meaningful work by default.**
> **Stop by exception.**
> **Audit on demand.**

Threshold 提供的是 **auditability**，不是持续执行 auditing。

正常 coding 工作不应该不断触发授权、审批或治理推理。

例如以下行为默认属于普通开发：

* 读取和理解代码；
* 创建、修改、删除项目文件；
* 重构；
* 编写和修改测试；
* 运行测试和构建；
* 制作 demo；
* 尝试并替换实现方案；
* 普通 Git 操作；
* 创建和领取子任务；
* Agent 之间交流与 review。

这些能力来自产品默认行为，而不是由一组 Human Decision grants 授予。

---

## 3. Legacy Threshold

原仓库现名：

`threshold-governance`

其定位是：

> **historical evidence / high-assurance governance research prototype**

它保持只读，可用于：

* 查询过去的真实 failure；
* 查看 Git history；
* 研究旧实现；
* 获取工程经验；
* 理解哪些风险确实发生过。

它不定义 Next Threshold 的架构。

当前工作区定位：

* Next Threshold：`E:\Threshold lite`；远端为 `https://github.com/Key-of-door/Threshold.git`。
* Legacy Threshold：`E:\Threshold\development\sh\work\s2-host-composition-freeze-20260830`；远端为 `https://github.com/Key-of-door/threshold-governance.git`，保持只读。

新代码和实现材料只放入 Next Threshold 的明确 root，不默认复制旧代码。以上是定位信息，重入时仍需检查实际目录与 Git remote；列出远端不表示本地已经 clone 或配置完成，也不新增 push、merge 或发布授权。

值得继承的是原则和失败经验，例如：

* Agent communication 不产生 Human authorization；
* timeout / disconnect 不代表外部效果没有发生；
* UNKNOWN 是合法状态；
* execution fact 与 Agent interpretation 不同；
* handoff 后需要重新观察现实；
* 局部风险只应阻断相关动作；
* Human authorization 不能由 Agent 自报。

默认不继承：

* Authority graph；
* Evidence / Claim / Relation ontology；
* qualification universe；
* evaluator registry；
* SIA；
* frozen package chain；
* proof / witness machinery；
* session custody；
* prototype bridge stack。

原则：

> **保留教训，不保留为了表达教训而产生的旧结构。**

---

## 4. Runtime boundary

Agent runtime 负责：

* 模型调用；
* context；
* Agent execution loop；
* 普通 tool dispatch；
* runtime 自身已有的 permission / sandbox；
* planner、model routing 等 runtime 内部能力。

Threshold 不应重新实现这些东西。

Threshold 希望从 runtime 获得的最小能力：

* run/session identity；
* run started / ended；
* structured tool execution notification；
* run status；
* interruption / cancellation（如果 runtime 支持）；
* extension/custom tool surface。

最低真实性要求：

> Threshold 至少从真实 execution side 得到事件或结果，而不是只依赖 Agent 事后描述自己做过什么。

例如：

```text
Runtime fact:
pytest 实际执行，exit code = 0

Agent interpretation:
我认为功能已经完成
```

两者都可以保存，但不能互相替代。

保留 runtime 原生标识，并记录它与 Threshold Run 的对应关系；不要假设 session、turn、run 在每种 runtime 中含义相同。`agent_end` 只说明其实际对应的 runtime 阶段结束，不自动将 Task 标为完成。process exit 不证明外部效果没有发生，tool error 也不证明副作用为零。

---

## 5. First runtime candidate: Pi

当前首选的 integration spike 候选是 **Pi**。

理由不是 Pi 被选定为永久 runtime，而是它目前具有很薄的接入面：

* JSONL RPC；
* session/state；
* abort；
* execution/lifecycle events；
* extensions；
* custom tools。

理想边界：

```text
Pi
├── model / context / Agent loop
├── ordinary tools
│
├── structured runtime events ──► Threshold
│
└── Threshold tools ◄──────────── extension
```

当前目标只是回答：

> **Pi 能否成为 Agent runtime，而 Threshold 不需要因此变成 runtime/orchestrator？**

如果答案是否定的，应更换 runtime，而不是扭曲 Threshold 去适配 Pi。

OpenCode 当前是一个合理的第二候选，特别是在未来需要附着到已有 service/client 时。

---

## 6. Pi integration spike

Spike 不是完整 Next Threshold implementation。

它应尽量小，只验证真实 runtime integration。

建议顺序：

### Phase A — real runtime bridge

验证真实 Pi：

1. 启动；
2. 获取 session/run identity；
3. 收到真实 lifecycle/tool events；
4. 查询状态；
5. abort / interruption；
6. process exit；
7. Windows 路径、Git Bash/PowerShell 和 child process cleanup 的基本行为。

这里必须使用真实 Pi execution。

模拟事件只能验证 bridge code，不能证明 Pi integration 成立。

如果尚未配置真实模型调用，应明确区分：

* protocol/bridge test passed；
* real Agent invocation not yet verified。

### Phase B — one collaboration tool

加入一个非常小的 Threshold service endpoint，例如：

* read task；
* update task；
* send message；
* save checkpoint。

先从上述例子中选择一个 endpoint，验证 Pi extension 真实调用 service；不要求这一阶段同时实现全部协作 API。

### Phase C — one fake controlled operation

加入例如：

```text
fake_deploy(target="staging")
```

业务效果可以是假的。

但完整控制路径必须是真的：

```text
Agent requests operation
→ adapter parses actual request
→ Decision check
→ ASK when missing
→ Human trusted endpoint approves
→ same adapter executes
→ result is recorded
```

分别报告接口权限和宿主隔离：Agent credential 不能写 Human Decision，是接口行为验证；同 OS 用户的任意 shell 是否能取得 Human credential，是另一项部署边界，不能由前者推出。fake operation 不连接真实 production、外部消息或支付系统。

Spike 暂时不需要：

* 完整八表 schema；
* 完整 persistence；
* 完整 vertical slice；
* 所有 runtime；
* production action。

若 spike 使用内存状态，应明确它只验证进程存活期间的控制路径，不能据此宣称持久恢复或 crash 后的重复保护已建立。

---

## 7. Telemetry versus project history

Runtime telemetry 与长期项目记录是不同的东西。

## Runtime telemetry

例如：

* read；
* grep；
* ls；
* tiny shell calls；
* tool start/finish；
* debug data。

这些主要服务：

* adapter；
* debugging；
* temporary tracing。

可以有：

* retention；
* size limit；
* compression；
* sampling；
* deletion。

第一版不应把 telemetry schema 设计成稳定、跨-runtime 的公共 ontology。

## Durable project history

长期只保存有项目意义的工作，例如：

* 实质文件变化；
* 有意义的实现步骤；
* important test/build；
* commit / patch / artifact；
* checkpoint；
* controlled external operation；
* UNKNOWN external effect；
* 必要的 Agent work summary。

原则：

> **Record meaningful work, not every observable micro-event.**

长期项目历史应该首先对 Human 和接手 Agent 可读，而不是成为 tool-call dump。

---

## 8. Project collaboration

当前倾向使用普通关系模型。

可能包括：

* Project；
* Task；
* Run；
* Message；
* Action；
* Decision；
* Block；
* Operation。

这只是当前 implementation starting point。

不是 schema freeze。

可以：

* 合并；
* 删除；
* 增加普通表；
* 修改字段。

不要因为现在列出八个名字，就让“八张表”获得架构权威。

---

## 9. Message

Agent communication 应该非常普通。

最小可能需要：

```text
message_id
project_id
task_id?
sender
recipient
body
created_at
reply_to?
sequence/cursor
```

消息：

* 可持久化；
* 支持离线读取；
* notification 可以重复；
* cursor 只是读取位置；
* 不产生 Human authority；
* 不等于 Task ownership；
* 不表示 receiver 同意其内容。

本地少量 Agent 暂时不需要 broker 或 distributed event bus。

---

## 10. Git and worktrees

原则：

> **Git owns committed code history.**

未提交代码的当前事实仍在 worktree。

普通记录不要求 snapshot 每个时刻。

重要 checkpoint/test 在确有需要时，可以保存：

* HEAD；
* dirty paths；
* patch；
* artifact reference；
* observation timestamp。

如果没有保存某个 historical dirty state，应诚实地说：

> 无法精确重现当时的 dirty bytes。

不要为了任意时刻 replay 建立完整 workspace snapshot system。

并行写任务优先使用普通 Git worktree。

无法精确判断某段 dirty diff 属于哪个 Agent 时，可以记录：

> attribution unavailable / shared workspace change

不要因此建立 file custody 或 byte ownership。

---

## 11. Human Decision

Human authorization 必须来自真实 trusted channel。

不能通过：

```json
{"actor": "human"}
```

或：

```text
source = human
```

建立真实性。

v0 可以采用非常简单但真实的入口分离：

```text
Agent API / credential
Human CLI API / credential
```

Agent 可以：

* 请求 Human decision；
* 读取 Decision；
* 读取 Block。

Agent 不可以：

* 创建 Human Decision；
* 修改 Human Decision；
* revoke Human Decision。

服务端从认证入口确定 actor。

同时必须诚实说明宿主边界：

> 如果 Agent 在相同 OS 用户权限下能够读取 Human credential、修改数据库或绕过受控工具，则 Threshold 无法声称拥有更强隔离。

不要用额外 proof object 掩盖这一事实。

---

## 12. Risk Gate

v0 使用：

* `GO`
* `ASK`
* `NO`

Core 应故意保持简单。

`GO` 表示在当前支持范围内可以执行；`ASK` 表示缺少一项具体的 Human 决定；`NO` 表示该动作被明确禁止。技术错误、测试失败或尚未实现的能力应按实际原因报告，不伪装成需要 Human 授权；普通工程问题优先由 Agent 自行处理。

受控 adapter 负责理解具体领域动作：

```text
adapter
→ parses actual operation / target / consequence
→ declares required Decision
→ core performs small Decision match
→ GO / ASK / NO
```

Agent 不能自行声明：

```text
requires_decision = false
```

Decision matching 初期只支持现实 adapter 真正需要的字段，例如：

* action type；
* target；
* project/task scope；
* one-shot / task-scoped；
* optional artifact/version；
* optional expiry。

暂时不要引入：

* policy DSL；
* nested inheritance；
* generic precedence language；
* rule composition；
* universal risk scoring。

出现实质冲突的 Human Decisions 时：

> 只 Block 相关动作，让 Human 澄清。

---

## 13. Controlled operations

Authorization check 与真实执行必须处于同一个受控路径。

不要：

```text
check X
→ GO
→ Agent 自己另外执行 Y
```

应当：

```text
operation request
→ adapter obtains actual parameters
→ Decision check
→ GO
→ same adapter performs execution
→ stores result
```

这样检查的对象就是执行的对象。

如果动作因 ASK 等待后恢复，应在实际执行前重新匹配当前 Decision 与实际参数；历史 GO 不是脱离该操作的通用许可。已撤销的决定不能授权尚未开始的新执行，但撤销也不能追回已经发生的效果。

这不需要 Permit / Receipt / proof universe。

一个普通 service-side controlled call 即可。

Threshold 只承诺控制经过受支持 adapter 的操作。

如果 Agent 同时拥有可绕开 adapter 的真实外部凭据，则必须明确：

> 这些调用不受 Threshold gate 保证。

---

## 14. Universal shell interpretation is out of scope

v0 不尝试全面理解：

```text
rm
curl
git
python ...
```

是否危险、是否合法、是否有外部副作用。

普通 shell：

* 能观察多少就记录多少；
* 安全依赖 runtime / OS；
* Threshold 不声称理解任意程序的完整效果。

一个新的高后果 effect 出现时，优先考虑：

> 增加一个具体 adapter。

而不是扩张 universal policy engine。

---

## 15. External UNKNOWN

这是旧 Threshold 中明确值得保留的 failure lesson。

如果：

```text
request sent
→ response lost
```

不能自动得出：

```text
FAILED / NOT_EXECUTED
```

最小 Operation 只需要保存足够恢复的信息，例如：

```text
operation_id
adapter
target
request_identity
decision_id?
status
external_reference?
idempotency_key?
started_at
finished_at?
result?
uncertainty_reason?
```

恢复策略：

* 能确认尚未进入 effect call，**并确认旧执行者已经不可能继续发送** → 可以重新领取；
* 已确认 remote result → 补齐本地结果；
* remote 有可靠查询 → 先 query；
* remote 支持适用且仍有效的 idempotency → 使用原 request/key；不能假设远端 key 永久有效，也不能换一个新 key 把重复效果伪装成新操作；
* 可能已经发生但无法确认 → `UNKNOWN`，不自动重发。

特别注意：

> “尚未观察到 effect”本身不足以允许重新领取。

必须同时确认旧 worker / execution path 不可能稍后继续执行。

单机阶段优先使用进程状态与条件更新；如果无法确认旧执行路径已停止，则保留 UNKNOWN，不为了恢复而推断它已停止。父进程退出也不自动证明其子进程或已发出的远端操作结束。当前不需要引入 distributed lease。

---

## 16. UNKNOWN is a general honesty principle

类似原则也适用于 Run。

必须区分：

* confirmed ended；
* reachable/running；
* lost / unknown。

Connection lost 不自动等于 worker stopped。

新 Agent 接手前重新观察：

* old run；
* worktree；
* Task；
* pending Operation。

Next Threshold 不需要 session custody protocol。

---

## 17. Block

Block 可以是一张普通表，因为它具有自然生命周期。

例如：

```text
OPEN
RESOLVED
CANCELLED
```

可能关联：

* Task；
* Action；
* Operation。

重要行为：

> 局部风险只阻断相关动作。

一个待审批 deploy 不应该阻止 Agent 继续写代码、跑测试或处理另一个 Task。

Block 不都需要 Human 解决：可恢复的技术问题可以由 Agent 修复后解除。取消任务或 Block 只改变本地工作安排，不会把关联 operation 的 UNKNOWN 自动变成未执行。

---

## 18. Handoff

Handoff 的核心不是恢复完整 Agent context。

它是：

> **persistent project state + new worker re-observation**

Checkpoint 只是帮助接手的索引，例如：

* 当前目标；
* 已完成；
* 当前工作；
* Git state；
* important checks；
* open issues；
* next dependency。

真正必须持久化的状态，例如：

* active Block；
* Human Decision；
* pending Operation；

不能只藏在 checkpoint prose 中。

接手者应重新观察 Git/worktree 和 runtime state。

---

## 19. SQLite

当前 v0 场景：

* single machine；
* one local service；
* few Agents；
* CLI/client through service。

SQLite 是当前首选。

普通原则：

* one service owns writes；
* WAL；
* short transactions；
* busy timeout；
* foreign keys；
* normal migrations；
* remote/network calls outside DB transactions。

如果 Operation 的“开始记录”对 crash 后 retry safety 很重要，应实际评估更强的 durability，例如 `synchronous=FULL`。

这是普通数据库配置问题，不需要 durability proof system。

SQLite、Git、filesystem artifact 和 remote system 不构成一个全局事务。

允许 crash 后出现：

* orphan artifact；
* missing reference；

然后普通 repair。

不要为全局原子性重新发明 distributed transaction protocol。

---

## 20. Development method

Next Threshold 不再采用这种默认循环：

```text
theoretical edge case
→ guard
→ negative test
→ evaluator
→ qualification
→ mutation
→ new ontology
```

采用：

```text
run real workflow
→ observe actual friction/failure
→ fix with ordinary engineering
→ add focused regression
→ continue
```

任何新增机制首先回答：

> **如果没有它，当前真实 workflow 具体在哪里坏？**

答不出来，暂时不加。

这不是拒绝 defensive programming。

只是让 defensive cost 与真实风险成比例。

---

## 21. Current validation aims

首条 vertical slice 的当前验证目标是四件事；它们用于指导实际使用检查，不是冻结验收清单：

> **看得见工作。**
> **接得上项目。**
> **停得住支持的操作。**
> **分得清谁作了决定。**

正常开发过程中 Threshold 应尽量安静。

如果 CLI、client、普通重构或 demo 开发开始因为内部 governance architecture 变得困难，应首先重新检查 Threshold 自身设计。

---

## 22. Current unknowns

以下事项仍然开放，不应被本文假装已经决定：

* Pi 是否最终适合作为首个 runtime；
* Pi adapter 实际需要多少代码；
* Windows integration 的真实稳定性；
* telemetry 如何最终汇总成 Action；
* Human credential 在最终宿主中的隔离强度；
* 最终 SQLite schema；
* task-scoped Decision 最终需要哪些 selector；
* 以后是否支持 OpenCode 或其他 runtime；
* client / desktop / web 形态；
* multi-machine / remote workers 是否确实需要。

这些问题应该由实际实现与使用逐步回答。

---

## 23. How to use this document

当后续 Agent 因上下文压缩、session replacement 或重新进入项目而需要快速恢复方向时：

1. 先读本文了解当前产品意图；
2. 再读取当前代码、Git、Task 和最新实现记录；
3. 用代码、Git 和运行记录核验实现事实，用适用的 Human decision 确认产品意图和授权；不要把当前代码行为自动视为正确需求，也不要把本文当作更高的 Authority；
4. 如果现实已经改变，先区分工程选择过时、实现缺陷或产品方向变化，再相应更新本文；普通文档修订无需另建 freeze 或 acceptance 流程。

本文的作用是：

> **帮助记住我们为什么保持简单。**

不是：

> **阻止未来改变设计。**
