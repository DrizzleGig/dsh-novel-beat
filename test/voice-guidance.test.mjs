import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadVoiceGuidance } from '../lib/voice-fit.js'
import { getSessionState, setSessionMode, setSessionVoice } from '../lib/store.js'

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'beat-voice-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

function confirmedService(overrides = {}) {
  return {
    identity: () => ({
      plugin: 'dsh-novel-voice',
      readOnly: true,
      capabilities: ['voice.brief', 'voice.status', 'voice.revision'],
    }),
    getStatus: async () => ({
      profiles: [{ id: 'p1', status: 'confirmed', version: 'v3' }],
    }),
    getBrief: async () => ({
      ok: true,
      sources: { status: 'confirmed', profileId: 'p1', profileVersion: 'v3' },
      revision: 7,
      markdown: '【总则】冷硬、克制，少解释。\n【不要】形容词堆砌。\n【样段】他没回头。\n',
    }),
    ...overrides,
  }
}

test('voice 可用时给模型一段写法基线，并带摘要与版本', async () => {
  const guidance = await loadVoiceGuidance({
    service: confirmedService(), cwd: 'D:/book', book: '测试', chapter: 1, mode: 'auto',
  })
  assert.equal(guidance.available, true)
  assert.equal(guidance.label, '跟随已确认文风')
  assert.equal(guidance.profileVersion, 'v3')
  assert.match(guidance.styleText, /冷硬/)
  assert.doesNotMatch(guidance.styleText, /样段/, '只取总则/这一场/写法，不把样段塞给模型')
  assert.match(guidance.digest, /^[0-9a-f]{64}$/)
})

test('读者偏好行随【写法】进入 styleText，不把样段/硬约束带进去', async () => {
  const service = confirmedService({
    getBrief: async () => ({
      ok: true,
      sources: { status: 'confirmed', profileId: 'p1', profileVersion: 'v3' },
      revision: 7,
      markdown: '【总则】冷硬、克制。\n【写法】\n1. 收住解释。\n2. 读者偏好（已确认 2 条，仅建议）：喜欢：短句；不喜欢：段末升华\n【不要】形容词堆砌。\n【样段】他没回头。\n【硬约束】视角：第三人称。\n',
    }),
  })
  const guidance = await loadVoiceGuidance({
    service, cwd: 'D:/book', book: '测试', chapter: 1, mode: 'auto',
  })
  assert.equal(guidance.available, true)
  assert.match(guidance.styleText, /读者偏好/)
  assert.match(guidance.styleText, /短句/)
  assert.doesNotMatch(guidance.styleText, /样段|硬约束/)
})

test('voice 提供 personaBrief 时，人物画像作为只读建议进入 guidance', async () => {
  const service = confirmedService({
    identity: () => ({
      plugin: 'dsh-novel-voice',
      readOnly: true,
      capabilities: ['voice.brief', 'voice.status', 'voice.revision', 'voice.personaBrief'],
    }),
    getPersonaBrief: async () => ({
      ok: true,
      available: true,
      markdown: '# 人物画像简报\n【老人·主角】\n- 行为倾向：先观察，再给实际警告。',
      revision: 8,
    }),
  })
  const guidance = await loadVoiceGuidance({
    service, cwd: 'D:/book', book: '测试', chapter: 1, mode: 'auto',
  })
  assert.equal(guidance.available, true)
  assert.match(guidance.personaText, /老人/)
  assert.equal(guidance.personaRevision, 8)
})

test('作者关闭 → 中性，且不读 voice', async () => {
  let called = false
  const service = confirmedService({ getStatus: async () => { called = true; return { profiles: [] } } })
  const guidance = await loadVoiceGuidance({ service, cwd: 'D:/book', book: '测试', chapter: 1, mode: 'off' })
  assert.equal(guidance.available, false)
  assert.equal(guidance.reason, 'disabled-by-beat')
  assert.equal(called, false)
})

test('没有服务 / 没有已确认档案 / 接口不兼容都降级为中性', async () => {
  const missing = await loadVoiceGuidance({ service: null, cwd: 'D:/book', book: '测试', chapter: 1 })
  assert.equal(missing.reason, 'missing-service')

  const noProfile = await loadVoiceGuidance({
    service: confirmedService({ getStatus: async () => ({ profiles: [{ id: 'p', status: 'proposed', version: 'v1' }] }) }),
    cwd: 'D:/book', book: '测试', chapter: 1,
  })
  assert.equal(noProfile.available, false)
  assert.equal(noProfile.reason, 'no-confirmed-profile')

  const incompatible = await loadVoiceGuidance({
    service: confirmedService({ identity: () => ({ readOnly: false, capabilities: [] }) }),
    cwd: 'D:/book', book: '测试', chapter: 1,
  })
  assert.equal(incompatible.reason, 'unsupported-contract')
})

test('超时与异常都降级，不让拍板流程卡住', async () => {
  const hung = await loadVoiceGuidance({
    service: confirmedService({ getBrief: () => new Promise(() => {}) }),
    cwd: 'D:/book', book: '测试', chapter: 1, timeoutMs: 30,
  })
  assert.equal(hung.available, false)
  assert.equal(hung.reason, 'timeout')

  const broken = await loadVoiceGuidance({
    service: confirmedService({ getStatus: async () => { throw new Error('boom') } }),
    cwd: 'D:/book', book: '测试', chapter: 1,
  })
  assert.equal(broken.reason, 'service-error')
})

test('会话里的 voice 开关可持久化，且切拍板模式不会把它冲掉', async (t) => {
  const dir = await tempDir(t)
  await setSessionMode(dir, 's1', 'on')
  await setSessionVoice(dir, 's1', 'off')
  let state = await getSessionState(dir, 's1')
  assert.equal(state.voice, 'off')
  assert.equal(state.mode, 'on')

  await setSessionMode(dir, 's1', 'off')
  state = await getSessionState(dir, 's1')
  assert.equal(state.voice, 'off', '切模式只改 mode，不能丢掉 voice 偏好')
  assert.equal(state.mode, 'off')
})
