# Per-Run capability activation

2026-09-13。普通实现与小实验记录，不是 freeze。Pi 保持 0.85.1。

## 小范围研究与选择

Pi 允许 `--no-skills` 关闭发现，再用重复的 `--skill <path>` 增量选择。启动时只有 name/description/path catalog，正文由模型 read 或 `/skill:name` 加载。此次用原生 RPC `get_commands` 核对 catalog，并观察真实 read；Threshold 不解析或复制 skill 正文。[Pi 0.85.1 skills](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/skills.md)

Extension 可用 `--extension <file>` 单次加载，`--no-extensions` 关闭默认发现；包安装与加载是不同步骤。本地已安装 npm 包中的官方示例也能直接用这个入口。[Pi extensions](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/docs/extensions.md)

Pi 核心没有原生 MCP。社区 `pi-mcp-adapter` 提供 MCP extension、配置文件与显式 `createMcpAdapter({config})`，后者有隔离配置入口。但它还有多来源发现、缓存、连接生命周期等工作，本轮不引入；用一个真实 extension 已能验证非 skill 的装配，不新增 `--mcp` 或虚构 MCP 已完成。[Pi README](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/README.md)、[community adapter](https://github.com/nicobailon/pi-mcp-adapter)

其他产品只作对照：Claude Code `--plugin-dir` 是单 session 加载；`--strict-mcp-config` 配合 `--mcp-config` 限定配置来源。Codex 有显式技能调用和按 description 的隐式匹配，MCP 的 enabled 可在保留安装配置时关闭服务器。它们提醒我们区分安装、发现、调用，不能把“安装了”视作“仅这个 Run 激活”。本轮没有运行 Claude/Codex 对照实验。[Claude CLI](https://code.claude.com/docs/en/cli-reference)、[Codex skills](https://learn.chatgpt.com/docs/build-skills)、[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

| 样本 | 来源与用途 | 选择理由与局限 |
| --- | --- | --- |
| code-review | ferologics/pi-skills | 一个独立 SKILL.md；报告本地 findings，不自动发 GitHub 评论。默认 PR 流程需要用本次 objective 明确替换为本地 working tree review |
| code-simplifier | 同一仓库 | 与 reviewer 不同的代码整理指引，没有额外依赖；带 TypeScript/React 等风格偏好，不能凌驾这个纯 JS 项目的实际要求 |
| hello.ts | Pi 0.85.1 官方 examples/extensions | 仅返回问候，不联网、不修改项目。适合观察工具是否注册/调用，不能据此评价真实业务插件或 MCP 实用性 |

Skill 源仓库未 archived，最新 commit 为 `8b0816aae32fdecb135b39f75dc19fe65fccabbf`，2026-06-02；这是小型个人维护样本，不作维护承诺。完整阅读两个入口后，使用已登录 gh 的 contents API 按该 commit 下载原始字节；不执行包安装脚本、不改 `~/.pi`。安装在忽略目录 `.local/capabilities/ferologics-8b0816aae32fdecb135b39f75dc19fe65fccabbf/{code-review,code-simplifier}/SKILL.md`。原上游署名保留，未改写样本内容。[源仓库](https://github.com/ferologics/pi-skills/tree/8b0816aae32fdecb135b39f75dc19fe65fccabbf)、[hello 源码](https://github.com/earendil-works/pi/blob/v0.85.1/packages/coding-agent/examples/extensions/hello.ts)

没有选用需要多 Agent runner、额外 provider、语义 Git 引擎或全局链接安装的整套能力包。也没有因为某个现成 skill 写得很强硬就把它变成 Threshold 规则。

## 实现

CLI 重复 `--skill` / `--extension` → service 校验本地入口文件 → Run JSON 保存路径/入口 SHA-256 → Pi 原生命令行加载。未选集合为空，不从 Project 或历史 Run 合并。skill 目录只展开为它的 `SKILL.md`；extension 当前要求入口文件，依赖由其正常本地安装解决。

Pi 使用默认普通工具和所加载 extension 的工具，不再用固定 `--tools` 把新工具排除。这个 Windows 环境已安装 Git Bash。自带 Threshold extension 不算可选能力，仍每 Run 加载；Pi 本身也可能包含内建 extension，不声称进程里仅有用户指定的几个模块。

没有新表、Role、plugin lifecycle、解析器或 policy gate。schema v4 是 `runs.capabilities_json` 一列；旧 Run 为 null。入口哈希是选择时的调试信息，不固定引用依赖或防止文件随后变动。加载失败是技术错误，不是 ASK。安装位置和全局配置未被写入 Project DB。

`npm test`：10/10。新增三项 focused tests 覆盖 CLI→service→Run metadata/restart，以及真实 Pi 进程的单项/组合/下一 session 默认空/设置中的未选能力不进入 catalog 或工具集/正文不等于 catalog/extension 加载失败。测试 probe 仅在无模型测试进程里检查 Pi 的工具和 system prompt，没有进入 F/G worker。

## 真实 F/G 实验

在既有 `E:/test1/config-checker` 上继续 A→E 时间线；复制已关闭的 D/E SQLite 到 `E:/test1/capability-activation/state`。两个全新 Pi session，中间真实关闭并重启 service；G 只获得正常 Task/checkpoint/recent Run/Message/Git，不获得 F 的 conversation。F/G 均使用获准的 DeepSeek/deepseek-flash。观察时间：2026-09-13 16:32:48–16:34:32（Asia/Shanghai）。Threshold 实现基于 `0b69f451c864fc762e49d533ff8512aaba4c55c2` 上本轮未提交改动；不是该旧 commit 自身的运行结果。

| Worker | Run / session | 实际选择和行为 |
| --- | --- | --- |
| F | Run `d42de746-eee1-4508-9ef7-27d42e914c9f`；session `01a099e5-cd79-73ce-98e3-cd3d4f12148d` | 仅 code-review；Pi catalog 仅此 skill；成功 read 其 SKILL.md；重新检查 Git、README、source/tests，发 Message #3，保存 checkpoint；前后项目文件哈希一致 |
| G | Run `0c98ee55-1aae-4f3c-9fdc-065e63a6ea37`；session `01a099e6-a740-714a-86d0-deba28ef470a` | code-simplifier + hello extension；catalog 仅 simplifier，成功 read 正文，没有 read reviewer skill；hello 一次成功；读 #1–3，重新检查并复现，发回复 #4、保存 checkpoint |

两个 Run 都正常 ended、Pi exit 0、runtime error=null。G 后再次重启，四条 Message 保持一致；Task 仍 done，原状态更新 metadata 未改变。F/G 未提交或推送实验项目。没有 H：G 已组合 skill 与真实 extension；不为凑三个 worker 重复模型调用。

F 没找到必须修复的问题。它复现了 Node JSON.parse 错误消息可能带换行，列为“若希望单行则可改”的可选项。G 独立复现后，将 CLI 的错误消息压缩空白为单行，新增一个测试；parser/loader、原 fixture 和旧测试断言保留。G 没有接受 delimiter Unicode 语义变更，也没有进行 TypeScript/React 风格重写。

独立检查：项目测试 **15/15**，原独立 harness **8 组通过**；另一个独立 CLI malformed-JSON probe 确认 exit 1、stdout 空、stderr 单行。before/after diff 只包含 `bin/config-check.mjs` 的错误展示改动与 `tests/load.test.mjs` 插入的一个测试；去除新增测试块后与原文件逐字相同。F 的只读性是文件快照观察，不是 reviewer skill 的权限保证。

需要保留的不准确之处：

- G 把“简洁 stderr”解释为必须单行，并称旧行为是已证明缺陷。README 没有明确单行要求；本报告将改动视为获准范围内的小型 UX 改进，**不采用其更强的需求判断**。F/G 的分歧原样留在 Message 中。
- F 的 Message 有一句“没有 stderr-empty 测试”，紧接括号又承认实际存在；这是摘要冗余/矛盾。消息仍应由接手者核查，skill 没有消除表达错误。
- F 的一个 guidelines 查找复合命令返回 1；G 的首次 edit 失败，随后 read 文件并成功 edit。只保留观察，不将其当 governance STOP；当前简短日志没有保留该 edit 的具体错误文本，原因不作推断。
- F/G 用管道截取测试输出；独立 harness 直接运行测试并检查进程退出码，最终验证没有依赖管道末端成功或 Agent 自报。

## 负担、隔离与产品判断

| 原生 Pi stats | F | G |
| --- | ---: | ---: |
| Tool calls | 21 | 21 |
| 最后 context tokens | 24,673 | 23,322 |
| 累计 input/output/cacheRead total | 177,075 | 266,120 |
| 新 Message 字符数 | 2,796 | 1,951 |

累计 total 包含多轮 cacheRead，不等于单次 context，也不能据此计算费用；provider pricing 未配置，cost=0 不表示免费。两份 skill 原文约几 KB，确实被读取。本轮没有相同 objective/相同历史的无 skill 对照，不能量化 skill 的额外 token 成本、速度收益或 review 质量提升。F 的消息并不特别短，不声称 reviewer skill 优于此前 D。

**成立的观察：同一 Project 可以让两个新 Run 明确选择不同的现成 skill，工具也可只在选定 Run 加入；它们通过 Message 自然继续工作。** 新进程的 catalog/tool-set 分离已由无模型真实 Pi 测试验证，F/G 的实际正文读取与调用也相符。选中的 extension 若自行发现更多资源，是其自己的行为，本接口不分析它的全部实现。

这里的“不继承”指运行时能力配置不从旧 Run 自动带入。历史消息、代码和 checkpoint 本来就会影响后续 Agent；同用户文件系统仍然可读，所以不能宣称任何提示影响都绝对隔离。当前不需要 Role 或 plugin framework。长路径略繁琐、外部 skill 有不适配的默认假设，但还不值得增加注册表或 preset 系统。实验支持装配机制可用；是否让协作更好，仍应由后续真实任务观察。

本机短记录：`E:/test1/capability-activation/result.json`、`F-tools.json`、`G-tools.json`、`verification.json`、`final.patch`；它们不属于 runtime 的长期 Project DB，也没有传给 worker。README 给出了实际 CLI 用法。全局 Pi 设置、模型版本与临时 key 文件未修改；没有把 key 写入实验文件或仓库。
