# Changelog

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

## 0.5.0 — 2026-10

- 五个工具（`beat_plan` / `beat_list` / `beat_decide` / `beat_gate` / `beat_compile`）。
- 每章一个 `chNNN.json`；空白书实时拦截；结果编译成 novel-forge 的细纲格式。
