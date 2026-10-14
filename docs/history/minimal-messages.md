# Minimal Message / Inbox 与一次协作观察

2026-09-13。实现基于 `339747f8fca06d8149a3a178fe8bbc8b0b046161`，验证使用本轮未提交 working-tree 源码。working architecture 仍为参考，不是 freeze。

## 实现范围

只新增 messages 表（schema v3）及 send_message/read_messages 两个 Agent tools、message send/read 两个 CLI 命令。Task 是第一版收件范围，Project 由 Task 归属确定；来源由服务绑定真实 Run。CLI 来源仅为 client，不是 Human 身份或授权。

消息持久追加，按 ID 分页；每页默认 10、最多 20 条，正文最多 6,000 字符。read_task 只提示 inbox 数量/最新 ID；正文按需读。读取不消耗消息或标记全局已读，cursor 由调用者传入。没有 named recipient、read_at、ack、通知、子 Agent、消息线程或自动启动 worker。

消息正文不改变 Task/Decision/受控操作权限。Checkpoint 记录运行停点，Message 保存具体协作内容；没有统一成新的记录 ontology。

`npm test`：7 项通过，包括迁移、重启、分页期间追加、重复读取、Task 隔离、真实 Run 来源、客户端不能用 JSON 冒充 Run、正文不能批准部署或完成 Task，以及 CLI 收发。

## D → E 实验

继续使用 `E:/test1/config-checker`，不造新缺陷、不要求 reviewer 必须找到 bug。C 之后的已关闭 DB 复制到 `E:/test1/message-collaboration/state`；A/B/C 的历史数据库和报告保留。D/E 使用 DeepSeek flash、Pi 0.85.1 和新的 --no-session worker。

| | D：只读 reviewer | E：独立复核与修改 |
| --- | --- | --- |
| Run | `0d2a45c1-edc9-4606-b2b1-0d4b12213796` | `d8da4f7e-df29-43f2-a67c-31a3590318d3` |
| Pi session | `01a099a6-f808-700c-ac9b-3e3f28e2eb8f` | `01a099a7-a122-7762-aa15-f86bfc9bae88` |
| 消息 | #1 review findings | #2 回复 #1，说明接受与保留项 |

D 读取 Task/inbox、Git、源码和测试，运行 review probes；文件哈希确认没有修改项目。D 没有报告确定缺陷，而是复现 BOM 文件被拒绝的行为，提出 BOM 兼容性/字符定义的不确定项及少量覆盖建议，然后用 checkpoint 指向消息。

D 和服务进程正常退出后，重启服务，E 从同一 Task 正常进入。没有给 E 传 D 的 conversation、完整输出、reasoning 或观察文件；现成 Project state 中保留正常 checkpoint。真实 read_messages 返回 #1，E 随后运行 Git diff、读取文件/测试并自行探测 BOM、字符与读文件错误行为。

E 在 loader 中增加“忽略开头一个 BOM”，保留纯 parser 的严格 JSON 行为；没有采纳字符定义的修改，也没有改写 JSON.parse 错误信息。它在 C 的 tests/load.test.mjs 后追加 BOM、ENOENT 和 CLI stderr 三项检查，通过 #2 回复理由。Task 状态/来源说明和 Decision 状态均未变。

## 独立检查与诚实边界

- 全项目测试 **14/14 通过**；原有独立行为检查 **8 组通过**。
- 另行核对 BOM 文件经 loader/CLI 成功、纯 parser 仍拒绝 BOM、BOM 后的坏 JSON 仍报错。
- parser、CLI 和 seed tests/fixtures 字节未变。C 的测试文件发生整文件哈希变化，但旧文件完整的 1,581 字节前缀保留，后面追加三项测试；没有削弱旧断言。原始 result.json 中 originalTestsPreserved=false 指整文件哈希变化，后续 verification.json 记录了这一细分核对。
- 消息两次读取均不消耗，服务再次重启后两条消息及真实 Run 来源保留。D/E session 不同，无 parent/child 关系。
- E 把 BOM 问题说成“违反 UTF-8 需求”，比现有 README 的明确约定更强。独立结果支持“新增 BOM 兼容行为有效”，不能据此证明旧实现确定违反需求。这里记录为 E 的兼容性选择，保留 D 原来的不确定性，不升级为 Human 语义裁决。
- 观察脚本最初只匹配字面 git diff，实际 E 用 git --no-pager diff；依据记录修正匹配后通过，没有重跑模型或改变运行事实。

## 八个产品问题

1. **独立理解与 review？** 本例成立；D 查看真实项目，且允许诚实报告无确定缺陷。
2. **消息有帮助？** E 实际读取 #1，围绕其中具体项目复核，并在 #2 对应回复。它有可观察用途。
3. **机械执行？** E 自行复现并选择性采纳，保留了字符语义方面的不确定性；不应夸大为已经证明能识别任意错误 review。
4. **重复调查/失忆？** 重复读 Git/文件和跑部分检查发生了，符合独立验证要求；没有重写 parser/CLI 或要求补背景。无对照，不能估计减少了多少调查成本。
5. **长度？** D/E 消息分别为 2,280 / 1,318 字符，有可核对内容，但既有行为复述和需求解释可以再短。Pi 收尾 context 约 17,665 / 18,481 tokens；累计调用 usage 为 115,225 / 168,339（含缓存读取，不等于单次上下文大小或收费金额）。没有对照，不能将全部开销归因于 Message，也不能宣称成本已经很低。
6. **字段够不够？** 此次 Task scope 足够；没有证据要求具名 recipient 或全局 unread。跨 Task/指定接收者尚未验证。
7. **比 checkpoint 自然？** 本例 review 正文与 continuation 停点明确分开，E 的回复可直接引用 #1，结构更清楚。这是产品观察，不是 checkpoint-only 对照结论。
8. **真实缺口？** 本次协作没有暴露阻断需求。暂不新增 ack、routing、角色或完整历史；等待实际使用再决定。

结论：**当前小消息能力已经支持一次真实、跨服务重启的 peer review → 独立复核 → 回复/修改。** 这次是一个小任务、同模型的观察，不证明长程协作或所有 reviewer 判断都可靠。期间无需 Human 重新解释背景；只有事前任务/工作目标和模型调用授权。

本地详细记录位于 `E:/test1/message-collaboration/`：result.json、D-tools.json、E-tools.json、verification.json、final.patch、E-added-tests.txt。final.patch 是从最初 seed 到当前的累计 Git diff，E 相对 C 仅修改 loader 并追加测试。日志为实验旁观记录，没有提供给 worker，也不进入长期项目 DB。
