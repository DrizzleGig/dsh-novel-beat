import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildChapter,
  buildOverview,
  latestReopenRevision,
  parseChapterFileName,
  readChapterTitles,
} from '../lib/panel.js'

const BOOK = '测试书'
const FILE = '正文/第10章_太子雪清河.md'

function fixture() {
  const options = [
    { label: '太子要收他进东宫', impact: '收进东宫', changes: [{ entity: '雪清河', key: '目的', to: '收入东宫', evidence: ['东宫'] }] },
    { label: '太子在查坑', impact: '查坑', changes: [{ entity: '雪清河', key: '目的', to: '查坑', evidence: ['坑'] }] },
  ]
  const decisions = [
    {
      id: 'b9-1', chapter: 9, title: '旧账决策', kind: '分叉', change: '旧账',
      status: 'committed', legacyReceipt: true, segmentId: null, requestId: 'q9',
      options, chosen: { label: '旧选择', impact: '', changes: [], forbidden: [] },
    },
    {
      id: 'b10-1', chapter: 10, title: '太子的真正目的', kind: '分叉', change: '太子的目的',
      status: 'committed', legacyReceipt: false, segmentId: 's-0001', requestId: 'q1',
      options, chosen: {
        label: '太子要收他进东宫', impact: '收进东宫',
        changes: [
          { entity: '雪清河', key: '对陈凡的目的', to: '收入东宫', evidence: ['东宫'] },
          { entity: '陈凡', key: '在东宫的位置', to: '被拉拢的客卿', evidence: ['客卿'] },
        ],
        forbidden: [], obligations: [],
      },
      createdAt: '2026-11-15T02:00:00.000Z',
    },
    {
      id: 'b10-2', chapter: 10, title: '陈凡怎么应对', kind: '分叉', change: '陈凡对东宫的态度',
      status: 'committed', legacyReceipt: false, segmentId: 's-0002', requestId: 'q2',
      options, chosen: {
        label: '装傻，只给太子想看的', impact: '装傻',
        changes: [
          { entity: '陈凡', key: '对东宫的态度', to: '装傻，只给太子想看的', evidence: ['装傻'] },
          { entity: '陈凡', key: '东宫应对', to: '藏拙', evidence: ['藏拙'] },
        ],
        forbidden: [], obligations: [],
      },
      previousChoice: null, reopenCount: 0,
      createdAt: '2026-11-15T02:05:00.000Z',
    },
    {
      id: 'b10-3', chapter: 10, title: '章末钩子', kind: '分叉', change: '章末钩子',
      status: 'committed', legacyReceipt: false, segmentId: 's-0003', requestId: 'q3',
      options, chosen: {
        label: '太子露出不属于人类的气息', impact: '露出气息',
        changes: [
          { entity: '雪清河', key: '真实身份', to: '露出天使气息', evidence: ['天使'] },
          { entity: '陈凡', key: '对太子的最终判断', to: '确认太子不是普通人', evidence: ['不是人'] },
        ],
        forbidden: [], obligations: [],
      },
      createdAt: '2026-11-15T02:20:00.000Z',
    },
    {
      id: 'b11-1', chapter: 11, title: '入月轩的门路', kind: '分叉', change: '门路',
      status: 'proposed', legacyReceipt: false, segmentId: null, requestId: null,
      options, chosen: null, createdAt: '2026-11-15T03:00:00.000Z',
    },
  ]
  const segments = [
    { id: 's-0001', chapter: 10, decisionIds: ['b10-1'], file: FILE, offsetStart: 14, offsetEnd: 830, chars: 816, status: 'committed', revisionId: 'r-0001' },
    { id: 's-0002', chapter: 10, decisionIds: ['b10-2'], file: FILE, offsetStart: 833, offsetEnd: 1428, chars: 595, status: 'committed', revisionId: 'r-0002' },
    { id: 's-0003', chapter: 10, decisionIds: ['b10-3'], file: FILE, offsetStart: 1430, offsetEnd: 2055, chars: 625, status: 'committed', revisionId: 'r-0003' },
  ]
  const canon = [
    { entity: '雪清河', key: '对陈凡的目的', value: '收入东宫', chapter: 10, decisionId: 'b10-1' },
    { entity: '陈凡', key: '在东宫的位置', value: '被拉拢的客卿', chapter: 10, decisionId: 'b10-1' },
    { entity: '陈凡', key: '对东宫的态度', value: '装傻，只给太子想看的', chapter: 10, decisionId: 'b10-2' },
    { entity: '陈凡', key: '东宫应对', value: '藏拙', chapter: 10, decisionId: 'b10-2' },
    { entity: '雪清河', key: '真实身份', value: '露出天使气息', chapter: 10, decisionId: 'b10-3' },
    { entity: '陈凡', key: '对太子的最终判断', value: '确认太子不是普通人', chapter: 10, decisionId: 'b10-3' },
  ]
  const requests = [
    { id: 'q1', decisionId: 'b10-1', answeredAt: '2026-11-15T02:01:00.000Z', origin: 'author' },
    { id: 'q2', decisionId: 'b10-2', answeredAt: '2026-11-15T02:06:00.000Z', origin: 'author' },
    { id: 'q3', decisionId: 'b10-3', answeredAt: '2026-11-15T02:25:00.000Z', origin: 'author' },
  ]
  return {
    schemaVersion: 2,
    book: BOOK,
    meta: { title: BOOK },
    updatedAt: '2026-11-15T05:44:13.168Z',
    chapters: { 10: { status: 'decided', decisionIds: ['b10-1', 'b10-2', 'b10-3'] } },
    decisions,
    segments,
    canon,
    obligations: [],
    requests,
    revisions: [],
    audit: [],
    tasks: [],
    forks: [],
  }
}

