// 0.10.2: optional, read-only style fit. Voice is advisory metadata only.

import { createHash } from 'node:crypto'

export const VOICE_TIMEOUT_MS = 900
export const PERSONA_TIMEOUT_MS = 250
export const VOICE_MODES = ['auto', 'on', 'off']

function withTimeout(promise, timeoutMs) {
  let timer
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('voice 读取超时'), { code: 'voice-timeout' })), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

const FALLBACK_MESSAGES = {
  'missing-service': '未检测到 voice 服务，使用默认顺序。',
  'unsupported-contract': 'voice 接口不兼容，使用默认顺序。',
  disabled: 'voice 本会话已停用，使用默认顺序。',
  'enabled-state-unavailable': '当前 voice 接口不提供本会话开关状态，使用默认顺序。',
  'no-confirmed-profile': '没有已确认的文风档案，使用默认顺序。',
  'old-profile-unreadable': '已确认档案或版本不可读，使用默认顺序。',
  'empty-profile': '已确认文风简报为空，使用默认顺序。',
  timeout: 'voice 响应超时，使用默认顺序。',
  'service-error': 'voice 读取失败，使用默认顺序。',
}

function unavailable(reason, message = FALLBACK_MESSAGES[reason] ?? '仅建议/未接入；使用默认顺序。') {
  return { available: false, status: 'unavailable', reason, label: '仅建议/未接入', message, profileVersion: null, characterProfiles: false }
}

function styleTextFromBrief(brief) {
  const lines = String(brief?.markdown ?? '').split(/\r?\n/u)
  const kept = []
  let section = ''
  for (const line of lines) {
    const heading = /^【([^】]+)】/u.exec(line.trim())
    if (heading) section = heading[1]
    if (['总则', '这一场', '写法'].includes(section)) kept.push(line)
    if (['不要', '语感', '样段', '硬约束'].includes(section)) section = ''
  }
  return kept.join('\n').slice(0, 1200)
}

/** 面板用的只读文风：与模型侧 guidance 同一套可用性判断（0.11.0 去掉了 isEnabled 依赖）。 */
export async function loadConfirmedVoice({ service, cwd, book, chapter, timeoutMs = VOICE_TIMEOUT_MS } = {}) {
  const guidance = await loadVoiceGuidance({ service, cwd, book, chapter, mode: 'auto', timeoutMs })
  return { ...guidance, characterProfiles: false }
}

const STYLE_CUES = [
  { trait: '克制/留白', profile: /克制|留白|含蓄|少解释|不直说/u, option: /暂缓|观察|沉默|保留|私下|只告诉一人|不公开|不说明/u },
  { trait: '紧凑/直接', profile: /紧凑|简洁|短句|直接推进/u, option: /立即|立刻|当场|直接|马上|迅速/u },
  { trait: '沉浸/感官', profile: /沉浸|感官|细节|身体感受/u, option: /倾听|触碰|注视|感受|描写|细节/u },
  { trait: '对话推进', profile: /对话|对白|交谈|问答/u, option: /询问|说明|告诉|商量|对话|交谈/u },
]

function fitForOption(option, voice) {
  const wording = `${option?.label ?? ''} ${option?.action ?? ''}`
  const matchedTraits = STYLE_CUES
    .filter((cue) => cue.profile.test(voice.styleText) && cue.option.test(wording))
    .map((cue) => cue.trait)
  const score = matchedTraits.length ? Math.min(95, 68 + matchedTraits.length * 12) : 50
  const explanation = matchedTraits.length
    ? `动作措辞贴近已确认的${matchedTraits.join('、')}表达；仅建议，不改变事实或差分。`
    : '没有找到与已确认文风规则直接对应的措辞，维持原顺序；仅建议。'
  return { score, matchedTraits, explanation, profileVersion: voice.profileVersion, advisory: true }
}

/** Decorate and sort accepted options only. The supplied ledger-shaped object is never mutated. */
export function applyVoiceFit(chapter, voice) {  const result = structuredClone(chapter)
  result.voiceFit = voice
    ? {
      available: voice.available === true,
      status: voice.status ?? 'unavailable',
      label: '仅建议',
      reason: voice.reason ?? null,
      message: voice.message ?? '仅建议/未接入',
      profileVersion: voice.profileVersion ?? null,
      characterProfiles: voice.characterProfiles === true,
    }
    : unavailable('missing-service')
  if (voice?.available !== true) return result
  result.decisions = (result.decisions ?? []).map((decision) => {
    if (!decision.gate || decision.legacy || decision.evidenceStatus?.valid !== true
      || !Array.isArray(decision.options) || decision.options.length < 2) return decision
    const options = decision.options.map((option, index) => ({
      ...option,
      baselineOrder: index,
      styleFit: fitForOption(option, voice),
    }))
    options.sort((left, right) => right.styleFit.score - left.styleFit.score || left.baselineOrder - right.baselineOrder)
    return { ...decision, options }
  })
  return result
}

