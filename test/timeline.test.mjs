import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTimeline } from '../lib/timeline.js'
import { computeRevision } from '../lib/store.js'

const BOOK = '时间线测试书'
const AT = '2026-11-20T03:00:00.000Z'
const TYPES = ['plan', 'fork', 'commit', 'segment', 'revert', 'verify', 'waive', 'override', 'stale', 'check']

function fixture() {
  return {
    revision: 17,
    decisions: [{ id: 'b10-1', chapter: 10, title: '如何入城', chosen: { label: '走正门' } }],
    requests: [{ id: 'q-1', decisionId: 'b10-1', askedAt: AT, answeredAt: AT, answer: { selected: ['走侧门'] }, origin: 'author' }],
    segments: [{ id: 's-1', chapter: 10, decisionIds: ['b10-1'], chars: 120 }],
    revisions: [
      { id: 'r-1', kind: 'segment', chapter: 10, segmentId: 's-1', chars: 120, createdAt: AT },
      {
        id: 'r-2', kind: 'revert', chapter: 10, segmentId: 's-1', createdAt: AT,
        recommitted: ['b10-1'], reopenedDecisions: ['b10-2', 'b10-3'], choice: '走暗道',
        charsRemoved: 120, snapshot: 'rewinds/r-2.md',
      },
    ],
    audit: [
      { action: 'plan', chapter: 10, count: 3, at: AT },
      { action: 'fork-planned', chapter: 10, forkId: 'f-1', decisionId: 'b10-1', at: AT },
      { action: 'fork', chapter: 10, forkId: 'f-1', text: '城门紧闭', at: AT },
      { action: 'verify', chapter: 10, paid: [], at: AT },
      { action: 'waive', obligationId: 'o-1', at: AT },
      { action: 'canon-override', chapter: 10, entity: '城主', key: '身份', at: AT },
      { action: 'continuation-check', chapter: 10, reason: '先完成进城过渡', at: AT },
    ],
    obligations: [{ id: 'o-1', sourceDecision: 'b10-1', status: 'waived' }],
    chapters: { 11: { stale: { since: AT, reason: '第 10 章改选', sourceDecisionId: 'b10-1' } } },
  }
}

function timeline(data, options = {}) {
  return buildTimeline({ book: BOOK, data, ...options })
}

test('timeline projects all ten event types with readable summaries and stable IDs', () => {
  const result = timeline(fixture())
  assert.equal(result.ok, true)
  assert.equal(result.book, BOOK)
  assert.equal(result.revision, 17)
  assert.equal(result.total, 10)
  assert.deepEqual(result.counts, Object.fromEntries(TYPES.map((type) => [type, 1])))
  const events = Object.fromEntries(result.entries.map((entry) => [entry.type, entry]))
  assert.equal(events.plan.summary, '登记 3 个岔路')
  assert.equal(events.fork.summary, '发现岔路：城门紧闭')
  assert.equal(events.commit.summary, '「如何入城」→「走侧门」')
  assert.equal(events.segment.summary, '正文 120 字已登记')
  assert.equal(events.segment.segmentId, 's-1')
  assert.equal(events.segment.revisionId, 'r-1')
  assert.equal(events.revert.summary, '「如何入城」改成「走暗道」· 删 120 字 · 重开 2 个')
  assert.equal(events.revert.oldLineDecisionId, 'b10-1')
  assert.equal(events.revert.canOpenOldLine, true)
  assert.equal(events.verify.summary, '结构核对通过')
  assert.equal(events.waive.summary, '豁免义务 o-1')
  assert.equal(events.waive.chapter, 10)
  assert.equal(events.override.summary, '覆盖设定 城主.身份')
  assert.equal(events.check.summary, '续写检查：先完成进城过渡')
  assert.equal(events.stale.summary, '第 11 章待复核：第 10 章改选')
  assert.equal(events.stale.eventId, 'stale:11')
  assert.equal(events.stale.at, AT)
  assert.equal(new Set(result.entries.map((entry) => entry.eventId)).size, result.total)
})

