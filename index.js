/**
 * dsh-novel-beat — 作者拍板 + 全书账本（v0.7.0）
 *
 * 独立运行：不 import 任何其他插件，不依赖 novel-forge。
 * 数据落在 <工作区根>/.dsh-novel-beat/<book>/book.json（lib/store.js）。
 *
 * 默认关闭：装上不注册工具、不注入规则、不动 guard。
 * 作者 `/beat on` 后三层强制一起生效：
 *   L1 技能只在本会话出现（skills 按 agent 作用域注册）
 *   L2 系统提示常驻"先拍板再写"的规则（systemPrompt.section，关闭时返回空串）
 *   L3 写正文被 guard 拦下（根 ctx 全局注册，函数内按 agent 判模式）
 */
import { toolDefinitions, executeRevert, executeFork, listSegments } from './lib/tools.js'
import {
  getSessionState,
  setSessionMode,
  setSessionBodyRoots,
  setSessionVoice,
  readActiveBook,
  readBookData,
  resolveWorkspaceRoot,
  computeRevision,
} from './lib/store.js'
import { loadVoiceGuidance } from './lib/voice-fit.js'
import { createReadOnlyService } from './lib/service.js'
import { evaluateWrite, DEFAULT_BODY_ROOTS, WRITE_TOOL_NAMES } from './lib/enforce.js'
import { DECISION_STATUS, OPEN_DECISION_STATUSES, TASK_STATE } from './lib/schema.js'
import { isBookWriteBlockedSync } from './lib/transaction.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join as joinPath } from 'node:path'

export const inject = ['tools', 'commands', 'workingDirectory', 'agents']

const SEGMENT_LOOP_ENABLED = process.env.DSH_NOVEL_BEAT_SEGMENT_LOOP === '1'

/** 插件版本以 package.json 为准（发布时只改一处）。 */
let VERSION = '0.0.0'
try {
  const pkgPath = joinPath(dirname(fileURLToPath(import.meta.url)), 'package.json')
  VERSION = JSON.parse(readFileSync(pkgPath, 'utf8')).version ?? VERSION
} catch {
  // 读不到就当未知版本，不影响功能。
}

/** L2：模式开着时常驻系统提示。关闭时 text() 返回空串，等于不存在。 */
const SYSTEM_RULES = [
  '## 拍板模式（novel-beat）已开启',
  '',
  '这一会话由作者开启了"遇到岔路先问、答完接着写"的硬规则，插件在引擎层执行它：',
  '',
  SEGMENT_LOOP_ENABLED
    ? '1. segment-loop 章的节奏是**追加一个自然段 → `beat_plan` 检查 → 有岔路就 `beat_next` 问作者 → 作者选择对应的下一段再追加**；每个工具调用都用最新 revision。'
    : '1. 节奏是**写一段 → 遇到岔路 → 问一次 → 按答案接着写 → 登记这一段 → 再问下一个**。',
  SEGMENT_LOOP_ENABLED
    ? '   不要攒一批决策点一次问完：`beat_next` 一次只问一个；作者选择后，必须先用 `beat_append` 登记对应的下一段，才会放行下一个问题。'
    : '   不要攒一批决策点一次问完：`beat_next` 一次只问一个，而且上一条还没用 `beat_segment` 登记时，它会拒绝发下一个（`segment-required`）。',
  SEGMENT_LOOP_ENABLED
    ? '2. segment-loop 章不直接写入正文目录；只用 `beat_append` 保存单段。每段追加后必须 `beat_plan` 检查，含岔路时必须等作者选择。'
    : '2. 本章还有没问的岔路（`beat_plan` 登记了但没问）时，往正文目录写会被拒（`PENDING_DECISIONS`）。',
  SEGMENT_LOOP_ENABLED
    ? '   不得把该章切回 legacy `beat_segment`；章末用 `beat_finish` 合并，再把返回的全文原样传给 `beat_verify`。'
    : '   刚拍完板、正在写那一段时的写是允许的；写完用 `beat_segment` 登记，闸才会放下一题。',
  SEGMENT_LOOP_ENABLED
    ? '3. segment-loop 段落写错时，用 `beat_revert` 回退目标段及其后缀，再以新 operationId 重新追加；不要手动改 artifact。'
    : '3. 写过的东西要改：用 `beat_revert`（退第 N 段 = 正文截到它的起点，这一段和它后面所有段一起作废），不要静默覆盖。',
  '   只是错字、语序、环境描写：`beat_adjust`（不改故事状态，也不用问作者）。',
  SEGMENT_LOOP_ENABLED
    ? '4. segment-loop 章允许没有决策点；所有段都有有效检查且没有待选择后，用 `beat_finish`，再以其返回的文本调用 `beat_verify`。'
    : '4. 零决策章可以通过，但必须先 `beat_plan(beats: [], reason, path 或 text)` 登记零候选扫描；正文 hash 或相关输入变化后重扫。无有效 scan 收据时 `beat_verify` 会以 `scan-required` / `stale-scan` 拒绝。',
  SEGMENT_LOOP_ENABLED
    ? '5. 一次只登记一个决策点：写到那个岔路才 `beat_plan`，不要预先规划整章（那会让每章固定成"开局 / 中段 / 章末钩子"三条）。模型只提案；闸门核验；作者拍板。'
    : '5. 一次只登记一个决策点：模型只提案，闸门核验状态差分和 EvidenceRef，作者拍板。新提案须用 gate 与六要素；写到那个岔路才 `beat_plan`，不要预先规划整章。',
  '6. 作者自己插了一条岔路（`/beat fork`，账本里是 `f-x`、状态 open）时，下一步必须先 `beat_plan(…, forkId: \'f-x\', beats: […])` 把它写成决策点；在那之前 `beat_next` 会拒发新题（`fork-required`）。',
  SEGMENT_LOOP_ENABLED
    ? '7. 每次 `beat_append` 后、下一次追加之前，必须对最新段调用 `beat_plan`：有真岔路就登记这一个；确实没有就传 `beats: [] + reason`。这确保每个段落都经过续写检查。'
    : '7. 每登记完一段（`beat_segment`），写下一段之前必须先做一次**续写检查**：后面有真岔路就 `beat_plan` 登记这一个；确实没有就 `beat_plan(beats: [], reason: \'为什么不用作者拍板\', path 或 text)`。没做检查就写正文会被拒（`CONTINUATION_CHECK`）。这不是形式——它保证段落边界是顺着剧情长的，而不是事后切的。',
  '8. 作者选的选项要是会改掉账本里的既有设定，`beat_next` 不会硬失败：它会让你去问作者"是否允许这次剧情改这个设定"，作者同意后再 `beat_next(confirmCanon: true)` 提交。',
  '9. 选项要用故事语言写：代价、后果、风险都写成具体的人事，不写数值、不写状态键；状态变化用「原来怎样 → 现在怎样」的中文标签，标签缺了就用「这一处 / 原来的样子 / 新的样子」，绝不把内部 id 或数字增减摆给作者看。',
  '10. 提问卡的最后一行是宿主的自由输入行：作者可以直接写自己的走向。不要在正文里再列一遍选项，也不要替他拟第四个选项；作者写了原文后，先 `beat_decide`（choice 用作者原话 + changes）落账，再写正文。',
  '11. 生成选项前先看最近一次工具结果里的 `voiceGuidance`：可用时按它写 action/costs/outcomes 的切入点、语气与代价感；不可用时按中性写。不得借文风改写既定事实、伪造证据，或把风格差异写成难度/智商差异。',
  '',
  '把这条规则当成作者亲手设的约束：不解释、不绕过、不"先写一版看看"。',
  ...(SEGMENT_LOOP_ENABLED ? [
    '',
    '## 0.11 候选实验：段落循环',
    '本开关只新增流程：仅对首次由 beat_append 建立的 writingMode: segment-loop 章节使用新规则；已有/legacy 章节继续遵循 beat_segment 流程。',
    '对 segment-loop 章节，每次 append 一个自然段，段后必须 beat_plan 并绑定最新 segmentId/segmentHash/expectedRevision；有岔路先 beat_next 等作者，下一次 append 才登记其输出段；无岔路用 beats:[] + reason。章末 beat_finish 后，把它返回的 text 原样交给 beat_verify。不得与 beat_segment 混用；本实验不写正文/章节文件。',
  ] : []),
].join('\n')

