# Threshold

Project persists. Agents come and go.

一个单机项目服务：SQLite 保存任务与 checkpoint，Pi 负责运行 Agent。新的 Pi session 从项目状态和实际 Git/worktree 接手，不恢复上一位 Agent 的 conversation。

目前可以创建 Project/Task、指定 Run 工作目标、观察运行、保存 checkpoint、收发 Task 消息、显式更新 Task 状态、停止服务并重新接手。具体的 `fake_deploy` 保留 `ASK / NO / GO`，只产生本地 SQLite 模拟记录。普通开发和协作不检查部署 Decision。

## 运行

需要 Node **24.18+**、Git，以及 Pi 可用的 provider 配置。Windows 上可使用 Git Bash；本项目真实验证采用 Git for Windows 的 Bash。Pi 依赖固定为 0.85.1。

```powershell
npm ci
npm test

# Pi 配置目录含 models.json/settings.json 或其原生登录配置。
# 默认使用 ~/.pi/agent；本地 spike 的配置位于 .local/pi-agent。
node src/cli.mjs serve --home .local/threshold --agent-dir .local/pi-agent
```

CLI 使用同一个 `--home` 找到服务地址；CLI 不直接写数据库。在另一终端：

```powershell
node src/cli.mjs project create --name example --repo E:/my-project
node src/cli.mjs task create --project PROJECT_ID --title "修复 parser" --instructions "检查路径处理，完成一个小改动，运行相关测试并写 checkpoint"
node src/cli.mjs run --task TASK_ID --provider deepseek --model deepseek-flash
# 可选：明确这次希望完成一个函数、一个功能，还是剩余可交付项
node src/cli.mjs run --task TASK_ID --provider deepseek --model deepseek-flash --objective "完成剩余 CLI，运行完整测试，保存 checkpoint 并评估 Task 状态"
node src/cli.mjs status --run RUN_ID
node src/cli.mjs status --task TASK_ID
node src/cli.mjs stop
```

`run` 返回 Run ID，不等待整个模型回合。一个 Run 启动一个新的 Pi session；一次回合结束后服务关闭该 worker。`--objective` 是可选的本次工作目标：随 Run 持久保存，并通过初始提示和 `read_task.currentRun` 提供给 worker；不修改整个 Task 的 instructions。未提供时，worker 根据项目状态选择下一项有用的增量。它仍受 Task 要求和运行时间上限约束，不是无限续跑开关，也不代替具体部署 Decision。

Task 创建时为 `in_progress`。模型说“完成”、写 checkpoint、`agent_end` 或进程 exit 0 都不会自动改变它。Agent 可以通过 `update_task_status` 明确更新；CLI 可以这样操作：

```powershell
node src/cli.mjs task update --task TASK_ID --status done --note "已检查交付内容，相关测试通过"
node src/cli.mjs task update --task TASK_ID --status in_progress --note "复核发现仍有一项未完成"
```

当前仅提供 `in_progress` / `done`，可随时按实际工作重新打开。服务保存最近一次更新的说明、时间，以及入口来源（`agent` + Run ID，或 `client`）。这是普通工作状态及提交者的判断；不表示独立验证成功或 Human acceptance。`client` 也不意味着已认证为 Human。Task 状态不会授予部署权限、终止现有 Run 或自动开启下一轮。

当前 worker 显式加载 Threshold extension，关闭自动扩展、skills、prompt templates 和 AGENTS/CLAUDE 文件发现；本轮要求写在 Task 中。可为单个 Run 显式选择额外 skill/extension，见下文。每个回合目前最多等待 3 分钟。这些是当前实现限制，不是跨 runtime contract，也不是完整日常开发客户端。

再次执行 `serve`，然后对原 Task 执行 `run`。新 worker 通过 `read_task` 得到持久状态、最近 Run 和当时新读取的 Git 状态，并被要求检查 diff/相关文件后继续。`save_checkpoint` 追加工作摘要，同时服务独立读取 Git 身份。摘要标为 `agent_summary`；Git 读取标为 `git_observation`。

停止单个 worker：

```powershell
node src/cli.mjs stop --run RUN_ID
```

取消采用 Pi `clear_queue → abort → idle observation → EOF`，必要时终止 Pi 进程。Run 记录的是 Pi 的退出观察。它不证明任意子进程已消失，也不证明外部副作用未发生；接手仍要重新检查现场。

