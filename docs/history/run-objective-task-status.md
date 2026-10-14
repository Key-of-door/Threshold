# Run 工作目标与 Task 显式状态 — 2026-09-13

这次实现来自 config-checker 实验的实际摩擦：旧提示要求每回合只做一小步，B 完成 loader 就结束，CLI 留待以后。

新增两个普通能力：

- `run --objective "本次希望完成什么"`：目标随 Run 保存，并提供给 worker。没有目标时，仍从项目状态选择一个有用增量。目标不替代 Task instructions 或具体部署 Decision。
- `task update --task ID --status done|in_progress --note "说明"` 与 Agent tool `update_task_status`：显式记录工作状态、最近说明、时间和入口来源。Agent 来源绑定真实 Run；本地 CLI 来源是 client，不推断为 Human 身份。

Task 的 done 是提交者的工作判断，不是服务验证成功或 Human acceptance。Run 结束、checkpoint、exit 0 均不自动更新 Task；状态可以重新打开，不影响具体部署授权，也不启动自动续跑。

数据库仍为六张表。schema v2 只增加 `runs.objective` 和 `tasks.status_update_json`。旧数据经普通 migration 保留，旧行不补造目标或来源。

## 验证

`npm test` 的 5 项测试通过，包括旧 schema 迁移、Run 目标交付、Agent/CLI 状态来源、重启保留、重新打开，以及状态为 done 仍不能绕过部署 ASK。代码语法和 diff 检查通过。

随后做了一次真实 Pi/DeepSeek worker 验证。为保留原 A/B 实验，先将已正常关闭的 SQLite 复制到 `E:/test1/run-goal-check/state`。不改原 A/B 报告、观察文件或数据库；示例 repo 继续用于下一步开发。

- 本轮实现以 `cbb6012f0bb756b2ba2868dd34b0097492b2baf5` 为基线，运行的是新增、未提交 working-tree 源码。
- Task：`3f111a72-d402-49c5-9d03-f1a573949d57`。
- Run：`b7e0c5a1-b1d5-4f5c-8c94-98a8c904c3ce`。
- 新 Pi session：`01a0993b-7eed-76ef-a76e-690180eb218d`，继续使用 `--no-session`。
- Run 目标明确要求完成剩余 CLI、运行全项目检查、写 checkpoint 并显式评估 Task 状态。
- 实际 read_task 返回 B checkpoint `5701ea23-2177-4156-9776-681030295118`；新 worker 完成 CLI 并新增两项 focused tests。
- 实际调用 `update_task_status`；Task 保存为 done，source=agent，runId 为上述 Run，并保留说明与时间。
- A/B 的 parser、loader 字节未变，原 tests/fixtures 哈希未变。
- 独立执行：项目测试 **11/11 通过**；项目外检查 **8 组通过**。这与 Agent 自报分别记录。
- 新服务再次正常退出/重启后，Task 状态 metadata 和 Run objective 保留。

本地结果在 `E:/test1/run-goal-check/result.json`，检查日志和最终 diff 在同目录。它们是这轮实现的观察，不重写原实验“B 停在 loader、8/9 测试通过”的历史结果。

这次说明明确的工作目标和显式状态更新可用于真实项目收尾。它不能证明 Agent 的完成判断总是正确，也没有验证长程、多模型或异常宕机恢复。3 分钟回合等待上限仍在；状态 metadata 只保存最近一次更新，没有新增完整状态账本。
