# Threshold TUI — 第一轮视觉与交互改造

2026-09-26 · 对应 handoff `.local/handoffs/2026-09-26-tui-visual-interaction-handoff.md` · TUI v0.1 设计记录

后续验收：用户确认实际使用中未发现原生鼠标和中文输入问题，并同意作为 Threshold TUI v0.1 发布（整体 npm 包 `0.2.0-alpha.6`）。CLI 保留；启动 service 后可以选择 `threshold tui`。该反馈不扩展为所有终端、字体和 IME 的兼容保证。

本轮只改表现层与客户端视图状态：`src/tui.mjs`、`src/tui-components.mjs`、`tests/tui.test.mjs`。没有改 service API、store、Run 执行语义或 `cli-display.mjs`。语义约束沿用 [tui-interaction-v1.md](tui-interaction-v1.md)。

## 1. Critique（改造前）

依据：用户在真实终端的截图（约 180 列 × 50 行，Projects 页），以及隔离 fixture 在 180×50 / 120×32 / 80×24 / 40×20 下渲染的真实组件帧。

用户原话："信息挤在了右上角，密度太高。"截图中内容实际集中在**左上角**：约 50 列 × 14 行，其余区域全空。下面按这个现象分析。

### 表现层

- **单列平铺，没有空间结构。** 每个页面都是同一个 `DocumentView` 堆起来的文本块和方括号动作行，行宽由文本长度决定。宽终端右侧 60% 以上闲置，所有信息却挤在左侧同一缩进下。
- **一种按钮样式包办所有角色。** 导航、tab、Task 标题、Run 状态、`Archive Project`、表单字段全是 `[ ... ]` 青色按钮，标题和动作无法区分，主次动作和危险动作也无法区分。
- **元数据和正文权重相同。** 完整 UUID、绝对路径、带毫秒的 ISO 时间、每个 Task 重复出现的 "work assessment"，都与标题占用同样的行级空间。
- **chrome 过重且重复。** header 固定 3 行（产品名、面包屑、连接状态 + ISO 时间 + home 路径，80 列时折成 4 行），下面还有一行 6 个导航按钮，之后页面标题又重复一次面包屑和完整 ID。Task overview / Run inspect 直接嵌入 CLI `display()`，标题、ID、状态又出现一次。
- **状态不用 CLI 已有的符号。** Board 上 running / ended+error / unknown 都是同一种青色按钮 `[ ended / Run … ]`，错误只在下一行变红。

### 交互状态

- **面包屑残留旧上下文。** 回到 Projects、Service、Commands 页时 `this.project` 仍保留，header 继续显示上一个 Project（截图中的 `Test(GPT)`）。
- **返回时丢失阅读位置。** 每次 `setPage` 都新建 `ScrollView`，Board → Task → Esc 回到 Board 后滚动位置归零。
- **Tab 成本高。** Tab 顺序先走完 6 个导航按钮才能到正文；Board 上到达第 3 个 Task 需要十几次 Tab。
- **Run 身份信息会被滚走。** Run 页 `follow: 'end'` 时，顶部的 Run ID、状态和动作随活动增长滚出视口；输入入口位于文档末尾。
- **编辑时看不到上下文。** 编辑器占满页面，Run 的活动和目标只剩一行标题。

### 数据源限制（本轮不改，见 §6）

- live 事件没有时间戳，无法显示"几点收到这条回复"。
- tool start/end 没有配对 ID，不能合成完整的工具调用块。
- `last read` 是当前路由最后一次成功读取的时间，不是每条 Git/file 观察的时间（Git/file 各自带 `observedAt`）。

## 2. 设计取舍

参考 Claude Code 的终端设计：少量 chrome、一个强调色、灰色承担次要信息、列表用指针选择、输入目标固定在底部。不采用它的 session 中心架构。

