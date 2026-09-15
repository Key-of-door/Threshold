# Phase C — one fake controlled operation

目标：一个具体 fake_deploy 可以局部 STOP，普通项目工作继续走原路径。本文是 spike 实现说明，不是 freeze 或通用授权规范。

**2026-09-13：Phase C 的有界验证已完成。** 真实 ASK → 继续普通工作 → 用户具体批准 → 独立 Human 入口 → 原 Agent 再调用同一 adapter → GO/一次假执行，以及技术错误路径均已跑通。

## 当前实现

- `service.mjs` 只理解 `fake_deploy`，支持两个本地假 target：`staging`、`preview`。内存中保留当前 Decision、上次受阻操作和假执行结果。
- 缺少匹配决定返回 ASK，明确 operation/target/taskId/缺少的决定；匹配 deny 返回 NO；匹配 allow 后在同一个同步 adapter 调用中执行并返回 GO 和结果。
- “执行”只追加一条内存记录，没有真实部署。批准本身不执行；Agent 必须再次调用 adapter。
- Decision 精确匹配当前 taskId 和 target。相同 scope/target 的新 Human 提交替换旧决定；没有 precedence 或规则合成。task-scoped allow 可重复使用，服务退出即丢失。
- 不支持的 target、格式错误等返回 HTTP 技术错误，不创建 ASK。请求中 `approved=true` 或 `actor=human` 不会产生授权。
- 普通协作继续复用 Phase B service/extension。Pi 自己执行 read/write/PowerShell；这些调用没有通过 fake_deploy 的匹配函数。

## Human 入口

同一进程内有两个独立 loopback HTTP 监听：Agent 入口提供 `/fake-deploy` 和只读 `/state`；Human 入口只接受带随机 bearer credential 的 `/decision`。Phase B 协作服务仍保持独立。

演示控制台充当 Human client：显示精确操作并等待输入，然后使用父进程内的 credential 向 Human HTTP 入口提交决定。credential 不写文件、不放进 Pi 环境或 prompt，也不记录到运行工件。启动演示不会自动批准。

Human 可以亲自输入；本次桌面演示也可由操作者在用户明确批准/拒绝之后转送。转送不是模型自主作出 Human Decision。服务验证的是 credential possession 和入口，**不证明生物学上的 Human 身份，也不证明同 OS 用户下任意 shell 的隔离**。

## 运行与验证

```powershell
node --test spikes/pi-phase-c/service.test.mjs spikes/pi-phase-b/service.test.mjs
# 临时 DeepSeek key 仅通过调用进程环境提供。
node spikes/pi-phase-c/run.mjs
```

真实演示使用 Pi 0.85.1 / deepseek-flash。出现 Human prompt 后输入完整 JSON，例如按屏幕实际 scope 填写：

```json
{"decision":"allow","taskId":"<本次屏幕显示的 taskId>","target":"staging"}
```

也可输入 deny 或 cancel。演示接收决定后才继续调用 fake_deploy，最后检查 unsupported target 的技术错误并关闭所有服务。

已通过 4 项 Phase C focused tests，加上 2 项 Phase B 回归：缺少决定、伪造 approved、Agent/未认证入口不能签发决定、正确 Human credential、错误 task/target 不匹配、deny、普通 checkpoint 不受阻、技术错误不变 ASK。测试中的 Human client 是测试夹具，不冒充真实用户决定。

## 本次真实运行

工件目录：`.local/pi-phase-c/2234e9ff-d76c-4152-ac9a-5801931f7341/`。原生 Pi sessionId `01a0967f-9293-75d5-a3ae-f8a17e262393`。

已实际观察：Agent 请求 staging fake_deploy → ASK、零执行；随后创建 check.mjs、通过 PowerShell 运行 Node assertion 并输出 UNRELATED_TEST_OK，再写入 checkpoint。Task 仍为 in_progress。prompt 明确要求 ASK 后继续独立工作，因此证明的是这条路径可行，不是模型在任何提示下都会自然如此行动。

用户明确允许 task `task-90e627eb-ccd8-4229-a322-4e08e77c435a` 的 staging 模拟部署后，操作者将该决定转送到演示控制台。Human HTTP 入口在 `2026-09-12T16:49:21.543Z` 保存 allow；此时执行结果仍为零。随后原 Pi Agent 再次调用同一个 adapter，获得 GO，产生唯一结果 `151ffdff-ca0f-4bc5-b143-c3b566e1d6dc`，target/taskId 与请求和决定一致，局部 Block 清除。

最后用真实模型请求 `unsupported-demo`，得到 `isError: true` / HTTP 400，没有增加 Block 或执行结果，也没有 ASK。Agent 按该轮 prompt 的要求报告技术错误，不重试、不请求授权。这不是任何场景下的模型行为保证。

`report.json` 中三项真实路径检查均通过，运行源文件哈希与当前实现逐一匹配；结束时间 `2026-09-12T16:49:25.738Z`，Pi 退出码 0，三个本地服务已关闭。原始 tool/runtime 事件、服务快照和 Agent interpretation 分开保存；没有把模型报告本身当作执行事实。运行期间等待用户的时间不代表模型响应耗时。

本轮接口权限分离及精确匹配由 focused tests 覆盖，其中测试夹具直接使用 Human credential；真实 allow 来自用户在聊天中的具体决定，经控制台转送。这两个来源保持区分。未做模型主动窃取宿主凭据的实验，也不声称拥有该层隔离。

## 保留边界

只有内存状态、两个固定假 target、一个具体 adapter。没有 durable Decision、重启恢复、remote operation UNKNOWN 状态机、历史审计归档、policy engine、Permit/proof 或 qualification。

本轮 check/execute 是单个进程内同步的内存动作；不能外推成跨网络原子性。未来真实外部动作仍需要单独处理结果不明和重试。extension 的 transport error 不推断效果是否发生。

Block 是最近受阻调用的记录，重试执行成功后清除；它不参与普通协作或文件/测试调用。`agent_end` 和 Agent 的自然语言“完成”不改变 Task。

本轮没有改动 Phase A/B 的实现，也没有提交、推送或继续其他阶段。
