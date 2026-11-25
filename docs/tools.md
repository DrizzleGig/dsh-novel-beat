# `beat_*` 工具参考（0.10.2 本地实现；0.11.0-dev 实验）

面向接账本的开发者和想弄清内部流程的作者。作者日常只需要 `/beat` 命令（见 README）和输入框上方的拍板台。

legacy 工具都接受两个公共参数：

- `dir`：工作区目录，默认当前工作区。同一本书在 `正文/` 子目录里调用也只认一份账本。
- `book`：书名或账本路径，默认当前工作区里唯一/最近的那本。

其余参数按章号（`chapter`）组织。**工具参数会随版本演进**，以会话里工具定义的实际 schema 为准；本页只保证语义准确。

## 0.10.2 拍板台与只读 voice 建议（未发布）

右栏章节详情读取 gate 状态前后值、EvidenceRef、打断理由和选项六要素。证据失效会显示具体错误并禁用回退/改选；`impact` 预览和 `rewind` 事务执行都会重新验证目标决策证据，因此直接调用 remote 也不能绕过此门禁。假分叉拒因只在进程内短暂缓存，按解析后的工作区、书名和章节隔离，不写到账本或可选选项。

回退 sheet 绑定预览 revision、正文原始字节 hash 与账本 hash，展示事务 ID/阶段、正文与账本成对快照、后续 stale 待办和隔离状态。发生 revision/hash 冲突时可刷新影响预览；恢复未完成或书已隔离时会禁止再次回退。弹层初次打开聚焦对话框，Tab 在弹层内移动，Escape 关闭并恢复原焦点。

voice 只读适配只读取已确认文风，生成贴合度说明和建议顺序，不写 gate、canon、风险、状态差分或作者选择。只有服务能明确报告本会话已启用、并能核对 profile 与 brief 的确认状态/版本时才应用；服务缺席、停用、超时、档案不可读或启用状态未知时都保留基线顺序并显示原因。当前 voice 0.2.2 公共只读服务没有会话开关接口，也没有人物画像专用接口，因此这版会对它安全降级，不读取未确认人物画像，也不依赖未发布的 voice 0.3.1。

本版未新增 remote 方法、未改 schema v3 或 0.11 loop 契约；本地实现未发布、未安装、未接 kit 或真书。

## 0.10.1 回退事务（未发布）

普通 `beat_revert` 与面板回退共用成对正文/账本事务。面板影响预览会绑定 `expectedRevision`、账本 hash 与正文原始字节 hash；作者确认后，提交路径在 per-book 锁内重读并重算影响。任一预览值变化时返回冲突，不写事务日志、快照或正文。

提交先记录独立事务日志，再保存正文与账本原始字节快照、校验暂存文件、依次原子替换正文和 `book.json`，最后回读 hash/revision/receipt。启动时每本书第一次读写前都会扫描非终态事务：确定的 before/after 状态恢复到完整 before pair 或确认完整 after pair；未知状态、快照损坏或恢复失败两次会写 `quarantine.json` 并暂停该书的写入。不能按文件时间戳猜测新稿。`rewinds/` 仍是旧线回看格式，不参与活动事务恢复。

回退提交成功后，后续章正文保持不变，并独立写 stale 标记；失败留 pending 并只重试标记。重写简报也在提交后构建，失败留 pending 并重试，不回滚正文或账本。事务 receipt 用 txId 幂等识别。本地锁只覆盖单进程；本轮未实现跨进程锁。

`segment-loop` 章节的 `beat_revert` 仍调用自己的 merge receipt 回退逻辑，不进入此双文件事务。

## 0.10.0 状态差分闸门（未发布）

普通章节的新候选必须包含 `gate`（稳定 `entity/key/from/to`、证据、reason、confidence）及选项六要素：`action`、`costs`、`outcomes`、`informationGain`、`risks`、`changes`。`key` 必须来自 schema 白名单。body/outline EvidenceRef 必须绑定当前文件 SHA-256、UTF-16 offset 和逐字 quote；失效时拒绝，不做模糊重定位。canon/author 引用也须与账本来源 quote 一致。

零候选扫描必须调用 `beat_plan` 并提供非空 `reason`；正文来自 `path`、`text`，或本章最近已登记段落的文件。没有这些来源时拒绝。可另传 `sourceRefs` 绑定大纲、canon 或作者回执。收据保存 `bodyFile/bodyHash`、相关账本输入 hash、`baseRevision/resultRevision`；正文或引用的大纲变化后要重新扫描。`beat_gate` 和 `beat_verify` 使用同一收据检查。只变化无关账本 revision 不会使扫描失效，重复同一扫描和验章不增加 revision。

