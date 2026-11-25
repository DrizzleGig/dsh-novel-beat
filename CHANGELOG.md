# Changelog

## 0.11.0 — 发布（2026-11-25）

**范围说明：** 0.10.0 / 0.10.1 / 0.10.2 均未单独发布，其内容全部并入本版；本节的验收范围是 0.10.x 已有的闸门/事务/拍板台，加上 0.11.0 新增的作者自定拍板、文风写法基线与右栏视觉。旧条目保留在下方作历史。

### 新增

- **作者自定拍板**：提问卡最后一行可写自己的走向。原文立即入账（`answerText` + `pendingCustom`），并标记 `author-custom`；未补结构化 `changes` 前写正文会被闸门以 `PENDING_STRUCTURED_CHANGES` 拦下。右栏的决策地图/时间线/详情标「作者自定」并显示原文；回退归档保留原文与 changes。
- **voice 选项写法基线**：`beat_plan` / `beat_next` / `beat_segment` / `beat_append` / `beat_verify` 的成功结果附带 `voiceGuidance`（≤1200 字文风摘要 + `profileId/profileVersion/revision/digest`，不可用时带 `reason` 与中性说明），模型据此写选项的切入点、语气与代价感。新增 `/beat voice auto|off`。
- **右栏视觉重做（不改信息架构）**：批校本设计令牌、衬线标题与字号阶梯、语义色（朱砂/青玉/赭石/墨灰）、浅暗双主题、章节 folio、决策卡与详情/回退 sheet 的间距与层级；新增「作者自定」「段落模式」徽标。
- **段落循环收口**：`DSH_NOVEL_BEAT_SEGMENT_LOOP=1` 下的 `beat_append` / `beat_finish` 随包发布，仍默认关闭；面板显示段落模式与合并 hash。

### 变更 / 修复

- 会话设置改为合并写入：`setSessionMode` 不再清掉 `bodyRoots` 与新增的 `voice` 偏好。
- 面板的 voice 贴合与模型侧 `voiceGuidance` 使用同一套可用性判断，不再出现"面板说未接入、模型却能读到文风"的分裂。
- **同意信号的反转（有意为之）**：0.10.2 要求 voice 暴露 `isEnabled`，但 voice 0.2.2 没有，导致文风永远降级。0.11.0 改为"存在已确认档案即视为同意"，关闭出口在拍板侧（`/beat voice off`）；风险写在此处，不藏。
- 面板章节投影新增 `writingMode` / `mergeHash` / `mergedAt`。

### 测试

- `npm test`：**417/417**（新增自定义拍板 pendingCustom、`PENDING_STRUCTURED_CHANGES`、voiceGuidance 可用/关闭/超时/旧档、会话开关持久化）。
- 段落循环专项 30/30；check / panel / pack 见发布记录。

### 已知边界

- 真书实测、真实崩溃恢复 UI 未执行；不能把模拟或工具级故障注入写成真实书结论。
- 段落循环默认关闭，发布后才做真书验证；loop 章仍走旧提案口径（不带 v3 证据闸门），已列为已知问题，发布后补强。
- voice 0.2.2 没有人物画像接口与跨进程会话开关；beat 只读已确认档案。
- 未实现跨进程锁；同一本书默认一次只走一套写流程。

## 0.11.0-dev — 已并入 0.11.0（历史）

- 新增默认关闭的 `DSH_NOVEL_BEAT_SEGMENT_LOOP=1` 实验开关，以及隔离旧章语义的 `beat_append` / `beat_finish` 源侧工具。
- 本地实现范围包括自然段 append、段后检查/作者暂停、幂等与 revision 冲突、确定性合并收据、段边界回退和 merge verify；artifact 只写 `.dsh-novel-beat/<书名>/`，不写章节文件。
- 不接 kit UI/共享章节写入，不发布、不推送、不在真书中运行。正式发布门仍要求0.10.2模拟与0.11测试通过；真书实测在发布后。

## 0.10.2 — 并入 0.11.0（原定单独发布，未单独发）

