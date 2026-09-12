# Pi integration spike — Phase A

范围：真实 Pi 进程与 JSONL RPC。没有 project service、collaboration extension、controlled adapter 或数据库。Pi 仍是候选 runtime。

后续工程备注（2026-09-13）：Phase B 将已有 RPC 函数抽到 `../pi-rpc.mjs` 共用，Phase A runner 现在引用该文件并额外记录 bridgeSha256。抽取后的无模型进程检查通过（`.local/pi-phase-a/c2ca7cfb-fdd3-46c9-9410-d94c1f28fb92/report.json`）；下文历史 shell 观察仍绑定各自记录的旧脚本，不重绑到当前代码。

## Phase A 收口：Windows compatibility supplement（2026-09-12）

**本轮 Phase A 可以收口。** PowerShell 核心路径和 Git Bash 兼容性均已实际验证；Pi 继续作为薄集成候选，没有因此成为永久 runtime。没有进入 Phase B/C。

已通过 winget 安装 Git for Windows 2.55.0.3（含 Bash 5.3.15）、fd 10.5.0、ripgrep 15.2.0；安装器哈希均通过 winget 校验。Pi 的本地 `settings.json` 显式设置 `shellPath: C:/Program Files/Git/bin/bash.exe`，避免旧进程 PATH 上的 WSL bash 入口。依赖目录已由 winget 加入用户 PATH；安装前打开的终端需要重开或刷新进程 PATH。

npm 完整依赖树检查退出码 0，无缺失；esbuild 0.28.1 实际 TypeScript 转译、Google SDK 模块导入、protobuf 7.6.5 编解码往返通过。没有升级 Pi，也没有为了消除安装脚本提示而批量放行脚本。

补测只给现有探针增加 shell 参数，复用原来六项检查。实际运行：

```powershell
# 当前调用进程已包含新 Git cmd、fd、rg 路径；临时 key 只由进程环境提供。
node spikes/pi-phase-a/phase-a.mjs deepseek-flash deepseek bash
```

- 六项探针完成，约 40 秒，脚本退出码 0。
- 真正的模型 `read` / `bash` 调用及对应 lifecycle 已观察；Bash 实际 cwd 为包含中文、空格的 `/e/Threshold lite/.../工作目录 with spaces`，成功读取 fixture。
- Bash 工具输出确认 Git 2.55.0.windows.3、fd 10.5.0、ripgrep 15.2.0、Node 24.18.0 均可执行。
- 显式 abort 后 streaming 变为 false；测试 Node 子进程已结束，没有延迟文件写入。
- 活跃时直接 EOF / 强制结束 Pi：仍各观察到存活子进程及随后发生的延迟文件写入，无 agent_end。这与 PowerShell 观察一致，**不把父进程退出当作后代清理保证**。
- 三组测试子进程及其 Bash 父 PID 在收尾核查时均不存在。

本次工件：`.local/pi-phase-a/a1b143e6-7e01-446b-bd8c-2ca748aaa38d/report.json`，同目录保存每个进程的 JSONL 和 session 文件。运行时间 2026-09-12T07:49:38Z 至 07:50:18Z；脚本 SHA-256 `8916fd00abe28ae498e1e5bb2a7fa6524848b27263a19271b9728523fc8aebdd`。旧 PowerShell 记录仍属于当时脚本，不重绑到当前版本。

正常停机沿用已经观察过的顺序：`clear_queue` → `abort` → 确认 idle → EOF。意外进程退出后应重新观察，而不是据此认定工具停止或效果未发生。

收口保留的未验证范围：非空 queue 的取消、流式生成刚开始时的取消、多 worker 并发、重连恢复、任意程序的后代清理。它们不是本轮已证明的能力，也不扩展为 Phase A 新增任务。此次没有新建 governance primitive、通用 supervisor 或修补 Pi。

## 先前结果：DeepSeek + PowerShell 真实调用（2026-09-12）

**Pi + PowerShell 的 Phase A 核心路径已实际跑通；Windows 停机有一项必须保留的限制。** 没有进入 Phase B/C。

