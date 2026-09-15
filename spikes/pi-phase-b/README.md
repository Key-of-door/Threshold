# Phase B — tiny project service

收口记录：2026-09-13。**真实 Pi Agent → collaboration tool → Threshold service → Agent 继续工作 → checkpoint 写回已跑通。** Pi 负责模型、工具调度和 Agent loop；Threshold 只持有当前任务和最新 checkpoint。

采用 `read_task` + `save_checkpoint`，因为这个小组合可以验证读状态和写回；没有再扩展其他协作能力。

```text
Pi Agent ── extension.ts ── HTTP /task、/checkpoint ── service.mjs
   │                                                  │
   └─ Pi 自带 read 工具读取工作文件                  内存 task / checkpoint
```

## 实现

- `service.mjs`：Node 内置 HTTP、一个 task、一个最新 checkpoint，仅绑定 `127.0.0.1` 随机端口。
- `extension.ts`：注册两个 Pi 自定义工具。服务地址来自启动环境，不由模型参数指定；普通 JSON 请求、5 秒超时、传递 Pi 取消信号，没有自动重试。
- `run.mjs`：启动服务和真实 Pi worker，执行小工作和服务不可用检查，保存短期运行记录后关闭两者。
- `service.test.mjs`：两项 focused tests，覆盖任务读取、checkpoint 保存、Task 不被隐式完成，以及格式/大小错误不改动状态。
- `../pi-rpc.mjs`：把 Phase A 已有进程/RPC 函数抽出共用，增加显式 extension 路径参数；没有重写 runtime 或增加通用 adapter framework。

服务和 extension 合计不到 100 行；没有新增 npm 依赖。仍使用 Phase A 安装的 Pi 0.85.1。

## 实际验证

```powershell
node --test spikes/pi-phase-b/service.test.mjs
node spikes/pi-phase-b/run.mjs
# 可选参数：node spikes/pi-phase-b/run.mjs <provider> <model>
```

模型默认 `deepseek / deepseek-flash`，配置沿用 `.local/pi-agent/models.json`；凭据从进程环境提供。用户已明确把临时 key 的使用范围扩展到本轮 Phase B。运行脚本没有保存 key。

真实运行时间：2026-09-12T15:59:53Z 至 15:59:58Z；原生 Pi sessionId：`01a09658-be85-7305-a3ef-2e807f49d9e3`。

1. 初始 prompt 只要求从 Threshold 读取任务并执行，未包含随机 Task ID、工作文件名或文件 token。
2. Agent 通过 `read_task` 取得服务实际持有的任务，再用 Pi 的 `read` 读取中文/空格工作目录下的文件。
3. Agent 调用 `save_checkpoint`。服务收到 GET `/task` 与 PUT `/checkpoint`，其关联字段与真实 Pi toolCallId 一致；服务中的 summary 包含 Task ID 和实际文件 token。
4. Agent 根据结果向用户报告。它的自然语言“完成”保存在 `agentInterpretation`；服务 Task 仍为 `in_progress`，没有自动完成转换。
5. 关闭服务后，Agent 再调用一次 `read_task`，真实工具结果为 `isError: true` / `Threshold service technical error: fetch failed.`。该次 prompt 明确要求只尝试一次，观察到 Agent 报告技术错误且不重试；这不证明任何 prompt 下都不会重试。
6. Pi 最终 idle，按 clear_queue → abort → EOF 收尾，退出码 0，服务已关闭。

两项 focused tests、两条真实模型路径均通过。RPC 提取后还执行了 Phase A 的无模型进程检查，两个检查通过；没有重新宣称旧 Phase A shell 观察属于本轮代码。

短期记录：`.local/pi-phase-b/f6a2d3f4-513b-4a3c-ad66-3b3d9f7490a2/report.json`，同目录有 `runtime.jsonl` 和原生 session 文件。报告记录本轮源文件哈希用于定位版本，不是 freeze、acceptance package 或 qualification evidence。服务调用记录只保存 method/path/status/toolCallId；完整 Pi conversation 不写入项目状态。

## 边界与建议

- **内存状态独立于 Pi conversation，但没有持久化保证。** checkpoint 只保存在服务进程内，重启丢失；本轮没有 SQLite、文件存储或 crash recovery。
- checkpoint 是 Agent 的工作总结；服务不验证其内容真假，也不把它升级为 Task 完成或授权。`source: agent` 是记录类别，并非经过认证的身份。
- 服务没有身份认证。本机其他进程也能访问它；localhost 不是 Human/Agent 隔离。toolCallId 只是调试关联字段，不是凭证。
- 只有当前 task 和最后一份 checkpoint；并发写入后者覆盖前者，没有历史版本或 merge 语义。
- 连接/JSON/超时等错误保持技术错误。写入响应不明时可能已保存，extension 的错误提示要求先读回核对；没有在这里添加 Operation、UNKNOWN 状态机或重试系统。
- 超时和取消信号已接线，但本轮未单独实验慢服务、半响应和写入后断连；不把这些列为已经验证的保证。
- 没有 Decision、Block、Risk Gate、Human trusted channel、消息 inbox 或 Phase C。没有 mutation、qualification，也没有 push/merge/promotion。

当前结果支持继续沿用薄 runtime + 普通 project service 的方向；持久化和受控动作仍应各自按真实工作流单独验证。
