# `beat_*` 工具参考（0.7.0）

面向接账本的开发者和想弄清内部流程的作者。作者日常只需要 `/beat` 命令（见 README）和输入框上方的拍板台。

所有工具都接受两个公共参数：

- `dir`：工作区目录，默认当前工作区。同一本书在 `正文/` 子目录里调用也只认一份账本。
- `book`：书名或账本路径，默认当前工作区里唯一/最近的那本。

其余参数按章号（`chapter`）组织。**工具参数会随版本演进**，以会话里工具定义的实际 schema 为准；本页只保证语义准确。

## 节奏

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
