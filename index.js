/**
 * @local/novel-beat — 决策点问询（v0.1）
 *
 * 判定规则（作者定的标准）：
 *   凡是会改变故事状态的节点，都必须由作者拍板；
 *   只描述世界（风光、温度、比喻、环境）的节点，模型自行决定。
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
      '列出本章所有「会改变故事状态」的决策点，逐个等待作者拍板。写正文之前必须先调用本工具。',
      '判定标准：会影响剧情走向、人物关系、信息知情、持有得失、位置状态的，一律列入；',
      '纯环境描写、比喻、氛围渲染不列入——那些模型自己决定。',
      '每个决策点必须写清 change（谁/什么 从什么变成什么），并给出 2-4 个有代价差异的选项，或 1 个选项+自由填写。',
    ].join(''),
    parameters: {
      type: 'object',
      properties: {
        dir: { type: 'string', description: '工作区目录（绝对路径），决策点记录落在其下的 .dsh-novel-beat/ 里' },
        book: { type: 'string', description: '书名' },
        chapter: { type: 'number', description: '章号' },
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
                description: '给作者的选项，2-4 个；每个都要有代价，不能是等价选项',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', description: '选项描述' },
                    cost: { type: 'string', description: '选它的代价/后果（节奏、人物、伏笔、下一章要还的债）' },
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
      if (existing && existing.beats?.some((beat) => beat.status === 'decided') && args.reset !== true) {
        throw new Error(
          `第 ${args.chapter} 章已有拍板记录（${existing.beats.filter((b) => b.status === 'decided').length} 条），` +
          '重新列清单会丢掉作者已经拍过的板。确认要重排请传 reset: true。',
        )
      }

      const normalized = beats.map((beat, index) => {
        const title = String(beat.title ?? '').trim()
        const change = String(beat.change ?? '').trim()
        if (!title) throw new Error(`第 ${index + 1} 个决策点缺少 title`)
        if (change.length < 4) {
          throw new Error(`决策点「${title}」的 change 太短：必须写清「谁/什么 从 A 变成 B」，写不出状态变更的节点不该列入`)
        }
        const options = Array.isArray(beat.options) ? beat.options : []
        return {
          id: `b${index + 1}`,
          title,
          kind: beat.kind ?? '动作',
          change,
          options: options.map((option) => ({
            label: String(option?.label ?? '').trim(),
            cost: option?.cost ? String(option.cost).trim() : '',
          })).filter((option) => option.label),
          status: 'pending',
          choice: null,
          note: null,
          decidedAt: null,
        }
      })

      const data = { book: args.book, chapter: args.chapter, beats: normalized }
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
      const scenes = data.beats.map((beat) => `- ${beat.title}：${beat.change}`)
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
}
