/**
 * dsh-novel-beat — 作者拍板 + 全书账本（v0.6.0）
 *
 * 独立运行：不 import 任何其他插件，不依赖 novel-forge。
 * 数据落在 <dir>/.dsh-novel-beat/<book>/book.json（lib/store.js）。
 *
 * 默认关闭（m00430）：装上不主动占 schema；作者用 /beat on 或 M4 的
 * composer 按钮开启后，beat_* 才会进入该会话的工具表。
 */
import { toolDefinitions } from './lib/tools.js'
import { getSessionMode, setSessionMode } from './lib/store.js'

export const inject = ['tools', 'commands', 'workingDirectory', 'agents']

const SKILL = {
  name: 'novel-beat',
  description: '小说创作中实时拦截剧情分叉：每遇到一个会改变故事走向的节点，就登记成决策点、给出 2–4 个真分叉让作者拍板；拍板写进全书账本，写后还能校验。默认关闭，作者说 /beat on 才启用。当用户说「我想写一个…」「写第 N 章」「继续写」「接下来怎么发展」，或任何一次要推进剧情的时候使用。',
  whenToUse: '任何时候要往下推进剧情——从开书的第一句创意，到续写某一章的中段。只要有“接下来发生什么”要定，就用它拦一下。',
  source: 'runtime',
  content: [
    '# novel-beat：往下写之前先拍板',
    '',
    '## 启用',
    '',
    '默认关闭。作者说「写第 N 章」「继续写」「接下来怎么发展」时，先确认拍板模式已开（`/beat on`）；没开就提示作者开，不要擅自写正文。',
    '',
    '## 唯一判定规则',
    '',
    '**会改变故事状态的节点，必须问作者；只描述世界的，模型自己决定。**',
    '',
    '- 要问：谁死谁活、谁知道了什么、**信息揭露到什么程度**、关系变了、得到或失去了什么、位置时间跳了、承诺立了、剧情分叉了、金手指或世界观规则变了。',
    '- 不问：风、光、温度、气味、比喻、房间陈设、说话时手放在哪。',
    '- 代码层的等价说法：**凡是能往 canon 里写一条的，都是决策点。**',
    '',
    '## 一次推进的流程',
    '',
    '1. **看账本** — `beat_list(context:true)`：拿全书 canon、未回收义务、最近决策。写下一章前必看。',
    '2. **登记** — `beat_plan(dir, book, chapter, beats[])`',
    '   - 每个决策点 2–4 个真分叉；每个选项必须写 `impact` 和 `changes`（entity / key / from / to / evidence）。',
    '   - 不同选项的 `changes` 必须不同——只换措辞的假分叉会被拒绝。',
    '   - `change` 写成「谁/什么 从 A 变成 B」；kind 八选一：动作 / 知情 / 关系 / 得失 / 状态 / 承诺 / 时序 / 分叉。',
    '   - 空白书从最上游开始，拿到答案后用 `append:true` 补下一层；不要先把整章想完再回头拆。',
    '',
    '3. **问人** — 把选项摆给作者（`ask_user_question`），不替作者选。每个选项的 impact 要写清后续、代价、伏笔。',
    '',
    '4. **记录** — `beat_decide`',
    '   - 作者选了你给的选项，传它的 `label`；他自己写的内容照原话传，并同时给 `changes`。',
    '   - 已拍板的要改，传 `supersede:true` + `reason`；不要静默覆盖。',
    '',
    '5. **查闸** — `beat_gate`，`pass` 之前**绝对不许写正文**。',
    '',
    '6. **编译** — `beat_compile`（默认 self）：产出「本章决策约束 / 必须发生 / 不得出现 / 既有义务 / 全书 canon」。把它当写作约束。',
    '',
    '7. **写正文** — 由宿主模型写。插件不管正文，也不依赖其他插件。',
    '',
    '8. **写后校验** — `beat_verify`（`text` 或 `path` 二选一）：正文是否出现每个变化的证据、是否踩禁项、到期义务是否回应。失败按 failures 改稿；通过才算完成。',
    '',
    '9. **下一章** 重复 1–8；到期的义务会在 compile / verify 里出现。',
    '',
    '## 纪律',
    '',
    '- 不先写完再补问；不在 gate 未过时「先写一版看看」。',
    '- 不用环境描写凑决策点；不为凑数拆节点。',
    '- 作者改主意用 `beat_adjust`（waive / supersede），必须写 reason；不要静默改账本。',
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

const BEAT_TOOL_NAMES = toolDefinitions().map((definition) => definition.name)

export async function apply(ctx) {
  const commands = ctx.get('commands')
  const workingDirectory = ctx.get('workingDirectory')
  const agents = ctx.get('agents')
  const modeCache = new Map()
  const restrictions = new Map()

  const dirFor = async (agent) => {
    if (!workingDirectory?.ensure) return null
    try {
      return await workingDirectory.ensure(agent)
    } catch {
      return null
    }
  }

  const applyAgentMode = async (agent) => {
    if (!agent?.id) return false
    const dir = await dirFor(agent)
    if (!dir) return false
    const { mode } = await getSessionMode(dir, agent.id)
    const on = mode === 'on'
    modeCache.set(agent.id, on)

    const previous = restrictions.get(agent.id)
    if (previous) {
      try {
        previous()
      } catch {
        // 旧的 restrict 已随 agent 作用域释放，清引用即可。
      }
      restrictions.delete(agent.id)
    }

    if (!on) {
      const agentCtx = agent.ctx
      if (agentCtx?.tools?.restrict) {
        const install = () => agentCtx.tools.restrict({ deny: BEAT_TOOL_NAMES })
        const dispose = typeof agentCtx.effect === 'function'
          ? agentCtx.effect(install)
          : install()
        restrictions.set(agent.id, dispose)
      }
    }
    return on
  }

  for (const definition of toolDefinitions()) {
    ctx.effect(() => ctx.tools.register(definition, {
      when: (context) => modeCache.get(sessionKey(context)) === true,
    }))
  }

  if (commands?.register) {
    ctx.effect(() => commands.register({
      name: 'beat',
      description: '开关拍板模式：/beat on、/beat off、/beat status',
      handler: async (invocation) => {
        const raw = String(invocation?.rawInput ?? '')
          .trim()
          .replace(/^\/?beat\b/i, '')
          .trim()
        const action = (raw.split(/\s+/)[0] || 'status').toLowerCase()
        const agent = invocation?.agent
        if (!agent?.id) return { kind: 'error', text: '拿不到当前会话，无法切换拍板模式。' }
        const dir = await dirFor(agent)
        if (!dir) return { kind: 'error', text: '拿不到当前工作区，无法切换拍板模式。' }

        if (action === 'status') {
          const on = await applyAgentMode(agent)
          return {
            kind: 'success',
            text: `拍板模式：${on ? '开' : '关'}（/beat on 开启，/beat off 关闭）`,
          }
        }
        if (action !== 'on' && action !== 'off') {
          return { kind: 'error', text: '用法：/beat on | /beat off | /beat status' }
        }

        await setSessionMode(dir, agent.id, action)
        const on = await applyAgentMode(agent)
        return {
          kind: 'success',
          text: `拍板模式已${on ? '开启' : '关闭'}。${on ? '写章前先 beat_plan。' : 'beat_* 工具已从本会话隐藏。'}`,
        }
      },
    }))
  }

  const skills = ctx.get('skills')
  if (skills) {
    ctx.effect(() => skills.register(SKILL))
  }

  if (typeof ctx.on === 'function') {
    ctx.effect(() => ctx.on('agent/created', async ({ agent }) => {
      await applyAgentMode(agent)
    }))
    ctx.effect(() => ctx.on('agent/disposed', ({ agent }) => {
      modeCache.delete(agent?.id)
      restrictions.delete(agent?.id)
    }))
  }

  if (agents?.list) {
    for (const agent of agents.list()) {
      await applyAgentMode(agent)
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
  })
}
