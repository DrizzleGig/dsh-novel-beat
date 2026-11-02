/**
 * dsh-novel-beat — 决策点问询（v0.5）
 *
 * 判定规则（作者定的标准）：
 *   凡是会改变故事状态的节点，都必须由作者拍板；
 *   只描述世界（风光、温度、比喻、环境）的节点，模型自行决定。
 *
 * 两种起点都支持：
 *   - 空白书：作者只给一句创意，边推演边用 append 逐层登记，拍板后再往下推；
 *   - 已有细纲：读细纲，逐拍登记。
 *
 * 落地方式：决策点 = 会往「账本」里写一条的状态变更。
 * 拍板结果落盘到 <dir>/.dsh-novel-beat/<书>/ch<NNN>.json，
 * 再由 beat_compile 编译成 novel-forge 认识的细纲片段。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const inject = ['tools']

const KINDS = ['动作', '知情', '关系', '得失', '状态', '承诺', '时序', '分叉']
const ROOT = '.dsh-novel-beat'

/**
 * 随插件一起安装的技能：让模型自己想起来「该用它」。
 * 注册进 skills 服务的 runtime 层，装完插件即生效，不需要额外安装任何东西。
 */
const SKILL = {
  name: 'novel-beat',
  description: '小说创作中实时拦截剧情分叉：每遇到一个会改变故事走向的节点，就登记成决策点、给出 2-4 个真分叉让作者拍板，没拍板不许往下写。空白书从一句创意开始就能用，不依赖已有大纲或细纲。当用户说「我想写一个…」「写第 N 章」「继续写」「接下来怎么发展」，或任何一次要推进剧情的时候使用。',
  whenToUse: '任何时候要往下推进剧情——从开书的第一句创意，到续写某一章的中段。只要有"接下来发生什么"要定，就用它拦一下。',
  source: 'runtime',
  content: [
    '# novel-beat：往下写之前先拍板',
    '',
    '## 唯一判定规则',
    '',
    '**会改变故事状态的节点，必须问作者；只描述世界的，模型自己决定。**',
    '',
    '- 要问：谁死谁活、谁知道了什么、**信息揭露到什么程度**、关系变了、得到或失去了什么、位置时间跳了、承诺立了、剧情分叉了、金手指或世界观规则变了。',
    '- 尤其要问「这一段把这个秘密抖多少」——信息给到什么程度本身就是剧情决策，不是修辞节奏。',
    '- 不问：风、光、温度、气味、比喻、房间陈设、说话时手放在哪。',
    '- 代码层的等价说法：**凡是能往事实账本里写一条的，都是决策点。**',
    '',
    '## 两种起点',
    '',
    '**空白书（最常见）**：作者只给了一句创意、一个题材、一个金手指的念头。没有大纲、没有细纲、没有前文。',
    '决策点不是"扫"出来的，是**在往下推演的过程中"截"出来的**——你每决定一步"接下来发生什么"，就在动手之前把这一步里变了的东西登记下来。',
    '',
    '**已有细纲**：先读细纲，再逐拍登记。',
    '',
    '## 实时拦截协议（空白书必须遵守）',
    '',
    '1. 作者给创意 → 先把**最上游**的分叉问掉（主角是谁 / 金手指是什么 / 开局在哪个位置 / 第一个对手是谁），一次 1–3 个，不要一口气抛十个。',
    '2. 每拿到一个答案，用 beat_plan(append: true) 补登记下一层分叉，再问下一批。**边推边问，不要先把整章想完再回头拆。**',
    '3. 只要"接下来写什么"里有任何一处会改变状态，就**先登记、先问**，再动笔。',
    '4. 当某个已拍板的答案改写了上游设定（例如作者说"删掉这个金手指"），停下来告诉作者这会波及哪些已写的设定，再继续。',
    '',
    '## 一次推进的流程',
    '',
    '1. **登记** — beat_plan(dir, book, chapter, beats[], context?)',
    '   - change 必须写成「谁/什么 从 A 变成 B」，少于 4 个字会被拒绝。',
    '   - kind 八选一：动作 / 知情 / 关系 / 得失 / 状态 / 承诺 / 时序 / 分叉。',
    '   - **数量由节点定，没有上下限**：节点密就多，节点疏就少。字数和它无关，别为凑数把环境描写拆成决策点。',
    '   - 分几次登记用 append: true，已拍板的不会动；整章重排才用 reset: true。',
    '   - 空白书第一次调用时把创意原文塞进 context，后面翻记录时能对上。',
    '',
    '2. **问人** — 把每个决策点的 2–4 个选项摆给作者（ask_user_question）',
    '   - 选项要真能改变走向，不要「他走过去 / 他慢慢走过去」这种假分叉。',
    '   - 每个选项都要写 impact：**选了之后会发生什么**——对人物和关系的影响、可能引出的后续发展、代价与后患、顺手埋下的伏笔。不是只写代价。',
    '   - **不替作者选**，不写「我建议选 A 就 A 吧」。',
    '',
    '3. **记录** — beat_decide(dir, book, chapter, id, choice)',
    '   - 作者选了你给的选项，就传它的 label；他自己写的内容就照原话传。',
    '   - 作者自己写的内容如果否定了这个节点本身（例如"干脆删掉这个设定"），编译时会被标成「作者改写」，不会照抄原来的状态变更。',
    '',
    '4. **查闸** — beat_gate，pass 之前**绝对不许写正文**。',
    '',
    '5. **编译** — beat_compile，产出「## 本章必写场景」与「## 本章禁止偏离项」。',
    '',
    '6. **接回写作** — 把编译结果当写作约束；装了 novel-forge 就贴进 novel_outline save_chapter，没装就直接当提示词约束用。',
    '',
    '## 不要做的事',
    '',
    '- 不要在 gate 没通过时「先写一版看看」。',
    '- 不要先写完剧情再回头补问。',
    '- 不要用环境描写充当决策点凑数。',
    '- 分批只是交互节奏（一次抛太多作者看不过来），不是数量上限。',
  ].join('\n'),
}

