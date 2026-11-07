# dsh-novel-beat 0.5.0 功能审查与版本路线

- 审查日期：2026-11-07
- 审查对象：`D:\插件\plugins\novel-beat`（HEAD `cc3bb7e`，version 0.5.0）
- 对照实现：dsh-novel-forge v1.5.0（`C:\Users\liyicheng\.dsh\profiles\desktop\node_modules\dsh-novel-forge`）
- 审查人：DSH 助手

---

## 0. 结论（先读这段）

**机制成立，工程质量欠账，`beat_compile` 是当前最弱的一环。**

1. **做得对**：把「会改变故事状态」当成决策点的唯一判据，比按字数/按场景数量逼问更接近创作实际；`append` 保护已拍板记录、`reset` 才允许重排，这个交互约束是对的；compile 能识别「作者自己写的内容否定了原节点」，没有照抄矛盾状态（`d3c285c` 修的就是这个）。
2. **必须修**：compile 产出的「场景」是账本句，不是画面；实测一段忠实复现两个决策的正文，novel-forge 契约覆盖率是 **0%**。同时「本章禁止偏离项」被解析成 `改写已拍板决策` 这个正文永远不会出现的词，**机器门禁实际为零**。
3. **最大结构缺口**：决策只按章存，没有跨章账本、没有修订历史、不能撤销/删除节点。写到几十章后，「第 3 章到底拍过什么」只能翻 JSON。
4. **工程底线**：`docs/` 和 `test/` 都不存在，零测试；写文件不是原子操作；`book=".."` 可以越出 `.dsh-novel-beat/` 一层。

**建议**：下一版直接从 **0.6.0「可靠性 + compile v2」** 开始，不要先做面板。0.5.0 已经发布且能用，不需要 0.5.1 热修。

---

## 1. 审查范围与证据

### 1.1 仓库与安装态

| 项 | 结果 |
|---|---|
| 仓库文件 | 审查前只有 `icon.svg`、`.gitignore`、`cordis.patch.yml`、`LICENSE`、`README.md`、`index.js`、`package.json`；`docs/`、`test/` 不存在。本次新增 `docs/review-0.5.0.md`（未提交） |
| package.json | `dsh-novel-beat@0.5.0`，`type: module`，零 dependencies，`files` 白名单 5 项，`dsh.bundle.patch=./cordis.patch.yml` |
| git 状态 | `git status --short` 无输出（干净）；HEAD `cc3bb7e` |
| 本地 vs 安装态 | 本地 `index.js` 与两份安装副本内容一致，`git diff --no-index` 无差异，仅 CRLF/LF 行尾不同 → 线上运行代码 = 仓库 HEAD |

安装副本：

- `C:\Users\liyicheng\.dsh\profiles\desktop\node_modules\dsh-novel-beat\index.js`
- `D:\data\dsh\home\profiles\desktop\node_modules\dsh-novel-beat\index.js`

### 1.2 实调探针

在 `D:\插件\tmp\beat-review-probe` 建了空白书 `审查探针`，第 1 章走完整链路：

| 步骤 | 结果 |
|---|---|
| `beat_plan` 登记 2 点 | 成功（「玉佩怎么到手」「旧敌是否认出他」） |
| `beat_decide b1` 选预置项 | `拍卖会竞价拍下` |
| `beat_decide b2` 自定义 | `认出但不说破，暗中记下他袖口的纹样` |
| `beat_gate` | `pass=true`，「2 个决策点全部拍板」 |
| `beat_compile` | 输出两段 Markdown（见 §3.1） |

落盘文件：`D:\插件\tmp\beat-review-probe\.dsh-novel-beat\审查探针\ch001.json`

### 1.3 与 novel-forge 契约的对照实验

脚本：`D:\插件\tmp\gate-probe.mjs`（直接 import forge 的 `lib/gate-metrics.js`，跑纯函数）。

输入 A（77 字，忠实复现两个决策）：

> 林砚在拍卖会上举牌，最终花了三百两把那枚玉佩拍了下来。玉佩终于到了他手里，现银也见了底。散场时他察觉有人盯着他，那人认出他却不说破，只记住了他袖口的纹样。

输入 B（49 字，意译）：

