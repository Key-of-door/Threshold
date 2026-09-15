# First self-hosting use

2026-09-13，约 17:17–17:23（Asia/Shanghai）。基于 `f206ba3` 的一次真实维护；不扩 core。

**结果：当前路径基本顺畅。Threshold 已通过自己的 Project/Task/Run/Message 完成一次自身维护，没有需要新增 core primitive 的阻断。** 这是一个小维护任务的观察，长期稳定性仍留给后续真实使用。

## 环境与任务

GitHub 的 Pi `v0.85.1` tag 和 npm 对应版本均可访问；本地 pinned Pi 启动、get_state、正常退出通过。获准的 DeepSeek/deepseek-flash 最小调用返回 `THRESHOLD_SMOKE_OK`，0 tool calls，exit 0。没有修改 Pi 版本、provider 设置或全局配置，也没有保存临时模型 key。调用使用进程环境；本轮正常关闭了所有启动的服务和 worker。

通过普通 CLI `serve → project create → task create → run → status/message read → stop` 操作，没有新增 harness、被动 observer extension 或调度框架。

- Project：`00452b45-f2db-4b1d-9398-4de1e36c7ca3`，repo 为 `E:/Threshold lite`。
- Task：`d9849b70-d847-489b-b513-b1cfea25545e`，Handle invalid CLI invocations as ordinary errors。
- 持久状态：`.local/self-hosting/state`。Project/Task 可以继续使用，不必重建。

真实复现：`--unknown-option` 和缺失 flag value 会打印 Node 堆栈；`statuz` 拼错命令却退出 0。A 修改 `src/cli.mjs` 的输入错误处理，新增 `tests/cli-errors.test.mjs` 两项 regression。现在错误退出 1、stderr 有说明且无堆栈；无参数 usage 仍成功，正常服务/客户端命令保留。没有 schema、依赖或 core primitive 变更。

## 三个普通 peer Runs

| Run | 额外能力 | 结果 | 时间 / tool calls |
| --- | --- | --- | --- |
| A `20924cc5-7902-44dc-a098-4000c9944711` | 无 | 实现与测试，Message #1 请求 review，checkpoint，Task 保持 in_progress | 45.2s / 21 |
| B `2618d199-83a6-4b39-9ab0-7f217e42e9ac` | code-review skill | 独立 review，Message #2：无成立缺陷；checkpoint；没有修改项目文件 | 55.2s / 16 |
| C `4a12f393-3fb8-4fef-99e4-b68687ce26bc` | 无 | 独立核查后不制造 revision，Message #3 回复 #2，checkpoint，明确更新 Task done | 26.7s / 14 |

三个 session ID 不同，每两 Run 之间正常重启服务。B 的 runtime observation 确认读取 A checkpoint；C 确认读取 B checkpoint。各 Run 都调用 read_messages，后续消息引用并讨论前面的具体内容。这里根据正常服务观察和实际协作回复判断接手有效，没有保存完整 conversation、hidden reasoning 或原始 tool dump。B 的 skill 由 Pi catalog 确认；没有额外正文读取 instrumentation。运行时间包含整个工作过程，不能当作单独的“重建上下文耗时”；正常 CLI 未暴露 worker token stats，本轮没有为此补机制。

Operator 只选定具体维护任务、提供各阶段 objective、启动/重启服务和独立验收；没有在 B/C prompt 中转述前一位实现或 findings，没有中途补背景。生产代码和测试由 A 完成，本报告由 operator 整理。B/C 前后 41 个非忽略项目文件哈希一致，未为了凑 revise 步骤制造修改。

独立结果：`npm test` **12/12 通过**；重新运行最初四个 CLI 样例，退出码、stdout/stderr、无堆栈均符合目标。Task done 的来源是 C 的明确工作判断，与 operator 的测试结果分开保存。config-checker 文件与 G 完成后的记录一致，本轮未改动其历史。当前没有 commit/push。

## Friction log

- 创建 Project/Task 一次即可，JSON 很容易脚本读取；手动操作时 `--home`、Project/Task/Run UUID 重复输入较多。
- reviewer skill 路径较长；CLI 接受相对目录，省去绝对前缀，但仍不短。首次记录，暂不增加 alias/registry。
- `status --task` 足以重建状态，但 instructions、checkpoint、多个 Run objective 一起显示，人读时不够紧凑；没有信息缺口。
- checkpoint 与 Message 有重复；三个 worker 都重复执行小测试。本轮耗时不构成阻断，但更大任务中值得继续观察。没有据此新增缓存或协作协议。
- reviewer skill 默认 PR framing，objective 需明确本地 working-tree review。这是样本 skill 的适配摩擦。
- C 自报一次 grep pattern 误判并自行核查修正；未要求 operator 解释或加入新机制。未保留该命令原始输出，不进一步推断原因。

继续使用（在 repo 根目录，模型 credential 仍只通过当前获准环境提供）：

```powershell
node src/cli.mjs serve --home .local/self-hosting/state --agent-dir .local/pi-agent --port 0
# 另一个终端
node src/cli.mjs status --home .local/self-hosting/state --task d9849b70-d847-489b-b513-b1cfea25545e
```

简短本地记录在 `.local/self-hosting/`：smoke、Run status、Task/checkpoint、三条 Message 和 CLI 前后复现。无需安装或启用新架构能力即可继续下一项实际维护。