const SKILL = {
  name: 'novel-beat',
  description: '小说创作中实时拦截剧情分叉：每遇到一个会改变故事走向的节点，就登记成决策点、给出 2–4 个真分叉让作者拍板；拍板写进全书账本，写后还能校验。仅在作者用 /beat on 开启的本会话中出现。当用户说「我想写一个…」「写第 N 章」「继续写」「接下来怎么发展」，或任何一次要推进剧情的时候使用。',
  whenToUse: '任何时候要往下推进剧情——从开书的第一句创意，到续写某一章的中段。只要有"接下来发生什么"要定，就用它拦一下。',
  source: 'runtime',
  content: [
    '# novel-beat：遇到岔路先问，答完接着写',
    '',
    '## 启用',
    '',
    '这个技能只出现在作者用 `/beat on` 开启的会话里。开启即代表作者接受硬规则：',
    '**有岔路没问完，就不许往下写**（引擎层会拒，`PENDING_DECISIONS`）。',
    ...(SEGMENT_LOOP_ENABLED ? [
      '0.11 实验流程只适用于首次由 `beat_append` 建立的 segment-loop 章节；已有/legacy 章节继续使用 `beat_segment` 和原有正文流程。',
    ] : []),
    '',
    '## 唯一判定规则',
    '',
    '**会改变故事状态的节点，必须问作者；只描述世界的，模型自己决定。**',
    SEGMENT_LOOP_ENABLED
      ? '模型只能提交候选；实验流程按既有段落检查和作者选择推进，只有作者选择才会写入已选状态。'
      : '模型只能提交候选；状态键白名单、当前 canon、EvidenceRef 的 SHA-256/UTF-16 offset/quote 和选项差分由闸门确定性核验；只有作者选择才会写入已选状态。旧账证据保持 legacy，不补造锚点。',
    '',
    '- 要问：谁死谁活、谁知道了什么、**信息揭露到什么程度**、关系变了、得到或失去了什么、位置时间跳了、承诺立了、剧情分叉了、金手指或世界观规则变了。',
    '- 不问：风、光、温度、气味、比喻、房间陈设、说话时手放在哪。',
    '- 代码层的等价说法：**凡是能往 canon 里写一条的，都是决策点。**',
    '',
    '## 一章的节奏（必须按这个走）',
    '',
    '1. **看账本** — `beat_list(context:true)`：拿全书 canon、未回收义务、最近决策。写下一章前必看。',
    SEGMENT_LOOP_ENABLED
      ? '2. **先写开场** — 直接用 `beat_append` 追加这一章开头的一个自然段；该段也必须通过后续续写检查。'
      : '2. **先写开场** — 直接写这一章开头那一段（还没遇到岔路的部分）。这一步允许，也建议：作者想看到内容，再决定岔路。',
    SEGMENT_LOOP_ENABLED
      ? '3. **遇到第一个岔路** — `beat_plan(dir, book, chapter, beats)` 只登记**这一个**决策点（一次一个；多给会被拒），给 2–4 个真分叉；每个选项写 `impact` 和 `changes`（entity / key / from / to / evidence），不同选项的 `changes` 必须不同。'
      : '3. **遇到第一个岔路** — `beat_plan` 只提交一个候选 gate：稳定 entity/key/from/to、精确 EvidenceRef、reason/confidence；给 2–4 个选项，每项必须写 action、costs、outcomes、informationGain、risks、changes。差分必须真实不同，不能只换措辞或省略代价后果。',
    '4. **问一次** — `beat_next`：插件亲手把**一个**决策摆给作者并等回答。不要一次问三个，也不要自己替作者选。',
    SEGMENT_LOOP_ENABLED
      ? '5. **按答案续写** — 作者选择后，只生成与选择对应的下一段，调用 `beat_append` 登记；未登记前 `beat_next` 不会发下一个问题。'
      : '5. **按答案接着写这一段** — 写完用 `beat_segment` 登记（挂到刚拍板的决策上，存快照 + hash）。',
    SEGMENT_LOOP_ENABLED
      ? '5b. **续写检查** — 每次追加后、下一次追加前都回答"后面还有没有真岔路"：'
      : '   没登记之前 `beat_next` 会拒发下一个（`segment-required`）——这就是"写一段再问下一个"的闸。',
    SEGMENT_LOOP_ENABLED
      ? '   有 → `beat_plan` 登记这一个；确实没有 → `beat_plan(beats: [], reason: \'…\')` 说明为什么不用作者拍板。未完成检查或作者选择前，不得追加下一段。'
      : '5b. **续写检查** — 登记完一段，写下一段之前必须先回答"后面还有没有真岔路"：',
    SEGMENT_LOOP_ENABLED
      ? '   宁可老实说"这里是过渡"，也不要造一个假岔路。'
      : '   有 → `beat_plan` 登记这一个（就接回第 3 步）；确实没有 → `beat_plan(beats: [], reason: \'…\')` 说明为什么不用作者拍板。',
    SEGMENT_LOOP_ENABLED
      ? ''
      : '   没回答之前往正文写会被拒（`CONTINUATION_CHECK`）。宁可老实说"这里是过渡"，也不要造一个假岔路。',
    '6. **遇到下一个岔路** — 回到第 3 步，重复。',
    SEGMENT_LOOP_ENABLED
      ? '7. **这一章写完** — `beat_finish` 确定性合并并返回全文 → 将全文原样交给 `beat_verify(text)`。本实验不写正文文件。'
      : '7. **这一章写完** — 零决策章先 `beat_plan(beats: [], reason, path 或 text)` 绑定最终正文；已有段落文件时可省略来源。依赖大纲/canon/作者回执时附 sourceRefs。再 `beat_compile`（可选）→ `beat_verify`（`text` 或 `path`）：证据、禁项、到期义务、段落漂移、有没有没登记的正文。',
    '',
    '## 改与退',
    '',
    '- 只是错字、语序、环境描写：`beat_adjust`（不改变故事状态，不用问作者）。',
    SEGMENT_LOOP_ENABLED
      ? '- segment-loop 段落写错了：用 `beat_revert` 回退目标段及其后缀，再用新 operationId 通过 `beat_append` 重写；不要手改 artifact。'
      : '- 写错了、作者说"这一段不行、重写"：`beat_revert`（退第 N 段 = 正文截到它的起点，这一段和它后面所有段一起作废；返回的话就是让模型从哪重写）。作者也可以自己敲 `/beat revert`。',
    '- 作者改主意但没写错：`beat_adjust` 的 `waive` / `supersede`，必须写 reason。',
    '',
    '## 作者插的岔路',
    '',
    '作者比你更清楚哪里该有一个岔路。他用 `/beat fork 要决定什么` 插的岔路会记在账本里（`f-x`、状态 open）——',
    '这时你不能往下问新的，必须先 `beat_plan(dir, book, chapter, forkId: \'f-x\', beats: [2–4 个选项])` 把它写成决策点，再 `beat_next`。',
    '不写就 `fork-required`；写完之后那条岔路会变成 `planned` 并挂到你登记的决策上。',
    '',
    '## 纪律',
    '',
    '- 不先写完再补问；不攒一批决策点一次问完。',
    '- 不用环境描写凑决策点；不为凑数拆节点。',
    SEGMENT_LOOP_ENABLED
      ? '- 不静默覆盖正文或段落 artifact；segment-loop 内容要按"改与退"回退后重写。'
      : '- 不静默覆盖已经写过的正文；要改就按"改与退"走。',
    '- 作者选的选项会改掉账本里的既有设定时，不替他说"可以"：先问"是否允许这次剧情改这个设定"，同意后才 `beat_next(confirmCanon: true)`。',
    '- 不依赖 novel-forge；`format:\'novel-forge\'` 只是可选导出。',
  ].join('\n'),
}