| 决定 | 理由 / 边界 |
| --- | --- |
| 顶部一行上下文栏：`threshold › Projects › Project › Task › run xxxx`，右侧显示连接状态和本地时间 | 面包屑由当前页面推导，不再残留旧上下文。祖先段可以点击，键盘用 Esc 或 `/`。窄屏时先折叠中间段，始终保留当前位置 |
| 删除 6 个按钮的全局导航行；Quit 移到 Commands | Esc 返回上级，`/` 打开 Commands（Projects、按 ID 打开、fresh Run、Service、帮助、Quit）。无鼠标仍能走完所有主要路径 |
| 底部一行按键提示，右侧显示 `home slots u/max` | 容量明确标为 home 级别，满时变黄，不冒充某个 Project 的进度 |
| 每页分三个区：固定顶部（身份 + 动作 + 通知）、滚动正文、固定底部（输入目标或恢复入口） | Run 页的状态、phase、模式、模型、workspace、完整 ID 和 Stop 始终可见；unknown 的恢复入口、ended 的结果说明固定在底部。终端太矮（固定区超过 40% 行数）时，固定区并入滚动区 |
| 列表项：`❯` 指针 + 加粗标题 + 右对齐元数据 + 缩进的次要行 | Task 标题成为标题而不是按钮；状态和短 ID 右对齐，把宽度用起来。标题和元数据放不下一行时，元数据换到下一行，标题不截断 |
| 按钮保留 `[ ]`，括号变暗；危险动作（Stop Run、Stop service）用警告色 | 单色和 ASCII 模式下仍能靠括号识别按钮 |
| Run 状态复用 CLI 的 `format().state()`：`● running`、`! ended · error/interruption`、`? unknown`、`— ended` | 与 CLI 一致；ended 用中性色，不使用成功符号 |
| Task overview 宽屏（≥110 列）分两栏：左边是说明、checkpoint、当前 Git；右边是 Task 字段、Runs、更多入口 | 窄屏上下堆叠，内容不删；不再嵌入 CLI `display()` |
| 编辑时底层页面保持可见但不可交互，编辑器在底部，上方一行显示完整目标 | 输入时能看到 Run 活动；底层页面的按钮不会被误点 |
| 每个路由保存自己的滚动视图和选中项 | Board 另保留各 Project 最近快照（进程内最多 40 个），返回刷新期间不以 Loading 短帧清零滚动位置；不会借用别的 Project 内容 |
| Tab / Shift+Tab 在区域边界跨区（顶部 ↔ 正文 ↔ 底部）；进入页面的默认焦点：Board 和列表页在正文，Task 页在顶部动作，Run 页在底部输入 | 减少 Tab 次数，焦点位置符合各页最常用的动作 |
| 时间显示为本地 `YYYY-MM-DD HH:MM:SS local` | Run 原始 ISO 仍在 Inspect；Message/checkpoint 可用 `Show recorded time` 展开完整 ISO（毫秒、时区），在 TUI 内拖选复制。窄屏 metadata 换行，不截掉秒数 |
| ASCII 模式：`>`、`-`、` > `、`...`、` / ` 分隔符，tab 用 `>` / `*` 标记 | 与 CLI 的 ASCII 约定一致；状态不只靠颜色 |

明确**没有**做：常驻 Task sidebar、按块折叠、可搜索的 command palette、split view。handoff 把它们列为可选项；本轮先解决密度和层级，避免一次重写。

## 3. 字段去向表