test('timeline ignores duplicate audit projections and unsupported audit actions', () => {
  const data = fixture()
  data.audit.push(...['rewind', 'revert', 'commit', 'segment', 'answer-needs-changes', 'conflict-pending', 'migrate-0.7'].map((action) => ({ action, chapter: 10, at: AT })))
  const result = timeline(data)
  assert.equal(result.total, 10)
  assert.equal(result.counts.revert, 1)
  assert.equal(result.counts.commit, 1)
  assert.equal(result.counts.segment, 1)
})

test('timeline prefers fork over fork-planned in either audit order and keeps distinct forks', () => {
  for (const reverse of [false, true]) {
    const audit = [
      { action: 'fork-planned', forkId: 'f-1' },
      { action: 'fork', forkId: 'f-1', text: '原始岔路' },
      { action: 'fork-planned', forkId: 'f-2', text: '另一个岔路' },
    ]
    if (reverse) audit.reverse()
    const result = timeline({ audit })
    assert.equal(result.total, 2)
    assert.ok(result.entries.some((entry) => entry.summary === '发现岔路：原始岔路'))
    assert.ok(result.entries.some((entry) => entry.summary === '发现岔路：另一个岔路'))
  }
})

test('timeline sorts newest timestamps first, equal timestamps by eventId descending, and unknown times last', () => {
  const result = timeline({ requests: [
    { id: 'unknown-a' },
    { id: 'a', answeredAt: AT },
    { id: 'z', answeredAt: AT },
    { id: 'old', answeredAt: '2026-11-19T23:00:00.000Z' },
    { id: 'new', answeredAt: '2026-11-20T12:00:00+08:00' },
    { id: 'unknown-z', answeredAt: 'invalid' },
  ] })
  assert.deepEqual(result.entries.map((entry) => entry.eventId), [
    'request:new', 'request:z', 'request:a', 'request:old', 'request:unknown-z', 'request:unknown-a',
  ])
  assert.equal(result.entries[0].at, '2026-11-20T04:00:00.000Z')
  assert.equal(result.entries.at(-1).at, null)
})

test('timeline paginates after sorting while counts and total cover the whole selection', () => {
  const data = fixture()
  const all = timeline(data)
  const middle = timeline(data, { limit: 3, offset: 2 })
  assert.deepEqual(middle.entries, all.entries.slice(2, 5))
  assert.equal(middle.total, 10)
  assert.deepEqual(middle.counts, all.counts)
  assert.equal(middle.limit, 3)
  assert.equal(middle.offset, 2)
  assert.equal(middle.hasMore, true)
  const last = timeline(data, { limit: 3, offset: 9 })
  assert.equal(last.entries.length, 1)
  assert.equal(last.hasMore, false)
  assert.deepEqual(timeline(data, { offset: 100 }).entries, [])
})

test('timeline filters chapters before computing counts and pagination', () => {
  const data = fixture()
  const result = timeline(data, { chapter: 10, limit: 2 })
  assert.equal(result.total, 9)
  assert.equal(result.counts.stale, 0)
  assert.equal(result.counts.waive, 1)
  assert.equal(result.entries.length, 2)
  assert.ok(result.entries.every((entry) => entry.chapter === 10))
  assert.equal(timeline(data, { chapter: 11 }).total, 1)
  assert.equal(timeline(data, { chapter: 12 }).total, 0)
  assert.equal(timeline(data, { chapter: null }).total, 10)
})

test('timeline bounds numeric limit and offset and uses defaults for invalid values', () => {
  for (const [limit, expected] of [[-1, 1], [0, 1], [101, 100], [3.8, 3], [NaN, 30], [Infinity, 30], ['4', 30], [null, 30]]) {
    assert.equal(timeline({}, { limit }).limit, expected)
  }
  for (const [offset, expected] of [[-2, 0], [3.8, 3], [NaN, 0], [Infinity, 0], ['4', 0], [null, 0]]) {
    assert.equal(timeline({}, { offset }).offset, expected)
  }
})

