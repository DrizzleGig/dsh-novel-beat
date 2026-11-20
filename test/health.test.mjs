import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHealth } from '../lib/health.js'
import { normalizeNewlines, sliceHash } from '../lib/segment.js'
import { computeRevision } from '../lib/store.js'

const BOOK = '体检测试书'
const CHAPTER = 10
const BODY = '风起。\n云涌。\n雨落。'
const decision = (id, status, extra = {}) => ({ id, chapter: CHAPTER, title: `决策 ${id}`, status, ...extra })
const segment = (id, start = 0, end = BODY.length, extra = {}) => ({
  id, chapter: CHAPTER, status: 'committed', offsetStart: start, offsetEnd: end,
  hash: sliceHash(BODY, start, end), ...extra,
})
const ledger = (extra = {}) => ({ decisions: [], segments: [], obligations: [], chapters: {}, revisions: [], audit: [], ...extra })
const health = (data, text = '', extra = {}) => buildHealth({ book: BOOK, data, chapter: CHAPTER, text, ...extra })
const byCode = (result, code) => result.issues.find((issue) => issue.code === code)

const cases = [
  ['OPEN_DECISION', 'block', '去拍板', ledger({ decisions: [decision('b1', 'proposed')] }), ''],
  ['AWAITING_SEGMENT', 'block', '去登记段落', ledger({ decisions: [decision('b1', 'committed')] }), ''],
  ['PENDING_CONFIRM', 'block', '确认设定变更', ledger({ decisions: [decision('b1', 'answered', { pendingChoice: { label: '放行' } })] }), ''],
  ['NEEDS_CHECK', 'warn', '做续写检查', ledger({ chapters: { 10: { continuationCheckRequired: true } } }), ''],
  ['DRIFT', 'warn', '重建段落/接受漂移', ledger({ segments: [segment('s1')] }), BODY.replace('风', '雷')],
  ['UNSEGMENTED', 'warn', '补登记', ledger(), BODY],
  ['OVERDUE_OBLIGATION', 'warn', '处理到期义务', ledger({ obligations: [{ id: 'ob1', text: '归还信物', status: 'open', dueChapter: 10 }] }), ''],
  ['STALE', 'info', '去复核', ledger({ chapters: { 10: { stale: { reason: '前章改选' } } } }), ''],
  ['NO_ANCHOR', 'info', '查看旧账说明', ledger({ decisions: [decision('b1', 'committed', { legacyReceipt: true })] }), ''],
  ['TEXT_UNAVAILABLE', 'info', '手动打开正文', ledger(), null],
]

for (const [code, severity, action, data, text] of cases) {
  test(`health ${code}：独立 fixture 生成对应问题、严重度和动作`, () => {
    const result = health(data, text)
    assert.deepEqual(result.issues.map((issue) => issue.code), [code])
    const issue = result.issues[0]
    assert.equal(issue.severity, severity)
    assert.equal(issue.count, 1)
    assert.equal(issue.items.length, 1)
    assert.equal(issue.action, action)
    assert.deepEqual(Object.keys(issue.items[0]), ['id', 'title', 'detail'])
    assert.ok(issue.items[0].detail.length > 5)
  })
}

test('health answered 无 pendingChoice 仍算 OPEN_DECISION（自定义答案待补结构化变化）', () => {
  const result = health(ledger({ decisions: [decision('b1', 'answered')] }), '')
  assert.deepEqual(result.issues.map((issue) => issue.code), ['OPEN_DECISION'])
  assert.match(result.issues[0].items[0].detail, /自定义答案/)
})

test('health level 优先级为 block > warn > ok，info 不抬高等级', () => {  const data = ledger({
    decisions: [decision('b1', 'asked')],
    chapters: { 10: { continuationCheckRequired: true, stale: { reason: '前章变化' } } },
  })
  assert.equal(health(data).level, 'block')
  data.decisions = []
  assert.equal(health(data).level, 'warn')
  data.chapters[10].continuationCheckRequired = false
  assert.equal(health(data).level, 'ok')
  assert.equal(health(ledger()).level, 'ok')
})

