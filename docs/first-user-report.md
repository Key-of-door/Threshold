# First-user observation — 2026-09-15

这轮两个新的 Codex CLI 会话，仅凭用户文档、help、练习仓库和正常 provider 环境，完成了安装 → 首个 Run → 服务停止 → 新会话接手 → Task done。测试期间没有作者补充背景或现场修 Threshold。

这支持当前版本在该 Windows 环境下的首次使用路径；它不是人类用户研究、长期稳定性证明或发布承诺。

## 本轮交付

版本 `0.2.0-alpha.1`，基于 `49e00e033bc6017dff379afb9fb7f332eaa1e6b4` 上的未提交实现。

- 安装包只包含运行代码、README、用户指南、迁移说明和不含凭据的 Pi 配置示例。
- 顶层/分组/具体命令 help，以及无需 service 的 version。
- 默认 home 使用稳定的 OS 用户数据目录；显式 `--home` 保留，不自动搬旧数据。
- 当前 Git repo/子目录识别 Project；重复登记同一根目录返回已有 Project。
- Task/Run 支持唯一 ID 前缀，歧义列候选；检索涵盖全部 Run，而不是最近五项。
- 默认人类输出，完整 checkpoint 可见；脚本显式使用 `--json`。
- 长文字文件输入；技术错误给出已知阶段、可确认原因和下一步，不保存原始 provider 错误。
- `run stop ID` 与 `service stop` 分开；裸 `stop` 不执行操作。

改动集中于 CLI、文档和普通查询/错误信息。增加了一个 ID lookup 查询，没有新表、Project primitive 或治理语义。Risk STOP、capability selection 和 worker 生命周期维持原有行为。`Threshold-capability` 未改动。

## 实际环境与隔离范围

Windows，Node 24.18.0，npm 11.16.0，Pi 0.85.1，DeepSeek `deepseek-flash`。两个 Pi Run 都没有选择额外 Skill/Extension。

练习目录 `E:/Threshold-first-user/log-summary`；安装 prefix `E:/Threshold-first-user/install`；公开 Pi 配置 `E:/Threshold-first-user/pi-agent`。凭据只通过本轮获准的进程环境提供，未复制作者的 `.local/pi-agent`。

使用真正的默认 home `C:/Users/yang/AppData/Local/Threshold`，开始前该目录不存在。没有传 `--home`，B 从 `examples` 子目录进入后仍找到原 Project。不是独立 OS 用户，也不声称权限隔离。

首次测试器启动因 Codex CLI 0.149.1 太旧，服务端返回 HTTP 400：当前 Astra 模型要求更新 CLI。该调用没有执行用户步骤。操作者在实验工具目录单独安装稳定版 0.154.0 后重新创建 A，保留错误记录，没有改 Threshold、换模型或把它归类为 safety interruption。

A/B 使用独立的 `codex exec --ephemeral`，不是 resume/fork，也不是两个桌面窗口。禁用 memory、插件等历史注入；不传本开发对话、架构材料或 A transcript。测试者仍有 Codex 本身的通用指令和模型先验。执行方式参考 [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) 和 [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)。

两份 brief 都允许自行决定 README 阅读量。事实上两者都先读了完整 README，又读用户指南；本轮没有覆盖只看开头就开始试的习惯。只记录公开消息、命令结果及 usage，不保存 reasoning item。

## 两次接手

Project `ef2e9b18-932a-4b55-b3bd-bf37b2ca1d74`；日常操作使用 `ef2e9b18`。Task `82e3ec1a-1c1b-4403-9438-917a65c3b795`。

| 会话 | Codex session | Pi Run / session | 实际结果 |
| --- | --- | --- | --- |
| A | `01a0a0ba-8b0f-7d82-a3fe-441bd86fa3ac` | Run `cc12bf33-110c-4b86-8525-ced4facc6c34`; Pi `01a0a0bb-e535-710e-9a25-1e655aebdb67` | 安装、建 Project/Task；解析模块与 12 项测试；checkpoint、Message；Task in_progress；服务正常退出 |
| B | `01a0a0bd-c9d3-7700-a94f-351541d925f3` | Run `226dfb06-c14d-476c-9269-e33b2870a463`; Pi `01a0a0bf-25f6-72aa-be02-1ca3bc87d46a` | 从子目录发现服务未启动，自行启动；读 Task/checkpoint/Message 与 Git/files；完成 CLI、5 项新增测试和用法；保存最终状态并停止服务 |

A/B 各使用一次真实 Pi Run，分别约 26.5 秒和 25.3 秒；两者持久退出观察均为 `ended / exit_code=0 / error=null`。服务停止后的 locator 均不存在，没有留下本轮 Node worker/service。A/B 操作者会话各约三分钟，包含安装/调查/验收时间。

