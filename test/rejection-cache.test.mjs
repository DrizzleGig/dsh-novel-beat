import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executePlan } from '../lib/tools.js'
import { bookFilePath } from '../lib/store.js'
import { clearRejectedCandidates, readRejectedCandidates, rememberRejectedCandidate } from '../lib/rejection-cache.js'

test('假分叉拒收原因只临时展示，候选不进入可选项或账本', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-rejected-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const book = 'rejected-test'
  const chapter = 12
  clearRejectedCandidates(dir, book, chapter)
  const ref = { kind: 'body', file: '正文/第12章.md', hash: 'a'.repeat(64), quote: '秘密由谁知道', offsetStart: 0, offsetEnd: 6 }
  const delta = { entity: 'person:hero', key: 'identity.exposure', from: 'unknown', to: 'public', evidence: [ref] }
  const claim = { text: '预期变化', basis: 'inference', sourceRefs: [ref] }
  const option = (label, action) => ({
    label, action, costs: ['承担泄密风险'], outcomes: [claim], informationGain: [claim], risks: [claim],
    changes: [delta],
  })
  const beat = {
    title: '秘密由谁知道', kind: '知情', change: '是否公开秘密',
    gate: { ...delta, reason: '不问就会替作者决定秘密由谁知道', confidence: 0.9 },
    options: [option('公开告诉所有人', '公开说明'), option('改写措辞', '换个说法')],
  }
  await assert.rejects(executePlan({ dir, book, chapter, beats: [beat] }, { requireGate: true }), { code: 'false-fork' })
  const rejected = readRejectedCandidates(dir, book, chapter)
  assert.equal(rejected.length, 1)
  assert.match(rejected[0].reason, /差分完全相同/u)
  assert.deepEqual(rejected[0].options.map((entry) => entry.label), ['公开告诉所有人', '改写措辞'])
  await assert.rejects(stat(bookFilePath(dir, book)), { code: 'ENOENT' }, '失败候选不得创建 book.json')
  clearRejectedCandidates(dir, book, chapter)
  assert.deepEqual(readRejectedCandidates(dir, book, chapter), [])
})

test('拒收候选按规范化工作区隔离同名书', () => {
  const first = 'D:/fixtures/one'
  const second = 'D:/fixtures/two'
  const beat = { title: '同名书', options: [{ label: '甲' }, { label: '乙' }] }
  const error = Object.assign(new Error('差分相同'), { code: 'false-fork' })
  rememberRejectedCandidate({ dir: first, book: '同名书', chapter: 3, beat, error, now: 1000 })
  assert.equal(readRejectedCandidates(first, '同名书', 3, 1000).length, 1)
  assert.deepEqual(readRejectedCandidates(second, '同名书', 3, 1000), [])
})