> 林砚在拍卖会上举牌，最终把那只玉佩收入囊中。散场时他察觉有人盯着他，那人没有点破，只多看了他一眼。

结果：

| 指标 | 输入 A | 输入 B |
|---|---|---|
| `available` | true | true |
| `coverage` | **0%** | **0%** |
| `missedScenes` | 两个场景全漏 | 两个场景全漏 |
| `passed` | false | false |

同一脚本解析 compile 的「本章禁止偏离项」：

```json
{ "banned": ["改写已拍板决策"], "requirements": [], "conditional": [] }
```

正文永远不可能出现「改写已拍板决策」这七个字，所以 `bannedHits=0`、`drift=0` —— **禁项段对机器门禁没有作用**。

### 1.4 本次没有验证的

- 没有写一篇 2000–3000 字的真实章节去测覆盖率（样本是 49/77 字的忠实片段，结论是「词法匹配不可靠」，不是「所有正文都 0%」）。
- 没有测多本书并发写、跨章索引、面板路径。
- 没有在真实 `novel_write_chapter` 里跑「覆盖率不足」的完整驳回链（只读源码确认它是 warning，不是硬拒）。

---

## 2. 功能盘点

| 工具 | 实际行为 | 缺口 |
|---|---|---|
| `beat_plan` | 登记决策点；校验 `title` 非空、`change` ≥4 字、选项必须有 `impact`；已有拍板记录时拒绝覆盖，`append` 追加、`reset` 重排 | 选项数量没校验（0 个或 10 个都能过）；`kind` 未在运行时校验（靠 schema enum）；`append` 与 `reset` 同传时 `append` 静默优先 |
| `beat_list` | 按章列决策点与拍板状态 | 描述写「不传 chapter 则只看待办统计」，schema 却 **required: ['dir','book','chapter']**，功能与说明不一致 |
| `beat_decide` | 记录/覆盖某点的选择，写 `status/choice/note/decidedAt` | 重复拍板**静默覆盖**，没有 previousChoice、没有历史、没有撤销 |
| `beat_gate` | 写正文前检查；未拍板/无清单/空清单都 `pass=false` | 只做「写前闸」，没有「写后校验正文是否违背决策」 |
| `beat_compile` | 生成 `## 本章必写场景` + `## 本章禁止偏离项` | **1 个决策 = 1 个场景**；场景标题是问句、描述是状态变更句；禁项段机器不可执行 |
| 技能 | 随插件注册 `novel-beat`，装完即生效 | 无 |
| 数据 | 每章一个 JSON：`<dir>/.dsh-novel-beat/<book>/chNNN.json` | 无书级索引，跨章不可见 |

关键代码位置：

- 路径与书名清洗：`index.js:97-100`
- 非原子写：`index.js:112-118`（直接 `writeFile`）
- 选项校验：`index.js:283-287`（只查 `impact`，没有 2–4 个的限制）
- 重复拍板覆盖：`index.js:379-382`
- 1:1 场景：`index.js:471-481`（`data.beats.map(sceneLine)`）
- 禁项模板：`index.js:482`

---

## 3. 问题清单

### P0-1 `beat_compile` 的「场景契约」语义失效

**现象**

compile 把每个决策点直接映射成一个场景：

```markdown
## 本章必写场景
- 玉佩怎么到手：玉佩 从 拍卖品 变成 林砚持有（走向：花钱得玉，得罪同场出价人，后续被盯上；代价是现银见底。）
- 旧敌是否认出他：认出但不说破，暗中记下他袖口的纹样（作者改写了这个节点，原始状态变更为「旧敌 从 不知情 变成 认出林砚」，以拍板为准）

## 本章禁止偏离项
- 不得改写已拍板决策：玉佩怎么到手 → 拍卖会竞价拍下
- 不得改写已拍板决策：旧敌是否认出他 → 认出但不说破，暗中记下他袖口的纹样
- 环境、天气、比喻、氛围等不影响走向的描写可自由发挥，但不得改变上述任何一条已拍板决策
```

**证据**