test('health counts 按问题数量求和，items 最多展示五条', () => {
  const data = ledger({
    decisions: [
      ...Array.from({ length: 7 }, (_, index) => decision(`b${index}`, 'proposed')),
      decision('waiting', 'committed'),
      decision('pending', 'answered', { pendingChoice: { label: '救人' } }),
      decision('legacy', 'committed', { legacyReceipt: true }),
    ],
    chapters: { 10: { continuationCheckRequired: true, stale: { reason: '需要复核' } } },
    obligations: [1, 2].map((index) => ({ id: `ob${index}`, text: '归还信物', status: 'open', dueChapter: 9 })),
  })
  const result = health(data, null)
  assert.deepEqual(result.counts, { block: 9, warn: 3, info: 3 })
  assert.equal(byCode(result, 'OPEN_DECISION').count, 7)
  assert.equal(byCode(result, 'OPEN_DECISION').items.length, 5)
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    'OPEN_DECISION', 'AWAITING_SEGMENT', 'PENDING_CONFIRM', 'NEEDS_CHECK',
    'OVERDUE_OBLIGATION', 'STALE', 'NO_ANCHOR', 'TEXT_UNAVAILABLE',
  ])
})

test('health 本章 proposed/asked、待确认、旧账和待登记互不重复', () => {
  const data = ledger({ decisions: [
    decision('asked', 'asked'),
    decision('answered', 'answered'),
    decision('pending', 'answered', { pendingChoice: { label: '救人' } }),
    decision('old', 'committed', { legacyReceipt: true }),
    decision('waiting', 'committed', { legacy: true }),
    decision('anchored', 'committed', { segmentId: 's1' }),
    decision('cancelled', 'cancelled'),
    decision('superseded', 'superseded'),
    decision('other', 'proposed', { chapter: 9 }),
  ] })
  const result = health(data)
  assert.deepEqual(result.counts, { block: 4, warn: 0, info: 1 })
  for (const [code, ids] of [
    ['OPEN_DECISION', ['asked', 'answered']],
    ['AWAITING_SEGMENT', ['waiting']],
    ['PENDING_CONFIRM', ['pending']],
    ['NO_ANCHOR', ['old']],
  ]) {
    assert.deepEqual(byCode(result, code).items.map((item) => item.id), ids)
  }
})

test('health 真实 sliceHash 检出漂移，并报告未登记前缀、中段和尾部', () => {
  const text = '漏\n已登记\n漏中\n已登记\n漏尾'
  const data = ledger({ segments: [
    { ...segment('s1'), offsetStart: 2, offsetEnd: 5, hash: sliceHash(text, 2, 5) },
    { ...segment('s2'), offsetStart: 9, offsetEnd: 12, hash: sliceHash(text, 9, 12) },
  ] })
  const result = health(data, text.replace('已登记', '未登记'))
  assert.deepEqual(result.issues.map((issue) => issue.code), ['DRIFT', 'UNSEGMENTED'])
  assert.equal(byCode(result, 'DRIFT').count, 1)
  assert.match(byCode(result, 'DRIFT').items[0].detail, /hash 对不上 · s1/)
  assert.equal(byCode(result, 'UNSEGMENTED').count, 3)
  assert.deepEqual(byCode(result, 'UNSEGMENTED').items.map((item) => item.detail), [
    '区间 0–1 · 1 字', '区间 6–8 · 2 字', '区间 13–15 · 2 字',
  ])
})

test('health 未回退段落按区间并集覆盖，忽略纯空白间隙', () => {
  const text = '甲乙丙\n \t丁戊己\n'
  const rows = [[6, 9], [1, 3], [0, 2], [1, 2]].map(([start, end], index) => ({
    id: `s${index}`, chapter: CHAPTER, status: index === 0 ? 'stale' : 'committed',
    offsetStart: start, offsetEnd: end, hash: sliceHash(text, start, end),
  }))
  const data = ledger({ segments: rows })
  assert.deepEqual(health(data, text).issues, [])
  assert.deepEqual(data.segments, rows, '不得原地重排源数组')
})

