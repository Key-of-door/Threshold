# Project Board 与可替换 scheduler：第一次真实使用

2026-09-13，22:17–22:26（Asia/Shanghai，运行及独立检查）。**一轮成功路径表明：普通 Pi Run 能通过 Project 组织两个 peer workers，并由全新 scheduler 接手 review/integration。** 同时发生过一次未完成调度的 Run，不能据此声称模型每次都能完成协调。

## 实现与实际任务

基础提交 `8637e54a2f59fd3041ef938ac6b6e2e95073122d`：Board 是既有 SQL 状态的聚合；Run 增加实际 workspace 和启动来源；显式 scheduler extension 提供创建 Task、启动/查看 Run；共享启动路径执行资源限制。没有新增表、父子身份、常驻 manager、自动调度或 merge engine。Skill 在 `capabilities/project-scheduler/SKILL.md`，普通 worker 可读 Board，但不自动获得调度工具。

沿用 Threshold self-hosting Project `00452b45-f2db-4b1d-9398-4de1e36c7ca3`，home 为 `.local/self-hosting/state`。新协调 Task `380cefb1-9896-4196-b94f-b27b67c0d55a` 只给高层维护目标、既有 friction 记录、环境与实验范围。Operator 没有指定两个最终方案。

S1 自行选择并分配：

- Task `49e09d4d-0b57-457b-89be-1a26b958ce96`：CLI `status/board --summary`，保留默认 JSON 格式。Worker 修改 `src/cli.mjs`、README，新增 CLI regression。分支 `codex/status-summary`，提交 `2d22d04`。
- Task `39bb6b16-a13e-41e3-90ba-895b5a3a69cf`：裸 `GET /status` 改为轻量 project/task index，完整详情仍可查询。Worker 修改 `src/service.mjs`、`src/store.mjs`，新增 status-index regression。分支 `codex/status-index`，提交 `38db522`。

第二项缩小了裸 `/status` 的字段集合：不再返回 Task instructions、Project created_at；不是所有 JSON 响应逐字段保持不变。CLI summary 的格式选择与这项 API 调整是两件事。两项有使用上的联系，但实际修改文件集合不相交。

## 真实 Runs

全部使用 pinned Pi 0.85.1、DeepSeek/deepseek-flash、独立 `--no-session` 会话。下列 ID 为完整 Run ID 的唯一前缀，完整身份保存在 Project Run rows 与本地快照。

| Run | Session | 选择的额外能力 | 实际结果 |
| --- | --- | --- | --- |
| 初次 `bf33db2f` | `01a09b21-41be-75eb-ace1-2276d4962640` | scheduler skill + extension | 正常退出，但没有 Task/worker/message/checkpoint，未完成协调 |
| S1 `5af94929` | `01a09b24-d755-7748-b744-4ea26b42b1a6` | scheduler skill + extension | 创建两个 Task/worktree，启动 A/B，留下 Message #4 和 checkpoint，然后结束 |
| A `35f654bc` | `01a09b26-2563-72b2-b938-5a2cffd8a1c8` | 无 | CLI 修改、测试、本地 commit、Message #6、checkpoint、Task done |
| B `bcb6316c` | `01a09b26-2623-74a5-920c-5da51faec49d` | 无 | status index 修改、测试、本地 commit、Message #5、checkpoint、Task done |
| S2 `5908b1e4` | `01a09b27-34e8-701a-9d6a-49604b67599c` | scheduler skill + extension | 从 Board/messages/Git 接手，自行 review、合并、测试，Message #7、checkpoint、协调 Task done |

A/B 分别位于 `.local/scheduling/worktrees/status-summary` 和 `status-index`，从相同基础提交创建。服务观察到两 Run 的存活区间重叠 **85.745 秒**；这表示并发存活，不是 CPU 同时执行或性能收益测量。S1 在 22:22:54 结束，A/B 分别继续到 22:24:33、22:24:09；S2 于 22:23:53 进入。S1 结束没有取消 workers。