- forge 的 `sceneMatched`（`lib/gate-metrics.js:529-562`）要求：标题或别名在正文里 `includes`；否则从描述里切 ≥3 字词，≥4 字词走 4 字滑窗，最后要「某个 ≥4 字词完整出现」或「命中词数 ≥ min(2, 词数)」。
- compile 的标题是问句（`玉佩怎么到手`），正文不会逐字出现；描述是账本句（`玉佩 从 拍卖品 变成 林砚持有`），`拍卖品`、`林砚持有`、`花钱得玉`、`同场出价人`、`现银见底` 这些词正常叙事里不会成串出现。
- 实测忠实片段覆盖率 **0%**（§1.3）。
- 禁项段被解析成 `改写已拍板决策` 一个词（§1.3），正文不含它，所以**机器永远不会因为「改写了决策」而拦稿**。

**影响**

- 当前不会硬拦稿：forge 对 `missedScenes` 只 `warn('scene-not-covered', ...)`，见 `lib/chapter-commit.js:485-492`；真正会拒绝的是 `bannedHits`，见 `:460-480`。
- 但会产生三重坏信号：① audit 的「契约指标」长期 0%–20%，审稿结论被污染；② 作者以为「compile 出来的东西被门禁保护了」，其实没有；③ forge 一旦把覆盖率升级为硬门禁，这条工作流立刻断。
- 更根本的是**语义错位**：决策点是「状态变更」，场景是「一段可写的画面」。一个场景可以承载 2–4 个决策，一个决策也可以跨场景。1:1 映射把两种东西混成一种。

**修法（compile v2）**

1. `beat_plan` 增加可选字段 `scene`（场景名，同一场景的多个决策点归组）；没有就按顺序每 2–3 个决策归一个场景。
2. 场景标题改成**短动作短语 + 别名**，用 forge 支持的 `标题｜别名1/别名2` 格式（`lib/gate-metrics.js:58-86`）：
   - `- 拍下玉佩｜玉佩到手/竞价得玉：...`
   - `- 散场被认出｜旧敌认出/袖口纹样：...`
3. 每个场景给 **3–5 个拍**，写成 `（拍：...）`，不要求逐字复现（`stripSceneMeta` + `beatLines` 会正确处理）。
4. 描述写「这一场结束时观众看到什么」，不要再放 `从 A 变成 B` 的账本句；账本句另起 `## 本章决策台账`（forge 不解析，给人看、给 `beat_verify` 用）。

示例：

```markdown
## 本章必写场景
- 拍下玉佩｜玉佩到手/竞价得玉：拍卖会上举牌，三百两拍下玉佩，现银见底（拍：拍卖师报底价；同场有人跟价；林砚加价；落槌；他摸到玉佩的凉）
- 散场被认出｜旧敌认出/袖口纹样：散场时旧敌认出林砚却不说破，记下他袖口纹样（拍：人群散开；目光落在袖口；旧敌错身而过；林砚察觉；他压下回头）

## 本章禁止偏离项
- 不得出现当众揭穿

## 本章决策台账
- b1 玉佩怎么到手 → 拍卖会竞价拍下
- b2 旧敌是否认出他 → 认出但不说破，暗中记下他袖口的纹样
```

注意：只有 `不得出现X` / `不得让X登场` 这类句式会被 forge 解析成真禁词；`不得改写已拍板决策` 会被解析成「改写已拍板决策」这个正文不会出现的词，等于没禁。

对照实验（`D:\插件\tmp\compile-v2-probe.mjs`）：用上面的格式，`parseScenes` 返回 2 个场景，标题/别名/拍解析正确；一段 76 字的自然正文 `coverage=100%`、`passed=true`。说明「短标题 + 别名 + 拍」这条路是可行的，难点不在 forge 的解析器，在 compile 的写法。

验收：同一段正文在 v2 输出上覆盖率 ≥80%（目标 100%），且 `parseScenes` 返回的场景数 = 实际场景数（不是决策点数）。

---

### P0-2 零测试

**证据**：仓库没有 `test/`，`package.json` 没有 `scripts.test`。0.5.0 的 compile 语义问题、`beat_list` 描述与 schema 不一致，都是读一遍代码就能发现的，但没有回归网。

**影响**：这是一个「决定正文能不能写」的闸门插件，改错一次就是作者白写一章。没有测试，0.6.0 的 compile v2 不敢动。

