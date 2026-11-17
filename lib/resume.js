// lib/resume.js — 回退/改选后的可靠续写入口。
// 首选：宿主 sessionController.prompt（SessionPromptRequest, mode='queue'）
// 兜底：调用失败时把同一段文字交回客户端，让作者手动发。
const MAX_RESUME_TEXT = 500

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
