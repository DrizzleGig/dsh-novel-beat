import test from 'node:test'
import assert from 'node:assert/strict'
import { applyVoiceFit, loadConfirmedVoice } from '../lib/voice-fit.js'

const IDENTITY = { readOnly: true, capabilities: ['voice.brief', 'voice.status', 'voice.revision'] }
const STYLE = '【总则】表达克制，适当留白，不直说。\n【写法】收住解释。\n【不要】禁止未确认规则。'

function service({ enabled = true, status = null, brief = null, hang = false } = {}) {
  return {
    identity: () => IDENTITY,
    isEnabled: async () => enabled,
    getStatus: async () => {
      if (hang) return await new Promise(() => {})
      return status ?? { profiles: [{ id: 'p1', version: '2.4', status: 'confirmed' }, { id: 'draft', version: '9', status: 'draft' }] }
    },
    getBrief: async (args) => brief ?? {
      ok: true, markdown: STYLE, revision: 17, sources: { profileId: args.profileId, profileVersion: '2.4', status: 'confirmed' },
    },
  }
}

function chapterFixture() {
  return {
    chapter: 12,
    revision: 48,
    decisions: [{
      id: 'b12-1', status: 'proposed', gate: { entity: 'person:hero', key: 'identity.exposure', from: 'unknown', to: 'private' },
      evidenceStatus: { status: 'valid', valid: true }, legacy: false,
      sourceRefs: [{ kind: 'body', quote: '秘密' }],
      options: [
        { id: 'o-fast', label: '立即公开', action: '马上向所有人说明', costs: ['失去保密空间'], outcomes: [{ text: '迅速获得协助' }], informationGain: [{ text: '当场看出反应' }], risks: [{ text: '消息扩散' }], changes: [{ entity: 'person:hero', key: 'identity.exposure', from: 'unknown', to: 'public' }] },
        { id: 'o-quiet', label: '暂缓说明', action: '先观察，只告诉一人', costs: ['独自承担压力'], outcomes: [{ text: '暂时保密' }], informationGain: [{ text: '观察对方是否守约' }], risks: [{ text: '疑心可能累积' }], changes: [{ entity: 'person:hero', key: 'identity.exposure', from: 'unknown', to: 'private' }] },
      ],
    }],
  }
}

test('voice 可用：只取已确认 profile、排序理由可见且不改 gate/事实/差分/风险', async () => {
  const input = chapterFixture()
  const before = structuredClone(input)
  const voice = await loadConfirmedVoice({ service: service(), cwd: 'D:/fixture', book: 'book', chapter: 12 })
  assert.equal(voice.available, true)
  assert.equal(voice.profileVersion, '2.4')
  assert.equal(voice.characterProfiles, false)
  const result = applyVoiceFit(input, voice)
  assert.deepEqual(result.decisions[0].options.map((option) => option.id), ['o-quiet', 'o-fast'])
  assert.equal(result.decisions[0].options[0].styleFit.advisory, true)
  assert.match(result.decisions[0].options[0].styleFit.explanation, /克制\/留白/u)
  assert.deepEqual(result.decisions[0].gate, before.decisions[0].gate)
  for (const option of result.decisions[0].options) {
    const original = before.decisions[0].options.find((entry) => entry.id === option.id)
    assert.deepEqual(option.changes, original.changes)
    assert.deepEqual(option.risks, original.risks)
    assert.deepEqual(option.costs, original.costs)
  }
  assert.deepEqual(input, before, '排序与贴合标注不得修改调用方/账本模型')
})

test('voice 缺席、超时、旧版本、无确认档案均降级且排序回到基线', async (t) => {
  const cases = [
    ['缺席', null, 'missing-service'],
    ['超时', service({ hang: true }), 'timeout'],
    ['旧档', service({ brief: { ok: true, markdown: STYLE, sources: { status: 'confirmed', profileVersion: '1.0' } } }), 'old-profile-unreadable'],
    ['无确认档案', service({ status: { profiles: [{ id: 'draft', version: '9', status: 'draft' }] } }), 'no-confirmed-profile'],
  ]
  for (const [label, voiceService, reason] of cases) {
    await t.test(label, async () => {
      const voice = await loadConfirmedVoice({ service: voiceService, cwd: 'D:/fixture', book: 'book', chapter: 12, timeoutMs: 8 })
      assert.equal(voice.available, false)
      assert.equal(voice.reason, reason)
      const model = chapterFixture()
      const result = applyVoiceFit(model, voice)
      assert.deepEqual(result.decisions[0].options.map((option) => option.id), ['o-fast', 'o-quiet'])
      assert.deepEqual(result.decisions[0].gate, model.decisions[0].gate)
      assert.deepEqual(result.decisions[0].options.map((option) => option.changes), model.decisions[0].options.map((option) => option.changes))
      assert.equal(result.voiceFit.label, '仅建议')
    })
  }
})

test('旧 voice 服务缺少 status/profileVersion 契约时不注入未确认画像', async () => {
  const old = {
    identity: () => IDENTITY,
    isEnabled: async () => true,
    getStatus: async () => ({ profiles: [{ id: 'p1', version: '2.4' }] }),
    getBrief: async () => ({ ok: true, markdown: STYLE, sources: { profileVersion: '2.4' } }),
  }
  const result = await loadConfirmedVoice({ service: old, cwd: 'D:/fixture', book: 'book', chapter: 12 })
  assert.equal(result.available, false)
  assert.equal(result.reason, 'no-confirmed-profile')
})

test('voice 0.2.2 没有会话开关：以已确认档案为同意信号，0.11.0 能读到文风', async () => {
  const currentPublishedContract = {
    identity: () => IDENTITY,
    getStatus: async () => ({ profiles: [{ id: 'p1', version: '2.4', status: 'confirmed' }] }),
    getBrief: async () => ({ ok: true, markdown: STYLE, revision: 17, sources: { profileId: 'p1', profileVersion: '2.4', status: 'confirmed' } }),
  }
  const voice = await loadConfirmedVoice({ service: currentPublishedContract, cwd: 'D:/fixture', book: 'book', chapter: 12 })
  assert.equal(voice.available, true)
  assert.equal(voice.profileVersion, '2.4')
  assert.equal(voice.characterProfiles, false)
  const model = chapterFixture()
  const result = applyVoiceFit(model, voice)
  assert.deepEqual(result.decisions[0].options.map((option) => option.id), ['o-quiet', 'o-fast'])
  assert.equal(result.voiceFit.available, true)
})

test('voice 只排序已校验 gate 的候选，失效证据仍保持基线且不加贴合标签', async () => {
  const voice = await loadConfirmedVoice({ service: service(), cwd: 'D:/fixture', book: 'book', chapter: 12 })
  const input = chapterFixture()
  input.decisions[0].evidenceStatus = { status: 'invalid', valid: false, code: 'stale-evidence' }
  const result = applyVoiceFit(input, voice)
  assert.deepEqual(result.decisions[0].options.map((option) => option.id), ['o-fast', 'o-quiet'])
  assert.ok(result.decisions[0].options.every((option) => option.styleFit === undefined))
})