test('parseChapterFileName 解析章号与标题', () => {
  assert.deepEqual(parseChapterFileName('第10章_太子雪清河.md'), { chapter: 10, title: '太子雪清河' })
  assert.deepEqual(parseChapterFileName('第1章_穿越斗罗大陆_独孤博之死_v3.md'), {
    chapter: 1,
    title: '穿越斗罗大陆 独孤博之死 v3',
  })
  assert.equal(parseChapterFileName('第10章.md'), null)
  assert.equal(parseChapterFileName('随便.md'), null)
})

test('overview 按章聚合统计、当前章、旧账与无锚点', () => {
  const data = fixture()
  const overview = buildOverview({ book: BOOK, data, on: true })
  assert.equal(overview.on, true)
  assert.equal(overview.book, BOOK)
  assert.deepEqual(overview.stats, {
    chapters: 3, decisions: 5, committed: 4, open: 1, segments: 3, chars: 2036,
  })
  assert.equal(overview.currentChapter, 11)
  const byChapter = new Map(overview.chapters.map((chapter) => [chapter.chapter, chapter]))
  assert.deepEqual(byChapter.get(10), {
    chapter: 10,
    title: '太子雪清河',
    decisions: 3,
    committed: 3,
    open: 0,
    segments: 3,
    chars: 2036,
    noAnchor: 0,
    legacy: false,
    stale: null,
    verifiedAt: null,
    continuationCheckRequired: false,
    writingMode: 'legacy',
    mergeHash: null,
    mergedAt: null,
  })
  assert.equal(byChapter.get(9).legacy, true)
  assert.equal(byChapter.get(9).noAnchor, 1)
  assert.equal(byChapter.get(11).open, 1)
  assert.equal(byChapter.get(11).noAnchor, 1)
})

