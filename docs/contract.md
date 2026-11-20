# `novelBeat` 只读服务契约（0.9.0）

> 面向 conductor / 第三方编排器。**只读**：不写 `book.json`、不替作者拍板、不写正文。
> 写操作永远走 beat 自己的工具（`beat_*`），并受作者确认约束。

## 1. 服务标识

```js
ctx.get('novelBeat')
```

```js
identity() => {
  plugin: 'dsh-novel-beat',
  version: '0.9.0',
  service_version: 1,
  capabilities: [
    'beat.status', 'beat.revision', 'beat.canon',
    'beat.artifact', 'beat.commit.events',
  ],
  dir: '.dsh-novel-beat',
  readOnly: true,
}
```

- 能力只增不改；字段只增不删（一个 minor 内）。
- 没有 `book.json` 时各方法返回 `null`，不抛错。

## 2. revision 与 commitId

- `book.revision` 是**单调整数**，每次写事务 +1；它是账本版本，不是插件版本。
- `commitId = "<书名>#<revision>"`，例如 `斗罗：开局炸毁冰火两仪眼#87`。
- 所有写工具返回 `revision`（整数）与 `revisionRecord`（历史记录）。
- 回退/改选接受 `expected_revision`；不一致时返回 `blocked` / `revision-conflict`，正文不动。

## 3. 方法

### `getStatus({ cwd, book?, chapter? })`

返回：`book / chapter / pending[] / openDecisions / chapterState / stateDetail / chapterMeta / lastSegment / revision`。

- `chapterState`：`empty | writing | open | pending_confirm | awaiting_segment | needs_check | verified`。
- `stateDetail.pendingConfirm` 与 `open` 分开计数；`pendingConfirm > 0` 时 `chapterState='pending_confirm'`。
- 不传 `book` 时按最近 mtime 选书（与面板一致）。

### `getRevision({ cwd, book? })`

```js
{ revision, updatedAt, latestRevisionId }
```

### `getCanon({ cwd, book?, chapter? })`

```js
{ schemaVersion, revision, canon[], obligations[], decisions[] }
```

- `canon[]`：`entity/key/value/chapter`。
- `obligations[]`：只返回 `open` / `due` 等未完成项。
- `decisions[]`：当前章决策，含 `choice/segmentId`。

### `getArtifact({ cwd, book?, artifactId })`

`artifactId` 可以是 `segment.id` 或 `decision.id`：

```js
{ found, artifactId, revision, kind, revisionId, hash, at, segment|decision }
```

找不到时 `{ found:false, artifactId }`。

### `onDidCommit(listener)`

```js
const off = novelBeat.onDidCommit((event) => {
  // { commitId, book, revision, kind, at, decisionId?, segmentId? }
})
```

- 只在写事务**落盘成功后**发出；监听器抛错不影响已提交写。
- 返回取消订阅函数。

## 4. 错误

只读服务不返回工具式 `isError`；用 `null` / `found:false` 表达缺失。写工具仍返回：

```json
{ "ok": false, "code": "stale|revision-conflict|needs-confirm|...", "message": "人话" }
```

## 5. 与兄弟插件

- **fade**：继续只读 `book.json` 的 `canon/obligations`；0.9 只多 `revision` 字段，无破坏。
- **conductor**：用 `identity` 判能力；用 `getStatus` 决定是否继续写；用 `getCanon` 给写作会话注入事实；用 `onDidCommit` 收事件；**不直接写 beat**。
- **voice / fanfic**：无硬边；需要时由宿主模型同时读两边。

## 6. 兼容

- `schemaVersion` 仍是 `2`；0.6 的 v1 账本读时迁移并初始化 `revision`。
- `query().version` 保留旧含义（schemaVersion）；插件版本看 `identity().version`。
- 0.9 新增方法：`getRevision/getStatus/getCanon/getArtifact/onDidCommit`；0.7/0.8 没有这些方法，调用方需先判 `typeof`。