test('timeline handles empty and missing ledgers without inventing events', () => {
  for (const data of [{}, null, { requests: [], revisions: [], audit: [], chapters: {} }]) {
    const result = timeline(data)
    assert.deepEqual(result.entries, [])
    assert.deepEqual(result.counts, Object.fromEntries(TYPES.map((type) => [type, 0])))
    assert.equal(result.total, 0)
    assert.equal(result.revision, 0)
    assert.equal(result.hasMore, false)
  }
})

test('timeline takes historical receipt choices before current decision choices and marks model relay', () => {
  const data = fixture()
  data.requests[0].origin = 'model-relayed'
  data.requests[0].answeredAt = null
  const event = timeline(data).entries.find((entry) => entry.type === 'commit')
  assert.equal(event.choice, '走侧门')
  assert.equal(event.at, AT)
  assert.equal(event.summary, '「如何入城」→「走侧门」（模型转述）')
  delete data.requests[0].answer
  assert.equal(timeline(data).entries.find((entry) => entry.type === 'commit').choice, '走正门')
  data.decisions[0].chosen = null
  data.decisions[0].answerText = '作者自由回答'
  assert.equal(timeline(data).entries.find((entry) => entry.type === 'commit').choice, '作者自由回答')
})

test('timeline can resolve a request through decision.requestId without fabricating revision IDs', () => {
  const data = {
    decisions: [{ id: 'b1-1', chapter: 1, title: '旧选择', requestId: 'q-old' }],
    requests: [{ id: 'q-old', answer: { selected: ['留下'] } }],
    audit: [{ action: 'plan', count: 1 }],
    revisions: [{ kind: 'segment', chars: 2 }],
  }
  const result = timeline(data)
  const commit = result.entries.find((entry) => entry.type === 'commit')
  assert.equal(commit.decisionId, 'b1-1')
  assert.equal(commit.chapter, 1)
  assert.equal(commit.title, '旧选择')
  assert.ok(result.entries.every((entry) => !Object.hasOwn(entry, 'commitId')))
  assert.ok(result.entries.every((entry) => !Object.hasOwn(entry, 'revisionId')))
  assert.equal(result.revision, computeRevision(data))
})

test('timeline keeps legacy revert information without claiming a snapshot exists', () => {
  const data = fixture()
  data.revisions = [{
    id: 'r-old', kind: 'revert', segmentId: 's-1', revertedDecisions: ['b10-1'],
    charsRemoved: 40, createdAt: AT,
  }]
  const event = timeline(data).entries.find((entry) => entry.type === 'revert')
  assert.equal(event.decisionId, 'b10-1')
  assert.equal(event.chapter, 10)
  assert.equal(event.chars, 40)
  assert.equal(event.oldLineDecisionId, 'b10-1')
  assert.equal(event.canOpenOldLine, false)
})

test('timeline resolves keep from the matching rewind receipt rather than a later decision choice', () => {
  const data = fixture()
  data.revisions[1].choice = 'keep'
  const event = timeline(data).entries.find((entry) => entry.type === 'revert')
  assert.equal(event.choice, '走侧门')
  assert.match(event.summary, /改成「走侧门」/)
})

test('timeline reports warning counts without treating paid obligations as warnings', () => {
  const result = timeline({ audit: [
    { action: 'verify', paid: ['o-1', 'o-2'] },
    { action: 'verify', warnings: ['缺少证据', '有漂移'] },
    { action: 'verify', warnings: 3 },
  ] })
  assert.deepEqual(result.entries.map((entry) => entry.summary), ['有 3 个提醒', '有 2 个提醒', '结构核对通过'])
})

test('timeline uses supplied chapter titles for chapter events and leaves input unchanged', () => {
  const data = fixture()
  const before = structuredClone(data)
  function freeze(value) {
    if (!value || typeof value !== 'object') return
    Object.freeze(value)
    for (const nested of Object.values(value)) freeze(nested)
  }
  freeze(data)
  const result = timeline(data, { chapterTitles: new Map([[10, '入城']]) })
  assert.equal(result.entries.find((entry) => entry.type === 'plan').title, '入城')
  assert.deepEqual(data, before)
  assert.deepEqual(timeline(data), timeline(data))
})