test('chapter 详情：选项、canRevert、级联影响与 canon 归属', () => {
  const data = fixture()
  const chapter = buildChapter({ book: BOOK, data, chapter: 10 })
  assert.equal(chapter.title, '太子雪清河')
  assert.equal(chapter.decisions.length, 3)
  const b102 = chapter.decisions.find((decision) => decision.id === 'b10-2')
  assert.equal(b102.seq, 2)
  assert.equal(b102.chosen.label, '装傻，只给太子想看的')
  assert.equal(b102.chosen.changes.length, 2)
  assert.equal(b102.canRevert, true)
  assert.deepEqual(b102.revert, {
    segments: 2,
    chars: 1222,
    canonEntries: 4,
    decisionIds: ['b10-2', 'b10-3'],
    laterChapters: [11],
  })
  assert.equal(b102.segment.id, 's-0002')
  assert.equal(b102.receipt.origin, 'author')
  assert.equal(b102.attempts, 1)

  const b101 = chapter.decisions.find((decision) => decision.id === 'b10-1')
  assert.equal(b101.revert.segments, 3)
  assert.equal(b101.revert.chars, 2041)
  assert.equal(b101.revert.canonEntries, 6)

  const ch9 = buildChapter({ book: BOOK, data, chapter: 9 })
  assert.equal(ch9.decisions[0].canRevert, false)
  assert.equal(ch9.decisions[0].revertBlockedReason, 'legacy')
  assert.equal(ch9.decisions[0].segment, null)
})

test('0.10.2 决策投影包含状态前后值、EvidenceRef、六要素与独立拒收候选', () => {
  const data = fixture()
  const decision = data.decisions.find((entry) => entry.id === 'b10-2')
  const ref = { kind: 'body', file: FILE, offsetStart: 20, offsetEnd: 25, quote: '密令。', hash: 'a'.repeat(64), sourceLength: 100 }
  decision.gate = {
    entity: 'person:hero', entityLabel: '主角', key: 'identity.exposure', keyLabel: '身份暴露',
    from: 'unknown', fromLabel: '无人知晓', to: 'private', toLabel: '只告知同伴',
    reason: '此處不問就會替作者決定秘密由誰知曉。', evidence: [ref], confidence: 0.9,
  }
  decision.sourceRefs = [ref]
  decision.options[0] = {
    ...decision.options[0], action: '单独说明', costs: ['承担保密义务'],
    outcomes: [{ text: '获得同伴协助', basis: 'inference', sourceRefs: [ref] }],
    informationGain: [{ text: '确认同伴态度', basis: 'inference', sourceRefs: [ref] }],
    risks: [{ text: '消息可能外泄', basis: 'inference', sourceRefs: [ref] }],
    changes: [{ entity: 'person:hero', key: 'identity.exposure', from: 'unknown', fromLabel: '无人知晓', to: 'private', toLabel: '只告知同伴', evidence: [ref] }],
  }
  const inputBefore = structuredClone(data)
  const model = buildChapter({
    book: BOOK,
    data,
    chapter: 10,
    evidenceStatus: { 'b10-2': { status: 'invalid', valid: false, code: 'stale-evidence', message: 'hash changed' } },
    rejectedCandidates: [{ id: 'reject-1', title: '同一差分改写', reason: '与现有选项差分相同。', options: [{ label: '说出来' }] }],
  })
  const projected = model.decisions.find((entry) => entry.id === 'b10-2')
  assert.deepEqual(projected.gate.evidence[0], {
    kind: 'body', file: FILE, offsetStart: 20, offsetEnd: 25, quote: '密令。', hash: 'a'.repeat(64),
  })
  assert.equal(projected.gate.from, 'unknown')
  assert.equal(projected.gate.to, 'private')
  assert.equal(projected.evidenceStatus.valid, false)
  assert.equal(projected.canCommit, false)
  assert.equal(projected.canRevert, false)
  assert.equal(projected.revertBlockedReason, 'stale-evidence')
  assert.deepEqual(projected.options[0].costs, ['承担保密义务'])
  assert.equal(projected.options[0].outcomes[0].sourceRefs[0].quote, '密令。')
  assert.equal(projected.options[0].changes[0].fromLabel, '无人知晓')
  assert.equal(model.rejectedCandidates[0].reason, '与现有选项差分相同。')
  assert.equal(projected.options.some((option) => option.label === '说出来'), false)
  assert.deepEqual(data, inputBefore, 'panel 投影不得修改账本输入')
})