## 小而具体的受控操作

`fake_deploy` 只接受 `staging` 或 `preview`，检查同一 Task/target 的当前 Human Decision，并在同一个短 SQLite transaction 内追加模拟结果。没有匹配的决定返回 ASK，deny 返回 NO。返回值里的 Block 只描述本次操作，不冻结项目；没有独立 Block 表。

Human CLI 明确允许某个模拟目标：

```powershell
node src/cli.mjs decision --task TASK_ID --target staging --value allow
# 后续可以用 --value deny 替换这一具体决定。
```

决定跨服务重启保留，适用于该 Task/target，可重复使用，直到 Human CLI 替换。提交决定本身不执行模拟部署。不要由 Agent 自动调用这条 Human 命令代替用户作决定。

服务生成独立的 `human.key`，只允许它访问 `/human/decisions`；Agent extension 仅收到绑定本次 Run/Task 的临时 credential。服务不信任 JSON 中的 `actor: human`。

这是本机可信用户服务，监听 `127.0.0.1`，不提供浏览器接口。普通管理接口没有多用户鉴权。**同 OS 用户的 shell 可读取 Human credential，因此这里的 API 入口分离不构成对同用户任意代码的安全隔离。** 不要把端口暴露到网络；加强宿主隔离是不同的部署需求。

## Task 消息

Agent 可以通过 `send_message` / `read_messages` 留下请求、review findings 或回复。接收范围就是当前 Task 的协作者；Task 归属确定 Project。消息没有父子 Agent、具名 recipient、线程或处理状态。

```powershell
node src/cli.mjs message send --task TASK_ID --body "请独立检查 CLI 的错误处理，发现与建议请留在这个 inbox。"
node src/cli.mjs message read --task TASK_ID
# 分页：将 ID 替换成上一页返回的 nextAfter
node src/cli.mjs message read --task TASK_ID --after ID --limit 10
```

消息按递增 ID 返回，默认每页 10 条，最多 20 条，单条最多 6,000 字符。`hasMore` 表示还有下一页；`nextAfter` 只是调用者的读取位置。读取不消耗消息、不标记全局已读；新 session 从 0 开始，不会因别人读过而错过消息。服务不自动保存消费 cursor。

`read_task` 仅附带 inbox 数量与最新 ID，正文按需读取，不自动塞进 checkpoint 或完整上下文。Agent 消息的 Task 和 from_run_id 由服务绑定真实 Run；JSON 声称其他来源不起作用。CLI 消息记录为 client/from_run_id=null，不代表 Human 授权。消息持久化后不会自动启动接收者、改变 Task 状态、创建 Decision 或执行受控操作。

checkpoint 说明这轮工作停在哪里；message 传达给协作者的具体内容。回复可以在正文中引用消息 ID，暂不建立 request/acknowledge/close 流程。若发送响应丢失，应先读取 inbox 再决定是否重发；重复发送会新增一行，没有 exactly-once 承诺。

## 单个 Run 的能力选择

将现成能力文件放在普通目录即可；不需要运行 `pi install`、修改全局设置或登记 registry。选择 skill 文件（也可以传包含 `SKILL.md` 的目录）和 extension 入口文件：

```powershell
node src/cli.mjs run --task TASK_ID --provider deepseek --model deepseek-flash --skill "E:/my-capabilities/reviewer/SKILL.md" --objective "独立检查当前实现"
# 参数可以重复；没有指定的下一 Run 不继承。
node src/cli.mjs run --task TASK_ID --provider deepseek --model deepseek-flash --skill "E:/my-capabilities/coding/SKILL.md" --extension "E:/my-capabilities/tool.ts"
```

CLI 相对路径按调用者当前目录展开；HTTP 的 `skills` / `extensions` 数组须使用绝对本地路径。每类最多 16 个，默认均为空。暂不支持按名称搜索、npm/Git spec、Project defaults 或目录批量加载 extension。

Pi 保持 `--no-skills --no-extensions`，再接收本次明确选中的路径；固定的 Threshold collaboration extension 始终加载。Pi 负责解析 skill、加载 extension 和执行工具。普通工具使用 Pi 默认集合（当前为 read/bash/edit/write；本机 bash 使用 Git Bash），选中的 extension 注册其工具。原先固定的 `--tools` 白名单会屏蔽额外工具，因此已移除。