**修法**：`node:test` + `node:assert`，零依赖；用 `mkdtemp` 建临时工作区；纯函数（compile/校验/路径）与 fs 集成分开测。最少 16 条，见 §6.2。

---

### P1-1 没有跨章决策账本

**证据**：`chapterPath` 只按章拼路径（`index.js:97-100`）；`beat_list` 必须给 `chapter`；`context` 是章级的；代码里没有任何「读其他章」的路径。

**影响**：写到 30 章后，模型不知道第 3 章拍过什么；`beat_plan` 可能重复登记已经拍过的分叉，或者把已拍板的上游设定重新打开。novel-forge 有 `ledger status_at/timeline`，决策层却没有对应物。

**修法（0.7.0）**：

- `.dsh-novel-beat/<book>/book.json` 书级索引：`{ chapters: { "1": { beats: [...] } }, updatedAt }`，或只存摘要 + 指向章文件。
- `beat_context(dir, book, beforeChapter)`：返回之前所有章已拍板的决策（可按 kind/关键词过滤），供写前简报用。
- `beat_history(dir, book, from, to)`：跨章时间线。
- 重开上游节点时，列出「受影响的后续章节」，让作者知道代价。

---

### P1-2 没有修订历史、不能撤销/删除节点

**证据**：`beat_decide` 直接改 `status/choice/note/decidedAt`（`index.js:379-382`），旧值不留；`beat_plan(reset:true)` 整章清空；没有 `beat_drop`/`beat_reopen`。

**影响**：作者改主意是常态。现在要么静默覆盖（无法回滚），要么整章重置（丢掉所有已拍板记录）。「作者主权」的工具不该这样。

**修法**：

- 每个 beat 加 `history: [{ choice, note, at, action }]`，`beat_decide` 追加而不是覆盖；顶层 `choice` 仍保留最新值，兼容旧读取。
- `beat_reopen(id, reason)`：把已拍板改回 pending，记一条 history。
- `beat_drop(id, reason)`：软删除（`status:'dropped'`），compile 跳过并告警；不要物理删。
- `reset` 前要求 `confirm:true`，或改成「新建 revision」而不是清空。

---

### P1-3 `beat_list` 描述与 schema 不一致

**证据**：描述 `index.js:315` 写「不传 chapter 则只看待办统计」，参数 `required: ['dir','book','chapter']` 在 `index.js:324`。

**影响**：模型按描述省略 `chapter` 会被 schema 拒绝，白一轮；或者作者以为能看全书待办，实际看不到。

**修法（二选一，推荐 A）**：

- A. 实现 `chapter` 可选：不传时扫描 `<book>/ch*.json`，返回每章 `total/decided/pending` 汇总。
- B. 改描述，明确「必须给 chapter」。

---

### P1-4 选项数量与选项质量没有运行时约束

**证据**：`index.js:283-287` 只检查「有选项就必须有 impact」；`options` 可以是 0 个、1 个、10 个；重复 label 也允许。

**影响**：0 个选项时，作者只能自由输入，compile 走「作者改写」分支并输出「原始状态变更为…」的长括号，进一步加剧 P0-1；10 个选项则把决策成本推给作者。

**修法**：`minItems: 2, maxItems: 4`；label 去重；`impact` 最短长度（如 10 字）；`kind` 在运行时用 `KINDS.includes()` 兜底。

---

### P2-1 非原子写

**证据**：`index.js:116` 直接 `writeFile(path, JSON.stringify(...))`。

**影响**：进程在写一半时退出会留下截断 JSON，下次 `loadChapter` 抛 `SyntaxError`，整章决策不可读（`ENOENT` 才返回 null）。

**修法**：同目录写 `chNNN.json.tmp` → `rename`；读取时对 `SyntaxError` 给可读错误（「文件损坏，最近的备份是…」），或保留 `.bak`。

---

### P2-2 `book=".."` 可以越出 `.dsh-novel-beat/`

**证据**：`index.js:98` 只替换 `[\\/:*?"<>|]`，`.` 和 `..` 原样保留；`join(dir, ROOT, '..', 'ch001.json')` 归一化为 `<dir>/ch001.json`。

