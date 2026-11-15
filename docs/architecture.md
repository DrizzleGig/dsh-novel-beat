# 架构概览（0.7.0）

给要读账本、接调度、或改这个插件的开发者。作者侧的用法见 [README](../README.md)，工具参数见 [tools.md](./tools.md)。

## 一句话

「拍板」是一套**写作流程约束 + 单文件账本**：插件在 Harness 会话里提供命令、工具、闸门和一条 UI 状态条；所有状态落在工作区的 `book.json` 里，进程内另有只读服务供兄弟插件查询。

## 代码地图

| 文件 | 职责 |
|---|---|
| `index.js` | 插件入口：注册命令（`/beat …`）、11 个工具、系统提示、`novelBeat` 只读服务 |
| `lib/tools.js` | `beat_*` 工具的实现与参数校验（约 91 KB，最大的一块） |
| `lib/schema.js` | schemaVersion 2 的数据模型、默认值、字段校验与 0.6→0.7 迁移 |
| `lib/store.js` | 账本读写（原子写、`book.json.bak` 备份）、工作区根锚定、防并发 |
| `lib/segment.js` | 段落登记：快照落盘、区间与 hash、正文定位 |
| `lib/enforce.js` | 三层强制与写作单元闸（`write-ahead` / `unit-gap` / `prefix-rewritten` / `gate-mismatch`） |
| `lib/verify.js` | 写后结构核对、`drift` / `unsegmented` 检测与节奏诊断 |
| `lib/compile.js` | 把已拍板决策编译成写作约束（必须发生 / 不得出现 / 义务 / canon） |
| `lib/remote.js`、`lib/remote-contract.js` | Web remote：拍板台的 `panel` / `revertLast` |
| `client.js` | Web 端：输入框上方的拍板台状态条 |

## 账本

```text
<工作区根>/.dsh-novel-beat/<书名>/book.json          账本（schemaVersion 2）
<工作区根>/.dsh-novel-beat/<书名>/book.json.bak      每次原子写之前的上一版
<工作区根>/.dsh-novel-beat/<书名>/revisions/<id>.md 段落快照（回退时按它重定位）
<工作区根>/.dsh-novel-beat/_sessions.json            会话模式（on/off、受保护的正文目录）
```

顶层字段：`decisions` / `canon` / `obligations` / `chapters` / `segments` / `revisions` / `requests` / `tasks` / `forks` / `audit`。

- **工作区根锚定**：从传入目录最多向上找 8 层，优先「已经有书目录的 `.dsh-novel-beat` 祖先」，其次 git 根，最后才是传入目录本身——同一本书在 `正文/` 子目录里调用也只认一份账本。
- **决策状态**：`proposed` / `asked` / `answered` / `committed` / `superseded` / `cancelled`。
- **凭据**：`committed` 的决策必须指向一条 `requests[]`；`origin: author` 是插件亲手问到的，`origin: model-relayed` 是模型转述并留 `relayedBy`——不冒充作者。

字段级契约：[`adapter-contract.md`](./adapter-contract.md)（冻结）。

## 强制模型（三层）

`/beat on` 之后同时生效，`/beat off` 后同时撤下：

1. **技能与会话提示**：技能只在这个会话出现，系统提示常驻节奏规则。
2. **工具面闸门**：写 `正文/` 的工具调用被 guard 拦，判定只看「这一章还有没有问了没答的岔路」（`PENDING_DECISIONS`）。
3. **写入单元闸**：`beat_next` / `beat_plan` 在上一段没登记时拒绝（`segment-required`、`write-ahead`）；拍板时记下闸门（`file` / `offset` / `prefixHash` / `decisionIds`），登记必须对得上，登记完即作废（`consumed`）。

边界要说清楚：这是**工具面内的协议**，不是系统级沙箱。AI 绕开工具（shell 重定向、外部编辑器）直接改文件时插件看不见，只能靠 `beat_verify` 的 `unsegmented` / `drift` 事后发现。

## 事件与只读服务

- 每次落账后触发 `onDidCommit`（带 kind 与受影响对象），兄弟插件据此刷新。
- 进程内只读服务 `ctx.get('novelBeat')`：`version` / `isOn(agentId)` / `resolveBook(cwd)` / `query({ cwd, book, chapter })` / `onDidCommit(listener)`——**没有任何写入入口**。
- `audit[]` 记录越权/覆盖类动作（如 `canonOverride`）。

## 调度器协议

Conductor 等外部调度器的接入方式见 [`conductor-adapter.md`](./conductor-adapter.md)（冻结）。

## 设计原则

- 作者确认优先于模型推测。
- 已确认的剧情事实不能被随意改变。
- 未完成的剧情义务需要持续保留。
- 写作中的实时决策与写后结构核对分开处理。
- 结构核对不越权评价文学质量。
