import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sha256 } from '../lib/segment.js'
import { readBookData } from '../lib/store.js'
import { planRewind, executeRewind } from '../lib/rewind.js'
import { executeNext, executeSegment } from '../lib/tools.js'

const BOOK = '回退测试书'
const FILE = '正文/第10章_太子雪清河.md'

function option(label, impact, changes) {
  return {
    label,
    impact,
    changes,
    obligations: [],
    forbidden: [],
  }
}

function fixtureData(body) {
  const options = [
    option('装傻，只给太子想看的', '装傻', [
      { entity: '陈凡', key: '对东宫的态度', to: '装傻，只给太子想看的', evidence: ['装傻'] },
      { entity: '陈凡', key: '东宫应对', to: '藏拙', evidence: ['藏拙'] },
    ]),
    option('半真半假，借东宫的势', '借势', [
      { entity: '陈凡', key: '对东宫的态度', to: '半真半假，借势', evidence: ['借势'] },
      { entity: '陈凡', key: '与东宫的关系', to: '有限合作', evidence: ['合作'] },
    ]),
  ]
  const decisions = [
    {
      id: 'b10-1', chapter: 10, title: '太子的真正目的', kind: '分叉', change: '目的',
      status: 'committed', legacy: false, legacyReceipt: false, segmentId: 's-0001', requestId: 'q1',
      options, chosen: option('太子要收他进东宫', '拉拢', [
        { entity: '雪清河', key: '对陈凡的目的', to: '收入东宫', evidence: ['东宫'] },
        { entity: '陈凡', key: '在东宫的位置', to: '被拉拢的客卿', evidence: ['客卿'] },
      ]),
      createdAt: '2026-11-15T02:00:00.000Z', decidedAt: '2026-11-15T02:01:00.000Z', answeredAt: '2026-11-15T02:01:00.000Z',
    },
    {
      id: 'b10-2', chapter: 10, title: '陈凡怎么应对', kind: '分叉', change: '陈凡对东宫的态度',
      status: 'committed', legacy: false, legacyReceipt: false, segmentId: 's-0002', requestId: 'q2',
      options, chosen: option('装傻，只给太子想看的', '装傻', [
        { entity: '陈凡', key: '对东宫的态度', to: '装傻，只给太子想看的', evidence: ['装傻'] },
        { entity: '陈凡', key: '东宫应对', to: '藏拙', evidence: ['藏拙'] },
      ]),
      createdAt: '2026-11-15T02:05:00.000Z', decidedAt: '2026-11-15T02:06:00.000Z', answeredAt: '2026-11-15T02:06:00.000Z',
    },
    {
      id: 'b10-3', chapter: 10, title: '章末钩子', kind: '分叉', change: '章末钩子',
      status: 'committed', legacy: false, legacyReceipt: false, segmentId: 's-0003', requestId: 'q3',
      options: [
        option('太子露出不属于人类的气息', '气息', [
          { entity: '雪清河', key: '真实身份', to: '露出天使气息', evidence: ['天使'] },
          { entity: '陈凡', key: '对太子的最终判断', to: '确认太子不是普通人', evidence: ['不是人'] },
        ]),
        option('东宫给一个无法拒绝的任务', '任务', [
          { entity: '雪清河', key: '对陈凡的安排', to: '给一个任务', evidence: ['任务'] },
          { entity: '陈凡', key: '东宫任务', to: '被迫接受', evidence: ['接受'] },
        ]),
      ],
      chosen: option('太子露出不属于人类的气息', '气息', [
        { entity: '雪清河', key: '真实身份', to: '露出天使气息', evidence: ['天使'] },
        { entity: '陈凡', key: '对太子的最终判断', to: '确认太子不是普通人', evidence: ['不是人'] },
      ]),
      createdAt: '2026-11-15T02:20:00.000Z', decidedAt: '2026-11-15T02:25:00.000Z', answeredAt: '2026-11-15T02:25:00.000Z',
    },
    {
      id: 'b11-1', chapter: 11, title: '入月轩的门路', kind: '分叉', change: '门路',
      status: 'proposed', legacy: false, legacyReceipt: false, segmentId: null, requestId: null,
      options, chosen: null, createdAt: '2026-11-15T03:00:00.000Z',
    },
  ]
  const segments = [
    { id: 's-0001', chapter: 10, decisionIds: ['b10-1'], file: FILE, offsetStart: 14, offsetEnd: 830, chars: 816, hash: sha256(body.slice(14, 830)), status: 'committed', revisionId: 'r-0001' },
    { id: 's-0002', chapter: 10, decisionIds: ['b10-2'], file: FILE, offsetStart: 833, offsetEnd: 1428, chars: 595, hash: sha256(body.slice(833, 1428)), status: 'committed', revisionId: 'r-0002' },
    { id: 's-0003', chapter: 10, decisionIds: ['b10-3'], file: FILE, offsetStart: 1430, offsetEnd: 2055, chars: 625, hash: sha256(body.slice(1430, 2055)), status: 'committed', revisionId: 'r-0003' },
  ]
  const canon = [
    { entity: '雪清河', key: '对陈凡的目的', value: '收入东宫', chapter: 10, decisionId: 'b10-1', updatedAt: '2026-11-15T02:01:00.000Z' },
    { entity: '陈凡', key: '在东宫的位置', value: '被拉拢的客卿', chapter: 10, decisionId: 'b10-1', updatedAt: '2026-11-15T02:01:00.000Z' },
    { entity: '陈凡', key: '对东宫的态度', value: '装傻，只给太子想看的', chapter: 10, decisionId: 'b10-2', updatedAt: '2026-11-15T02:06:00.000Z' },
    { entity: '陈凡', key: '东宫应对', value: '藏拙', chapter: 10, decisionId: 'b10-2', updatedAt: '2026-11-15T02:06:00.000Z' },
    { entity: '雪清河', key: '真实身份', value: '露出天使气息', chapter: 10, decisionId: 'b10-3', updatedAt: '2026-11-15T02:25:00.000Z' },
    { entity: '陈凡', key: '对太子的最终判断', value: '确认太子不是普通人', chapter: 10, decisionId: 'b10-3', updatedAt: '2026-11-15T02:25:00.000Z' },
  ]
  const requests = [
    { id: 'q1', decisionId: 'b10-1', chapter: 10, askedAt: '2026-11-15T02:00:30.000Z', answeredAt: '2026-11-15T02:01:00.000Z', origin: 'author', options: [], answer: { selected: ['太子要收他进东宫'], custom: null } },
    { id: 'q2', decisionId: 'b10-2', chapter: 10, askedAt: '2026-11-15T02:05:30.000Z', answeredAt: '2026-11-15T02:06:00.000Z', origin: 'author', options: [], answer: { selected: ['装傻，只给太子想看的'], custom: null } },
    { id: 'q3', decisionId: 'b10-3', chapter: 10, askedAt: '2026-11-15T02:24:30.000Z', answeredAt: '2026-11-15T02:25:00.000Z', origin: 'author', options: [], answer: { selected: ['太子露出不属于人类的气息'], custom: null } },
  ]
  return {
    schemaVersion: 2,
    book: BOOK,
    meta: { title: BOOK, genre: '', logline: '' },
    createdAt: '2026-11-15T01:00:00.000Z',
    updatedAt: '2026-11-15T05:44:13.168Z',
    chapters: {
      10: { status: 'decided', decisionIds: ['b10-1', 'b10-2', 'b10-3'], verifiedAt: null },
      11: { status: 'pending', decisionIds: ['b11-1'], verifiedAt: null },
    },
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

function bodyText() {
  return '甲'.repeat(2055)
}

async function fixtureDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-rewind-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const body = bodyText()
  const bookDir = join(dir, '.dsh-novel-beat', BOOK)
  await mkdir(join(dir, '正文'), { recursive: true })
  await mkdir(bookDir, { recursive: true })
  await writeFile(join(dir, FILE), body, 'utf8')
  await writeFile(join(bookDir, 'book.json'), `${JSON.stringify(fixtureData(body), null, 2)}\n`, 'utf8')
  return { dir, body }
}

test('planRewind keep：目标重落账、后续重开、canon/删除字数与 gate 正确', () => {
  const body = bodyText()
  const plan = planRewind({ data: fixtureData(body), decisionId: 'b10-2', choice: 'keep', bodyText: body, fileLength: body.length })
  assert.equal(plan.ok, true)
  assert.equal(plan.choice, 'keep')
  assert.equal(plan.cutAt, 833)
  assert.equal(plan.beforeChars, 2055)
  assert.equal(plan.removedChars, 1222)
  assert.equal(plan.hashOk, true)
  assert.deepEqual(plan.segments.map((segment) => segment.id), ['s-0002', 's-0003'])
  assert.deepEqual(plan.decisions.map((entry) => [entry.id, entry.role]), [['b10-2', 'target'], ['b10-3', 'reopen']])
  assert.deepEqual(plan.reopened.map((entry) => entry.id), ['b10-3'])
  assert.deepEqual(plan.laterChapters, [11])
  assert.equal(plan.canon.length, 4)
  assert.equal(plan.gate.offset, 830)
  assert.equal(plan.newChoice.label, '装傻，只给太子想看的')
  assert.equal(plan.warnings.length, 1)
})

test('planRewind 改选：newChoice 带 obligations/forbidden，canon 预览用新值', () => {
  const body = bodyText()
  const plan = planRewind({ data: fixtureData(body), decisionId: 'b10-2', choice: '半真半假，借东宫的势', bodyText: body, fileLength: body.length })
  assert.equal(plan.ok, true)
  assert.equal(plan.newChoice.label, '半真半假，借东宫的势')
  assert.deepEqual(plan.newChoice.obligations, [])
  assert.deepEqual(plan.newChoice.forbidden, [])
  const attitude = plan.canon.find((entry) => entry.entity === '陈凡' && entry.key === '对东宫的态度')
  assert.equal(attitude.after, '半真半假，借势')
})

test('planRewind 拒绝：hash 不一致、无锚点、未拍板', () => {
  const body = bodyText()
  const changed = `${body.slice(0, 900)}乙${body.slice(901)}`
  const hash = planRewind({ data: fixtureData(body), decisionId: 'b10-2', choice: 'keep', bodyText: changed, fileLength: changed.length })
  assert.equal(hash.ok, false)
  assert.equal(hash.blockedReason, 'cannot-locate')
  assert.equal(hash.hashOk, false)

  const data = fixtureData(body)
  data.decisions.push({
    id: 'b12-1', chapter: 12, title: '无锚点', kind: '分叉', change: '无锚点',
    status: 'committed', legacy: false, legacyReceipt: false, segmentId: null, requestId: 'q12',
    options: [], chosen: option('旧选择', '', []), createdAt: '2026-11-15T04:00:00.000Z',
  })
  data.requests.push({ id: 'q12', decisionId: 'b12-1', chapter: 12, askedAt: null, answeredAt: '2026-11-15T04:01:00.000Z', origin: 'author', options: [], answer: { selected: ['旧选择'], custom: null } })
  assert.equal(planRewind({ data, decisionId: 'b12-1', choice: 'keep', bodyText: body }).blockedReason, 'no-segment')
  assert.equal(planRewind({ data, decisionId: 'b11-1', choice: 'keep', bodyText: body }).blockedReason, 'not-committed')
})

test('executeRewind keep：正文截断、段落作废、canon 回退、目标重落账、b10-3 重开、revision/audit/快照落盘', async (t) => {
  const { dir, body } = await fixtureDir(t)
  const result = await executeRewind({ dir, book: BOOK, decisionId: 'b10-2', choice: 'keep', confirm: true, agentId: 'test-agent' })
  assert.equal(result.ok, true)
  assert.equal(result.reverted.chars, 1222)
  assert.equal(result.reverted.segments.length, 2)
  assert.equal(result.recommitted[0].id, 'b10-2')
  assert.equal(result.reopened[0].id, 'b10-3')
  assert.equal(result.snapshot.text.startsWith('rewinds/'), true)

  const truncated = await readFile(join(dir, FILE), 'utf8')
  assert.equal(truncated.length, 833)
  assert.equal(truncated, body.slice(0, 833))
  await access(join(dir, '.dsh-novel-beat', BOOK, result.snapshot.text))
  await access(join(dir, '.dsh-novel-beat', BOOK, result.snapshot.ledger))

  const { data } = await readBookData(dir, BOOK)
  assert.equal(data.segments.find((segment) => segment.id === 's-0001').status, 'committed')
  assert.equal(data.segments.find((segment) => segment.id === 's-0002').status, 'reverted')
  assert.equal(data.segments.find((segment) => segment.id === 's-0003').status, 'reverted')
  const b102 = data.decisions.find((decision) => decision.id === 'b10-2')
  const b103 = data.decisions.find((decision) => decision.id === 'b10-3')
  assert.equal(b102.status, 'committed')
  assert.equal(b102.chosen.label, '装傻，只给太子想看的')
  assert.notEqual(b102.requestId, 'q2')
  assert.equal(b102.reopenCount, 1)
  assert.equal(b103.status, 'proposed')
  assert.equal(b103.chosen, null)
  assert.equal(b103.previousChoice.label, '太子露出不属于人类的气息')
  assert.equal(data.canon.filter((entry) => entry.decisionId === 'b10-2').length, 2)
  assert.equal(data.canon.filter((entry) => entry.decisionId === 'b10-3').length, 0)
  assert.equal(data.canon.length, 4)
  assert.equal(data.chapters['10'].gate.offset, 830)
  assert.equal(data.chapters['10'].gate.consumed, false)
  assert.equal(data.chapters['10'].gate.decisionIds.includes('b10-2'), true)
  const revision = data.revisions.at(-1)
  assert.equal(revision.kind, 'revert')
  assert.equal(revision.reopen, true)
  assert.deepEqual(revision.revertedSegments, ['s-0002', 's-0003'])
  assert.deepEqual(revision.reopenedDecisions, ['b10-3'])
  assert.equal(revision.snapshot, result.snapshot.text)
  assert.equal(data.audit.at(-1).action, 'rewind')
  assert.equal(data.requests.filter((request) => request.decisionId === 'b10-2').length, 2)
})

test('executeRewind 改选：新选择落账、旧凭据保留、正文仍可写回', async (t) => {
  const { dir } = await fixtureDir(t)
  const result = await executeRewind({ dir, book: BOOK, decisionId: 'b10-2', choice: '半真半假，借东宫的势', confirm: true, agentId: 'test-agent' })
  assert.equal(result.ok, true)
  const { data } = await readBookData(dir, BOOK)
  const b102 = data.decisions.find((decision) => decision.id === 'b10-2')
  assert.equal(b102.status, 'committed')
  assert.equal(b102.chosen.label, '半真半假，借东宫的势')
  assert.equal(data.canon.find((entry) => entry.entity === '陈凡' && entry.key === '对东宫的态度').value, '半真半假，借势')
  assert.equal(data.requests.filter((request) => request.decisionId === 'b10-2').length, 2)
  assert.equal(data.decisions.find((decision) => decision.id === 'b10-3').status, 'proposed')
})

test('executeRewind 后能写回、beat_segment 登记、beat_next 继续问 b10-3', async (t) => {
  const { dir } = await fixtureDir(t)
  await executeRewind({ dir, book: BOOK, decisionId: 'b10-2', choice: 'keep', confirm: true, agentId: 'test-agent' })
  const file = join(dir, FILE)
  const truncated = await readFile(file, 'utf8')
  await writeFile(file, `${truncated}${'乙'.repeat(300)}`, 'utf8')

  const segment = await executeSegment({
    dir, book: BOOK, chapter: 10, file: FILE, decisionIds: ['b10-2'],
  })
  assert.equal(segment.ok, true)
  assert.equal(segment.segment.offsetStart, 830)
  assert.equal(segment.segment.chars, 303)
  assert.equal(segment.segment.decisionIds[0], 'b10-2')

  const asked = []
  const next = await executeNext(
    { dir, book: BOOK, chapter: 10 },
    { agent: { id: 'test-agent' } },
    {
      ask: async ({ questions }) => {
        asked.push(...questions.map((question) => question.id))
        return { answers: questions.map((question) => ({ id: question.id, selected: ['太子露出不属于人类的气息'] })) }
      },
    },
  )
  assert.equal(next.ok, true)
  assert.deepEqual(asked, ['b10-3'])
  assert.equal(next.committed[0].id, 'b10-3')

  const { data } = await readBookData(dir, BOOK)
  assert.equal(data.decisions.find((decision) => decision.id === 'b10-3').status, 'committed')
  assert.equal(data.decisions.find((decision) => decision.id === 'b10-3').chosen.label, '太子露出不属于人类的气息')
  assert.equal(data.segments.length, 4)
  assert.equal(data.canon.length, 6)
})

test('executeRewind stale expectedBookUpdatedAt：拒绝且正文不动', async (t) => {
  const { dir } = await fixtureDir(t)
  const file = join(dir, FILE)
  const before = await readFile(file, 'utf8')
  await assert.rejects(
    () => executeRewind({
      dir,
      book: BOOK,
      decisionId: 'b10-2',
      choice: 'keep',
      confirm: true,
      expectedBookUpdatedAt: '2026-11-15T00:00:00.000Z',
    }),
    (error) => error.code === 'stale',
  )
  assert.equal(await readFile(file, 'utf8'), before)
  const { data } = await readBookData(dir, BOOK)
  assert.equal(data.segments.find((segment) => segment.id === 's-0002').status, 'committed')
})

test('executeRewind 无锚点：拒绝且正文不动', async (t) => {
  const { dir } = await fixtureDir(t)
  const bookFile = join(dir, '.dsh-novel-beat', BOOK, 'book.json')
  const data = JSON.parse(await readFile(bookFile, 'utf8'))
  data.decisions.push({
    id: 'b12-1', chapter: 12, title: '无锚点决策', kind: '分叉', change: '无锚点',
    status: 'committed', legacy: false, legacyReceipt: false, segmentId: null, requestId: 'q12',
    options: [], chosen: option('旧选择', '', []), createdAt: '2026-11-15T04:00:00.000Z',
  })
  data.requests.push({
    id: 'q12', decisionId: 'b12-1', chapter: 12, askedAt: null, answeredAt: '2026-11-15T04:01:00.000Z',
    origin: 'author', options: [], answer: { selected: ['旧选择'], custom: null },
  })
  await writeFile(bookFile, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  const file = join(dir, FILE)
  const before = await readFile(file, 'utf8')
  await assert.rejects(
    () => executeRewind({ dir, book: BOOK, decisionId: 'b12-1', choice: 'keep', confirm: true }),
    (error) => error.code === 'no-segment',
  )
  assert.equal(await readFile(file, 'utf8'), before)
})

test('executeRewind markLaterStale：后续章节只加待复核标记，不动正文', async (t) => {
  const { dir } = await fixtureDir(t)
  const result = await executeRewind({
    dir, book: BOOK, decisionId: 'b10-2', choice: 'keep', confirm: true, markLaterStale: true,
  })
  assert.equal(result.ok, true)
  const { data } = await readBookData(dir, BOOK)
  assert.equal(data.chapters['11'].stale.sourceDecisionId, 'b10-2')
  assert.match(data.chapters['11'].stale.reason, /第 10 章回退了/)
  assert.equal(data.decisions.find((decision) => decision.id === 'b11-1').status, 'proposed')
  assert.equal((await readFile(join(dir, FILE), 'utf8')).length, 833)
})

test('executeRewind 正文已截断但后续失败：正文恢复原样', async (t) => {
  const { dir } = await fixtureDir(t)
  const file = join(dir, FILE)
  const before = await readFile(file, 'utf8')
  await assert.rejects(
    () => executeRewind({
      dir,
      book: BOOK,
      decisionId: 'b10-2',
      choice: 'keep',
      confirm: true,
      onAfterText: async () => { throw new Error('injected book write failure') },
    }),
    /injected book write failure/,
  )
  assert.equal(await readFile(file, 'utf8'), before)
  const { data } = await readBookData(dir, BOOK)
  assert.equal(data.segments.find((segment) => segment.id === 's-0002').status, 'committed')
  assert.equal(data.decisions.find((decision) => decision.id === 'b10-2').status, 'committed')
})

test('executeRewind hash 不一致：拒绝且正文/账本一个字不动', async (t) => {
  const { dir } = await fixtureDir(t)
  const file = join(dir, FILE)
  const original = await readFile(file, 'utf8')
  const changed = `${original.slice(0, 900)}乙${original.slice(901)}`
  await writeFile(file, changed, 'utf8')
  await assert.rejects(
    () => executeRewind({ dir, book: BOOK, decisionId: 'b10-2', choice: 'keep', confirm: true }),
    (error) => error.code === 'cannot-locate',
  )
  assert.equal(await readFile(file, 'utf8'), changed)
  const { data } = await readBookData(dir, BOOK)
  assert.equal(data.segments.find((segment) => segment.id === 's-0002').status, 'committed')
  assert.equal(data.decisions.find((decision) => decision.id === 'b10-2').status, 'committed')
})