| 信息组 | 改造后的默认位置 | 完整内容入口 / 复制方式 | 来源及降级状态 |
| --- | --- | --- | --- |
| Project / Task / Run 名称与完整 ID、归属 | 每页顶部面包屑；页面标题。列表中显示短 ID | 完整 ID：Board 标题右侧（Project）、Task overview 侧栏 `Task ID`、Run 顶部第 3 行（Run）。拖选复制，或 `--no-mouse` 使用终端原生选择 | 沿用现有读取；面包屑按页面推导，不残留 |
| Run mode / status / phase / workspace / objective | Board 的 Run 行：状态符号、live phase（标 "live snapshot"）、执行模式、目标单行预览、workspace。Run 页顶部固定：状态 + phase + 模式、模型 + workspace | 完整 objective 和配置：Inspect（CLI `display()`） | 持久状态与 live phase 分开显示；phase 只来自 live 读取 |
| unknown 占用、Run error、exit / stop 信息 | Board Run 行（error 红、unknown 黄）；Projects 和 Service 的 "Unresolved Runs" 段；Run 页顶部（error、exit code、stop reason）；unknown Run 页底部固定显示警告和恢复入口 | Recovery 表单显示完整 Run ID、workspace、确认项和 note | 使用 `! ? —`，不用成功符号；恢复后仍为 unknown |
| connection / stale snapshot / last read | 每页顶部右侧：`connected · read HH:MM:SS` 或 `! offline · last read …`；错误文字在固定顶部区 | Service 页：状态、地址、home | 断线只改连接显示，不改 Run 状态；窄屏只显示时间或 `! offline` |
| 写入目标 / pending / unconfirmed / 草稿 | Run 页底部：`Input goes to run xxxx only · not the Task inbox`；编辑器上方显示完整目标（Project / Task / 完整 Run ID）；footer 写明提交动作；pending 提示在固定区 | 结果不确定时，重试解锁控件在编辑器按钮区或底部区 | WriteGate 行为不变；草稿按目标保存在进程内；不自动重发 |
| Task instructions / status attribution / checkpoint | Task overview：说明全文、checkpoint 全文加来源和时间（左栏）；评估来源（顶部一行 + 侧栏）。Board：checkpoint 单行预览 | Checkpoint tab：来源 Run（完整 ID + Inspect 按钮）、本地保存时间、Show recorded time 展开完整 ISO、全文、"Git at checkpoint · historical, not current" | 预览在 Board，全文在 Task；原来的 JSON 输出改为字段显示，runId 保持完整 |
| Message 正文 / 来源 / 时间 / 分页 / count | Messages tab：`#id · source · run xxxx · 本地时间`，正文缩进显示全文；Board 显示 count | `Show recorded time` 展开完整 ISO；`Inspect sender Run / source Task` 查看完整 Run 和来源 Task；上一页 / 下一页 | count 标明 "count is not unread"；阅读不消费记录 |
| requested / startup observed 配置、capability 路径 / SHA、session ID | Run 顶部：provider / model | Inspect：Requested、Thinking、Context window、Output ceiling、观察说明、每个 capability 的路径和 sha256、Session | 与 CLI 相同；缺失显示 Not recorded / not observed |
| workspace Git / file 观察、branch / HEAD、时间 | Task overview "Current Git"：workspace、branch、HEAD、status 或错误、observed 时间 | Git tab：所选 workspace、observed 时间、输出；各 Run workspace 按钮、tracked diff、读文件 | 历史 Git（checkpoint）与当前 Git 分开标注；失败显示错误，不显示 clean |
| home / address / capacity / budgets / recovery | Board 顶部容量行（满时变黄）；footer `home slots`；Projects 页 Home 路径 | Service 页：state、URL、Home、Pi config、unresolved Runs、启停 | 容量明确标为 "shared by all Projects in this home" |
| activity / truncation / unavailable | Run 正文：输入、回复、`▸` 工具开始、`◂` 工具结束（带图例）；截断警告在顶部；不可用时显示警告 | pi-tui 的 "New activity / click to return to end" 回到末尾；Ctrl+Shift+F 搜索滚动正文 | 有限窗口，不称全文历史；搜索不覆盖固定区（身份信息同时在面包屑中） |

## 4. 验证

### 我运行过的（虚拟终端 / 隔离 fixture）

| 项目 | 命令 / 方法 | 结果 |
| --- | --- | --- |
| TUI focused | `node --test tests/tui.test.mjs` | 10/10 通过（原 8 项 + 新增 2 项） |
| 全套回归 | `node --test "tests/*.test.mjs"` | 80/80 通过 |
| 帧渲染 | `.local/tui-render.mjs`：临时 home、确定性 worker、6 个不同状态的 Task，15 个场景 × 4 种尺寸（180×50、120×32、80×24、40×20），另有 80×24 的 `--ascii` 无色版本 | 对照改造前后的同场景帧；ANSI 帧转成 HTML 截图检查配色 |

该轮新增回归测试覆盖：新块类型在 12 / 32 / 80 / 130 列下不越界（含 CJK 和 emoji），列表项、右栏和面包屑的点击命中；Projects 页不显示旧 Project；Board → Task → Back 恢复同一个滚动视图和选中项；Shift+Tab 从正文跨到顶部区、Tab 回到正文；矮终端时固定区并入滚动区；Run 页默认聚焦输入目标；编辑时编辑器上方显示完整 Run ID，底层页面的 Stop 按钮点击无效，worker 未被停止。

### Astra 审查后的修正

原测试仅验证同一 ScrollView 对象，没有覆盖 GET 等待中的 Loading 帧，也没有检查编辑时的顶部面包屑。现已修复并补充：