**影响**：只能写到 `<dir>/chNNN.json`，破坏面有限，但这是不该有的路径逃逸；`dir` 也没有「必须是绝对路径/必须存在」的校验。

**修法**：书名禁止 `.`/`..`/空串/纯空白；`resolve()` 后检查 `startsWith(join(dir, ROOT) + sep)`；`dir` 校验绝对路径。

---

### P2-3 与事实账本/认知账本没有联动

**证据**：beat 只有 `title/kind/change/options/choice`，没有结构化的事实三元组；compile 只输出 Markdown。

**影响**：作者拍完板，还要手工把「玉佩到手」翻译成 `novel_ledger update`；漏记就是设定漂移。`kind=知情` 也没有输出「谁知道了什么」。

**修法（0.8.0）**：beat 增加可选 `facts: "实体|键|值"` 与 `cognition: "谁|知道|信息"`；compile 在 `## 本章决策台账` 里附 `facts_updates` / `cognition_updates` 草稿，写章时直接抄进 `novel_write_chapter`。不要自动写账本——拍板是作者主权，落账仍由写章动作确认。

---

### P2-4 章号与输入没有边界校验

**证据**：`chapter` 只做 `padStart`；`0`、负数、`1.5` 都会生成奇怪文件名（`ch01.5.json`）；`beats` 没有数量/长度上限。

**修法**：`Number.isInteger(chapter) && chapter >= 1`；`title` ≤80 字、`change` ≤500 字、`options` ≤4；超限给可读错误。

---

### P2-5 发布与维护

- npm 令牌 **2026-11-09 过期**（HANDOFF §6），0.6.0 要么赶在到期前发，要么先续令牌。
- 没有 CI；至少加一个 `npm test` 的本地门禁，提交前跑。
- `package.json` 没有 `engines`（DSH 版本范围）与 `scripts`；建议补 `"scripts": {"test": "node --test"}`。
- `files` 白名单不含 `docs/`，审查文档不会进 npm 包——这是对的，别把 docs 加进去。

---

### P3 打磨项（不急着做）

- `planOutput`/`listOutput` 的 `beats.items` 是 `properties: {}`，输出 schema 等于没约束；补上字段类型。
- `append:true` + `reset:true` 同时传时，`append` 静默胜出；应报错。
- `beat_decide` 的 choice 与 option label 精确比较；作者多打一个句号就被判「改写」。做 trim + 去尾部标点 + 全半角归一。
- 没有 `beat_export`：作者想带走一份「本章决策清单」只能看 JSON。
- 没有决策密度统计（每章几个点、kind 分布、改写率），无法判断「这一卷是不是问得太碎/太粗」。

---

## 4. 版本路线

| 版本 | 主题 | 范围 | 验收 | 工作量 |
|---|---|---|---|---|
| **0.6.0** | 可靠性与 compile v2 | 测试；compile 分组/短标题/别名/拍；决策历史 + reopen/drop；schema/路径/原子写修复 | `npm test` 全绿；v2 样例覆盖率 ≥80%；0.5.0 数据可读；真机重装后 5 个工具可调 | 2–3 天 |
| **0.7.0** | 跨章决策账本 | `book.json` 索引；`beat_context`/`beat_history`；重开上游节点的下游影响提示 | 3 章样例能一次取回全部已拍板决策；重开 b1 能列出受影响章 | 2–3 天 |
| **0.8.0** | 账本联动与写后校验 | beat 增加 `facts`/`cognition`；compile 出草稿；`beat_verify`（建议式，不硬拦） | 写章时 facts 草稿可直接用；verify 对「改写了决策」的样本能报出差异 | 2 天 |
| **1.0.0** | 作者面板 | 决策列表/待办角标/一键编译/统计/导出 | 不装客户端也能用；面板操作与工具结果一致 | 3–5 天 |

**为什么 0.6.0 不先做跨章账本**：compile 是每天都要走的路径，它现在产出的是「看起来像契约、实际不生效」的东西；先把它修对，跨章账本才有意义。测试是 compile v2 的前置，不能省。

**为什么不做 0.5.1**：0.5.0 没有会阻断写作的 bug（覆盖率只是 warning）；为一个能用的小版本单独发一次，收益低于直接进 0.6.0。除非作者这几天就要靠 compile 产出细纲，那可以先发 0.5.1 只修 P0-1。