function sessionKey(context) {
  return context?.agent?.id
    ?? context?.session?.agent?.id
    ?? context?.session?.id
    ?? context?.sessionId
    ?? null
}
/** 故事总控是否已安装（装了它就是总开关，本插件自己的开关降级为「独立模式」的偏好）。 */
function conductorInstalled(ctx) {
  try {
    const conductor = ctx.get?.('novelConductor')
    return typeof conductor?.isDriving === 'function'
  } catch {
    return false
  }
}

/**
 * 本会话的实际生效状态：
 *   装了 conductor → 只看它接管没接管（beat 自己的按钮优先级更低，此时不生效）；
 *   没装 conductor → 看本插件自己的开关（独立模式，和以前完全一样）。
 */
function effectiveOn(ctx, manualOn, key) {
  if (!conductorInstalled(ctx)) return manualOn
  if (!key) return false
  try {
    return ctx.get('novelConductor').isDriving(key) === true
  } catch {
    return false
  }
}

const BEAT_TOOL_NAMES = toolDefinitions({ segmentLoop: SEGMENT_LOOP_ENABLED }).map((definition) => definition.name)

/** 从账本里推断"当前正在写哪一章、还有几个决策没拍板"。 */
export function gateFromBook(data) {
  if (!data) return { chapter: null, open: 0, chapters: {} }

  // 按章汇总：guard 认得出目标文件是"第 N 章"时，就用这份数据判第 N 章。
  // awaitingSegment：已拍板但还没 beat_segment 登记——这时允许写（正在写那一段），不算"还有没问的岔路"。
  const chapters = {}
  for (const decision of data.decisions ?? []) {
    const key = String(decision.chapter)
    const entry = chapters[key]
      ?? (chapters[key] = { total: 0, open: 0, awaitingSegment: 0, pendingConfirm: 0, pendingCustom: 0, needsCheck: false })
    entry.total += 1
    if (decision.status === DECISION_STATUS.ANSWERED && decision.pendingChoice) {
      // 作者选了一个会改设定的选项，正等作者确认"能不能改"——这时不能往下写。
      entry.pendingConfirm += 1
    } else if (decision.status === DECISION_STATUS.ANSWERED && decision.pendingCustom) {
      // 0.11.0：作者自己写了走向，原文已入账，但模型还没补结构化 changes——补完之前不能写正文。
      entry.pendingCustom += 1
    } else if (OPEN_DECISION_STATUSES.includes(decision.status)) {
      entry.open += 1
    } else if (
      decision.status === DECISION_STATUS.COMMITTED
      && !decision.segmentId
      && decision.legacyReceipt !== true
    ) {
      entry.awaitingSegment += 1
    }
  }
  // 刚登记完一段正文 → 下一次写正文前必须先做一次续写检查（详见 lib/enforce.js）。
  for (const [key, state] of Object.entries(data.chapters ?? {})) {
    if (state?.continuationCheckRequired !== true) continue
    const entry = chapters[key] ?? (chapters[key] = { total: 0, open: 0, awaitingSegment: 0, pendingCustom: 0, needsCheck: false })
    entry.needsCheck = true
  }

  const activeTask = [...(data.tasks ?? [])]
    .reverse()
    .find((task) => task.state !== TASK_STATE.COMPLETED)
  if (activeTask) {
    return {
      chapter: activeTask.chapter,
      open: chapters[String(activeTask.chapter)]?.open ?? 0,
      chapters,
    }
  }
  const openChapters = Object.keys(chapters)
    .filter((key) => chapters[key].open > 0)
    .map(Number)
  if (openChapters.length > 0) {
    const chapter = Math.max(...openChapters)
    return { chapter, open: chapters[String(chapter)].open, chapters }
  }
  const lastDecision = (data.decisions ?? []).at(-1)
  return { chapter: lastDecision?.chapter ?? null, open: 0, chapters }
}