- 实际 layout renderer 中，Board 从第 50 行进入 Task 再返回，在读取等待期间和完成后都保持第 50 行；跨 Project 返回同样成立，其他 Project 不显示旧内容。
- 编辑期间正文和顶部面包屑都不可操作，草稿、输入目标及焦点保留；显式提交后面包屑重新可用。
- 40 列下 Message/checkpoint 提供完整 ISO 的展开/收起入口；同秒不同毫秒的两条 Message 可以区分；默认 metadata 换行保留秒数和 local 标签。

新增两项回归，并扩展原编辑测试；新的验证结果见 dogfood 文档的 review follow-up。原生 IME/鼠标体验仍不能由这些测试替代。

原有测试的一处调整：Board live phase 的断言改为检查实际渲染出的文档，匹配文字与改造前相同（`waiting for input / live snapshot`，ASCII 模式）。

### 未验证，需要用户在日常终端确认

中文 IME 的 composition 和候选框位置（编辑器现在位于屏幕底部）、真实鼠标的点击与拖选冲突、系统剪贴板、实际字体下 `● ❯ › ─` 是否单宽、配色和密度的观感、缩放和窗口操作。虚拟终端通过不代表原生终端体验通过。

## 5. 剩余问题

- Inspect 仍嵌入 CLI `display()`，标题、状态、Task 与顶部固定区重复。下一轮可以改成原生字段布局，但必须逐项保全 CLI 字段。
- 40×20 这类矮终端上，固定区会并入滚动区，Run 页跟随末尾时身份信息会滚走（面包屑仍显示 `run xxxx`）。
- 右对齐布局依赖终端报告的列数，以及模糊宽度字符按单宽显示。如果终端把模糊宽度字符当双宽，可以用 `--ascii`。
- 编辑器边框和滚动条来自 pi-tui，ASCII 模式下仍是 Unicode 线条（与改造前相同）。
- Task assessment 与部分 Git 观察的精确原始时间仍可从 CLI `--json` 查看；本次修正为 Message/checkpoint 增加了 TUI 内完整时间入口。
- `.local/start-tui.ps1` 的编码问题（无 BOM 的 UTF-8 被 Windows PowerShell 5.1 按 GBK 读取）本轮未修改。

## 6. 只读接口提案（未实现）

| 项 | 内容 |
| --- | --- |
| 体验问题 | Run 活动流无法显示每条回复或工具事件发生的时间。用户回来查看时，分不清哪些是刚发生的 |
| 缺失字段 | live 事件的 `at`（service 收到该事件时的时间） |
| 现有来源 | `run-live.mjs` 的 `add()` 在内存中构造事件时，可以附上 `new Date().toISOString()` |
| 时效 / 丢失 / 重启边界 | 与现有窗口相同：内存窗口，超出 256 条 / 256 KiB 后淘汰，服务重启后不可重建。它是 service 的接收时间，不是 Pi 内部时间 |
| 最小接口 | `GET /runs/:id/live` 的每个事件增加可选字段 `at`；客户端只在字段存在时显示 |

## 7. 用户手工检查清单

建议先用隔离 fixture（`node .local/tui-terminal-smoke.mjs`），不碰真实服务，也不调用付费模型。

1. 用平时的终端和窗口大小打开，看顶部上下文栏和底部提示栏，确认拥挤和密度的问题是否改善。
2. 在 Run 输入和 Task inbox 编辑器里用中文输入法：composition 是否正常，候选框是否跟随底部编辑器的光标。
3. 鼠标：点击面包屑（Projects、Project、Task）和列表项；在活动流和 Message 里拖选文字并粘贴，确认不会误触发动作。
4. 只用键盘：Board → Enter 进入 Task → Esc 返回，确认回到原来选中的 Task 和滚动位置；在列表顶部按 Shift+Tab，焦点应跳到顶部按钮区。
5. 在 Run 页调整窗口大小，缩到约 80 列和约 40 列，确认重要信息没有在横向丢失。
6. 检查 `● ❯ › ─ ▸ ◂` 是否单宽对齐；如果错位，试 `--ascii` 并反馈是哪个终端。
7. Run 活动中向上滚动，等新活动到来，确认出现 "New activity / click to return to end" 并能点击回到末尾。
8. 快速看一眼 `--no-color` 和 `--ascii`。
