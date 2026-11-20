# book.json 契约（schemaVersion 2）——给兄弟插件读的账本接口

> 面向：novel-fade / novel-voice / novel-fanfic / Conductor 等要读「拍板」账本的插件。
> 这是**只读契约**：别的插件可以读，不要写。要写请走 beat 自己的工具，或走 `novelBeat` 服务提供的只读查询。
> 版本：dsh-novel-beat 0.9.0 / `schemaVersion: 2`（0.6.x 是 1）。
> 0.9 增量：顶层多 `revision`（整数，单调 +1）；`commitId = "<书>#<revision>"`；服务接口见 [contract.md](./contract.md)。

## 一、文件在哪

```text
<工作区根>/.dsh-novel-beat/<书名>/book.json          ← 账本
<工作区根>/.dsh-novel-beat/<书名>/book.json.bak      ← 每次原子写之前的上一版
<工作区根>/.dsh-novel-beat/<书名>/revisions/<id>.md  ← 段落快照（回退用）
<工作区根>/.dsh-novel-beat/_sessions.json            ← 会话模式（on/off、受保护的正文目录）
```

- **工作区根的锚定规则**（`lib/store.js` 的 `resolveWorkspaceRoot`）：从传入目录最多向上 8 层，
  优先取"已经有书目录的 `.dsh-novel-beat` 祖先"，其次 git 根，再其次任意 `.dsh-novel-beat` 祖先，
  最后才用传入目录本身。**同一本书只会有一份账本**，在 `正文/` 子目录里调用也一样。
- 书名 = 目录名，做过多余字符清洗（`assertBookName`）。

## 二、顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `schemaVersion` | `2` | 读之前先看它；不认识就降级，不要猜 |
| `book` / `title` | string | 书名 |
| `createdAt` / `updatedAt` | ISO string | |
| `revision` | integer | 0.9 起：每次写 +1；`commitId = <书>#<revision>` |
| `decisions[]` | 决策点 | 见下 |
| `canon[]` | 设定事实 | `{ entity, key, value, chapter, decisionId, updatedAt }` |
| `obligations[]` | 义务/伏笔 | `{ id, text, status, dueChapter, sourceDecision, sourceChapter, ... }` |
| `chapters{}` | 按章状态 | `{ status, verifiedAt, continuationCheckRequired, gate, pendingConfirm … }` |
| `segments[]` | 段落映射 | 0.7 新增，见下 |
| `revisions[]` | 版本记录 | 0.7 新增：`kind: segment / adjust / revert` |
| `requests[]` | 作者作答凭据 | 0.7 新增：**唯一真相**，`committed` 必须能对到一条 |
| `tasks[]` | 创作任务 | 0.7 新增（Conductor 适配用） |
| `forks[]` | 作者插的岔路 | 0.7 新增，可能不存在 |
| `audit[]` | 审计流水 | 追时间线用，别当状态读 |

## 三、decisions[]

```json
{
  "id": "b1-2",
  "chapter": 1,
  "title": "要不要当场杀独孤博",
  "kind": "分叉",
  "change": "这一选择改变了什么（一句话）",
  "options": [{ "label": "选 A", "impact": "…", "changes": [], "obligations": [] }],
  "status": "committed",
  "chosen": { "label": "选 A", "impact": "…", "changes": [], "obligations": [], "forbidden": [] },
  "requestId": "q-1a2b3c",
  "askedAt": "2026-11-15T03:31:00.000Z",
  "answeredAt": "2026-11-15T03:32:51.000Z",
  "committedAt": "2026-11-15T03:32:51.000Z",
  "segmentId": "s-0004",
  "answerText": null,
  "pendingChoice": null,
  "legacyReceipt": false
}
```

- **`status` 取值**：`proposed` / `asked` / `answered` / `committed` / `superseded` / `cancelled`。
  只有 `committed` 是"作者已经拍死、可以当 canon 用"；`answered` 表示作者答了但还没落成结构化变化
  （`pendingChoice` 非空 = 正在等作者确认"能不能改这个设定"）。
- **`committed` 一定带 `requestId`，且 `requests[]` 里有对应条目**，条目的 `origin` 只有三种：
  `author`（引擎亲手问到的）/ `model-relayed`（老路径，模型转述）/ `legacy`（0.6 迁移生成）。
  读方可以用它判断"这个答案是不是真的作者说的"。
- 0.6 迁移来的决策 `legacyReceipt: true`，没有 `requestId` 之外的保证。

## 四、segments[]（正文单元）

```json
{
  "id": "s-0004",
  "chapter": 11,
  "file": "正文/第11章_月轩_唐月华.md",
  "decisionIds": ["b11-1"],
  "offsetStart": 0, "offsetEnd": 2391, "hash": "…", "chars": 2391, "unitChars": 2391,
  "status": "committed",
  "revisionId": "r-0004",
  "createdAt": "2026-11-15T03:34:30.000Z"
}
```

- `offsetStart` / `offsetEnd` 是**字符**偏移（JS string index），`file` 是相对工作区根、正斜杠路径。
- `status`：`committed` / `reverted`（`open`、`stale` 目前不用）。
- 回退是**级联**的：退第 N 段 = 正文截到它的 `offsetStart`，第 N 段及其后所有段一起 `reverted`。
  所以"当前有效段落"= `status === 'committed'` 且没有被后续回退作废。

## 五、读的时候注意

1. **先看 `schemaVersion`**：只认 2；看到 1 说明账本还没被 beat 打开过，等 beat 迁移（它会自动备份成 `.bak`）。
2. **`canon` 是事实、`decisions` 是决定**：注入提示词时用 `canon`（已确认的设定）+ 未回收的 `obligations`，
   不要把 `options` 里没被选中的分支当事实。
3. **不要缓存跨轮**：账本每次 beat 工具调用后都会变（原子写），读之前重新读文件。
4. **不要写**：并发写会覆盖 beat 的原子写；需要写请联系 beat 自己的工具。
5. 进程内还有更省事的只读服务：`ctx.get('novelBeat')` →
   `{ version, isOn(agentId), resolveBook(cwd), query({cwd, book, chapter}), onDidCommit(cb) }`。
   它和文件契约等价，但帮你把"工作区根锚定 + 章节过滤 + 只保留有效段落"做完了。