---

## 5. 0.6.0 建议拆成 6 个 issue

1. **test harness**：`test/` + `node --test` + `mkdtemp` fixture；先给 0.5.0 的现有行为补 8 条 characterization test。
2. **compile v2**：`scene` 字段 + 分组 + 短标题/别名 + 3–5 拍 + 决策台账；与 forge `parseScenes` 的契约测试。
3. **decision history**：`history[]` + `beat_reopen` + `beat_drop`；`reset` 加确认。
4. **schema 修正**：`beat_list` 支持全书汇总；options `minItems/maxItems`；chapter 整数校验；append/reset 冲突报错。
5. **路径与写入安全**：书名 `.`/`..` 拒绝；`resolve` 包含性检查；临时文件 + rename。
6. **文档**：README 更新 compile v2 的输出格式与「覆盖率是 warning 不是硬拒」的事实；CHANGELOG 0.6.0。

---

## 6. 验收清单（可直接当 PR 检查表）

### 6.1 功能

- [ ] `beat_plan` 拒绝空 `beats`、`change` <4 字、选项缺 `impact`。
- [ ] 已有拍板记录时，不带 `append`/`reset` 的 `beat_plan` 拒绝覆盖。
- [ ] `append` 保留已拍板项；`reset` 清空并留下 revision 记录。
- [ ] `beat_decide` 重复拍板时写 history，旧 choice 可查。
- [ ] `beat_reopen` 把 decided 改回 pending，compile 重新把它算进 `missing`。
- [ ] `beat_drop` 软删除，compile 跳过且不报 missing。
- [ ] `beat_gate` 对无清单/空清单/有 pending 三种情况都 `pass=false`。
- [ ] `beat_list` 不传 chapter 时返回全书各章汇总。
- [ ] `book=".."` 被拒绝；`book="a/b"` 被清洗成 `a_b`。
- [ ] 章号 `0`/`-1`/`1.5` 被拒绝。

### 6.2 compile v2

- [ ] 3 个决策点、2 个 `scene` → `parseScenes` 返回 2 个场景。
- [ ] 每个场景 3–5 个 `（拍：...）`，拍不参与逐字匹配。
- [ ] 标题是短动作短语，带 1–2 个别名。
- [ ] 一段 800 字手写样例覆盖率 ≥80%，目标 100%。
- [ ] `## 本章禁止偏离项` 里的硬禁项写成 forge 认识的句式（`不得出现X`/`不得让X登场`），能被 `parseBanRules` 解析出真正的禁词。
- [ ] 0.5.0 的 `ch001.json` 能直接读，不需要迁移。

### 6.3 工程

- [ ] `npm test` 退出码 0，≥16 条。
- [ ] `node --check index.js` 通过。
- [ ] `set_bundle enabled:false` → `remove_bundle` → `install_bundle` 后，5 个工具在真实会话里可调。
- [ ] 写文件走临时文件 + rename；模拟截断写入后能读出 `.bak` 或给可读错误。
- [ ] README 明确：不装 novel-forge 时 compile 只是提示词约束；装了才进契约指标。

---

## 7. 复现命令

```powershell
# 1. 探针数据
Get-Content 'D:\插件\tmp\beat-review-probe\.dsh-novel-beat\审查探针\ch001.json' -Raw

# 2. 契约指标实验（需要 forge 已安装）
D:\node.exe D:\插件\tmp\gate-probe.mjs

# 2b. compile v2 格式对照实验
D:\node.exe D:\插件\tmp\compile-v2-probe.mjs

# 3. 仓库状态
& 'C:\Program Files\Git\cmd\git.exe' -C 'D:\插件\plugins\novel-beat' status --short
& 'C:\Program Files\Git\cmd\git.exe' -C 'D:\插件\plugins\novel-beat' log -1 --oneline
```

---

## 8. 一句话建议

**0.6.0 只做三件事：把 compile 改成「场景」而不是「决策点镜像」、把决策变成可回滚的账本、把测试补上。** 这三件做完，这个插件才配得上「作者主权」四个字；面板和统计可以晚一点，它们不解决信任问题。