拍板前，EvidenceRef 要与整个来源文件的原始字节 hash 一致；拍板后允许在原正文末尾追加。插件内部记录 `sourceLength`，逐字检查原前缀的 hash 和原 offset/quote，不允许模型传入该字段或靠重新定位放行。大纲始终要求全文件 hash 一致。新决策的输出通过 `beat_segment` 绑定；验章同时复核来源、实际输出段及传入正文的段落 hash，并在该段查找结果 ID 或显示 label。这个检查是确定性文本核验，不是语义审稿，`strict:false` 也不会放过新决策缺失的输出。

`beat_list(chapter)` 返回 gate、sourceRefs、完整 options/chosen 与 bodyBinding；`beat_compile` 保留六要素和证据，并标明已知事实与推演。作者自填/修改选项通过 `beat_decide(optionDraft)` 补足六要素并重新过闸，原 options 不覆盖；chosen 保存来源及字段差异。

正式注册的 `beat_plan` schema 与执行器强制新候选带 gate。为保留已有 0.11 实验契约，`toolDefinitions({segmentLoop:true})` 仍使用原候选格式；模块内部导出的 `executePlan` 默认允许历史调用，普通工具注册时显式传 `requireGate:true`。内部函数不是新的对外工具入口。白名单限制稳定键与 ID 格式；本轮不建立人物别名库，也不声称能自动判断任意自然语言是否语义等价。

迁移前账本通过现有原子写机制保存到 `book.json.bak`（后续成功写入会更新这份滚动备份），历史正文不重写。只读 service/remote 仅做内存迁移。schema v3 不能直接交给只支持 v2 的旧包；本轮没有实现成对正文/账本恢复事务。

模型只提出候选；闸门核验状态和证据；作者选择后才提交 canon。旧 v2 条目仍可读和参与旧流程，其 evidence 保持 legacy，不伪造 offset/hash。0.10.0 本地实现未发布。

## legacy 章节节奏

```
/beat on
  └─ beat_plan（走到岔路才登记，一次一个决策点）
       └─ beat_next（插件亲手问作者，一次一个）
            └─ 写这一段正文
                 └─ beat_segment（登记段落：快照 + hash + 回显）
                      └─ beat_plan（续写检查：后面还有没有真岔路？）
                           └─ … 循环到章末
                                └─ beat_verify（结构核对）→ verified
```

## 段落循环实验（未发布，默认关闭）

只有在启动 DSH 前将环境变量 `DSH_NOVEL_BEAT_SEGMENT_LOOP=1` 传给 beat 插件进程，才会注册 `beat_append` 和 `beat_finish`。默认值关闭。该开关只暴露本地实验工具，不代表 0.10.2 模拟 gate 已通过或允许发布。

章节首次通过 `beat_append` 建立为 `writingMode: segment-loop` 后，只能用新流程；同章不能调用 legacy `beat_segment`，已有 legacy 章节也不能切换。建议节奏：

```text
beat_append(text, operationId, expectedRevision)
  → beat_plan(最新 segmentId / segmentHash / expectedRevision)
       ├─ beats: [] + reason → 已记录 no-candidate 检查
       └─ 一个候选 → beat_next 等作者 → 下一次 beat_append 绑定已选决策
  → 重复，直至章末
  → beat_finish(expectedRevision) → 原样将返回的 text 交给 beat_verify(text)
```

`beat_append` 每次只接受一个非空自然段，并返回 segment ID、连续序号、Unicode 字符数、规范化文本 SHA-256、operationId 和账本 revision。它要求上一段已有有效决策或带理由的 no-candidate 收据；缺收据返回 `segment-check-required`，有尚未作者确认的决策返回 `pending-decision`。同 operationId + 同章节/原文重放返回原 receipt；同 ID 异 payload 返回 `idempotency-conflict`。过期 `expectedRevision` 返回 `revision-conflict`。

`beat_finish` 要求所有当前段都经过有效检查、无待选决策且 seq 连续；它以 seq 升序、两个 LF 拼接，无首尾修饰，并返回全文、ordered segment IDs、每段 hash、chapter hash、字符数及 merge receipt。合并 artifact 存在 beat 自有 `.dsh-novel-beat/<书名>/merges/`；章节文件仍由 kit 写。重复 finish 返回原 receipt。回退时 `beat_revert` 接受 loop 段 `segment` 与 `expectedRevision`，只调整账本段状态、使下游收据和 merge 失效，不截正文文件。

该实验复用现有 `beat_plan`、`beat_next`、`beat_revert` 和 `beat_verify`；`beat_plan` 的段落检查需要当前 `expectedRevision`、`segmentId`、`segmentHash`。合并前 `beat_verify` 返回 `not-merged`；合并后必须把 `beat_finish` 返回的全文原样作为 `text` 提交，否则以 `merge-mismatch` 拒绝。legacy 章原有 `beat_segment` excerpt/marker 区间语义不变。