// ── 0.11.0：选项内容的文风上下文 ──────────────────────────────────────────────
//
// 与上面的"排序建议"不同：guidance 是给模型看的写法基线，随 beat_plan / beat_next /
// beat_segment / beat_verify 的工具结果回传，模型在写选项时按它组织 action/costs/outcomes。
// 只读、可降级、不改任何事实或差分。

function guidanceUnavailable(reason, message, label = '中性') {
  return {
    available: false,
    status: 'unavailable',
    reason,
    label,
    message,
    styleText: null,
    personaText: null,
    personaRevision: null,
    profileId: null,
    profileVersion: null,
    revision: null,
    digest: null,
  }
}

async function loadPersonaText({ service, identity, cwd, book, chapter, timeoutMs }) {
  if (typeof service.getPersonaBrief !== 'function') return null
  if (!Array.isArray(identity?.capabilities) || !identity.capabilities.includes('voice.personaBrief')) return null
  try {
    const brief = await withTimeout(
      service.getPersonaBrief({ cwd, book, chapter }),
      Math.min(PERSONA_TIMEOUT_MS, timeoutMs),
    )
    if (brief?.ok !== true || brief.available !== true || typeof brief.markdown !== 'string' || !brief.markdown.trim()) return null
    return {
      text: brief.markdown.slice(0, 1200),
      revision: Number.isInteger(brief.revision) ? brief.revision : null,
    }
  } catch {
    return null
  }
}

/**
 * 读取当前可用的文风写法基线。
 * mode: 'off' 作者显式关闭（拍板侧开关）；'auto'/'on' 都跟随已确认档案。
 * 不要求 voice 暴露 isEnabled：以"作者在 voice 里确认过档案"为同意信号，关闭出口在拍板侧。
 */
export async function loadVoiceGuidance({
  service, cwd, book, chapter, mode = 'auto', timeoutMs = VOICE_TIMEOUT_MS,
} = {}) {
  if (mode === 'off') {
    return guidanceUnavailable('disabled-by-beat', '作者在拍板里关掉了文风跟随；选项按中性写。')
  }
  if (!service || typeof service.getStatus !== 'function' || typeof service.getBrief !== 'function') {
    return guidanceUnavailable('missing-service', '未检测到 voice 服务；选项按中性写。')
  }
  try {
    return await withTimeout((async () => {
      const identity = typeof service.identity === 'function' ? service.identity() : null
      if (identity?.readOnly !== true
        || !Array.isArray(identity?.capabilities)
        || !identity.capabilities.includes('voice.brief')) {
        return guidanceUnavailable('unsupported-contract', 'voice 接口不兼容；选项按中性写。')
      }
      const status = await service.getStatus({ cwd, book })
      const profiles = Array.isArray(status?.profiles) ? status.profiles : null
      if (!profiles) return guidanceUnavailable('old-profile-unreadable', 'voice 档案不可读；选项按中性写。')
      const confirmed = profiles.find((profile) => profile?.status === 'confirmed' && typeof profile.id === 'string')
      if (!confirmed) return guidanceUnavailable('no-confirmed-profile', '没有已确认的文风档案；选项按中性写。')
      if (typeof confirmed.version !== 'string' || !confirmed.version.trim()) {
        return guidanceUnavailable('old-profile-unreadable', '已确认档案缺版本；选项按中性写。')
      }
      const brief = await service.getBrief({
        cwd,
        book,
        chapter,
        task: '为拍板选项提供已确认文风；只影响措辞与代价感，不判断剧情事实、不改状态差分。',
        profileId: confirmed.id,
      })
      if (brief?.ok !== true || brief?.sources?.status !== 'confirmed'
        || brief.sources.profileId !== confirmed.id
        || brief.sources.profileVersion !== confirmed.version) {
        return guidanceUnavailable('old-profile-unreadable', '已确认文风简报不可信；选项按中性写。')
      }
      const styleText = styleTextFromBrief(brief)
      if (!styleText) return guidanceUnavailable('empty-profile', '已确认文风简报为空；选项按中性写。')
      const persona = await loadPersonaText({ service, identity, cwd, book, chapter, timeoutMs })
      return {
        available: true,
        status: 'available',
        label: '跟随已确认文风',
        message: `选项按 voice v${confirmed.version} 的已确认文风写。`,
        styleText,
        personaText: persona?.text ?? null,
        personaRevision: persona?.revision ?? null,
        profileId: confirmed.id,
        profileVersion: String(confirmed.version),
        revision: Number.isInteger(brief.revision) ? brief.revision : null,
        digest: createHash('sha256').update(styleText).digest('hex'),
      }
    })(), timeoutMs)
  } catch (error) {
    const timeout = error?.code === 'voice-timeout'
    return guidanceUnavailable(
      timeout ? 'timeout' : 'service-error',
      timeout ? 'voice 响应超时；选项按中性写。' : 'voice 读取失败；选项按中性写。',
    )
  }
}
