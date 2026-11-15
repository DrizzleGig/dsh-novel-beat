# Conductor 适配协议（v0.7.0 冻结，P5 只做适配）

> 面向：后续的 Conductor / 任务调度插件。
> **本协议在 0.7.0 冻结**：字段名与状态枚举不再改；新增能力只能追加可选字段。
> Beat **不重新实现剧情判断**，也不允许任何调度器替作者拍板。

## 一、权责边界（不可协商）

1. **Beat 拥有剧情决策权威**：`beat_plan` / `beat_next` / `beat_decide` 只在 Beat 内部有效，
   调度器不能直接写 `book.json`，也不能绕过 `beat_next` 替作者作答。
2. **Conductor 只有任务调度权**：它决定"现在该写哪一章 / 派给谁 / 何时开始"，
   不决定"这一章里角色怎么选"。
3. **作者拥有最终决定权**：`needs_author` 是终态等待，不是失败；调度器不得超时后自动替作者选。
4. **Voice / Fade / Fanfic 等兄弟插件不得推翻已确认事实**：它们读 `canon`（只读契约见
   [`adapter-contract.md`](./adapter-contract.md)），写也只能通过自己的账本。

## 二、调用约定：`task_context`

每次调用 Beat 都必须带（缺一项即视为协议违规，Beat 可拒绝执行）：

```json
{
  "task_context": {
    "task_id": "t-0001",
    "project_id": "斗罗同人",
    "branch_id": "main",
    "correlation_id": "corr-7f3a"
  }
}
```

- `task_id`：调度器自己的任务 ID；Beat 记在 `tasks[]` 里，用于幂等与审计。
- `project_id`：作品标识（通常等于书名）。
- `branch_id`：分支隔离用；同一 `task_id` 在不同分支上是不同任务。
- `correlation_id`：一次调度链路的追踪号，会写进 `audit[]`。

## 三、修改类调用必须带的两个字段

| 字段 | 类型 | 规则 |
|---|---|---|
| `idempotency_key` | string | 同一次调用的重试必须带同一个 key；Beat 见到重复 key 直接返回上次结果，不重复落账 |
| `expected_revision` | string | 调用方认为账本当前停在哪一版（Beat 的 `revisions[]` 最新 id）；不一致 → 返回 `blocked`，让调度器重读 |

## 四、统一返回状态

```text
accepted | running | needs_author | blocked | ready | completed | failed | cancelled
```

| 状态 | 含义 | 调度器该做什么 |
|---|---|---|
| `accepted` | Beat 收下了任务 | 等待下一次轮询/回调 |
| `running` | Beat 正在处理（比如正在问作者） | 不要重复投递 |
| `needs_author` | 停在"等作者拍板" | 通知作者；**不要**替作者选，也不要超时失败 |
| `blocked` | 账本被别人改了 / `expected_revision` 过期 / 有未满足的前置 | 重读账本后重试，或升级给作者 |
| `ready` | 条件齐备，可以继续写 | 触发下一步（例如让写作会话继续） |
| `completed` | 这一章/这一段结束 | 收口，写回自己的任务状态 |
| `failed` | 内部错误 | 带 `code` + `message` 重试或上报 |
| `cancelled` | 作者或调度器取消 | 释放资源，不要重投 |

## 五、只读观测

调度器不要解析 `book.json` 做状态机判断，用只读服务：

```js
const beat = ctx.get('novelBeat')
beat.version                                     // '0.7.0'
beat.isOn(agentId)                               // 这个会话是否开着拍板
await beat.resolveBook(cwd)                      // { book, dir } | null
await beat.query({ cwd, book, chapter })          // 决策 / canon / 义务 / 有效段落
beat.onDidCommit(({ kind, tool, book, chapter, ids, at }) => { … })  // kind: commit | segment | revert
```

## 六、适配层要实现的（P5 留给 Conductor 自己）

1. 把 `tasks[]` 里的 `state`（`created → planning → awaiting_author → writing → segment_committed → verifying → completed`）与自己的任务状态对齐。
2. `needs_author` 时挂起而不是失败；作者拍完后用同一个 `idempotency_key` 继续。
3. 每次修改类调用前从 `query()` 拿最新 `revisions[]` 作为 `expected_revision`。
4. 分支隔离：同一 `task_id` + 不同 `branch_id` 各自独立，不得共用 `decision_id`。

## 七、版本记录

| 版本 | 变更 |
|---|---|
| 0.7.0 | 冻结 `task_context`、`idempotency_key`、`expected_revision`、八态返回枚举 |