开关关闭时，除隐藏新工具外，所有对现存 loop 章的 plan/next/decide/revert/verify/adjust 写入口也会返回 `feature-disabled`。段落与合并 artifact 是分步落盘；本实验不承诺跨文件故障自动恢复、跨进程锁或 kit 共享写入安全。

## 工具一览

| 工具 | 什么时候用 | 主要参数 |
|---|---|---|
| `beat_plan` | 走到真正的岔路才登记，一章多次调用、每次一个。也用来做「续写检查」。 | `chapter`、`beats`、`append`、`reset`、`forkId` |
| `beat_next` | 让插件亲手把下一个决策摆给作者，一次只问一个；作者选完由插件自己落账（`origin=author`）。 | `chapter`、`confirmCanon` |
| `beat_segment` | 登记刚写完的这一段：存快照、算区间与 hash、挂到已拍板的决策上，登记成功回显正文。 | `file`、`decisionIds`、`excerpt`、`fromMarker`、`toMarker` |
| `beat_revert` | 安全回退：退第 N 段并在它的起点截断正文，这一段和其后所有段一起作废。 | `segment`、`mode`、`confirm` |
| `beat_fork` | 作者主动插一条岔路（模型漏判时）。 | `text` |
| `beat_list` | 查账本：全书概览 / 本章决策与选项 / `context:true` 看 canon、未回收义务和最近决策。 | `chapter`、`onlyPending`、`context` |
| `beat_decide` | 兜底入口，只在宿主没有提问服务时用；有提问服务时会被拒绝（`use-beat-next`）。 | `id`、`choice`、`changes`、`note`、`supersede`、`reason` |
| `beat_gate` | 写正文前体检：不传 `ids` 按整章判，传了只判本段。 | `ids` |
| `beat_compile` | 把本章已拍板决策编译成写作约束（必须发生 / 不得出现 / 义务 / 全书 canon）。 | `format` |
| `beat_verify` | 写后校验：证据是否出现、是否踩禁项、到期义务有没有回应；通过后盖章 `verified`。 | `text`、`path`、`strict` |
| `beat_adjust` | 作者主权动作：`waive` 放弃义务、`supersede` 推翻旧决策，都必须写 `reason`。 | `action`、`id`、`reason`、`changes` |

## 常见拒绝码

工具拒绝时一般会带一个明确的 `code`，按码处理比读整段报错快。

| code | 含义 | 下一步 |
|---|---|---|
| `one-at-a-time` | `beat_plan` 一次给了多个决策点 | 一次只登记一个 |
| `segment-required` | 上一段还没登记成段落 | 先 `beat_segment` |
| `segment-check-required` | loop 段没有有效的段后检查收据 | 用 beat_plan 检查最新段 |
| `pending-decision` | loop 章有待作者选择或待登记的决策输出段 | 先 beat_next 等作者，或登记已选输出段 |
| `one-paragraph-only` | loop append 为空或含换行、多段边界 | 拆成单段后重试 |
| `idempotency-conflict` | operationId 已用于不同段落内容/章节 | 刷新账本，使用新的 operationId |
| `chapter-already-merged` | 当前合并后仍尝试追加 | 先按段边界回退再重写 |
| `not-merged` | loop 章节还没有有效 merge receipt | 先完成所有段检查，再 beat_finish |
| `revision-conflict` | expectedRevision 已过期 | 读取最新 revision、段 ID/hash 再重试 |
| `feature-disabled` | 段落循环实验开关未启用 | 在本地启动插件前开启实验开关 |
| `chapter-mode-conflict` | 同章混用了 legacy 与 segment-loop 工具 | 按本章已固定的模式继续 |
| `write-ahead` | 正文里有没登记成段落的字 | 先 `beat_segment`，或删掉多写的 |
| `unit-gap` | 这一段没接在拍板时的位置 | 从锚点开始登记，别跳过中间正文 |
| `prefix-rewritten` | 已登记的正文被改过 | 先 `/beat revert` 回到改动处 |
| `gate-mismatch` | 这一段挂的是别的决策 | 一段只对应它自己那一次拍板 |
| `cannot-locate` | 回退时按快照定位不到原文 | 一个字都不动，人工处理 |
| `fork-required` | 作者插的岔路还没被写成决策点 | `beat_plan` 带 `forkId` |
| `use-beat-next` | 有提问服务时调了 `beat_decide` | 改用 `beat_next` |
| `PENDING_DECISIONS` / `CONTINUATION_CHECK` | 闸门拦写正文 | 先拍板 / 先回答续写检查 |

## 相关文档

- 账本字段与事件流：[`adapter-contract.md`](./adapter-contract.md)
- 调度器协议：[`conductor-adapter.md`](./conductor-adapter.md)
- 架构概览：[`architecture.md`](./architecture.md)
