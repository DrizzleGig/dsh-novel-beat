# dsh-novel-beat

> 每一处关键，都由你拍板。
>
> 更好的创作。

你写了一句「林砚在拍卖会拍下玉佩」。
模型交回来三千字：三个仇家、一个旧识、一段身世。
剧情是往前走，但走向不是你选的。

dsh-novel-beat 在正文之前，把「会改变故事走向」的节点拦下来：
每个节点给 2–4 个真分叉，选哪个、代价是什么，你定。
拍板写进全书账本；下一章写之前，账本先摆出来。
写完还能验：该发生的变化有没有发生，该还的债有没有还。

**不依赖 `novel-forge` 或任何其他插件。默认关闭，不写小说时不占地方。**

## 它解决什么问题

用 DSH 写小说时，模型在「细纲 → 正文」之间有一大片自由发挥的空间：细纲只写「林砚在拍卖会拍下玉佩」，怎么加价、谁在场、旧敌什么反应、玉佩什么来历，全由模型自己编。

本插件把粒度下沉到**决策点**，在生成正文之前就问；拍板之后不是只留一句话，而是写成**结构化状态变更**，进入全书账本。

## 为什么不是细纲

细纲回答「这一章大概发生什么」；拍板回答「这个节点现在必须选哪一个」。

细纲是给人看的；拍板是给下一章、给全书账本、给写后校验用的一份状态。选完不是记一句话，是 canon 里多了一条「谁/什么 从 A 变成 B」。

## 唯一判定规则

> **会改变故事状态的，都要问；只描述世界的，不用问。**

能往 canon 里写一条的，就是决策点：

| 类型 | 例子 |
|---|---|
| 动作 | 他动手了 / 他忍住了 |
| 知情 | 谁知道 / 谁不知道 / 揭露到什么程度 |
| 关系 | 结盟 / 翻脸 / 欠人情 |
| 得失 | 钱、物、功法、证据 |
| 状态 | 在哪、伤没伤、几层 |
| 承诺 | 答应 / 违约 / 期限 |
| 时序 | 先发生还是后发生 |
| 分叉 | 门口遇到谁 |

风、光、温度、比喻、氛围 → 不进清单，模型自己决定。

## 七个工具

| 工具 | 作用 |
|---|---|
| `beat_plan` | 登记本章决策点；每个 2–4 个真分叉，每个选项必须有 `changes`（entity / key / from / to / evidence），不同选项的 changes 必须不同 |
| `beat_list` | 不传 `chapter` 看全书概览；传 `chapter` 看本章；`context:true` 返回 canon + 未回收义务 + 最近决策 |
| `beat_decide` | 记录作者选择；预设选项直接快照 changes，自定义选项必须带 changes；改主意用 `supersede:true` + `reason` |
| `beat_gate` | 写正文前体检；还有未拍板就 `pass:false` |
| `beat_compile` | 产出本章约束（默认 `format:'self'`）：必须发生、证据、不得出现、既有义务、全书 canon；`format:'novel-forge'` 只做可选兼容导出 |
| `beat_verify` | 写后校验：`text` 或 `path` 二选一；缺变化 / 踩禁项 / 到期义务没回应，都有明确 failure/warning |
| `beat_adjust` | 作者主权动作：`waive` 义务、`supersede` 决策；必须写 `reason` |

## 会话开关（默认关）

默认 `off`：装上不主动占 schema，作者开启后才把 `beat_*` 加进当前会话。

- `/beat on`、`/beat off`、`/beat status`
- composer 左侧「拍板」按钮（Typert remote，直接调 host 的 `beatMode`）
- 关掉只影响当前会话，数据保留；同一 session resume 保持；fork 的新会话默认 `off`

## 一次推进

