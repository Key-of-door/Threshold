# Threshold terminal — design study 01

工作草案，2026-09-15。全部示例使用虚构 fixture；没有连接 service，也没有替换现有 CLI。外观不构成接口承诺。

建议方向：modern, calm, technical, slightly playful。让 Project/工作标题先出现，状态与异常次之，路径/ID/SHA 退后。品牌性格来自小脸和语气，不来自动画或大量彩色面板。

## 先做什么

先改善普通 CLI 的排版，再评估一个独立只读 TUI。它们共用标题、状态、详情和下一步的层级，普通 `threshold status` 继续一次输出后退出；TUI 的入口名称暂不决定。

不必假定“大众都喜欢 TUI”。这轮是候选设计，实际用户是否更容易找到任务、识别异常、知道下一步，仍要观察。

| 决定 | 理由 |
| --- | --- |
| 正文中性灰阶，少量青绿色作定位 | 大部分状态应安静；别让每个 worker 都有自己的品牌色 |
| 只用加重、空行、缩进与对齐形成层级 | 可以映射到真实终端，不依赖网页卡片、比例字体和细字号 |
| `ended` 中性；runtime error 明确标记 | Run 结束、退出码和 Task 工作评估是不同事实；不要借视觉升级语义 |
| 异常先说明已知事实，再给一个具体检查入口 | 不把 timeout 当零副作用，不默认建议重跑，不把技术错误转成授权请求 |
| 单次查询不显示 spinner 或“live” | 只有确实在更新的交互视图才能呈现动态状态；连接失效时应保留旧快照并说明更新时间 |
| 并行 worker 平铺，以 Task/objective/workspace 区分 | 不制造 parent/manager 层级；不把 tool 次数转换成进度条 |
| checkpoint 默认保留全文，Board 仅做预览 | 原始内容是自由文本，不能为了整齐假装有结构化“已完成/待办”字段 |
| Message 来源与正文分开，保留相互矛盾的消息 | 可以方便检查，不能由 UI 自动判定哪条正确 |
| capability 名称只是路径标签 | 展示实际选择的路径/哈希；selected 与 runtime 已确认加载分开，不声称隔离或权限保证 |

## Logo

用户提供的原标识保持不变。这次只试字符化的表现：

```text
 ╭────╮
 •  ●       threshold
 ╰────╯

(· ●)  threshold
(o O)  threshold   # ASCII fallback
```

三行版本保留断开的轮廓和不对称双眼，但圆环已经近似为圆角轮廓；它是终端变体，不是精确缩放。建议只在显式 help/启动处出现，TUI 用单行，普通查询、错误和 JSON 不加 logo。字符宽度与圆点形状由终端字体决定；不要求 Nerd Font，不自动改变用户字体。

网页预览用 JetBrains Mono（不可用则系统等宽字体）帮助比较；真正终端的字体和背景由用户控制。青绿色只是默认倾向，不保证各终端 ANSI palette 相同。

## 运行真正的终端原型

从 Threshold 仓库运行，无新增依赖：

```powershell
node docs/design/terminal-preview.mjs --help
node docs/design/terminal-preview.mjs board
node docs/design/terminal-preview.mjs error --mono
node docs/design/terminal-preview.mjs help --ascii
node docs/design/terminal-preview.mjs --tui
```

支持 11 个场景：help、empty、board、task、run、error、parallel、messages、offline、capabilities、startup。`--mono` / `NO_COLOR` 禁用 ANSI 色；管道输出不发颜色控制序列；`--ascii` 替换主要 Unicode 符号；`--no-logo` 隐藏标识。

TUI 原型只支持上下键/j/k、Enter 查看、Esc 返回、q 退出。退出视图不会停止 service/Run。真实终端版用于看字符与键盘，交互预览用于比较完整的视觉方向；尚未承诺全套终端 resize、宽字符测量、屏幕阅读器和所有键盘兼容性。

## 还没落实的展示能力

示例中的默认路径缩写、摘要长度、友好标签、全局 fallback 等属于设计提案。没有通用“异常来源”“最近活动”新字段，不能以本轮 mock 暗示这些接口已经存在。TUI 接入前还要核对每个展示值来自哪个现有读取结果。

若落实普通 CLI：优先 TTY/NO_COLOR、终端宽度降级、JSON 不受影响、复制命令和错误内容的可读性。若落实 TUI：只做查询/刷新/展开，先保留明确的 CLI 停止入口；不为交互视图建立自己的 Task lifecycle。

目前没有增加 core primitive，没有接真实 provider，也没有 push。设计是否值得采用，先由人看、用真实终端试，再决定。

本轮检查：11 个场景在浏览器预览中切换正常，无脚本错误；800px/360px、深浅背景已查看，窄宽度不产生水平溢出。TUI 键盘选择、详情、返回和退出已检查，真实终端也试过 j / Enter / q。单色/ASCII 输出及语法检查通过。该检查仅针对展示原型，不是对实际 service 集成的验证。