export async function apply(ctx) {
  const commands = ctx.get('commands')
  const workingDirectory = ctx.get('workingDirectory')
  const agents = ctx.get('agents')
  const systemPrompt = ctx.get('systemPrompt')
  const userQuestions = ctx.get('userQuestions')
  // beat_next 用这个亲手问作者；拿不到服务就退化成"模型自己问 + beat_decide 落账"。
  const ask = typeof userQuestions?.ask === 'function'
    ? (request) => userQuestions.ask(request)
    : null
  const modeCache = new Map()
  const modeSeq = new Map()
  const agentsById = new Map()
  const gateCache = new Map()
  const restrictions = new Map()
  const skillRegistrations = new Map()

  const dirFor = async (agent) => {
    if (!workingDirectory?.ensure) return null
    try {
      return await workingDirectory.ensure(agent)
    } catch {
      return null
    }
  }

  /** guard 必须同步：这里只取"当前会话的工作目录"，拿不到就退化成不拦。 */
  const syncDirFor = (agent) => {
    try {
      return workingDirectory?.get?.(agent?.session) ?? null
    } catch {
      return null
    }
  }

  const disposeSkill = (id) => {
    const dispose = skillRegistrations.get(id)
    if (!dispose) return
    skillRegistrations.delete(id)
    try {
      dispose()
    } catch {
      // 作用域可能已先释放。
    }
  }

  /** L1：技能只在本会话开启时出现；关闭即撤下。 */
  const ensureSkill = (agent, on) => {
    if (!on) {
      disposeSkill(agent.id)
      return
    }
    if (skillRegistrations.has(agent.id)) return
    const agentCtx = agent.ctx
    const skills = agentCtx?.get?.('skills') ?? ctx.get('skills')
    if (!skills?.register) return
    const install = () => skills.register(SKILL)
    const dispose = typeof agentCtx?.effect === 'function'
      ? agentCtx.effect(install)
      : (typeof ctx.effect === 'function' ? ctx.effect(install) : install())
    skillRegistrations.set(agent.id, dispose)
  }

  /** 关闭时把 beat_* 从本会话工具表里隐掉。 */
  const applyRestriction = (agent, on) => {
    const previous = restrictions.get(agent.id)
    if (previous) {
      try {
        previous()
      } catch {
        // 旧的 restrict 已随 agent 作用域释放，清引用即可。
      }
      restrictions.delete(agent.id)
    }
    if (on) return

    const agentCtx = agent.ctx
    if (agentCtx?.tools?.restrict) {
      const install = () => agentCtx.tools.restrict({ deny: BEAT_TOOL_NAMES })
      const dispose = typeof agentCtx.effect === 'function'
        ? agentCtx.effect(install)
        : install()
      restrictions.set(agent.id, dispose)
    }
  }

  /**
   * 刷新一个会话的三层状态。guard 不能 await，所以它读的是这份缓存；
   * 每次 beat_* 工具跑完、每次 /beat、每个 agent 建立时都会刷新。
   */
  const refreshAgent = async (agent) => {
    if (!agent?.id) return null
    const dir = await dirFor(agent)
    if (!dir) {
      modeCache.set(agent.id, false)
      gateCache.set(agent.id, { on: false, chapter: null, open: 0, chapters: {}, bodyRoots: DEFAULT_BODY_ROOTS, dir: null })
      disposeSkill(agent.id)
      applyRestriction(agent, false)
      return null
    }

    const settings = await getSessionState(dir, agent.id)
    const on = effectiveOn(ctx, settings.mode === 'on', agent.id)
    const bodyRoots = settings.bodyRoots ?? DEFAULT_BODY_ROOTS

    let gate = { chapter: null, open: 0, chapters: {} }
    let active = null
    let writePaused = false
    try {
      active = await readActiveBook(dir)
      if (on) gate = gateFromBook(active?.data ?? null)
      writePaused = Boolean(active?.book && isBookWriteBlockedSync(dir, active.book))
    } catch {
      // 无法确认事务恢复状态时，对受保护正文写 fail closed。
      writePaused = true
      gate = gateCache.get(agent.id) ?? gate
    }
    const activeBook = active?.book ?? gateCache.get(agent.id)?.activeBook ?? null

    modeCache.set(agent.id, on)
    gateCache.set(agent.id, { on, bodyRoots, dir, activeBook, writePaused, ...gate })
    ensureSkill(agent, on)
    applyRestriction(agent, on)
    return { on, dir, bodyRoots, ...gate }
  }

  // ── 扩展窗口：进程内只读服务 novelBeat ─────────────────────────────────
  // 给兄弟插件用（fade 的账本注入、conductor 的任务适配、后续 voice/fanfic…）。
  // 只读：查询与订阅，**不提供任何写入或改状态的入口**——剧情决策权仍在作者与 beat 工具手里。
  const commitListeners = new Set()
  const emitCommit = (payload) => {
    for (const listener of [...commitListeners]) {
      try {
        listener(payload)
      } catch {
        // 订阅者自己的异常不能影响插件主流程。
      }
    }
  }

  const resolveBookFor = async (cwd) => {
    if (typeof cwd !== 'string' || cwd === '') return null
    try {
      const active = await readActiveBook(cwd)
      if (!active) return null
      return { book: active.book, root: resolveWorkspaceRoot(cwd) }
    } catch {
      return null
    }
  }

  const novelBeatApi = {
    version: VERSION,
    ...createReadOnlyService({ version: VERSION, gateFromBook }),
    /** 这个会话是不是开着拍板（agentId 传 SessionId 字符串）。 */
    isOn(agentId) {
      return modeCache.get(String(agentId)) === true
    },
    /** 找"这个工作区现在正在写的那本书"（按 book.json 的最近改动）。 */
    async resolveBook(cwd) {
      const found = await resolveBookFor(cwd)
      return found ? { book: found.book, dir: found.root } : null
    },
    /** 只读快照：账本里这一章/这本书的决策、canon、义务、段落。 */
    async query({ cwd, book, chapter } = {}) {
      const found = await resolveBookFor(cwd)
      if (!found) return null
      const target = typeof book === 'string' && book ? book : found.book
      const { data } = await readBookData(found.root, target)
      const scope = (list) => (chapter == null ? (list ?? []) : (list ?? []).filter((item) => item.chapter === chapter))
      return {
        book: target,
        /** @deprecated 保留一个 minor；请改用 schemaVersion，插件版本见 identity().version。 */
        version: data.schemaVersion,
        schemaVersion: data.schemaVersion,
        revision: computeRevision(data),
        chapter: chapter ?? null,
        decisions: scope(data.decisions).map((decision) => ({
          id: decision.id,
          chapter: decision.chapter,
          title: decision.title,
          status: decision.status,
          choice: decision.chosen?.label ?? decision.answerText ?? null,
          segmentId: decision.segmentId ?? null,
        })),
        canon: (data.canon ?? []).map((entry) => ({
          entity: entry.entity,
          key: entry.key,
          value: entry.value,
          chapter: entry.chapter ?? null,
        })),
        obligations: (data.obligations ?? [])
          .filter((entry) => chapter == null || entry.dueChapter === chapter || entry.sourceChapter === chapter)
          .map((entry) => ({
            id: entry.id,
            text: entry.text,
            status: entry.status,
            dueChapter: entry.dueChapter ?? null,
            sourceDecision: entry.sourceDecision ?? null,
          })),
        segments: scope(data.segments)
          .filter((segment) => segment.status !== 'reverted')
          .map((segment) => ({
            id: segment.id,
            chapter: segment.chapter,
            file: segment.file,
            offsetStart: segment.offsetStart,
            offsetEnd: segment.offsetEnd,
            chars: segment.chars,
            decisionIds: segment.decisionIds ?? [],
          })),
        chapters: data.chapters ?? {},
      }
    },
    /** 订阅"作者的拍板/段落落账"，返回取消订阅函数。 */
    onDidCommit(listener) {
      if (typeof listener !== 'function') return () => {}
      commitListeners.add(listener)
      return () => commitListeners.delete(listener)
    },
  }
  if (typeof ctx.provide === 'function') {
    ctx.effect(() => ctx.provide('novelBeat', novelBeatApi))
  }

  // 0.11.0：选项写法基线。voice 只读、可降级；没有服务或作者关掉时返回中性说明。
  const voiceProvider = async (args, exec) => {
    const dir = typeof args?.dir === 'string' ? args.dir : null
    const book = typeof args?.book === 'string' ? args.book : null
    if (!dir || !book) return null
    const sessionId = exec?.agent?.id ?? null
    let mode = 'auto'
    if (sessionId) {
      try {
        mode = (await getSessionState(dir, sessionId)).voice ?? 'auto'
      } catch {
        mode = 'auto'
      }
    }
    let service = null
    try {
      service = ctx.get('novelVoice') ?? null
    } catch {
      service = null
    }
    return loadVoiceGuidance({
      service,
      cwd: dir,
      book,
      chapter: Number(args.chapter) || null,
      mode,
    })
  }

  for (const definition of toolDefinitions({
    ask,
    askAvailable: Boolean(ask),
    segmentLoop: SEGMENT_LOOP_ENABLED,
    voiceProvider,
  })) {
    ctx.effect(() => ctx.tools.register(definition, {
      when: (context) => effectiveOn(ctx, modeCache.get(sessionKey(context)) === true, sessionKey(context)),
    }))
  }

  // 故事总控接管：它开/关时刷新本会话三层（modeCache / L1 技能 / 工具限制），
  // 只改内存，不写书目录里的持久开关。事件总线对加载顺序不敏感。
  if (typeof ctx.on === 'function') {
    ctx.effect(() => ctx.on('novel-conductor/drive', (event) => {
      const agent = event?.agent
      if (!agent?.id) return
      refreshAgent(agent).catch(() => {})
    }))
  }

  if (commands?.register) {
    ctx.effect(() => commands.register({
      name: 'beat',
      description: '拍板模式：/beat on、/beat off、/beat status、/beat voice [auto|off]、/beat body [路径|reset]、/beat list [章]、/beat revert [段号]、/beat fork <要决定什么>',
      handler: async (invocation) => {
        const raw = String(invocation?.rawInput ?? '')
          .trim()
          .replace(/^\/?beat\b/i, '')
          .trim()
        const parts = raw.split(/\s+/).filter(Boolean)
        const action = (parts[0] || 'status').toLowerCase()
        const agent = invocation?.agent
        if (!agent?.id) return { kind: 'error', text: '拿不到当前会话，无法切换拍板模式。' }
        const dir = await dirFor(agent)
        if (!dir) return { kind: 'error', text: '拿不到当前工作区，无法切换拍板模式。' }

        if (action === 'status') {
          const state = await refreshAgent(agent)
          const cached = gateCache.get(agent.id)
          const roots = (cached?.bodyRoots ?? DEFAULT_BODY_ROOTS).join('、') || '（空：只保护已登记段落）'
          const chapter = cached?.chapter ? `第 ${cached.chapter} 章` : '还没登记本章决策'
          const pendingCustomCount = cached?.chapter
            ? (cached?.chapters?.[String(cached.chapter)]?.pendingCustom ?? 0)
            : 0
          const pendingSuffix = [
            cached?.open ? `还有 ${cached.open} 个决策没拍板` : '',
            pendingCustomCount > 0 ? `${pendingCustomCount} 条作者自定待补六要素` : '',
          ].filter(Boolean).join('，')
          const conductor = conductorInstalled(ctx)
            ? (effectiveOn(ctx, false, agent.id)
              ? '- 故事总控：开（本会话由它接管；你的开关只作独立模式偏好）'
              : '- 故事总控：关——装了故事总控时它说了算，本插件本会话不工作；要写就 /cue on')
            : null
          return {
            kind: 'success',
            text: [
              `拍板模式：${state?.on ? '开' : '关'}（独立开关：${cached?.manual ? '开' : '关'}）`,
              conductor,
              `- 受保护正文目录：${roots}`,
              `- 当前进度：${chapter}${pendingSuffix ? `，${pendingSuffix}` : ''}`,
              '- 开关：/beat on | /beat off；改保护目录：/beat body 正文|/beat body reset',
              '- 选项写法：/beat voice auto（跟随已确认文风）| /beat voice off（中性）',
              '- 段落：/beat list（列本章段落）；/beat revert [段号]（退这一段及其后所有段，重写）',
              '- 自己插岔路：/beat fork 要不要当场杀掉独孤博',
            ].filter(Boolean).join('\n'),
          }
        }

        if (action === 'fork') {
          // 作者主动插一条岔路：模型漏判时由作者开口，插件把它记进账本，
          // 模型看到 fork-required 之后必须用 beat_plan(forkId) 写成决策点再问。
          const text = raw.replace(/^fork\b/i, '').replace(/^[\s:：]+/, '').trim()
          if (!text) {
            return { kind: 'error', text: '用法：/beat fork 这里要决定什么（例如 /beat fork 要不要当场杀掉独孤博）' }
          }
          const active = await readActiveBook(dir)
          if (!active) return { kind: 'error', text: '这本书还没有账本：先 beat_plan 登记第一次岔路。' }
          const chapter = gateCache.get(agent.id)?.chapter
            ?? Math.max(1, ...active.data.decisions.map((decision) => decision.chapter))
          const forked = await executeFork({ dir, book: active.book, chapter, text })
          await refreshAgent(agent)
          return {
            kind: 'success',
            text: `${forked.message}\n（也可以直接说给模型听：这里要插一个岔路——它会用 beat_fork 登记。）`,
          }
        }

        if (action === 'voice') {
          // 0.11.0：选项写法是否跟随已确认文风。auto=跟随档案（默认），off=强制中性。
          const target = (parts[1] || 'status').toLowerCase()
          if (target === 'off' || target === 'auto') {
            await setSessionVoice(dir, agent.id, target)
            await refreshAgent(agent)
            return {
              kind: 'success',
              text: target === 'off'
                ? '选项写法：中性。文风不再影响选项内容（恢复用 /beat voice auto）。'
                : '选项写法：跟随已确认文风（没有已确认档案时自动中性）。',
            }
          }
          if (target === 'on') {
            return { kind: 'error', text: '没有 /beat voice on 这个档位：用 /beat voice auto（跟随已确认档案）或 /beat voice off（中性）。' }
          }
          const state = await getSessionState(dir, agent.id)
          const active = await readActiveBook(dir)
          let service = null
          try {
            service = ctx.get('novelVoice') ?? null
          } catch {
            service = null
          }
          const guidance = active
            ? await loadVoiceGuidance({
              service, cwd: dir, book: active.book, chapter: null, mode: state.voice ?? 'auto',
            })
            : null
          return {
            kind: 'success',
            text: [
              `选项写法：${state.voice === 'off' ? '中性（作者已关闭）' : '跟随已确认文风'}`,
              guidance
                ? `- 当前：${guidance.available ? `${guidance.label} · v${guidance.profileVersion}` : guidance.label}——${guidance.message}`
                : '- 还没有账本，无法检测文风；有账本后自动检测。',
              '- 开关：/beat voice auto（跟随已确认档案，默认）| /beat voice off（强制中性）',
            ].join('\n'),
          }
        }

        if (action === 'body') {
          const target = parts.slice(1).join(' ').trim()
          if (!target) return { kind: 'error', text: '用法：/beat body 路径（可多次追加）| /beat body reset' }
          const current = gateCache.get(agent.id)?.bodyRoots ?? DEFAULT_BODY_ROOTS
          const next = target.toLowerCase() === 'reset'
            ? [...DEFAULT_BODY_ROOTS]
            : [...new Set([...current, target.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')])]
          await setSessionBodyRoots(dir, agent.id, next)
          const state = await refreshAgent(agent)
          return {
            kind: 'success',
            text: `受保护正文目录：${(state?.bodyRoots ?? next).join('、')}`,
          }
        }

        if (action === 'list' || action === 'revert') {
          const active = await readActiveBook(dir)
          if (!active) return { kind: 'error', text: '这本书还没有账本。' }
          const book = active.book
          // `/beat revert 3!` 里的感叹号就是"我知道正文被改过，照找到的位置退"的确认。
          const confirm = /!$/.test(parts[1] ?? '') || parts.some((part) => part === '!')
          const cleaned = (parts[1] ?? '').replace(/!+$/, '')
          const numeric = /^\d+$/.test(cleaned) ? Number(cleaned) : null
          const chapter = numeric ?? gateCache.get(agent.id)?.chapter
            ?? Math.max(1, ...active.data.decisions.map((decision) => decision.chapter))

          if (action === 'list') {
            const listed = await listSegments({ dir, book, chapter })
            if (!listed.segments.length) {
              return { kind: 'success', text: `第 ${chapter} 章还没有登记过段落。写完一段就用 beat_segment 登记，回退才有东西可退。` }
            }
            const lines = listed.segments.map((segment, index) => {
              const titles = segment.decisions.length
                ? segment.decisions.map((item) => `${item.id}「${item.title}」`).join('、')
                : '（开场/过渡段）'
              const mark = segment.status === 'reverted' ? ' · 已作废' : ''
              return `${index + 1}. ${segment.id} · ${segment.chars} 字 · 第 ${segment.offsetStart}–${segment.offsetEnd} 字 · ${titles}${mark}`
            })
            return {
              kind: 'success',
              text: [
                `第 ${chapter} 章（${book}），共 ${listed.segments.length} 段：`,
                ...lines,
                '',
                '退最后一段：/beat revert；退第 N 段：/beat revert N（它后面的段会一起作废）',
              ].join('\n'),
            }
          }

          let segmentId = /^s-\d+$/i.test(cleaned) ? cleaned : null
          if (!segmentId && numeric) {
            const committed = active.data.segments
              .filter((segment) => segment.chapter === chapter && segment.status === 'committed')
              .sort((left, right) => (left.offsetStart ?? 0) - (right.offsetStart ?? 0))
            segmentId = committed[numeric - 1]?.id ?? null
            if (!segmentId) return { kind: 'error', text: `第 ${chapter} 章没有第 ${numeric} 段。` }
          }
          const reverted = await executeRevert({ dir, book, chapter, confirm, ...(segmentId ? { segment: segmentId } : {}) })
          await refreshAgent(agent)
          const notes = reverted.warnings?.length ? `\n提醒：${reverted.warnings.join('；')}` : ''
          return { kind: 'success', text: `${reverted.message}${notes}` }
        }

        if (action !== 'on' && action !== 'off' && action !== 'revert' && action !== 'list' && action !== 'fork') {
          return {
            kind: 'error',
            text: '用法：/beat on | /beat off | /beat status | /beat voice [auto|off] | /beat body [路径|reset] | /beat list [章] | /beat revert [段号] | /beat fork <要决定什么>',
          }
        }

        await setSessionMode(dir, agent.id, action)
        const state = await refreshAgent(agent)
        const on = state?.on === true
        return {
          kind: 'success',
          text: on
            ? '拍板模式已开启：先 beat_plan 登记本章决策，全部拍板后才能写正文。'
            : '拍板模式已关闭：beat_* 工具已隐藏，技能已撤下，写正文不再被拦。',
        }
      },
    }))
  }

  // L2：常驻规则。注册在插件根 ctx（全局一层），但按 scope 判断是哪个会话
  if (systemPrompt?.section) {
    ctx.effect(() => systemPrompt.section({
      name: 'novel-beat',
      order: 60,
      text: (context) => {
        const id = context?.scope?.id ?? context?.scope
        if (!id) return ''
        return modeCache.get(String(id)) === true ? SYSTEM_RULES : ''
      },
    }))
  }

  // L3：底层写盘闸。M0 已验证 agent 作用域是根作用域、彼此不继承，
  // 所以注册在插件根 ctx 上一次，函数里按 execution.agent.id 判模式。
  if (typeof ctx.tools?.guard === 'function') {
    ctx.effect(() => ctx.tools.guard((execution) => {
      try {
        const agent = execution?.agent
        const id = agent?.id
        if (!id) return undefined
        const cached = gateCache.get(id)
        if (!cached?.on && !cached?.writePaused) return undefined

        const cwd = syncDirFor(agent) ?? cached.dir
        if (!cwd) return undefined

        const verdict = evaluateWrite({
          toolName: execution.name,
          args: execution.arguments,
          cwd,
          bodyRoots: cached.bodyRoots ?? DEFAULT_BODY_ROOTS,
          state: cached,
        })
        return verdict.blocked ? verdict.reason : undefined
      } catch {
        // guard 抛错会炸整次工具调用，这里一律退化成放行（并让 verify 事后兜底）。
        return undefined
      }
    }))
  }

  if (typeof ctx.on === 'function') {
    ctx.effect(() => ctx.on('agent/created', async ({ agent }) => {
      await refreshAgent(agent)
    }))
    ctx.effect(() => ctx.on('agent/disposed', ({ agent }) => {
      const id = agent?.id
      modeCache.delete(id)
      gateCache.delete(id)
      restrictions.delete(id)
      disposeSkill(id)
    }))
    // 每次 beat_* 跑完都刷新闸门状态：下一次写正文用的就是最新账本
    ctx.effect(() => ctx.on('tools/result', (exec, result) => {
      const name = exec?.name
      const agent = exec?.agent
      if (typeof name !== 'string' || !agent?.id || !name.startsWith('beat_')) return
      // 落账事件：订阅者（fade 的快照、conductor 的任务状态）据此知道"账本变了"。
      const kind = { beat_next: 'commit', beat_decide: 'commit', beat_segment: 'segment', beat_revert: 'revert' }[name]
      if (kind && result?.isError !== true) {
        const args = exec.arguments ?? exec.args ?? {}
        const value = result?.value ?? {}
        // 幂等重放 / 无变化分支没有写账本，不能重复发落账事件。
        if (value?.idempotent === true || value?.changed === false) return refreshAgent(agent)
        const ids = kind === 'commit'
          ? (value?.committed ?? (name === 'beat_decide' && value?.id ? [value.id] : []))
            .map((item) => item?.id ?? item).filter(Boolean)
          : kind === 'segment'
            ? [value?.segment?.id ?? value?.segmentId].filter(Boolean)
            : (value?.reverted?.revertedSegments ?? value?.revertedSegments ?? []).filter(Boolean)
        const revision = Number.isInteger(value?.revision) ? value.revision : value?.bookRevision
        if (ids.length > 0 && Number.isInteger(revision) && typeof args.book === 'string') {
          emitCommit({
            kind,
            tool: name,
            book: args.book,
            chapter: args.chapter ?? null,
            ids,
            revision,
            commitId: `${args.book}#${revision}`,
            at: new Date().toISOString(),
          })
        }
      }
      return refreshAgent(agent)
    }))  }

  if (agents?.list) {
    for (const agent of agents.list()) {
      await refreshAgent(agent)
    }
  }

  ctx.effect(() => () => {
    for (const dispose of restrictions.values()) {
      try {
        dispose()
      } catch {
        // agent 作用域可能已经先释放。
      }
    }
    restrictions.clear()
    for (const id of [...skillRegistrations.keys()]) disposeSkill(id)
    modeCache.clear()
    gateCache.clear()
  })
}