Skill 注册进 Pi catalog 与正文被模型读取是两件事。服务检查选中 skill 的 catalog 路径，并提示 worker 在读取 Task 后读取选中的正文；仍需通过实际 tool observation 判断模型有没有读取、怎样使用。Run 的 `capabilities` 只保存本次选择的路径和入口文件 SHA-256，不是成功加载证明、完整依赖快照或正文遵从保证。旧 Run 保持 null，新 Run 未选择时为两个空数组。近期 Run metadata 是历史，不自动成为本次配置。

这里提供运行配置分离，不是文件或进程 sandbox；共享 Project 的消息当然可以影响后续判断。任意 extension 自身的自动发现、写入或外部 effect 不自动获得 Threshold STOP 保证。只有接入具体 controlled adapter 的操作才有相应保证。

本轮研究、样本与真实 F/G 观察见 [Per-Run capabilities](docs/per-run-capabilities.md)。

## 状态与实现

| 模块 | 职责 |
| --- | --- |
| `src/service.mjs` | 本地 HTTP、Run 生命周期、具体 API 入口 |
| `src/store.mjs` | 普通 SQL 与 migration；七张表 |
| `src/pi.mjs` | Pi 进程/RPC/取消；不拥有模型循环 |
| `src/capabilities.mjs` | 本地入口文件选择与调试用哈希 |
| `src/extension.ts` | 任务/checkpoint、显式状态、消息收发、`fake_deploy` |
| `src/git.mjs` | 按需 Git 读取 |
| `src/cli.mjs` | 服务客户端与启动入口 |

七张表是 `projects / tasks / runs / checkpoints / decisions / fake_deployments / messages`。SQLite 使用 WAL、foreign keys、5 秒 busy timeout、`synchronous=FULL` 和短 transaction。模型、HTTP、Git 不在数据库 transaction 内执行。

schema v2 增加 Run objective 和 Task 最近状态更新 metadata；v3 增加 messages 表与 Task/ID 索引；当前 v4 仅给 Run 增加 capabilities JSON 字段。已有数据保留；历史字段未知时保持空值，不从摘要推断补填。没有新增完整状态变更账本或 capability registry 表。

默认数据位于 `.local/threshold`，由一个服务独占写入。`server.lock` 防止同一数据目录开两个 writer。正常关闭会清理服务定位文件与锁；异常退出后的锁不会自动删除，应先检查记录的 PID、旧 worker 和现场，再清理精确的 stale lock。重新打开 DB 时，没有退出观察的旧 Run 标为 `unknown`，不会自动重放。

同一 worktree 同时只启动一个本服务管理的 worker。并行写任务使用普通 Git worktree。服务不会把共享目录里的所有 diff 归因给某个 Agent，也不会保存 dirty bytes 的完整副本。

Pi 使用 `--no-session`：不保存完整 conversation，也不恢复旧 session。服务只在内存保留最近最多 64 个 Run 的简短工具名称/计数等调试观察；原始工具输入输出不进长期 DB。重要工作通过 checkpoint 记录；其中模型报告的测试结论仍是摘要，不自动成为服务独立验证的事实。

## 验证

```powershell
npm test
# 显式真实模型验证，使用当前 shell 中的 DEEPSEEK_API_KEY；不写入仓库。
npm run demo:restart
```

真实演示在忽略的 `.local/restart-demo-*` 目录建立独立小型 Git 项目：A 实现 add 并保存下一步；服务进程正常退出；新服务、新 Pi session B 读取旧 checkpoint，检查项目并实现 multiply。演示脚本独立运行两个算术检查，并在该目录输出简短 `report.json`。这验证正常重启接手，不声称 crash recovery、远端 exactly-once、任意进程清理或模型总能正确完成任务。

尚未实现跨 Task/具名接收者消息、自动通知、真实远端操作、自动重试/reconcile、多用户服务和完整客户端。它们各自等待真实使用需求。

架构方向见 [Working Architecture](docs/working-architecture.md)（参考，不是 freeze）。历史 A/B/C 观察保留在 [spikes](spikes/)，不自动等同于当前实现的验证结果。