```text
beat_list(context:true)      # 看 canon + 未回收义务
  → beat_plan(...)           # 登记 2–4 个真分叉
  → ask_user_question        # 作者拍板
  → beat_decide(...) × N     # 写 chosen / canon / obligations
  → beat_gate(...)           # 必须 pass
  → beat_compile(...)        # 自包含契约
  → 写正文（宿主模型；插件不管正文）
  → beat_verify(text/path)   # 缺变化 / 禁项 / 义务到期
  → 不通过：改稿重验；通过：本章 verified，下一章从 canon 继续
```

作者改主意：

```text
beat_adjust(waive, ob1, "这条伏笔不要了")
beat_adjust(supersede, b3-2, "这个走向作废")
beat_decide(supersede:true, reason:"…")   # 重拍当前决策
```

## 数据落盘

```text
<工作区>/.dsh-novel-beat/<书名>/book.json     # 单文件账本
<工作区>/.dsh-novel-beat/_sessions.json       # 会话开关
<工作区>/.dsh-novel-beat/<书名>/legacy/       # 0.5 旧数据备份
```

`book.json` 包含 `decisions`、`canon`、`obligations`、`chapters`、`audit`；一次读-改-写，tmp → `.bak` → rename 原子落盘，per-book 队列串行化，避免并发写坏。

0.5 的 `chNNN.json` 首次访问时自动迁移：旧拍板保留为 `legacy` 决策，但没有结构化 changes/canon；`beat_verify` 对 legacy 只做弱校验。旧文件不删除，移到 `legacy/`。

## 安装

```powershell
# 改完代码要「先卸再装」才会重载
plugin_manager set_bundle    target=dsh-novel-beat enabled=false
plugin_manager remove_bundle  target=dsh-novel-beat
plugin_manager install_bundle target=link:D:\插件\plugins\novel-beat
```

装好后默认关闭；在 composer 左侧点「拍板」或输入 `/beat on`。Host 与 Client 改动后需要重启 DSH 才会加载新的 JS 生成。

## 0.5 → 0.6 的破坏性变更

- 数据从「每章一个 `chNNN.json`」变为「每书一个 `book.json`」；自动迁移，旧文件进 `legacy/`。
- `beat_plan` 的每个选项现在必须带 `changes`；1 个选项或换措辞的假分叉会被拒绝。
- `beat_compile` 默认输出 `self` 契约；旧的 `## 本章必写场景` 只在 `format:'novel-forge'` 时输出，并带 deprecated warning。
- `beat_list` 的 `chapter` 变为可选；不传时返回全书概览。
- `novel-forge` 从「工作流依赖」降为「可选导出格式」。

## 边界（写清楚，避免误会）

- `beat_verify` 是**确定性结构校验**，不是 AI 语义审稿：它查证据短语、禁项、到期义务，不判断文笔和潜台词。
- `path` 只读工作区内 `.md`/`.txt`，≤ 2 MB；`text` 直接传。
- 插件不接管正文、不写章节文件；正文由宿主模型写，作者自己保存。

## 适合谁

- 适合：写长篇、边写边推、怕设定崩、想让剧情由自己掌握的作者。
- 不适合：只想让模型一口气写完、不打算回头改的人。

## 开发

```powershell
D:\node.exe --test          # 59 tests
D:\node.exe --check index.js client.js lib/*.js
```

```text
index.js                    # host 入口：7 工具 + /beat + skill + 会话 restrict
lib/schema.js               # 校验/规范化/canon/义务/id/legacy
lib/store.js                # book.json 原子写、锁、迁移、会话模式
lib/compile.js              # self / novel-forge 契约
lib/verify.js               # 确定性校验
lib/tools.js                # 7 工具 handler 与 schema
lib/remote-contract.js      # Typert remote 契约（beatMode）
lib/remote.js               # BeatRemote：status/setMode，复用 /beat 命令
client.js                   # composer「拍板」按钮
cordis.patch.yml            # 主插件 + remote 两行
test/*.test.mjs             # schema/store/compile/verify/tools/index/e2e/client
```

## License

MIT