- 修复模拟 P1：回退预览继续返回精简 projection；事务提交时从当前决策 options 取完整 v3 选项并经 `validateSelectedOption` 重验，避免六要素在 `chosen` 中丢失；当前作者自定义选择也保留其完整快照与来源标记。0.10.2 尚未发布，本轮原版本号修复。
- 补齐右栏决策详情：展示 gate 状态前后值、打断理由、可回查 EvidenceRef 和选项六要素；证据失效时禁用面板回退/改选，并在 remote 预览与事务提交前重新验证，防止绕过 UI 落账。
- 回退 sheet 展示预览 revision、正文/账本 hash、事务 ID/阶段、成对快照、stale 待办及只读隔离态；完善加载时焦点、Tab 环绕、Escape 关闭和冲突/隔离刷新提示。
- voice 只读适配只为合格选项加贴合度说明与建议排序，不写 gate、canon、差分、风险或作者选择。只有能确认本会话已启用、档案已确认且版本可读时才应用；当前 voice 0.2.2 服务缺少本会话开关和人物画像接口，会自动回到基线顺序，不依赖未发布 voice 0.3.1。
- 假分叉拒因只存短时内存缓存，并按解析后的工作区、书名和章节隔离；拒收候选不会写入账本或有效选项。
- 未新增 remote 方法或修改 schema v3 / 0.11 loop 契约；未安装、未发布/推送、未接 kit 或真书。

## 0.10.1 — 并入 0.11.0（历史）

- 新增 schema v3 成对正文/账本回退事务：独立事务日志、原始字节双快照、暂存校验、原子替换、回读 hash 与账本 receipt。
- `beat_revert` 与面板 `rewind` 共用 per-book 事务服务；锁内重读 revision/hash 并重算回退计划，冲突不落事务副作用；旧 `rewinds/` 快照仍按历史格式只读。
- 增加按书启动恢复、幂等回滚和 quarantine fail-closed；隔离书的账本写入与受保护正文写入均被阻止。
- 后续章节 stale 标记与重写简报是独立待办，失败只保留 pending 并重试，不回滚正文/账本；0.11 loop revert 继续使用独立路径。
- 未实现跨进程锁；未接 kit、真实 DSH 或真书，未发布/推送/安装。

## 0.10.0 — 并入 0.11.0（历史）

- 账本 schemaVersion 升至 3，逐版迁移 v1→v2→v3 与 v2→v3；旧决策、选项、拍板、canon、义务、段落、修订和正文不重写，旧证据标为 legacy，迁移前账本留存 `book.json.bak`。
- 新增状态差分/证据闸门：稳定 ID、状态键白名单、EvidenceRef 的 SHA-256/UTF-16 offset/quote 校验、重复/no-op/作者已决定/假分叉拒收，以及选项六要素。
- 空候选扫描需理由并绑定正文 hash 与相关输入；`beat_gate` 和 `beat_verify` 校验同一收据。模型只提案，作者选择后才提交状态。
- 保持 0.11 默认关闭的实验工具和章节模式；不包含 0.10.2 UI/voice、kit、真书和发布。

## 0.9.2 — 2026-11-21

- 接管：工具门与 `refreshAgent` 改用 `effectiveOn`；订阅 `novel-conductor/drive` 刷新该会话三层（modeCache / L1 技能 / L2 提示 / L3 guard）。
- `/beat status` 增故事总控说明。
- 新增 `lib/tool-schema.mjs` + `test/tool-schema.test.mjs`（参数 schema 守卫）。


## 0.9.1 — 2026-11-20

**文档修正：README 换成写作者能读的语言，功能与 0.9.0 相同。**

### 修改

- README 开头与 v0.9 功能改从写作场景出发，不再在作者向正文里堆 `revision` / `commitId` / 服务接口等术语；技术细节集中到「技术信息」。
- 作者侧命令、FAQ 与数据安全说明同步改成日常说法。
- `package.json` 把 `CHANGELOG.md` 加入发布文件，README 里的变更记录链接在 npm 上也能打开。

### 测试

- 与 0.9.0 相同的 `node --test` **257/257**；无代码变更。

## 0.9.0 — 2026-11-20

**主题：可信账本——真实 revision、单一提交边界、只读服务与事件、时间线/体检/搜索、朱批纸本 UI。**

### 新增