有价值的自然观察：A 错称 README 引用的样例不存在，并把这条判断写进 Message。实际上 seed 文件一直存在。B 读取文件后自行纠正该说法，没有把 Message 当事实。操作者没有中途修正或提醒 B。

## 使用摩擦

| 观察 | 对产品的含义 |
| --- | --- |
| A/B 都从 README 转到用户指南、查询安装目录中的 Pi 示例。B 还重写了已经预置的公开配置 | 配置就绪与需要首次配置的分界仍不够轻松；测试 brief 已说明环境就绪，因此也包含测试者自身的谨慎。值得简化说明，尚不支持新增配置框架 |
| npm 报弃用与 allow-scripts 提示，但安装和 Pi 执行成功 | 陌生用户不知道提示是否影响可用性；保留为依赖/安装文档事项，不把成功解释成所有平台均安全无误 |
| B 首次 status 得到 service address 不存在提示，按帮助启动后恢复 | 技术错误指向正确用户操作；没有要求调查 DB 或找作者 |
| A 将“本次不做 CLI”写入持久 Task 的正文和标题 | B 必须解释旧阶段范围，并在 Message/新 objective 中重申本轮阶段。这是实际的写法/使用摩擦；先让 quickstart 示例把完整目标放 Task、阶段范围放 Run objective，不据此发明任务层级 |
| A/B 都多次查询 status；B 有一次普通 Git 相对路径错误，自行纠正 | 前者是异步 Run 的现有交互成本；后者是操作者 shell/cwd 错误，不归因于 Threshold |
| 两者均未公开表达“必须调查 Threshold 内部才能继续”，命令记录也未读取内部实现/DB | 本轮没有观察到用户所关注的该类信号；不能据此断言模型从未产生过某个未表达想法 |

短 ID、默认 home、Project 子目录识别、完整 checkpoint 和显式 service stop 都实际被使用。两者仍看到创建输出中的完整 ID，但没有复制完整 UUID 才能继续的步骤。没有作者介入；只有测试前的 Codex CLI 版本准备由操作者处理。

Message 里自然混入了安装摩擦、验收自报和长边界文字，能接手不代表这些都值得长期保留。此次不修改消息，也不增加分类或历史体系。

## 独立检查与限制

- Threshold：`npm test`，23 项通过；针对 help/home/短 ID 歧义/旧 Run 查找/停止对象/错误阶段有 5 项新增测试。`git diff --check` 通过。
- 练习项目：操作者最终 `node --test`，17 项通过；另用 6 份独立输入验证中文及空格路径、LF/CRLF、空输入、坏 JSON、缺失/不支持 level、非对象 JSON，检查 stdout/stderr、退出码和原始行号，全部符合要求。
- A 的解析模块和原 12 项测试字节未变；seed 样例和 `.gitignore` 未变。B 新增 CLI/测试，更新 package/README；未改写旧测试让结果通过。
- 源码与安装产物在 A/B 期间未变；安装后的运行文件哈希与候选一致。没有测试者现场修产品。
- Task 的 `done` 是产品中的工作评估；上述独立执行结果另行核对，不由状态字段代替。

Codex 累计 input/cached/output tokens：A `308851 / 288768 / 2836`；B `328277 / 293376 / 2748`。这些是测试器反复调用的累计计数，含重复缓存上下文，不是单次上下文长度，也不是 Pi token 成本。本轮未记录 Pi usage，因此不声称端到端 token 负担已经很轻。

未验证：真正陌生人、npm registry 发布/公网下载安装、全新 provider 登录、Linux/macOS、活跃 Run 的真实取消、长期运行或高并发。启动预算和三分钟上限仍在；本轮未触及它们。

本轮没有 push、merge、发布或自动新增 core 能力。实现保留未提交，练习历史保留。后续优先处理“完整 Task vs 本轮 objective”的文档表达与 Pi 首次配置说明，而不是下一种 integration。

## 本地记录入口

仅供复查，不是用户安装材料或 acceptance package：`E:/Threshold lite/.local/first-user-build/` 中的 `candidate.json`、两个 `tester-*.jsonl`、`snapshot-a.json`、`snapshot-b.json`、`independent-checks.json`、`independent-project-tests.txt`。候选 tgz SHA-256：`d1e2e69b63791de4d1f203ea5a3770b906e4edb43af1bbe718d6413550117b70`。

自我复核：没有把代理用户当真人样本；没有把 Task done 当测试结果；A 的错误 Message 保留为历史判断；没有把“未观察到”升级为“不可能发生”；也没有因实验顺畅而宣称长期产品体验已经证明。