用户指定 provider `deepseek`、模型 `deepseek-flash`。已核对 [DeepSeek 官方接口文档](https://api-docs.deepseek.com/)和 [2026-09-10 更新](https://api-docs.deepseek.com/updates/)；使用 `https://api.deepseek.com`。Pi 0.85.1 内置目录仍为旧 Flash 名称，因此仅通过普通 models.json 增加精确的新模型名，没有修改 Pi。

`deepseek-models.json` 是这次文本探针的配置：沿用 Pi 的 DeepSeek 兼容参数，以环境变量引用 key；128k context / 4096 output 是探针保守上限，不是厂商能力声明。没有填写价格，所以事件里的零 cost 不能解释为免费或零账单。

实际执行：

```powershell
Copy-Item -LiteralPath spikes/pi-phase-a/deepseek-models.json -Destination .local/pi-agent/models.json
# DEEPSEEK_API_KEY 由调用进程临时提供，不写入命令文件或配置值。
node spikes/pi-phase-a/phase-a.mjs deepseek-flash deepseek
```

最终一轮耗时约 43 秒，六项探针完成，脚本退出码 0。这里的 `observed` 表示按探针预期完成观察，不代表所有停机方式均能清理后代进程。

| 实际检查 | 结果 |
| --- | --- |
| 原生身份 / 状态 / 空闲 abort / EOF | 取得 sessionId；并行 RPC 按 id 对应；EOF 退出码 0，无 agent_end |
| 空闲时强制终止 | 进程关闭，新请求被拒绝，无 agent_end |
| 模型读文件与 PowerShell | 模型精确为 deepseek/deepseek-flash；真实读取中文/空格路径 fixture，并输出指定 PowerShell 标记 |
| 生命周期 | 观察到 agent_start、turn_start/end、message_*、tool_execution_start/update/end、agent_end、agent_settled；工具开始/结束按 toolCallId 关联 |
| 活跃工具期间显式 abort | streaming true → false；工具结果为 Command aborted / isError；测试子进程在检查时已结束，未产生延迟文件 |
| 活跃工具期间 EOF | Pi 以 0 退出且无 agent_end；测试子进程仍存活，随后完成延迟文件写入 |
| 活跃工具期间强制终止 | Pi 关闭且无 agent_end；测试子进程仍存活，随后完成延迟文件写入 |

表格把同一探针的事件观察单列，实际是六项探针。EOF/强制退出使用仅持续 15 秒的本地 fixture；探针等待它自然结束。结束后逐一核查三个测试 Node PID 及其 PowerShell 父 PID，均已不存在，没有遗留测试进程。

取消后还观察到一个空 assistant turn：`stopReason: error`、`errorMessage: This operation was aborted`。这是本次 Pi/DeepSeek 取消路径事实，不能只凭通用 `error` 标签判断是否需要重试，更不能误写成正常业务完成。

**工程含义：** 正常关闭 worker 先 `clear_queue` → `abort` → 确认 idle → EOF。直接 EOF / 终止父进程不能保证工具或后代已停止，即便 Pi 退出码为 0。本轮只观察这个限制，没有添加 Job Object、通用 supervisor 或修补 Pi。若后续工作流要求宿主强杀也清理全部后代，再针对该真实需求做有界实现。

完整记录（临时开发观察，均在被忽略目录）：

- 首轮 DeepSeek：`.local/pi-phase-a/e20bd0fd-6315-4762-ab14-45dbf3c84fa8/report.json`，四项探针；当时脚本版本保留在报告 sourceSha256。
- 补齐活跃 EOF/强制终止后的完整一轮：`.local/pi-phase-a/e380ee0e-b120-4848-8be1-e4b9072a5ab2/report.json`；2026-09-12T07:35:23Z 至 07:36:06Z。
- 本轮脚本 SHA-256：`05198824ffe9d5b83165f97e20c59fe78f4ff5317d2be70410fffdcd091758c8`。
- 同目录保存每个 Pi 进程的 JSONL，以及实际产生的原生 session 文件。这只证明本轮文件落盘，未证明 session replacement 或 crash recovery。

key 仅在本轮调用进程环境存在，调用结束时清除；未写入 auth.json。对 `.local/` 的 key 格式扫描结果为零匹配。原始 RPC 和报告的写入另做该环境变量值的替换，避免错误文本意外回显。这个处理不宣称同 OS 用户下的 credential 隔离。

**该轮结束时未验证：** Git Bash（当时未安装，现已在顶部补测）、非空 queue 的取消、流式生成刚开始时的取消、并发多 worker、重连恢复。该轮使用 Pi 自带 PowerShell；当前边界见顶部收口记录。

## 历史观察：首次无凭据检查与 OpenAI 登录（2026-09-12）

- 本地安装 `@earendil-works/pi-coding-agent@0.85.1`，依赖固定在 package-lock.json。
- Windows / Node 24.18.0；通过 Node 直接启动 Pi CLI，`shell: false`、参数数组、隐藏子进程窗口。
- 实际工作目录包含空格和中文。
- `get_state` 返回原生 sessionId；并行请求按 RPC id 关联；空闲状态下 `clear_queue` / `abort` 成功。
- stdin EOF 后真实 Pi 退出码 0，无未完成 JSONL frame、无 agent_end。
- 强制终止空闲 Pi 后桥接端拒绝新请求，无 agent_end。
- 没有已配置的 provider，`get_available_models` 返回空，state.model 为 unknown 占位值。
- get_state 提供 sessionFile 路径，但本次空会话没有产生对应 session 文件；这不证明会话持久化或恢复。
- Pi 自带 OpenAI Codex `/login` 已实际尝试 Browser login。token exchange 返回 HTTP 403，错误码 `unsupported_country_region_territory`，类型 `request_forbidden`。错误产生的精确时间未采集；结果于本轮工具读取中观察，整理时间 2026-09-12T15:17:33+08:00。
- 随后的 `auth check --provider openai-codex --no-refresh --json` 返回 `not_ready / credentials_not_configured`。没有重试登录，没有迁移其他客户端凭据。交互 Pi 已正常退出。

本次报告：`.local/pi-phase-a/645f2376-6c82-4e5a-9f5b-1a7bc5068730/report.json`，同目录包含两份原始 RPC/进程 JSONL。报告中的 sourceSha256 对应实际执行脚本。这些是临时开发观察，不是 qualification 或产品完成声明。

## 运行

从 workspace 根目录执行：

```powershell
npm ci --prefix spikes/pi-phase-a --no-audit --no-fund
node spikes/pi-phase-a/phase-a.mjs
```

第二条不发送模型请求。临时工件和 Pi 配置位于被 Git 忽略的 `.local/`。脚本为每次运行新建观察目录；单进程 telemetry 上限 4 MiB，但历史目录不会自动清理。不要将整个 `.local/` 加入版本库，其中 Pi 的 auth.json 将来可能保存凭据。

Pi 登录使用它自己的交互 CLI，配置目录为 workspace 下 `.local/pi-agent`；凭据就绪后，从可用模型中选一个确切 ID，再运行：

```powershell
node spikes/pi-phase-a/phase-a.mjs <model-id> <provider> [powershell|bash]
```

省略 provider 时保持最初的 `openai-codex` 默认值，省略 shell 时使用 `powershell`。DeepSeek 的实际结果见顶部；OpenAI 订阅登录仍未成功，没有借用其他客户端凭据。

## 首轮记录中的剩余依赖（历史，不是当前待办）

1. Pi 可用的模型凭据及真实模型调用。这是当前首个依赖；不能从“支持订阅登录”推断当前账户/网络已可用。
2. 模型驱动的 agent/turn/tool lifecycle、原生 toolCallId、运行中状态、active abort、子进程清理尚未验证。
3. 当前找不到 Git Bash；PATH 上为 Windows 的 WSL bash 入口。本轮没有运行它，也没有把它当作 Git Bash 验证成功。PowerShell 实际工具执行同样等待模型接入。
4. 活跃工具期间强制终止父进程、EOF 和排队请求取消的组合行为仍未验证；已运行的强制退出只覆盖空闲 Pi。
5. 未证明 Windows Job Object 级隔离、所有后代进程清理、session replacement 或 crash recovery。桥接脚本不承诺这些保证。

原生 sessionId、RPC 请求 id、toolCallId 与本地 observationId 分开记录；本轮未观察到独立的原生 runId，不合成一个冒充原生标识。`agent_end` 不改变 Task；process exit / tool error 不证明外部副作用为零。

本轮 Git 初始化并设置 origin 为 `https://github.com/Key-of-door/Threshold.git`；fetch 两次因 TCP 443 连接失败，尚未取得本地远端提交。GitHub API 返回 main `9ee2578dce2fe6e7b14d16354e2f9ed2569dbfb0`，这不等于本地 HEAD。没有 commit、push 或对 legacy repo 的操作。

Pi 接口依据：安装包自带 `docs/rpc.md`、`docs/providers.md`、`docs/windows.md` 与 `dist/modes/rpc/rpc-mode.js`。OpenAI 的 [Codex authentication 文档](https://developers.openai.com/codex/auth)说明 ChatGPT 登录方式；本机 Pi 是否可用仍以实际登录与调用结果为准。