test('overview 投影可展示只读事务状态', () => {
  const transactionStatus = {
    blocked: true, quarantined: true, currentRevision: 49,
    latest: { txId: 'tx-example', stage: 'quarantined', beforeRevision: 48, afterRevision: 49 },
  }
  const result = buildOverview({ book: BOOK, data: fixture(), transactionStatus })
  assert.deepEqual(result.transactionStatus, transactionStatus)
  assert.equal(result.ledgerHash, null)
})

test('latestReopenRevision 找到目标决策最近一次回退快照', () => {
  const data = fixture()
  data.revisions = [
    { id: 'r-0006', kind: 'revert', reopen: true, recommitted: ['b10-2'], snapshot: 'rewinds/rw-1.md' },
    { id: 'r-0007', kind: 'revert', reopen: true, recommitted: ['b10-3'], snapshot: 'rewinds/rw-2.md' },
    { id: 'r-0008', kind: 'segment', snapshot: 'revisions/r-0008.md' },
  ]
  assert.equal(latestReopenRevision(data, 'b10-2').id, 'r-0006')
  assert.equal(latestReopenRevision(data, 'b10-3').id, 'r-0007')
  assert.equal(latestReopenRevision(data, 'b10-1'), null)
  assert.equal(latestReopenRevision(data, ''), null)
})

test('readChapterTitles 只读目录名，不读正文', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-panel-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, '正文'), { recursive: true })
  await writeFile(join(dir, '正文', '第10章_太子雪清河.md'), '正文不参与标题推断', 'utf8')
  await writeFile(join(dir, '正文', '第2章_天斗皇宫_武魂觉醒仪式.md'), '', 'utf8')
  const titles = await readChapterTitles(dir)
  assert.equal(titles.get(10), '太子雪清河')
  assert.equal(titles.get(2), '天斗皇宫 武魂觉醒仪式')
})

test('作者原文超过 2000 字时，面板截断并标记（完整原文仍留在账本）', () => {
  const long = '字'.repeat(2500)
  const data = {
    schemaVersion: 3,
    book: BOOK,
    decisions: [{
      id: 'b12-1', chapter: 12, title: '自定义走向', kind: '分叉', change: '',
      status: 'committed', legacyReceipt: false, segmentId: 's-12', requestId: 'q12',
      options: [{ label: 'A', changes: [] }, { label: 'B', changes: [] }],
      chosen: { label: '自定义', source: 'author-custom', custom: true, customText: long, changes: [] },
      answerText: long,
    }],
    segments: [{
      id: 's-12', chapter: 12, decisionIds: ['b12-1'], file: '正文/第12章.md',
      offsetStart: 0, offsetEnd: 10, chars: 10, status: 'committed',
    }],
    canon: [], requests: [], revisions: [], chapters: {}, tasks: [],
  }
  const chapter = buildChapter({ book: BOOK, data, chapter: 12 })
  const decision = chapter.decisions[0]
  assert.equal(decision.chosen.customTruncated, true)
  assert.equal(decision.chosen.customText.length, 2001, '2000 字 + 省略号')
  assert.equal(decision.answerTextTruncated, true)
})

test('changes 投影保留中文标签（entityLabel/keyLabel/fromLabel/toLabel）', () => {
  const data = fixture()
  const decision = data.decisions.find((entry) => entry.id === 'b10-1')
  decision.chosen.changes[0] = {
    ...decision.chosen.changes[0],
    entityLabel: '雪清河', keyLabel: '对陈凡的目的',
    from: 'undecided', fromLabel: '还没定', toLabel: '收入东宫',
  }
  const chapter = buildChapter({ book: BOOK, data, chapter: 10 })
  const b101 = chapter.decisions.find((entry) => entry.id === 'b10-1')
  assert.equal(b101.chosen.changes[0].entityLabel, '雪清河')
  assert.equal(b101.chosen.changes[0].keyLabel, '对陈凡的目的')
  assert.equal(b101.chosen.changes[0].fromLabel, '还没定')
  assert.equal(b101.chosen.changes[0].toLabel, '收入东宫')
})