test('health 已回退和其他章段落不参与漂移或覆盖', () => {
  const data = ledger({ segments: [
    segment('reverted', 0, BODY.length, { status: 'reverted', hash: 'incorrect' }),
    segment('other', 0, BODY.length, { chapter: 9, hash: 'incorrect' }),
  ] })
  const result = health(data, BODY)
  assert.deepEqual(result.issues.map((issue) => issue.code), ['UNSEGMENTED'])
  assert.equal(result.issues[0].count, 1)
})

test('health 非法或越界段落不阻断体检，也不掩盖未登记正文', () => {
  const ranges = [[-1, 3], [0, BODY.length + 1], [4, 2], [0.5, 3], [0, '3']]
  const data = ledger({ segments: ranges.map(([offsetStart, offsetEnd], index) => ({
    ...segment(`s${index}`), offsetStart, offsetEnd,
  })) })
  const result = health(data, BODY)
  assert.equal(byCode(result, 'DRIFT').count, 5)
  assert.equal(byCode(result, 'UNSEGMENTED').count, 1)
  assert.ok(byCode(result, 'DRIFT').items.every((item) => item.detail.includes('区间不合法')))
})

test('health TEXT_UNAVAILABLE 跳过漂移/覆盖，空字符串正文仍可用', () => {
  const data = ledger({ segments: [segment('s1', 0, BODY.length, { hash: 'bad' })] })
  const result = health(data, null)
  assert.equal(result.textAvailable, false)
  assert.deepEqual(result.issues.map((issue) => issue.code), ['TEXT_UNAVAILABLE'])
  const empty = health(ledger(), '')
  assert.equal(empty.textAvailable, true)
  assert.deepEqual(empty.issues, [])
})

test('health 到期义务跨章累计，排除已回收、豁免、未到期和无期限项', () => {
  const data = ledger({ obligations: [
    { id: 'old', dueChapter: 2, status: 'open' },
    { id: 'today', dueChapter: 10, status: 'open' },
    { id: 'paid', dueChapter: 1, status: 'paid' },
    { id: 'waived', dueChapter: 1, status: 'waived' },
    { id: 'future', dueChapter: 11, status: 'open' },
    { id: 'null', dueChapter: null, status: 'open' },
    { id: 'missing', status: 'open' },
  ] })
  assert.deepEqual(byCode(health(data), 'OVERDUE_OBLIGATION').items.map((item) => item.id), ['old', 'today'])
})

test('health 换行先归一化，与 sliceHash 和正文登记的偏移一致', () => {
  const raw = '甲\r\n乙\r丙'
  const text = normalizeNewlines(raw)
  const data = ledger({ segments: [{
    id: 's1', chapter: CHAPTER, status: 'committed', offsetStart: 0, offsetEnd: text.length,
    hash: sliceHash(raw, 0, text.length),
  }] })
  assert.deepEqual(health(data, raw).issues, [])
})

test('health 仅含空白的正文无需登记，区间数字有千位分隔', () => {
  assert.deepEqual(health(ledger(), ' \t\n\u3000').issues, [])
  const text = ' '.repeat(1222) + '字'.repeat(38)
  assert.equal(byCode(health(ledger(), text), 'UNSEGMENTED').items[0].detail, '区间 1,222–1,260 · 38 字')
})

test('health 返回实际 revision、章节标题并保持账本和输入不变', () => {
  const data = ledger({ revision: 17, chapters: { 10: { continuationCheckRequired: true } } })
  const before = structuredClone(data)
  const chapterTitles = new Map([[10, '风雨将至']])
  const result = health(data, '', { chapterTitles })
  assert.equal(result.ok, true)
  assert.equal(result.book, BOOK)
  assert.equal(result.chapter, CHAPTER)
  assert.equal(result.revision, computeRevision(data))
  assert.equal(result.issues[0].items[0].title, '风雨将至')
  assert.deepEqual(data, before)
  assert.deepEqual(chapterTitles, new Map([[10, '风雨将至']]))
  assert.equal(health({ audit: [{}, {}], revisions: [{}] }).revision, 3)
})
