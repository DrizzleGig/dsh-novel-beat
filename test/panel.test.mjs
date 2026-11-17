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
