# 首条持久项目接手观察 — 2026-09-13

本轮把 A/B/C 的路径收拢为 `src/` 中的小型服务与 CLI，没有建立另一个 Phase D spike。

实现基于分支 `codex/pi-integration-spikes` 的 `3cbcbb7a83b1b11d2020633918fb143dcb988806`，本次实际运行使用新增的未提交 working-tree 源码。该 HEAD 只是基线，不代表本轮新增代码已经在该 commit 中。历史 spike 结果不自动绑定当前实现。

## 实际运行

环境：Windows、Node 24.18.0、Pi 0.85.1、Git for Windows Bash；真实模型为 DeepSeek `deepseek-flash`。临时凭据只通过环境变量用于用户授权的本轮验证，未保存到源码或报告。

- `npm test`：3 个 focused tests 通过。覆盖 SQLite 重启保留状态、缺少退出观察的旧 Run → unknown、具体 Decision 作用范围、Agent/Human API credential 分离、ASK 下普通 checkpoint 写入，以及模型 error + 进程 exit 0 不变成工作成功。
- `npm run demo:restart`：两轮真实 A/B 接手演示均通过；第二轮使用本轮最终运行源码，还检查了测试文件未被修改。
- `node --check` 检查新增 `.mjs`；`git diff --check` 无 whitespace 错误。

最终演示的本地报告：`.local/restart-demo-5nCc95/report.json`。该目录被 Git 忽略，包含可检查的小型示例仓库和数据库；它不是需要提交的正式 evidence package。

| 观察 | A | B |
| --- | --- | --- |
| Threshold 服务进程 PID | 13120 | 16132 |
| Threshold Run | `904ed5d8-29ba-4dbe-a914-734aad21bc41` | `63caf81a-cf7e-4463-8396-c29aa78bc25e` |
| Pi sessionId | `01a096c2-b1b8-7257-a12a-a244188085c4` | `01a096c2-d9a2-7203-81a7-f9f8ec9aa73b` |
| 工作结果 | 实现 add，留下 multiply | 保留 add，完成 multiply |
| Pi 退出观察 | ended / exit 0 / 无记录错误 | ended / exit 0 / 无记录错误 |

A 的 checkpoint 为 `dc5161ff-2f59-4105-bb83-d9a674260765`。B 的真实 `read_task` tool result 返回了该 ID。B 随后生成了自己的 checkpoint `c474bbd7-79e5-4c87-ab05-941975a20ec9`。

两次服务启动之间确实退出了旧服务进程。Pi 使用 `--no-session`，没有保存/恢复 A 的 conversation。服务读取的 Git 状态、原 Task、checkpoint 和旧 Run 从项目状态提供给新 session。运行脚本独立执行 `node add.test.mjs` 和 `node multiply.test.mjs`，均成功；原测试内容未改。Task 仍为 `in_progress`。

## 结论与边界

这条真实路径支持：**项目连续性可以依赖持久 Task/checkpoint + Git，而不依赖单一 Agent conversation。**

仅验证正常退出/重启和当前小型任务；未验证 crash recovery、远端 effect、任意进程树清理、另一 provider 或多用户隔离。Run 的结束不是 Task 完成，checkpoint 中的测试叙述仍为 Agent summary。没有把所有 runtime events 写入长期数据库。

当前服务还有明确的使用限制：单 worktree 一个受管 worker、3 分钟回合等待上限、显式 Pi extension 配置而不自动发现项目 AGENTS/skills、无 Task 状态编辑命令。具体运行方式与 Human credential 的同 OS 用户边界见根 README。下一项功能应由实际使用决定，不由这份记录扩展设计面。
