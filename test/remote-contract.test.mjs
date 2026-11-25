import test from 'node:test'
import assert from 'node:assert/strict'
import { DESCRIPTORS, TYPERT_REMOTE } from '../lib/remote-contract.js'
import { registerHooks } from 'node:module'
import { access, mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { computeLedgerHash, emptyBook } from '../lib/schema.js'
import { executeNext, executePlan, executeSegment } from '../lib/tools.js'
import { hashText } from '../lib/decision-gate.js'
import { setSessionMode } from '../lib/store.js'

// 仅替换两个宿主依赖；运行真实 BeatRemote、选书逻辑及磁盘读取。
const hostModules = new Map([
  ['@deepseek-ai/dsh-typert-protocol', `
    export const decorated = []
    export function Remote(name) { return (_, context) => { decorated.push([name, context.name]) } }
    export class TypertRemoteService { constructor(ctx) { this.ctx = ctx } }
  `],
  ['@deepseek-ai/dsh-session', 'export const SessionId = (id) => id'],
])
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (hostModules.has(specifier)) {
      return { url: `data:text/javascript,${encodeURIComponent(hostModules.get(specifier))}`, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
let BeatRemote, decorated
try {
  ;({ default: BeatRemote } = await import('../lib/remote.js'))
  ;({ decorated } = await import('@deepseek-ai/dsh-typert-protocol'))
} finally {
  hooks.deregister()
}

async function searchRemote(t) {
  const dir = await mkdtemp(join(tmpdir(), 'beat-search-remote-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const agent = { id: 'session-search' }
  let registration
  const remote = new BeatRemote({
    agents: { get: (id) => id === agent.id ? agent : null },
    workingDirectory: { ensure: async (resolved) => { assert.equal(resolved, agent); return dir } },
    commands: { execute: () => assert.fail('search 不得执行命令') },
    typert: { register: (value) => { registration = value } },
  })
  async function putBook(book, title, mtime) {
    const data = emptyBook({ book, now: '2026-11-19T08:00:00.000Z' })
    data.revision = 31
    data.decisions.push({ id: 'b-1', chapter: 2, title, status: 'proposed', chosen: null })
    data.canon.push({ entity: '陈凡', key: '去向', value: '东宫', chapter: 2 })
    data.integrity.ledgerHash = computeLedgerHash(data)
    const directory = join(dir, '.dsh-novel-beat', book)
    await mkdir(directory, { recursive: true })
    const file = join(directory, 'book.json')
    await writeFile(file, JSON.stringify(data), 'utf8')
    await utimes(file, new Date(mtime), new Date(mtime))
    return file
  }
  return { dir, remote, registration, putBook, id: agent.id }
}

async function decisionRemote(t, voice = null) {
  const dir = await mkdtemp(join(tmpdir(), 'beat-decision-remote-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const agent = { id: 'session-decision' }
  const book = 'remote-decision'
  const file = '正文/第一章.md'
  const start = '深夜。\n林青还不知道密令。\n'
  const resultText = '林青获知密令，决定动身。\n'
  await mkdir(join(dir, '正文'))
  await writeFile(join(dir, file), start)
  const quote = '林青还不知道密令'
  const ref = {
    kind: 'body', file, hash: hashText(start), quote,
    offsetStart: start.indexOf(quote), offsetEnd: start.indexOf(quote) + quote.length,
  }
  const delta = { entity: 'person:linqing', key: 'knowledge.awareness', from: 'unknown', to: 'aware', evidence: [ref] }
  const claim = (text) => ({ text, basis: 'inference', sourceRefs: [ref] })
  const first = {
    label: '立即告知', action: '现在向林青传达密令', costs: ['承担泄密风险'],
    outcomes: [claim('林青能够参与行动')], informationGain: [claim('林青得到密令内容')],
    risks: [claim('行动可能暴露')], changes: [delta],
  }
  const second = {
    label: '暂缓说明', action: '先观察，只告诉一人', costs: ['独自承担压力'],
    outcomes: [claim('暂时保密')], informationGain: [claim('观察对方是否守约')],
    risks: [claim('疑心可能累积')], changes: [{ ...delta, to: 'waiting' }],
  }
  const beat = {
    title: '林青何时得到密令', kind: '知情', change: '由作者决定是否立即告诉林青',
    gate: { ...delta, reason: '不问就会替作者决定谁先知情', confidence: 0.9 },
    options: [first, second],
  }
  const planned = await executePlan({ dir, book, chapter: 1, beats: [beat] }, { requireGate: true })
  const remote = new BeatRemote({
    agents: { get: (id) => id === agent.id ? agent : null },
    workingDirectory: { ensure: async (resolved) => { assert.equal(resolved, agent); return dir } },
    commands: { execute: () => assert.fail('本测试不执行宿主命令') },
    typert: { register() {} },
    get(name) { return name === 'novelVoice' ? voice : null },
  })
  return { dir, book, file, start, resultText, quote, id: planned.ids[0], agent, remote }
}

test('remote contract 暴露 v0.8 的 overview / chapter，并保留 v0.7 方法', () => {
  const methods = DESCRIPTORS.map((descriptor) => descriptor.method)
  assert.deepEqual(methods.splice(10), ['timeline', 'health', 'search'])
  assert.deepEqual(methods, ['status', 'setMode', 'panel', 'revertLast', 'overview', 'chapter', 'impact', 'rewind', 'resume', 'oldLine'])
  assert.equal(TYPERT_REMOTE.package, 'dsh-novel-beat')
  for (const descriptor of DESCRIPTORS) {
    assert.equal(descriptor.namespace, 'beatMode')
    assert.equal(descriptor.service, 'beatMode')
    assert.equal(descriptor.invocation.kind, 'direct')
  }
})

test('overview / chapter 的参数与结果 codec 可校验', () => {
  const byMethod = new Map(DESCRIPTORS.map((descriptor) => [descriptor.method, descriptor]))
  const overview = byMethod.get('overview')
  assert.deepEqual(overview.parameters.map((parameter) => parameter.name), ['sessionId'])
  const objectSchema = overview.result.create()
  assert.deepEqual(objectSchema.parse({ ok: true, book: null }), { ok: true, book: null })
  assert.throws(() => objectSchema.parse(null))

  const chapter = byMethod.get('chapter')
  assert.deepEqual(chapter.parameters.map((parameter) => parameter.name), ['sessionId', 'chapter'])
  const chapterSchema = chapter.parameters[1].codec.create()
  assert.equal(chapterSchema.parse(10), 10)
  assert.throws(() => chapterSchema.parse(0))
  assert.throws(() => chapterSchema.parse('10'))
  assert.throws(() => chapterSchema.parse(1.5))

  const impact = byMethod.get('impact')
  assert.deepEqual(impact.parameters.map((parameter) => parameter.name), ['sessionId', 'decisionId', 'options'])
  const decisionIdSchema = impact.parameters[1].codec.create()
  assert.equal(decisionIdSchema.parse('b10-2'), 'b10-2')
  assert.throws(() => decisionIdSchema.parse(''))
  const optionsSchema = impact.parameters[2].codec.create()
  assert.deepEqual(optionsSchema.parse({ choice: 'keep' }), { choice: 'keep' })
  assert.throws(() => optionsSchema.parse(null))

  const rewind = byMethod.get('rewind')
  assert.deepEqual(rewind.parameters.map((parameter) => parameter.name), ['sessionId', 'decisionId', 'options'])

  const resume = byMethod.get('resume')
  assert.deepEqual(resume.parameters.map((parameter) => parameter.name), ['sessionId', 'text'])
  const resumeSchema = resume.parameters[1].codec.create()
  assert.equal(resumeSchema.parse('继续写'), '继续写')
  assert.throws(() => resumeSchema.parse(''))
  assert.throws(() => resumeSchema.parse('x'.repeat(501)))

  const oldLine = byMethod.get('oldLine')
  assert.deepEqual(oldLine.parameters.map((parameter) => parameter.name), ['sessionId', 'decisionId'])
})

test('search contract：sessionId + JSON options，返回 object，Host decorator 同步注册', async (t) => {
  const { registration } = await searchRemote(t)
  const search = DESCRIPTORS.find((entry) => entry.method === 'search')
  assert.deepEqual(search.parameters.map((entry) => entry.name), ['sessionId', 'options'])
  const options = { q: '陈凡', entity: '陈凡', status: 'proposed', chapter: 2, limit: 5 }
  assert.deepEqual(search.parameters[1].codec.create().parse(options), options)
  for (const invalid of [null, [], '陈凡', 1]) assert.throws(() => search.parameters[1].codec.create().parse(invalid))
  assert.deepEqual(search.result.create().parse({ ok: true, hits: [] }), { ok: true, hits: [] })
  for (const invalid of [null, [], '结果']) assert.throws(() => search.result.create().parse(invalid))
  assert.equal(registration.invocations, DESCRIPTORS)
  assert.ok(decorated.some(([name, method]) => name === 'search' && method === 'search'))
})

test('remote.chapter 只读接 voice 文风排序，接口缺少本会话开关时回到基线', async (t) => {
  const voice = {
    identity: () => ({ readOnly: true, capabilities: ['voice.brief', 'voice.status', 'voice.revision'] }),
    isEnabled: async () => true,
    getStatus: async () => ({ profiles: [{ id: 'confirmed', version: '2.4', status: 'confirmed' }] }),
    getBrief: async ({ profileId }) => ({
      ok: true,
      markdown: '【总则】表达克制，适当留白。\n【写法】不直说。',
      revision: 17,
      sources: { profileId, profileVersion: '2.4', status: 'confirmed' },
    }),
  }
  const connected = await decisionRemote(t, voice)
  const chapter = await connected.remote.chapter(connected.agent.id, 1)
  const decision = chapter.decisions[0]
  assert.equal(chapter.voiceFit.available, true)
  assert.equal(chapter.voiceFit.profileVersion, '2.4')
  assert.deepEqual(decision.options.map((option) => option.label), ['暂缓说明', '立即告知'])
  assert.ok(decision.options.every((option) => option.styleFit?.advisory === true))

  let briefCalls = 0
  const currentPublishedVoice = {
    ...voice,
    isEnabled: undefined,
    getBrief: async (...args) => { briefCalls += 1; return voice.getBrief(...args) },
  }
  const unavailable = await decisionRemote(t, currentPublishedVoice)
  const fallback = await unavailable.remote.chapter(unavailable.agent.id, 1)
  assert.equal(fallback.voiceFit.available, false)
  assert.equal(fallback.voiceFit.reason, 'enabled-state-unavailable')
  assert.match(fallback.voiceFit.message, /本会话开关状态/u)
  assert.deepEqual(fallback.decisions[0].options.map((option) => option.label), ['立即告知', '暂缓说明'])
  assert.equal(briefCalls, 0, '开关状态未知时不得读取文风简报')
  assert.deepEqual(decision.gate, fallback.decisions[0].gate)
  for (const option of decision.options) {
    const baseline = fallback.decisions[0].options.find((entry) => entry.label === option.label)
    assert.deepEqual(option.changes, baseline.changes)
    assert.deepEqual(option.risks, baseline.risks)
  }
})

test('remote.chapter 标失效证据；impact 与 rewind 拒绝提交，隔离态错误可读', async (t) => {
  const fixture = await decisionRemote(t)
  const { dir, book, file, start, resultText, quote, id, agent, remote } = fixture
  await executeNext({ dir, book, chapter: 1 }, { agent: { id: agent.id } }, {
    ask: async ({ questions }) => ({ answers: questions.map(({ id: questionId }) => ({ id: questionId, selected: ['立即告知'] })) }),
  })
  await writeFile(join(dir, file), start + resultText)
  await executeSegment({ dir, book, chapter: 1, file, decisionIds: [id], excerpt: resultText })
  await setSessionMode(dir, agent.id, 'on')

  const ledgerFile = join(dir, '.dsh-novel-beat', book, 'book.json')
  const ledgerBefore = await readFile(ledgerFile)
  const changedBody = (await readFile(join(dir, file), 'utf8')).replace(quote, '林青早已知道密令')
  await writeFile(join(dir, file), changedBody)

  const chapter = await remote.chapter(agent.id, 1)
  assert.equal(chapter.decisions[0].evidenceStatus.valid, false)
  assert.equal(chapter.decisions[0].canRevert, false)
  assert.equal(chapter.decisions[0].revertBlockedReason, 'stale-evidence')
  assert.equal((await remote.impact(agent.id, id, { choice: '暂缓说明' })).code, 'stale-evidence')
  await assert.rejects(remote.rewind(agent.id, id, { choice: '暂缓说明', confirm: true }), { code: 'stale-evidence' })
  assert.deepEqual(await readFile(ledgerFile), ledgerBefore)
  await assert.rejects(access(join(dir, '.dsh-novel-beat', book, 'transactions')), { code: 'ENOENT' })

  await writeFile(join(dir, '.dsh-novel-beat', book, 'quarantine.json'), JSON.stringify({ txId: 'tx-isolated', reason: '恢复校验失败' }))
  assert.equal((await remote.impact(agent.id, id, { choice: 'keep' })).code, 'book-quarantined')
  assert.equal((await remote.rewind(agent.id, id, { choice: 'keep', confirm: true })).code, 'book-quarantined')
})

test('search remote：拒绝错误 options 与字段类型，chapter 沿用远程接口约束', async (t) => {
  const { remote, id } = await searchRemote(t)
  for (const options of [null, [], '陈凡', 1, true, { q: 2 }, { q: null }, { entity: [] }, { status: false }, { limit: '5' }, { limit: NaN }, { limit: Infinity }]) {
    assert.equal((await remote.search(id, options)).code, 'bad-options')
  }
  for (const chapter of [0, -1, 1.5, 10000, true, {}, '一']) {
    assert.equal((await remote.search(id, { chapter })).code, 'bad-chapter')
  }
})

test('search remote：无书返回 no-book，默认参数不创建账本或会话文件', async (t) => {
  const { dir, remote, id } = await searchRemote(t)
  const result = await remote.search(id)
  assert.equal(result.ok, false)
  assert.equal(result.code, 'no-book')
  assert.deepEqual(await readdir(dir), [])
  await assert.rejects(remote.search('missing', { q: '陈凡' }), /会话尚未加载/)
})

test('search remote：选最近修改的书，传递筛选与 limit，读取保持内容及 mtime 不变', async (t) => {
  const { dir, remote, putBook, id } = await searchRemote(t)
  await putBook('旧书', '旧书陈凡', '2026-11-17T00:00:00Z')
  const file = await putBook('新书', '陈凡前往东宫', '2026-11-18T00:00:00Z')
  const before = { text: await readFile(file, 'utf8'), mtime: (await stat(file)).mtimeMs }
  const result = await remote.search(id, { q: '东宫', chapter: '2', status: 'proposed', limit: 1 })
  assert.equal(result.book, '新书')
  assert.equal(result.revision, 31)
  assert.equal(result.total, 2)
  assert.deepEqual(result.groups, { decision: 1, canon: 1, obligation: 0 })
  assert.deepEqual(result.hits.map((hit) => hit.id), ['b-1'])
  const filtered = await remote.search(id, { q: '东宫', entity: '陈凡', chapter: 2, status: 'committed' })
  assert.deepEqual(filtered.hits.map((hit) => hit.kind), ['canon'])
  assert.equal((await remote.search(id, { q: '东宫', chapter: 1 })).total, 0)
  assert.equal((await remote.search(id)).total, 0)
  assert.deepEqual({ text: await readFile(file, 'utf8'), mtime: (await stat(file)).mtimeMs }, before)
  assert.deepEqual((await readdir(join(dir, '.dsh-novel-beat', '新书'))).sort(), ['book.json'])
  assert.deepEqual((await readdir(join(dir, '.dsh-novel-beat'))).sort(), ['新书', '旧书'].sort())
})

test('search remote：v1 旧账只在内存兼容，重复搜索不迁移落盘或生成备份', async (t) => {
  const { dir, remote, putBook, id } = await searchRemote(t)
  const file = await putBook('旧账', '陈凡旧拍板', '2026-11-18T00:00:00Z')
  const data = JSON.parse(await readFile(file, 'utf8'))
  data.schemaVersion = 1
  delete data.revision
  delete data.segments
  delete data.revisions
  delete data.requests
  delete data.tasks
  delete data.transactions
  delete data.integrity
  data.decisions[0] = { id: 'old-1', chapter: 2, title: '陈凡旧拍板', status: 'decided', chosen: { label: '前往东宫' }, decidedAt: data.createdAt }
  await writeFile(file, JSON.stringify(data), 'utf8')
  const before = { text: await readFile(file, 'utf8'), mtime: (await stat(file)).mtimeMs }
  const first = await remote.search(id, { q: '东宫' })
  assert.equal(first.ok, true)
  assert.equal(first.hits[0].status, 'committed')
  assert.deepEqual(first, await remote.search(id, { q: '东宫' }))
  assert.deepEqual({ text: await readFile(file, 'utf8'), mtime: (await stat(file)).mtimeMs }, before)
  assert.deepEqual(await readdir(join(dir, '.dsh-novel-beat', '旧账')), ['book.json'])
})

test('search remote：v2 旧账内存升级后稳定可搜，不写盘或生成备份', async (t) => {
  const { dir, remote, putBook, id } = await searchRemote(t)
  const file = await putBook('旧二版账', '陈凡前往东宫', '2026-11-18T00:00:00Z')
  const data = JSON.parse(await readFile(file, 'utf8'))
  data.schemaVersion = 2
  delete data.transactions
  delete data.integrity
  await writeFile(file, JSON.stringify(data), 'utf8')
  const before = { text: await readFile(file, 'utf8'), mtime: (await stat(file)).mtimeMs }
  const first = await remote.search(id, { q: '东宫' })
  assert.equal(first.ok, true)
  assert.equal(first.revision, 31)
  assert.equal(first.total, 2)
  assert.deepEqual(first, await remote.search(id, { q: '东宫' }))
  assert.deepEqual({ text: await readFile(file, 'utf8'), mtime: (await stat(file)).mtimeMs }, before)
  assert.deepEqual(await readdir(join(dir, '.dsh-novel-beat', '旧二版账')), ['book.json'])
})

test('search remote：拒绝 v3 内容与账本 hash 不符，沿用 no-book 封装且不写盘', async (t) => {
  const { dir, remote, putBook, id } = await searchRemote(t)
  const file = await putBook('损坏账', '陈凡前往东宫', '2026-11-18T00:00:00Z')
  const data = JSON.parse(await readFile(file, 'utf8'))
  data.canon[0].value = '未经记账修改的西宫'
  await writeFile(file, JSON.stringify(data), 'utf8')
  const before = { text: await readFile(file, 'utf8'), mtime: (await stat(file)).mtimeMs }
  const result = await remote.search(id, { q: '西宫' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'no-book')
  assert.deepEqual({ text: await readFile(file, 'utf8'), mtime: (await stat(file)).mtimeMs }, before)
  assert.deepEqual(await readdir(join(dir, '.dsh-novel-beat', '损坏账')), ['book.json'])
})