- **真实版本**：`book.revision` 单调 +1；所有写事务走 `mutateBookData` 提交边界；`commitId = "<书>#<revision>"`；回退接受 `expected_revision`，冲突返回 `revision-conflict` 且正文不动。
- **只读服务**：`novelBeat` 提供 `identity/getStatus/getRevision/getCanon/getArtifact/onDidCommit`；成功落账后发 `commit.events`（失败不发）。
- **时间线**：`buildTimeline` 合并 plan/fork/commit/segment/revert/verify/waive/override/stale/check；`timeline` remote + 右栏真实视图。
- **章末体检**：`buildHealth` 输出 OPEN_DECISION / AWAITING_SEGMENT / PENDING_CONFIRM / NEEDS_CHECK / DRIFT / UNSEGMENTED / OVERDUE_OBLIGATION / STALE / NO_ANCHOR / TEXT_UNAVAILABLE；`health` remote + 右栏视图。
- **搜索**：`buildSearch` 检索决策 / canon / 义务，支持 q/entity/status/chapter/limit；右栏搜索框与结果跳转。
- **重写工单**：`buildRewriteBrief` 把回退后的续写指令变成四类硬约束 + 软信息，超限只砍软信息；接入 `resume.prompt`，上限 1200 字。
- **UI**：右栏改为「朱批纸本 / Ink & Vermilion Ledger」：暖纸、墨字、朱砂、玉色已落账、琥珀待处理；浅/深色；地图/时间线/体检三视图。

### 修正

- `gateFromBook` 先判 `answered + pendingChoice` → `pendingConfirm`，再判 `open`；guard 行为不变。
- `tools.result` 改为 `(exec, result)` 真实双参；旧测试用真实双参。
- 0.6→0.7 迁移初始化 `revision`；`beat_segment` 返回整数 `revision` + `revisionRecord`。
- 体检 `answered` 无 `pendingChoice` 仍算 OPEN_DECISION，避免"0 阻断但写不了"。

### 兼容与边界

- `schemaVersion` 仍为 2；0.6 v1 账本读时迁移；0.7/0.8 账本可直接打开。
- 仍**不写正文**；回退只在作者确认后截断，旧正文留档。
- 可选字段未做：`task_context` / `idempotency_key` 留给 0.9.1；conductor 0.1 不需要它们。

### 测试

- `node --test` **257/257**；新增 event/revision/service-v09/timeline/health/search/rewrite-brief 测试；`npm run check`、`git diff --check` 通过。

## 0.8.0 — 2026-11-17

**主题：右栏「拍板台」——按章看决策、影响预览、安全回退、侧栏改选。**

### 新增

- **右栏「拍板台」**：官方 `sidebarRightTabs` / `sidebarRight` 槽位；会话头入口；按章手风琴 + 决策卡 + 同栏详情；空态/加载态/错误态；420px 适配。
- **读模型**：`beatMode.overview` / `beatMode.chapter`；按章统计、章标题推断、旧账无锚点标记、轻量回退影响。
- **影响预览**：`beatMode.impact`；给出删多少字、作废几段、撤回几条 canon、目标重落账、后续哪些决策重开、哪些章节不受影响。
- **安全回退**：`beatMode.rewind`；保留选择或改选另一个走向；回退前存 `rewinds/<id>.md` + `.json`；正文/账本失败整体恢复；`revision(kind='revert', reopen=true)` 追加式保存。
- **续写入口**：`beatMode.resume`；优先调用宿主 `sessionController.prompt` 把续写指令发回会话；失败降级为复制文案。
- **侧栏改选**：作者点击选项 → 回退 + 目标重新落账 + 后续决策 `proposed`；凭据仍是 `origin:'author'`。

### 安全边界

- 无正文锚点的决策拒绝回退；正文 hash 不一致时侧栏拒绝，不自动重定位（`/beat revert N!` 仍是聊天内显式路径）。
- 不升 schemaVersion；旧 v0.7 仍可读 v0.8 账本。
- 不做跨章静默级联；第 11、12 章明确提示仍基于旧走向。

### 界面与主题

