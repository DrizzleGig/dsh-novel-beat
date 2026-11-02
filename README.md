# dsh-novel-beat

**决策点问询**：写正文之前，把所有会改变剧情走向的节点逐条交给作者拍板。

## 它解决什么问题

用 DSH 写小说时，模型在「细纲 → 正文」之间有一大片自由发挥的空间：细纲只写「林砚在拍卖会拍下玉佩」，怎么加价、谁在场、旧敌什么反应、玉佩什么来历，全由模型自己编。

novel-forge 的门禁是「整章细纲 批/不批」——粒度是一章，批准时方案已经成型，小细节早就定了。

本插件把粒度下沉到**决策点**，并在生成正文之前就问。

## 判定规则（唯一标准）

> **会改变故事状态的，都要问；只描述世界的，不用问。**

能落进账本的状态变更 = 决策点：

| 类型 | 例子 |
|---|---|
| 动作 | 他动手了 / 他忍住了 |
| 知情 | 谁知道 / 谁不知道 |
| 关系 | 结盟 / 翻脸 / 欠人情 |
| 得失 | 钱、物、功法、证据 |
| 状态 | 在哪、伤没伤、几层 |
| 承诺 | 答应 / 违约 / 期限 |
| 时序 | 先发生还是后发生 |
| 分叉 | 门口遇到谁 |

风、光、温度、比喻、氛围 → 不进清单，模型自己决定。

## 五个工具

| 工具 | 作用 |
|---|---|
| `beat_plan` | 列出本章决策点（每个必须有 `change`：谁/什么 从 A 变成 B） |
| `beat_list` | 查看拍板进度 |
| `beat_decide` | 记录作者的选择 |
| `beat_gate` | 写正文前体检：还有没拍板的就 `pass: false` |
| `beat_compile` | 编译成 novel-forge 的 `## 本章必写场景` / `## 本章禁止偏离项` |

## 工作流

```
beat_plan（列决策点）
   ↓  逐个 ask_user_question 问作者
beat_decide × N
   ↓
beat_gate  → PASS
   ↓
beat_compile → 细纲片段
   ↓
novel_outline save_chapter + approve
   ↓
novel_write_chapter
```

## 数据落盘

```
<工作区>/.dsh-novel-beat/<书名>/ch012.json
```

每章一个文件，包含全部决策点的选项、影响与发展、作者选择、拍板时间。

**不依赖任何其他插件**：五个工具只读写自己这个目录，不需要 novel-forge、不需要已有大纲或细纲。装了 novel-forge 可以把 `beat_compile` 的结果直接塞进 `novel_outline save_chapter`；没装就把它当写作提纲用，一样能走完。

## 安装

```powershell
# 改完代码要「先卸再装」才会重载
plugin_manager remove_bundle  target=dsh-novel-beat
plugin_manager install_bundle target=D:\插件\plugins\novel-beat
```
