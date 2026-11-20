import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSearch } from '../lib/search.js'
import { computeRevision } from '../lib/store.js'

const BOOK = '搜索测试书'
const ledger = (extra = {}) => ({ revision: 7, decisions: [], canon: [], obligations: [], ...extra })
const search = (data, options = {}) => buildSearch({ book: BOOK, data, ...options })
const decision = (extra = {}) => ({
  id: 'b1', chapter: 3, title: '陈凡如何进城', status: 'committed',
  chosen: { label: '走东宫正门', changes: [{ entity: '陈凡', key: '身份', to: '东宫幕僚' }] },
  ...extra,
})

test('search returns no hits for an empty or whitespace query', () => {
  const data = ledger({ decisions: [decision()] })
  for (const q of ['', ' \t\n', '　']) {
    const result = search(data, { q })
    assert.deepEqual(result.hits, [])
    assert.equal(result.total, 0)
    assert.deepEqual(result.groups, { decision: 0, canon: 0, obligation: 0 })
  }
})

test('search matches decision title before choice and change and keeps receipt fields', () => {
  const result = search(ledger({ decisions: [decision({ segmentId: 's3' })] }), { q: ' 陈凡 ' })
  assert.deepEqual(result.hits, [{
    kind: 'decision', id: 'b1', chapter: 3, title: '陈凡如何进城', status: 'committed',
    choice: '走东宫正门', matchedIn: 'title', snippet: '陈凡如何进城', segmentId: 's3',
  }])
  assert.equal(result.q, '陈凡')
})

test('search matches chosen label before change', () => {
  const hit = search(ledger({ decisions: [decision()] }), { q: '东宫' }).hits[0]
  assert.equal(hit.matchedIn, 'choice')
  assert.equal(hit.snippet, '走东宫正门')
})

test('search matches answerText and uses it as choice when no chosen label exists', () => {
  const data = ledger({ decisions: [decision({ chosen: null, answerText: '自己翻过城墙', status: 'answered' })] })
  const hit = search(data, { q: '翻过' }).hits[0]
  assert.equal(hit.matchedIn, 'choice')
  assert.equal(hit.choice, '自己翻过城墙')
  assert.equal(hit.status, 'answered')
  assert.equal('segmentId' in hit, false)
})

test('search also checks answerText when a chosen label exists', () => {
  const data = ledger({ decisions: [decision({ answerText: '先去城南' })] })
  const hit = search(data, { q: '城南' }).hits[0]
  assert.equal(hit.matchedIn, 'choice')
  assert.equal(hit.snippet, '先去城南')
  assert.equal(hit.choice, '走东宫正门')
})

test('search matches each structured change field', () => {
  const data = ledger({ decisions: [decision({ title: '如何行动', chosen: {
    label: '先试探', changes: [{ entity: '陈凡', key: '身份', to: '东宫幕僚' }],
  } })] })
  for (const q of ['陈凡', '身份', '幕僚']) {
    assert.equal(search(data, { q }).hits[0].matchedIn, 'change')
  }
})

test('search matches canon entity, key, and value with a stable entity.key ID', () => {
  const data = ledger({ canon: [{ entity: '陈凡', key: '身份', value: '东宫幕僚', chapter: 4 }] })
  for (const q of ['陈凡', '身份', '幕僚']) {
    const [hit] = search(data, { q }).hits
    assert.equal(hit.id, '陈凡.身份')
    assert.equal(hit.title, '陈凡.身份')
    assert.equal(hit.chapter, 4)
    assert.equal(hit.matchedIn, 'canon')
  }
})

test('search matches obligation text and ID and uses dueChapter', () => {
  const data = ledger({ obligations: [{ id: 'promise-1', text: '向陈凡归还信物', dueChapter: 6 }] })
  for (const q of ['信物', 'promise-1']) {
    const [hit] = search(data, { q }).hits
    assert.equal(hit.kind, 'obligation')
    assert.equal(hit.title, '向陈凡归还信物')
    assert.equal(hit.chapter, 6)
    assert.equal(hit.matchedIn, 'obligation')
  }
})

