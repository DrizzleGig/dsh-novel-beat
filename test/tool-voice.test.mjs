import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { toolDefinitions } from '../lib/tools.js'
import { hashText } from '../lib/decision-gate.js'

const BOOK = 'voice-wiring'
const FILE = '正文/第一章.md'
const START = '林青还不知道密令。\n'
const QUOTE = '林青还不知道密令'

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'beat-voice-wire-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, '正文'))
  await writeFile(join(dir, FILE), START)
  const ref = {
    kind: 'body', file: FILE, hash: hashText(START), quote: QUOTE,
    offsetStart: START.indexOf(QUOTE), offsetEnd: START.indexOf(QUOTE) + QUOTE.length,
  }
  const claim = (text) => ({ text, basis: 'inference', sourceRefs: [ref] })
  const delta = { entity: 'person:linqing', key: 'knowledge.awareness', from: 'unknown', to: 'aware', toLabel: '获知', evidence: [ref] }
  const first = {
    label: '告知', action: '现在向林青传达密令', costs: ['承担泄密风险'],
    outcomes: [claim('林青能够参与行动')], informationGain: [claim('林青得到密令内容')],
    risks: [claim('行动可能暴露')], changes: [delta],
  }
  const second = {
    ...first, label: '暂缓', action: '推迟到会面时再说',
    changes: [{ ...delta, to: 'waiting', toLabel: '等待会面' }],
  }
  const beat = {
    title: '林青何时得到密令', kind: '知情', change: '由作者决定是否立即告诉林青密令',
    gate: { ...delta, reason: '未经询问就会替作者决定谁先知情', confidence: 0.9 },
    options: [first, second],
  }
  return { dir, beat }
}

const guidance = {
  available: true,
  label: '跟随已确认文风',
  styleText: '【总则】冷硬、克制。',
  profileId: 'p1',
  profileVersion: 'v3',
  revision: 7,
  digest: 'a'.repeat(64),
  reason: null,
  message: '选项按 voice v3 的已确认文风写。',
}

test('beat_plan 把 voiceGuidance 挂到结果上；provider 失败时静默降级', async (t) => {
  const { dir, beat } = await setup(t)
  const defs = toolDefinitions({ voiceProvider: async () => guidance })
  const plan = defs.find((definition) => definition.name === 'beat_plan')
  const result = await plan.execute({ dir, book: BOOK, chapter: 1, beats: [beat] })
  assert.equal(result.ok, true)
  assert.equal(result.voiceGuidance.available, true)
  assert.equal(result.voiceGuidance.profileVersion, 'v3')
  assert.match(result.voiceGuidance.styleText, /冷硬/)

  const brokenDefs = toolDefinitions({ voiceProvider: async () => { throw new Error('boom') } })
  const brokenPlan = brokenDefs.find((definition) => definition.name === 'beat_plan')
  const again = await brokenPlan.execute({ dir, book: BOOK, chapter: 1, beats: [beat], append: true })
  assert.equal(again.ok, true, '文风读取失败不能挡住拍板')
  assert.equal(again.voiceGuidance, undefined)
})

test('没有 voiceProvider 时结果里不带 voiceGuidance', async (t) => {
  const { dir, beat } = await setup(t)
  const defs = toolDefinitions({})
  const plan = defs.find((definition) => definition.name === 'beat_plan')
  const result = await plan.execute({ dir, book: BOOK, chapter: 1, beats: [beat] })
  assert.equal(result.ok, true)
  assert.equal('voiceGuidance' in result, false)
})