- **拍板台改用 DSH 主题 token**（`--dsw-alias-label-primary/secondary/tertiary`、`border-l*`、`state-*`、`bg-*`），浅色与深色主题都跟随宿主，不再写死深色值。此前写的 `--dsw-alias-text-primary` 等变量名在宿主里并不存在，浅色主题下会落到兜底色，白底上是 #e8e9ec 的浅灰字（对比度 1.2:1）。
- **三级文字层次**：正文 18.9:1、次要 5.8:1、注释 3.7:1（浅色主题实测）；状态色另做 ink 版（压向正文色），已拍板 / 待拍板 / 警告小字不再发白。
- 分隔线、抬升层、软底色改用 `color-mix` 跟随文字色，深色主题同样生效；旧线正文改用正文色，长段阅读更清楚。

### 测试

- `node --test` **147/147**；新增 `panel` / `rewind` / `resume` / `remote-contract` / client 侧栏注册测试。
- 真实账本只读副本：12 章 / 35 决策 / 5 段 / 6,759 字；b10-2 回退 = 1,222 字 / 2 段 / 4 条 canon；正文 833 字；revision 追加。
- 浅色 / 深色两套主题下用真实 token 服务端渲染拍板台并截图核对对比度。

## 0.7.0 — 2026-11-15

**主题：从"靠模型自觉的工具集"变成"引擎兜底的决策事务"。开着就一定走流程。**