test('entity filter keeps exact matching changes and canon and excludes obligations', () => {
  const data = ledger({
    decisions: [decision(), decision({ id: 'b2', chosen: { label: '去东宫', changes: [{ entity: '陈凡之友' }] } })],
    canon: [{ entity: '陈凡', key: '去向', value: '东宫' }, { entity: '陈凡之友', key: '去向', value: '东宫' }],
    obligations: [{ id: 'o1', text: '陈凡去东宫' }],
  })
  const result = search(data, { q: '东宫', entity: '陈凡' })
  assert.deepEqual(result.hits.map((hit) => hit.id), ['b1', '陈凡.去向'])
  assert.deepEqual(result.groups, { decision: 1, canon: 1, obligation: 0 })
  assert.equal(search(data, { entity: '陈凡' }).total, 0)
  assert.equal(search(data, { q: '东宫', entity: ' 陈凡 ' }).total, 0)
})

test('status filter applies only to decisions and preserves original status', () => {
  const data = ledger({
    decisions: [decision({ status: 'Committed' }), decision({ id: 'b2', status: 'proposed' })],
    canon: [{ entity: '陈凡', key: '去向', value: '东宫' }],
    obligations: [{ id: 'o1', text: '陈凡归还信物', status: 'open' }],
  })
  const result = search(data, { q: '陈凡', status: 'ＣＯＭＭＩＴＴＥＤ' })
  assert.deepEqual(result.hits.map((hit) => hit.id), ['b1', '陈凡.去向', 'o1'])
  assert.equal(result.hits[0].status, 'Committed')
})

test('chapter filter excludes other and missing chapters and uses obligation dueChapter', () => {
  const data = ledger({
    decisions: [decision(), decision({ id: 'b2', chapter: 4 })],
    canon: [
      { entity: '陈凡', key: '身份', value: '幕僚', chapter: 3 },
      { entity: '陈凡', key: '去向', value: '东宫' },
    ],
    obligations: [
      { id: 'o1', text: '陈凡还信物', dueChapter: 3, chapter: 4 },
      { id: 'o2', text: '陈凡还礼', chapter: 3 },
    ],
  })
  assert.deepEqual(search(data, { q: '陈凡', chapter: 3 }).hits.map((hit) => hit.id), ['b1', '陈凡.身份', 'o1'])
  assert.equal(search(data, { q: '陈凡', chapter: '' }).total, 6)
})

test('limit truncates hits after total and groups are counted', () => {
  const data = ledger({
    decisions: Array.from({ length: 55 }, (_, index) => decision({ id: `b${index}` })),
    canon: [{ entity: '陈凡', key: '身份', value: '幕僚' }],
    obligations: [{ id: 'o1', text: '陈凡还信物' }],
  })
  for (const [limit, expected] of [[2, 2], [0, 1], [-5, 1], [80, 50], [2.8, 2], [NaN, 20], [Infinity, 20]]) {
    const result = search(data, { q: '陈凡', limit })
    assert.equal(result.total, 57)
    assert.deepEqual(result.groups, { decision: 55, canon: 1, obligation: 1 })
    assert.equal(result.limit, expected)
    assert.equal(result.hits.length, expected)
  }
})

test('search normalizes fullwidth characters and case in queries, fields, and entity filters', () => {
  const data = ledger({ decisions: [decision({
    title: 'ＮＰＣ Alpha', chosen: { label: 'Choose A', changes: [{ entity: 'ＡＬＰＨＡ', key: 'name', to: 'ready' }] },
  })], canon: [{ entity: 'Alpha', key: 'type', value: 'ＮＰＣ' }] })
  const result = search(data, { q: 'npc', entity: 'alpha' })
  assert.equal(result.total, 2)
  assert.equal(result.hits[0].snippet, 'ＮＰＣ Alpha')
  assert.equal(search(data, { q: 'ＣＨＯＯＳＥ' }).hits[0].matchedIn, 'choice')
})

