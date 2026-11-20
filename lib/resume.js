// lib/resume.js — 回退/改选后的可靠续写入口。
// 首选：宿主 sessionController.prompt（SessionPromptRequest, mode='queue'）
// 兜底：调用失败时把同一段文字交回客户端，让作者手动发。
const MAX_RESUME_TEXT = 1200
const MAX_BRIEF_TEXT = 1200

export class ResumeError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ResumeError'
    this.code = code
  }
}

/** 构造 SessionPromptRequest；content 用 DSH 的文本内容块。 */
export function buildResumeRequest({ sessionId, requestId, text, timeZone = null }) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (!value) throw new ResumeError('bad-text', '续写指令不能为空。')
  if (value.length > MAX_RESUME_TEXT) throw new ResumeError('too-long', `续写指令最多 ${MAX_RESUME_TEXT} 字。`)
  if (typeof sessionId !== 'string' || !sessionId) throw new ResumeError('bad-session', 'sessionId 不能为空。')
  if (typeof requestId !== 'string' || !requestId) throw new ResumeError('bad-request', 'requestId 不能为空。')
  return {
    requestId,
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: value }],
    ...(typeof timeZone === 'string' && timeZone ? { clientTimeZone: timeZone } : {}),
  }
}

/** 回退/改选后的结构化重写工单；硬约束优先，超限只砍软信息。 */
export function buildRewriteBrief({
  data,
  chapter,
  decision,
  plan,
  tail = '',
  tailChars = 80,
  maxChars = MAX_BRIEF_TEXT,
} = {}) {
  const targetChapter = chapter ?? decision?.chapter
  const cutAt = plan?.cutAt
  const title = decision?.title ?? '这一段'
  const chosen = decision?.chosen ?? null
  const newChoice = chosen?.label ?? plan?.newChoice?.label ?? '按新选择'
  const changes = Array.isArray(chosen?.changes) ? chosen.changes : []
  const forbidden = Array.isArray(chosen?.forbidden) ? chosen.forbidden : []
  const touched = new Set(changes.map((change) => `${change?.entity}\u0000${change?.key}`))
  const keepCanon = (data?.canon ?? [])
    .filter((entry) => !touched.has(`${entry?.entity}\u0000${entry?.key}`))
    .slice(-4)
    .map((entry) => `${entry.entity}.${entry.key}=${entry.value}`)
  const header = `【重写工单】第${targetChapter ?? '?'}章${Number.isInteger(cutAt) ? ` · 从第${cutAt}字之后继续` : ''}`
  const changed = decision ? `已改选：「${title}」→「${newChoice}」` : ''
  const must = decision?.chosen ? `必须发生：${String(chosen?.impact ?? '').trim() || '按新选择推进这一段'}` : ''
  const never = forbidden.length > 0 ? `不得出现：${forbidden.join('；')}` : ''
  const final = '只写这一段（400–800 字），写完调 beat_segment。'

  const build = ({ withKeep = true, canonLimit = 6, tailLen = tailChars } = {}) => {
    const lines = [header, changed, must].filter(Boolean)
    if (never) lines.push(never)
    if (withKeep && keepCanon.length > 0) lines.push(`必须保持：${keepCanon.slice(0, 4).join('；')}`)
    if (canonLimit > 0 && changes.length > 0) {
      const slice = changes.slice(0, canonLimit).map((change) => `${change.entity}.${change.key}=${change.to}`)
      if (slice.length > 0) lines.push(`相关设定：${slice.join('；')}`)
    }
    const tailText = tailLen > 0 ? String(tail ?? '').slice(-tailLen).replace(/\s+/g, ' ').trim() : ''
    if (tailText) lines.push(`上一段末尾：「…${tailText}」`)
    lines.push(final)
    return lines.join('\n')
  }

  let text = build()
  if (text.length > maxChars) text = build({ withKeep: false, canonLimit: 4 })
  if (text.length > maxChars) text = build({ withKeep: false, canonLimit: 0 })
  if (text.length > maxChars) text = build({ withKeep: false, canonLimit: 0, tailLen: 0 })
  if (text.length > maxChars) {
    const hard = [header, changed, must, never].filter(Boolean).join('\n')
    text = `${hard}\n…\n${final}`
    if (text.length > maxChars) text = `${text.slice(0, Math.max(0, maxChars - 1))}…`
  }
  return text
}

/** 调用宿主 sessionController.prompt；失败不抛，返回明确状态。 */
export async function promptSession(controller, request, signal) {
  if (!controller || typeof controller.prompt !== 'function') {
    return {
      ok: false,
      code: 'no-session-controller',
      message: '当前宿主没有 sessionController.prompt，无法自动续写；请把指令复制给模型手动发送。',
    }
  }
  try {
    await controller.prompt(request, signal)
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      code: 'resume-failed',
      message: `自动续写失败：${error?.message ?? error}。请复制指令手动发送。`,
    }
  }
}

export { MAX_RESUME_TEXT }