S2 的 runtime observation 确认读取了 S1 checkpoint `65184c64-746f-4403-9ffe-10d0c3989579`，并调用 read_messages/read_project_board/bash。其消息和实际 Git 合并结果表明它读取、核查了两个 Task 的成果；没有给 S2 A/B conversation 或人工转述 findings。S2 自己承担 review/integration，没有为了凑步骤再创建 reviewer Run。它自述参考了 code-review 指导；其显式 capability metadata 仍只有 scheduler，不能写成加载了 reviewer capability。

S2 通过普通 Git 形成两个本地 merge：`c667d43`、`436d3f3713b32095e2994473c810335659408e33`。无冲突，原 worker commits 保留。工作目录和分支留存，未执行清理。Operator 启动 S1/S2、读取状态与最终验收，没有在中间分发 worker 进度或决定合并顺序。

## 独立检查与限制

Operator 在整合提交 `436d3f3` 上实际运行 `npm test`：**18/18 通过**，并检查最终 diff 与真实 `board --summary` 输出。这包括原有回归、真实 Pi capability 加载检查、新工作目录/并发/累计限额测试，以及两项维护的新增检查。Worker 原有 tests/fixtures 未被改写；config-checker 的 9 个文件与既有 G 记录哈希相同。Task done 是 S2 的明确判断，独立测试结果另记，未自动互相升级。

最终另外做了无需模型的正常服务重启：重新读取的 Board 与结束快照完全一致，累计 Run 数仍为 8，新的 compact `/status` 返回正常。检查后关闭服务；没有留下运行中的 managed worker 或服务锁。

资源配置为最多 3 个未确定退出的 Run、home 累计最多 11 个 Run。开始已有 3 个历史 Run；本轮新增 5 个（含初次未完成），最终累计 8、余 3、未结束 0。测试验证 CLI/Agent 共享限制、并发请求不会突破额度、重启后累计数保留；真实实验没有为了触顶浪费额外模型调用。限制只覆盖 managed starts，不是 token/金额配额或同用户 shell sandbox。

第一轮 87.8 秒正常退出，却没有调度成果；当时短期观察仅有 28 次工具调用及 read_task/read/bash 名称，没有保留最终答复，**具体原因 UNKNOWN**。不推断 provider、模型或架构原因。随后使用忽略目录内的临时诊断 service wrapper，只观察有限工具错误和公开答复，不保存 hidden reasoning、不传给后续 worker。第二轮使用相同目标和代码完成调度；未为此修改架构。两轮之间正常重启了服务，当时没有其他 worker；成功的 S1/A/B/S2 路径中服务持续运行。

## 产品观察

1. Scheduler 能从 Board 和实际 repo 理解项目，并选择两项实际文件集合独立的维护。
2. 它自行创建普通 worktrees、启动两个无调度 capability 的 peers；这次没有交叉写入污染。
3. Message/checkpoint 足够让全新 S2 接手；没有需要 operator 补充背景的缺口。
4. 普通 Git 足够完成本轮整合；没有新增 core primitive 的阻断。
5. 首次没有 checkpoint 的正常结束暴露了诊断摩擦：当前 Run 退出状态无法说明 Agent 为什么没有完成目标。不能把重启另一个模型会话视为确定修复；本轮只保留观察。
6. Board 预览需要按 Task 展开；摘要/message 有重复，capability 路径仍长。暂不增加通知、别名或协作协议。

结论限于这个小型 self-hosting 工作流：**Project 可以保存协调上下文，scheduler 确实可替换；成功不依赖永久 main Agent。** 尚未验证大规模并行、长期可靠性或任意冲突整合。

本地轻量记录在 `.local/scheduling/`；不是 qualification package。使用说明见 README 的 Project Board 段落。没有 push、远端合并或部署。