test('search treats regex and prototype-like characters as literal text', () => {
  const title = '路径 [a-z]+ (x)? \\ .* __proto__ constructor'
  const data = ledger({ decisions: [decision({ id: '__proto__', title })] })
  for (const q of ['[a-z]+', '(x)?', '\\', '.*', '__proto__', 'constructor']) {
    const result = search(data, { q })
    assert.equal(result.total, 1)
    assert.equal(result.hits[0].id, '__proto__')
  }
  assert.equal(search(data, { q: '[oops' }).total, 0)
})

test('search converts non-string stored values to text for matching', () => {
  const data = ledger({ canon: [{ entity: '陈凡', key: '银两', value: 0, chapter: 1 }] })
  assert.equal(search(data, { q: '0' }).hits[0].snippet, '0')
})

test('search deduplicates each kind by its stable key after filtering', () => {
  const data = ledger({
    decisions: [decision({ title: '没有关键词', chosen: null }), decision(), decision()],
    canon: [
      { entity: '角色', key: '身份', value: '未定' },
      { entity: '角色', key: '身份', value: '陈凡幕僚' },
      { entity: '角色', key: '身份', value: '陈凡幕僚' },
    ],
    obligations: [{ id: 'b1', text: '陈凡归还信物' }, { id: 'b1', text: '陈凡归还信物' }],
  })
  const result = search(data, { q: '陈凡' })
  assert.equal(result.total, 3)
  assert.deepEqual(result.groups, { decision: 1, canon: 1, obligation: 1 })
})

test('search sorts by kind, descending chapter, then title with missing chapters last', () => {
  const data = ledger({
    decisions: [
      decision({ id: 'old', chapter: 1, title: 'match old' }),
      decision({ id: 'z', chapter: 5, title: 'match z' }),
      decision({ id: 'a', chapter: 5, title: 'match a' }),
    ],
    canon: [
      { entity: 'missing', key: 'match', value: '' },
      { entity: 'known', key: 'match', value: '', chapter: 99 },
    ],
    obligations: [{ id: 'later', text: 'match later', dueChapter: 100 }],
  })
  assert.deepEqual(search(data, { q: 'match' }).hits.map((hit) => hit.id),
    ['a', 'z', 'old', 'known.match', 'missing.match', 'later'])
})

test('search snippets include twenty characters on each side of the matching field', () => {
  const data = ledger({ decisions: [decision({ title: '前'.repeat(30) + '命中' + '后'.repeat(30) })] })
  const [hit] = search(data, { q: '命中' }).hits
  assert.equal(hit.snippet, '…' + '前'.repeat(20) + '命中' + '后'.repeat(20) + '…')
})

test('search snippets retain original Unicode text after compatibility expansion', () => {
  const title = '😀'.repeat(30) + 'ﬃ' + '后'.repeat(30)
  const data = ledger({ decisions: [decision({ title })] })
  assert.equal(search(data, { q: 'ffi' }).hits[0].snippet,
    '…' + '😀'.repeat(20) + 'ﬃ' + '后'.repeat(20) + '…')
})

test('search is a pure projection and returns the ledger revision', () => {
  const data = ledger({ decisions: [decision()], revision: undefined, revisions: [{}, {}], audit: [{}] })
  const before = structuredClone(data)
  const result = search(data, { q: '陈凡' })
  assert.equal(result.ok, true)
  assert.equal(result.book, BOOK)
  assert.equal(result.revision, computeRevision(data))
  assert.equal(result.revision, 3)
  assert.deepEqual(data, before)
  assert.deepEqual(search(undefined, { q: '陈凡' }).hits, [])
})