const toText = (value) => [{
  type: 'text',
  text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
}]

function chapterPath(dir, book, chapter) {
  const safeBook = String(book).replace(/[\\/:*?"<>|]/g, '_')
  return join(dir, ROOT, safeBook, `ch${String(chapter).padStart(3, '0')}.json`)
}

async function loadChapter(dir, book, chapter) {
  const path = chapterPath(dir, book, chapter)
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function saveChapter(dir, book, chapter, data) {
  const path = chapterPath(dir, book, chapter)
  await mkdir(dirname(path), { recursive: true })
  data.updatedAt = new Date().toISOString()
  await writeFile(path, JSON.stringify(data, null, 2), 'utf8')
  return path
}

function requireChapter(data, book, chapter) {
  if (!data) {
    throw new Error(`第 ${chapter} 章还没有决策点清单（${book}）。先调用 beat_plan 列出本章会改变剧情走向的节点。`)
  }
  return data
}

const planOutput = {
  type: 'object',
  properties: {
    book: { type: 'string' },
    chapter: { type: 'number' },
    total: { type: 'number' },
    pending: { type: 'number' },
    path: { type: 'string' },
    beats: { type: 'array', items: { type: 'object', properties: {} } },
  },
}

const listOutput = {
  type: 'object',
  properties: {
    book: { type: 'string' },
    chapter: { type: 'number' },
    total: { type: 'number' },
    decided: { type: 'number' },
    pending: { type: 'number' },
    beats: { type: 'array', items: { type: 'object', properties: {} } },
  },
}

const gateOutput = {
  type: 'object',
  properties: {
    pass: { type: 'boolean' },
    chapter: { type: 'number' },
    total: { type: 'number' },
    pending: { type: 'array', items: { type: 'object', properties: {} } },
    message: { type: 'string' },
  },
}

const decideOutput = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string' },
    choice: { type: 'string' },
    remaining: { type: 'number' },
    total: { type: 'number' },
  },
}

const compileOutput = {
  type: 'object',
  properties: {
    markdown: { type: 'string' },
    scenes: { type: 'number' },
    missing: { type: 'array', items: { type: 'string' } },
  },
}

function summarize(data) {
  const beats = data.beats ?? []
  const decided = beats.filter((beat) => beat.status === 'decided').length
  return {
    book: data.book,
    chapter: data.chapter,
    total: beats.length,
    decided,
    pending: beats.length - decided,
    beats: beats.map((beat) => ({
      id: beat.id,
      title: beat.title,
      kind: beat.kind ?? '动作',
      change: beat.change,
      status: beat.status,
      choice: beat.choice ?? null,
      options: beat.options ?? [],
    })),
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register({
    name: 'beat_plan',
    description: [
      '把「接下来这一段里会改变故事状态」的分叉登记成决策点，逐个等作者拍板。往下写正文之前必须先过这一关。',
      '**空白书也能用**：作者只给一句创意时，先登记最上游的几个分叉，拍板后再 append 下一层，边推边问，不要先把剧情想完再回头拆。',
      '判定标准：会影响剧情走向、人物关系、信息知情、持有得失、位置状态的，一律列入；',
      '纯环境描写、比喻、氛围渲染不列入——那些模型自己决定。',
      '每个决策点必须写清 change（谁/什么 从什么变成什么），并给出 2-4 个走向不同的选项；每个选项用 impact 写清「选了会发生什么」（影响、可能的发展、代价、伏笔）。',
      '决策点的数量**没有上下限**，由实际的状态变更节点决定：节点密就多，节点疏就少。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '工作区目录（绝对路径），决策点记录落在其下的 .dsh-novel-beat/ 里' },
        book: { type: 'string', description: '书名' },
        chapter: { type: 'number', description: '章号' },
        append: { type: 'boolean', description: '往已有清单末尾追加（不动已拍板的），用来逐个补点。数量由本章实际的状态变更节点决定，没有上下限' },
        beats: {
          type: 'array',
          description: '决策点列表，按剧情顺序排列',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '一句话标题，如「玉佩怎么到手」' },
              kind: { type: 'string', enum: KINDS, description: '决策类型：动作/知情/关系/得失/状态/承诺/时序/分叉' },
              change: { type: 'string', description: '这一拍会改变什么状态。写清「谁/什么 从 A 变成 B」，写不出状态变更的就不该列入' },
              options: {
                type: 'array',
                description: '给作者的选项，2-4 个；每个都要有 impact，不能是等价选项',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: '选项描述' },
                    impact: { type: 'string', description: '选了它会发生什么：对人物/关系/节奏的影响、可能引出的后续发展、代价与后患、埋下的伏笔（一段话写全，不要只写代价）' },
                  },
                  required: ['label'],
                  additionalProperties: false,
                },
              },
            },
            required: ['title', 'change'],
            additionalProperties: false,
          },
        },
        context: { type: 'string', description: '可选：这一步的创作背景/创意原文（空白书第一次登记时把作者给的创意、题材、金手指念头塞进来，后续翻记录时能对上）' },
        reset: { type: 'boolean', description: '本章已有拍板记录时，传 true 才会覆盖重排' },
      },
      required: ['dir', 'book', 'chapter', 'beats'],
      additionalProperties: false,
    },
    output: {
      schema: planOutput,
      render: (_args, value) => toText(
        `已登记 ${value.total} 个决策点（第 ${value.chapter} 章），待拍板 ${value.pending} 个。\n` +
        `接下来逐个问作者：对每个决策点调用 ask_user_question，把选项原文列给他，用 beat_decide 记录他的选择。\n` +
        `记录文件：${value.path}`,
      ),
    },
    async execute(args) {
      const beats = Array.isArray(args.beats) ? args.beats : []
      if (beats.length === 0) throw new Error('beats 不能为空：本章至少要有一个会改变剧情走向的决策点')

      const existing = await loadChapter(args.dir, args.book, args.chapter)
      const append = args.append === true && existing != null
      if (existing && !append && existing.beats?.some((beat) => beat.status === 'decided') && args.reset !== true) {
        throw new Error(
          `第 ${args.chapter} 章已有拍板记录（${existing.beats.filter((b) => b.status === 'decided').length} 条），` +
          '重新列清单会丢掉作者已经拍过的板。要往后补点请传 append: true；确认整章重排请传 reset: true。',
        )
      }
      const base = append ? (existing.beats ?? []) : []

      const normalized = beats.map((beat, index) => {
        const title = String(beat.title ?? '').trim()
        const change = String(beat.change ?? '').trim()
        if (!title) throw new Error(`第 ${index + 1} 个决策点缺少 title`)
        if (change.length < 4) {
          throw new Error(`决策点「${title}」的 change 太短：必须写清「谁/什么 从 A 变成 B」，写不出状态变更的节点不该列入`)
        }
        const options = Array.isArray(beat.options) ? beat.options : []
        const readImpact = (option) => String(option?.impact ?? option?.cost ?? '').trim()
        if (options.length > 0 && options.some((option) => !readImpact(option))) {
          throw new Error(`决策点「${title}」有选项没写 impact：每个选项都要说清「选了会发生什么」`)
        }
        return {
          id: `b${base.length + index + 1}`,
          title,
          kind: beat.kind ?? '动作',
          change,
          options: options.map((option) => ({
            label: String(option?.label ?? '').trim(),
            impact: readImpact(option),
          })).filter((option) => option.label),
          status: 'pending',
          choice: null,
          note: null,
          decidedAt: null,
        }
      })

      const merged = append ? [...base, ...normalized] : normalized
      const context = String(args.context ?? '').trim() || existing?.context || null
      const data = { book: args.book, chapter: args.chapter, context, beats: merged }
      const path = await saveChapter(args.dir, args.book, args.chapter, data)
      const summary = summarize(data)
      return { ...summary, path }
    },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'beat_list',
    description: '查看某章已登记的决策点与拍板状态。不传 chapter 则只看待办统计。',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '工作区目录（绝对路径）' },
        book: { type: 'string', description: '书名' },
        chapter: { type: 'number', description: '章号' },
        onlyPending: { type: 'boolean', description: 'true 只看还没拍板的' },
      },
      required: ['dir', 'book', 'chapter'],
      additionalProperties: false,
    },
    output: {
      schema: listOutput,
      render: (_args, value) => {
        const lines = value.beats.map((beat) => {
          const mark = beat.status === 'decided' ? '✓' : '○'
          const choice = beat.choice ? ` → ${beat.choice}` : ''
          return `${mark} ${beat.id} [${beat.kind}] ${beat.title}${choice}`
        })
        return toText(
          `第 ${value.chapter} 章：共 ${value.total} 个决策点，已拍板 ${value.decided}，待拍板 ${value.pending}\n` +
          (lines.length ? lines.join('\n') : '（没有匹配的决策点）'),
        )
      },
    },
    async execute(args) {
      const data = requireChapter(await loadChapter(args.dir, args.book, args.chapter), args.book, args.chapter)
      const summary = summarize(data)
      if (args.onlyPending) summary.beats = summary.beats.filter((beat) => beat.status !== 'decided')
      return summary
    },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'beat_decide',
    description: '记录作者对某个决策点的拍板结果。作者选了哪个 option 就把它的 label 传进来；他自己写的内容就原样传 choice。',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '工作区目录（绝对路径）' },
        book: { type: 'string', description: '书名' },
        chapter: { type: 'number', description: '章号' },
        id: { type: 'string', description: '决策点 id（b1、b2…）' },
        choice: { type: 'string', description: '作者的选择：选项 label，或作者自己写的内容' },
        note: { type: 'string', description: '补充说明（可选）' },
      },
      required: ['dir', 'book', 'chapter', 'id', 'choice'],
      additionalProperties: false,
    },
    output: {
      schema: decideOutput,
      render: (_args, value) => toText(
        value.remaining > 0
          ? `${value.id} 已记录：${value.choice}\n还剩 ${value.remaining} 个决策点待拍板（共 ${value.total}）。`
          : `${value.id} 已记录：${value.choice}\n本章 ${value.total} 个决策点全部拍板，可以 beat_compile 编译细纲了。`,
      ),
    },
    async execute(args) {
      const data = requireChapter(await loadChapter(args.dir, args.book, args.chapter), args.book, args.chapter)
      const beat = data.beats.find((item) => item.id === args.id)
      if (!beat) throw new Error(`找不到决策点 ${args.id}（第 ${args.chapter} 章）`)
      const choice = String(args.choice ?? '').trim()
      if (!choice) throw new Error('choice 不能为空')
      beat.status = 'decided'
      beat.choice = choice
      beat.note = args.note ? String(args.note).trim() : null
      beat.decidedAt = new Date().toISOString()
      await saveChapter(args.dir, args.book, args.chapter, data)
      const remaining = data.beats.filter((item) => item.status !== 'decided').length
      return { id: beat.id, status: beat.status, choice: beat.choice, remaining, total: data.beats.length }
    },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'beat_gate',
    description: '写正文前的体检：本章决策点是否全部拍板。有未拍板的就返回 pass=false 并列出，此时不许写正文。',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '工作区目录（绝对路径）' },
        book: { type: 'string', description: '书名' },
        chapter: { type: 'number', description: '章号' },
      },
      required: ['dir', 'book', 'chapter'],
      additionalProperties: false,
    },
    output: {
      schema: gateOutput,
      render: (_args, value) => toText(value.message),
    },
    async execute(args) {
      const data = await loadChapter(args.dir, args.book, args.chapter)
      if (!data) {
        return {
          pass: false,
          chapter: args.chapter,
          total: 0,
          pending: [],
          message: `第 ${args.chapter} 章还没有决策点清单。写正文之前必须先 beat_plan 列出会改变剧情走向的节点，并逐个让作者拍板。`,
        }
      }
      const summary = summarize(data)
      const pending = summary.beats.filter((beat) => beat.status !== 'decided')
      if (summary.total === 0) {
        return { pass: false, chapter: args.chapter, total: 0, pending: [], message: `第 ${args.chapter} 章的决策点清单是空的。` }
      }
      if (pending.length > 0) {
        return {
          pass: false,
          chapter: args.chapter,
          total: summary.total,
          pending,
          message:
            `还有 ${pending.length} 个决策点没拍板，不许写正文：\n` +
            pending.map((beat) => `- ${beat.id} [${beat.kind}] ${beat.title}`).join('\n'),
        }
      }
      return {
        pass: true,
        chapter: args.chapter,
        total: summary.total,
        pending: [],
        message: `第 ${args.chapter} 章 ${summary.total} 个决策点全部拍板，可以写正文了。`,
      }
    },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'beat_compile',
    description: '把已拍板的决策点编译成 novel-forge 认识的细纲片段（## 本章必写场景 / ## 本章禁止偏离项），供 novel_outline save_chapter 直接使用。',
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '工作区目录（绝对路径）' },
        book: { type: 'string', description: '书名' },
        chapter: { type: 'number', description: '章号' },
      },
      required: ['dir', 'book', 'chapter'],
      additionalProperties: false,
    },
    output: {
      schema: compileOutput,
      render: (_args, value) => toText(
        value.missing.length
          ? `还有 ${value.missing.length} 个决策点未拍板，先补齐再编译：${value.missing.join('、')}`
          : value.markdown,
      ),
    },
    async execute(args) {
      const data = requireChapter(await loadChapter(args.dir, args.book, args.chapter), args.book, args.chapter)
      const pending = data.beats.filter((beat) => beat.status !== 'decided')
      if (pending.length > 0) {
        return { markdown: '', scenes: 0, missing: pending.map((beat) => `${beat.id} ${beat.title}`) }
      }
      const pickedOption = (beat) => (beat.options ?? []).find((option) => option.label === beat.choice) ?? null
      const sceneLine = (beat) => {
        const picked = pickedOption(beat)
        // 作者在我们给的选项里选了一个：节点原义成立，附上走向。
        if (picked) {
          return `- ${beat.title}：${beat.change}${picked.impact ? `（走向：${picked.impact}）` : ''}`
        }
        // 作者自己写的内容 —— 可能直接否定了这个节点（如「删掉这个金手指」）。
        // 这时绝不能照抄 change，否则细纲会自相矛盾；以拍板结果为准。
        return `- ${beat.title}：${beat.choice}（作者改写了这个节点，原始状态变更为「${beat.change}」，以拍板为准）`
      }
      const scenes = data.beats.map(sceneLine)
      const forbidden = data.beats.map((beat) => `- 不得改写已拍板决策：${beat.title} → ${beat.choice}`)
      const markdown = [
        '## 本章必写场景',
        ...scenes,
        '',
        '## 本章禁止偏离项',
        ...forbidden,
        '- 环境、天气、比喻、氛围等不影响走向的描写可自由发挥，但不得改变上述任何一条已拍板决策',
      ].join('\n')
      return { markdown, scenes: data.beats.length, missing: [] }
    },
  }))

  // 技能随插件安装即生效；skills 服务不存在时静默跳过，不让整个插件挂掉。
  const skills = ctx.get('skills')
  if (skills) {
    ctx.effect(() => skills.register(SKILL))
  }
}