**共同作者：[MiyueWinter](https://github.com/MiyueWinter)** — 文案、测试、设计与开发。

### 已完成（M1–M4）

- **账本升到 schemaVersion 2**：新增 `segments` / `revisions` / `requests` / `tasks`；决策多了 `status`（`proposed`/`asked`/`answered`/`committed`/`superseded`/`cancelled`）与凭据字段。读 0.6 账本时自动迁移，原文件备份为 `book.json.bak`。
- **作者作答凭据（receipt）**：`committed` 的决策必须指向一条 `requests[]` 记录。引擎亲手问到的答案记 `origin:'author'`；由模型转述的老路径记 `origin:'model-relayed'` 并留 `relayedBy`——不冒充作者。
- **`beat_next`（新）**：插件自己去问作者，**一次只问一个决策**；问完帮你落账。上一条还没用 `beat_segment` 登记成段落时，它会拒发下一个（`segment-required`）——这就是"写一段、问一个、再写下一段"的节奏闸。作者写了自己的答案但没给结构化变化时，转成"待补"（`answered`），不编造 canon 变更。
- **三层强制**：`/beat on` 后 ①技能只在这个会话出现 ②系统提示常驻节奏规则 ③写 `正文/` 的工具调用被 guard 拦。**判定只看"这一章还有没有岔路没问"**：有 → `PENDING_DECISIONS`（先 `beat_next` 问一个）；没有 → 放行（允许先写开场、也允许写完这一段再问下一个）。`/beat off` 三层全撤。
- **按章判**：写 `第N章…md` 时按文件名的章号核对那一章的决策，修掉"新开一章不登记决策也能写"的漏洞。
- **`beat_gate` 闸门下放到本段**：传 `ids` 只对本段判，不传按整章判。
- **工作区根锚定**：同一本书在 `正文/` 子目录里调用也只认一份账本。
- **`beat_plan` 一次只收一个决策点**（多给报 `one-at-a-time`）：按章批量规划会把"岔路"变成按模板填空——真实账本里每章恰好 3 条、第三条总是"章末钩子"就是这么来的。写到那个岔路才登记。
- **`beat_segment` 回显正文**：登记成功时把这一段正文（≤600 字预览 + 总字数）一起返回，卡片直接显示，作者不用去翻文件。开场/过渡段可以不带决策点，但要显式给范围。
- **`beat_revert` 改成级联回退**：退第 N 段 = 正文截断到它的起点，**第 N 段及其后所有已登记段一起作废**，canon/义务按倒序还原，一条 `revision(kind=revert)` 记下 `revertedSegments`；返回的话就是"从第 X 字重写"。不再需要 `force`，也不会留下"正文没了、段落还挂在账本上"的僵尸段。
- **新增命令 `/beat list [章]` 与 `/beat revert [段号]`**：作者自己就能列段落、退一段重写（不传段号=最后一段）。
- **作者自定义答案的死锁已修**：作者在卡片里自己写答案后，决策停在 `answered`；现在允许 `beat_decide` 为这一条补结构化 changes 落账，否则它永远到不了 `committed`、第 2 段起全部登记不上。
- **证据匹配归一化**：`beat_verify` 匹配 evidence 前做 NFKC、去空白/零宽/markdown 标记/标点、小写——全角半角、引号、省略号差异不再误判。
- **`beat_segment`（新）**：把刚写完的这一段登记成段落——存快照到 `revisions/<id>.md`、算区间与 hash、挂到决策点上；不给位置就接在上一段之后。同一决策只能被一个未回退的段落占用。
- **`beat_verify` 两道新提醒/闸**：已登记段落被改过 → `drift:<段落>`；正文里有没登记成段落的字 → `unsegmented:<区间>`（后者意味着这段退不了）。一章一条决策都没有时拒绝盖 `verified` 章（`NO_TASK`）。
- **`beat_decide` 降级为兜底**：宿主有提问服务时它直接拒绝（`use-beat-next`），防止模型绕过"插件亲手问作者"；唯一例外是作者刚在卡片里自己写了答案（`answered`），那时必须由它补齐结构化 changes。

### 回退安全（P0，按 ChatGPT 评审修）

- **`beat_revert` 不再"漂移也硬截"**：正文被手工改过、旧 offset 失效时，先按登记时的快照原文在正文里重新定位——
  - hash 完全对得上：直接退；
  - 能唯一定位到新位置：要求 `confirm:true`（命令里写 `/beat revert 3!`）才动正文；
  - 定位不到 or 同一段原文出现多次：**直接拒绝**（`cannot-locate`），一个字都不动，让人工处理。
  这样"作者改过的内容被截掉"这种事不会发生。

### 作者插岔路（P1）

- **新工具 `beat_fork` + 命令 `/beat fork <要决定什么>`**：作者比模型清楚哪里该有岔路，可以直接插一条（账本 `forks[]`，状态 `open`）。
- 插了之后模型必须先 `beat_plan(…, forkId: 'f-x', beats: […])` 把它写成决策点，否则 `beat_next` 拒发新题（`fork-required`）、`beat_plan` 不带 `forkId` 也拒（`fork-required`）。登记后岔路变 `planned` 并挂上 `decisionId`。
- `beat_list`（带 chapter）会列出本章待处理的岔路；老账本没有 `forks` 字段照读。

### 第 11 章实测三问（P0/P1，按作者 ChatGPT 评审修）

- **冲突选项不再硬失败**：作者选的选项和 canon 对不上时，不再 `canon-conflict` 把选择丢掉——先把选择存成
  `pendingChoice`（`status=answered`），返回"先问作者能不能改这个设定"；作者同意后 `beat_next(confirmCanon: true)`
  覆盖 canon，并记 `canon-overridden` 警告与 `audit.canonOverride`。没确认前 canon 不动、也不写凭据。
- **续写检查**：`beat_segment` 登记完一段就置 `chapters[N].continuationCheckRequired`；下一次写正文前
  必须用 `beat_plan` 回答一次"后面还有没有真岔路"——有就登记这一个（`verdict: fork`），
  没有就 `beat_plan(beats: [], reason: '…')`（`verdict: no-fork`，不造假决策）。没回答前 guard 拒写
  `[CONTINUATION_CHECK]`。不设段落字数配额。
- **`reset` 语义修正**：先清掉本章未拍板的决策（fork 放回 `open`）、保留已拍板的决策与它们的 canon 结果，
  再查重名——于是 `reset:true` 可以用原标题重建；新决策分配**新 ID**（`counters.decisions.<章号>` 高水位），
  不复用被 reset 掉的编号。
- **待确认时不许往下写**：作者选了会改设定的选项但还没回答"是否允许改设定"时，guard 拒写
  `[PENDING_DECISIONS]`（`chapters[N].pendingConfirm`），避免模型趁确认前把下一段写了。

### 作者侧入口（P2）

- **拍板台**：输入框上方一条状态条（只在 `拍板：开` 时出现）——显示"第 N 章 · K 段 · 最后一段 X 字"，
  带「重写这一段」（= `/beat revert`，级联作废）与「刷新」两个按钮，不用记段号。
- remote 服务 `beatMode` 新增 `panel(sessionId)` 与 `revertLast(sessionId)`；按钮与命令走同一份实现
  （`revertLast` 内部执行 `/beat revert`）。

### 写作单元闸（第 7 条回归：整章一次写完再回头问）

- **闸 A（`write-ahead`）**：拍板之前、登记新决策之前，正文里不许有"还没登记成段落"的字。
  模型要么先把上一段 `beat_segment` 登记，要么把多写的删掉——"先写完整章、再回头问作者"从此走不通。
  入口统一放在 `beat_next`（提问/提交）与 `beat_plan`（登记新决策）两处，不只靠 guard 拦写入。
- **闸 B（`unit-gap` / `prefix-rewritten` / `gate-mismatch`）**：拍板成功时记一道**闸门**
  `chapters[N].gate = { file, offset, prefixHash, decisionIds, at, consumed }`；
  下一次 `beat_segment` 必须正好从闸门锚点开始、锚点之前的正文 hash 没变、并且只挂这道闸门授权的决策。
  登记成功即消费（`consumed: true`），同一道闸门不能被重复使用。闸门只能由"拍板"创建，普通写入改不动它。
- **`beat_verify` 粒度诊断（只提醒，不阻断）**：`coarse-unit:<段落>`（一段占本章 >60% 且整章 >1500 字）、
  `thin-forks`（整章 >1500 字却只问了 ≤1 个岔路）——把"节奏塌了"变成数字，而不是新加一条硬规则。
- **边界写清楚**：这三条是**工具面内的协议**，不是系统级沙箱——模型绕开工具（shell 重定向、外部编辑器）写正文，
  guard 与闸门都看不见；那种情况只能靠 `beat_verify` 的 `unsegmented` / `drift` 事后发现。

### 扩展窗口（M5）

- **进程内只读服务 `novelBeat`**：`ctx.provide('novelBeat', …)`，面上只有
  `version` / `isOn(agentId)` / `resolveBook(cwd)` / `query({cwd, book, chapter})` / `onDidCommit(cb)`，
  **没有任何写入入口**——兄弟插件只能读账本、不能替代作者拍板。`onDidCommit` 在 `beat_next` / `beat_decide` /
  `beat_segment` / `beat_revert` 之后发出 `{ kind, tool, book, chapter, ids, at }`。
- **`docs/adapter-contract.md`**：`book.json`（schemaVersion 2）的文件契约——字段、状态枚举、
  凭据 `origin` 的三种来源、段落偏移与有效段落判定、读的时候的 5 条注意事项。
- **`docs/conductor-adapter.md`**：Conductor 适配协议在 0.7.0 **冻结**——权责边界四条、
  `task_context{task_id, project_id, branch_id, correlation_id}`、修改类调用必须带
  `idempotency_key` + `expected_revision`、统一八态返回（`accepted|running|needs_author|blocked|ready|completed|failed|cancelled`）。
- `package.json` 版本号 0.6.1 → **0.7.0**，`files` 增加 `docs`；插件版本由 `index.js` 从 `package.json` 读取，发布只改一处。

### 验收

- `node --test`（workdir `D:\插件\plugins\novel-beat`）：**126 tests / 126 pass / 0 fail**。
- 模拟链路 `D:\插件\tmp\beat-v07-spike\sim-rhythm.mjs`：**15/15 通过**（含第 7 条回归两条：整章写完再登记 / 再问作者都会被 `write-ahead` 拦）。
- 安装形态：`link:D:/插件/plugins/novel-beat`，重载走 `set_bundle(false)` → `remove_bundle` → `install_bundle`。

## 0.6.1 — 2026-11-13

**主题：文案改成写给小说作者的说法，功能不变。**

### 变更

- README 重写：面向小说作者，先讲处境与用法，安装和技术细节后置；新增前言、目录、常见问题、「喜欢它？」与许可证段。
- 市场卡片描述改成「AI 写着写着就替你决定了剧情？」这一版；英文卡片同步。
- `package.json` 的 description、`locale/zh.json`、`locale/en.json` 的描述同步成同一套说法。
- README 的三枚徽章（npm / license / stars）加上跳转链接；正文里的「GitHub」「Issue」「LICENSE」改为可点击链接。

### 说明

- 无代码变更；七个 `beat_*` 工具、账本格式、门控逻辑与 0.6.0 完全一致，升级不需要迁移，也不动已有数据。

## 0.6.0 — 2026-11-07

**主题：独立的全书账本 + 写后校验 + 会话级开关。**

### 新增

- **全书账本**：`<工作区>/.dsh-novel-beat/<书名>/book.json` 单文件，含 `decisions`、`canon`、`obligations`、`chapters`、`audit`；tmp → `.bak` → rename 原子写，per-book 队列串行化。
- **7 个工具**：`beat_plan`、`beat_list`、`beat_decide`、`beat_gate`、`beat_compile`、`beat_verify`、`beat_adjust`。
- **结构化分叉**：每个选项必须带 `changes`（entity / key / from / to / evidence），不同选项的 changes 必须不同；只换措辞的假分叉会被拒绝。
- **拍板落账**：`beat_decide` 写 canon + obligations；canon 冲突硬拒，合法状态推进（`from` 与当前值一致）放行；改主意用 `supersede:true` + `reason`。
- **写后校验**：`beat_verify` 接收 `text` 或工作区内 `path`（`.md`/`.txt`，≤2 MB），检查每个变化的证据、禁项、到期义务；`pass` 才把本章标为 verified。
- **会话级开关**：默认 `off`；`/beat on|off|status`；composer 左侧「拍板」按钮（Typert remote `beatMode`）；关掉用 `agent.ctx.tools.restrict` 把 `beat_*` 从当前会话隐藏，其他会话不受影响，数据保留。
- **0.5 迁移**：首次访问自动把 `chNNN.json` 转成 `book.json`；旧拍板保留为 `legacy` 决策，旧文件移到 `legacy/`，不删除、不反推 canon。

### 变更（破坏性）

- 数据从「每章一个 `chNNN.json`」变为「每书一个 `book.json`」；自动迁移，旧文件进 `legacy/`。
- `beat_plan` 的选项现在必须 2–4 个且每个都带 `changes`；1 个选项或重复 changes 会被拒绝。
- `beat_compile` 默认输出 `format:'self'` 的自包含契约；旧的 `## 本章必写场景` / `## 本章禁止偏离项` 只在 `format:'novel-forge'` 时输出，并带 deprecated warning。
- `beat_list` 的 `chapter` 变为可选；不传时返回全书概览。
- `novel-forge` 从「工作流依赖」降为「可选导出格式」；插件运行时不 import 任何其他插件。

### 修复

- 0.5 的 `beat_compile` 输出依赖 novel-forge 的解析规则，独立使用时只是提示词；0.6 改为自包含契约 + 自己的 `beat_verify`。
- `applyChangesToCanon` 不再把「`from` 与当前值一致」的正常剧情推进误判为冲突。
- 默认关闭时 `when` 异步导致工具 schema 仍可见；改为同步 `modeCache` + per-agent `tools.restrict`。
- composer 按钮的 `ctx.remote.commands.execute` 方案失败（`remote 未就绪`）；改为 Typert remote：`await ctx.remote.$mount()` 返回 dispose，服务从 `ctx.get('remote.beatMode')` 取。

### 测试

- `node --test`：**59 tests / 59 pass / 0 fail**（schema、store、compile、verify、tools、index、e2e、client）。
- `node --check`：`index.js`、`client.js`、`lib/*.js` 全过。
- 端到端：三章 canon 跨章可见、到期义务在第三章兑现、waive 后可继续。

### 说明

- `beat_verify` 是确定性结构校验，不是 AI 语义审稿；它查证据短语、禁项、到期义务，不判断文笔和潜台词。
- 插件不接管正文、不写章节文件；正文由宿主模型写，作者自己保存。
- 0.6.0 需要重启 DSH 才会加载新的 Host/Client JS 生成。

## 0.5.0 — 2026-11-02

- 五个工具（`beat_plan` / `beat_list` / `beat_decide` / `beat_gate` / `beat_compile`）。
- 每章一个 `chNNN.json`；空白书实时拦截；结果编译成 novel-forge 的细纲格式。




