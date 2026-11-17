import test from 'node:test'
import assert from 'node:assert/strict'
import { buildResumeRequest, promptSession, MAX_RESUME_TEXT } from '../lib/resume.js'

test('buildResumeRequest 构造 session.prompt 请求', () => {
  const request = buildResumeRequest({
    sessionId: 'session-1',
    requestId: 'beat-resume-1',
    text: '  从第 833 字继续写这一段。  ',
    timeZone: 'Asia/Shanghai',
  })
  assert.deepEqual(request, {
    requestId: 'beat-resume-1',
    sessionId: 'session-1',
    mode: 'queue',
    content: [{ type: 'text', text: '从第 833 字继续写这一段。' }],
    clientTimeZone: 'Asia/Shanghai',
  })
  assert.throws(() => buildResumeRequest({ sessionId: 's', requestId: 'r', text: '  ' }), /续写指令不能为空/)
  assert.throws(() => buildResumeRequest({ sessionId: 's', requestId: 'r', text: 'x'.repeat(MAX_RESUME_TEXT + 1) }), /最多/)
})

test('promptSession 成功 / 无服务 / 失败三种状态', async () => {
  const calls = []
  const ok = await promptSession({
    async prompt(request, signal) {
      calls.push({ request, signal })
    },
  }, { requestId: 'r', sessionId: 's', mode: 'queue', content: [{ type: 'text', text: '继续' }] }, new AbortController().signal)
  assert.deepEqual(ok, { ok: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].request.mode, 'queue')

  const missing = await promptSession(null, {}, new AbortController().signal)
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'no-session-controller')

  const failed = await promptSession({ async prompt() { throw new Error('session busy') } }, {}, new AbortController().signal)
  assert.equal(failed.ok, false)
  assert.equal(failed.code, 'resume-failed')
  assert.match(failed.message, /session busy/)
})
