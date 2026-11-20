// M2：通过真实磁盘账本验证只读服务契约，包含旧账本读取不得触发落盘迁移。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { apply, gateFromBook } from '../index.js';
import { emptyBook, validateBook } from '../lib/schema.js';
import { computeRevision } from '../lib/store.js';
import { evaluateWrite } from '../lib/enforce.js';

const BOOK = '服务契约书';
const AT = '2026-11-19T08:00:00.000Z';

async function serviceFor(dir) {
  let service;
  await apply({
    effect: (fn) => fn(),
    on: () => () => {},
    get(name) {
      if (name === 'commands') return { register: () => () => {} };
      if (name === 'workingDirectory') return { ensure: async () => dir, get: () => dir };
      if (name === 'agents') return { list: () => [] };
      return null;
    },
    tools: { register: () => () => {}, guard: () => () => {} },
    provide(name, value) {
      if (name === 'novelBeat') service = value;
      return () => {};
    },
  });
  assert.ok(service);
  return service;
}

async function fixture(t, configure = () => {}) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-service-v09-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const directory = join(dir, '.dsh-novel-beat', BOOK);
  const file = join(directory, 'book.json');
  const data = emptyBook({ book: BOOK, now: AT });
  data.revision = 17;
  configure(data);
  validateBook(data);
  await mkdir(directory, { recursive: true });
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return { dir, directory, file, data, service: await serviceFor(dir) };
}

function decision(data, fields = {}) {
  const item = {
    id: `b-${data.decisions.length + 1}`, chapter: 1, title: '是否救人',
    status: 'proposed', chosen: null, segmentId: null, createdAt: AT,
    ...fields,
  };
  if (['asked', 'answered', 'committed'].includes(item.status)) {
    item.requestId = `q-${item.id}`;
    item.askedAt = AT;
    item.answeredAt = item.status === 'asked' ? null : AT;
    data.requests.push({
      id: item.requestId, decisionId: item.id, chapter: item.chapter,
      askedAt: AT, answeredAt: item.answeredAt, origin: 'author',
      options: [], answer: { selected: ['救人'], custom: null },
    });
  }
  data.decisions.push(item);
  const meta = data.chapters[String(item.chapter)] ??= { decisionIds: [] };
  meta.decisionIds.push(item.id);
  return item;
}

function segment(data, fields = {}) {
  const number = data.segments.length + 1;
  const item = {
    id: `s-${number}`, chapter: 1, status: 'committed', decisionIds: [],
    file: '正文/第1章.md', offsetStart: (number - 1) * 20, offsetEnd: number * 20,
    chars: 20, hash: createHash('sha256').update(`段落 ${number}`).digest('hex'),
    revisionId: `r-${number}`, createdAt: AT,
    ...fields,
  };
  data.segments.push(item);
  for (const id of item.decisionIds) data.decisions.find((entry) => entry.id === id).segmentId = item.id;
  data.revisions.push({
    id: item.revisionId, kind: 'segment', segmentId: item.id,
    chapter: item.chapter, hash: item.hash, createdAt: AT,
  });
  return item;
}

function artifactData(data) {
  const entry = decision(data, { status: 'committed', chosen: { label: '救人' } });
  segment(data, { decisionIds: [entry.id] });
}

async function treeSnapshot(directory) {
  const rows = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        rows.push({ path: relative(directory, path), directory: true });
        await walk(path);
      } else {
        rows.push({
          path: relative(directory, path),
          content: (await readFile(path)).toString('base64'),
          mtime: (await stat(path)).mtimeMs,
        });
      }
    }
  }
  await walk(directory);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

test('M2 identity：字段、固定 capabilities 顺序、版本与 package.json 一致', async (t) => {
  const { service } = await fixture(t);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(service.identity(), {
    plugin: 'dsh-novel-beat', version: pkg.version, service_version: 1,
    capabilities: ['beat.status', 'beat.revision', 'beat.canon', 'beat.artifact', 'beat.commit.events'],
    dir: '.dsh-novel-beat', readOnly: true,
  });
  assert.equal(service.version, pkg.version);
  for (const name of ['commit', 'decide', 'write', 'setMode', 'mutate', 'plan']) {
    assert.equal(service[name], undefined, `${name} 不得出现在服务面`);
  }
});

test('M2 无账本、指定书不存在：新方法返回 null / found:false，不创建文件', async (t) => {
  const { dir, service } = await fixture(t);
  const empty = await mkdtemp(join(tmpdir(), 'novel-beat-service-empty-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  for (const args of [{ cwd: empty }, { cwd: dir, book: '不存在的书' }]) {
    for (const name of ['getRevision', 'getStatus', 'getCanon']) assert.equal(await service[name](args), null);
    assert.deepEqual(await service.getArtifact({ ...args, artifactId: 'missing' }), { found: false, artifactId: 'missing' });
  }
  assert.deepEqual(await readdir(empty), []);
});

test('M2 cwd：新方法拒绝相对路径和缺省路径，不猜进程工作区', async (t) => {
  const { service } = await fixture(t);
  for (const cwd of ['.', '正文', '', undefined]) {
    for (const name of ['getRevision', 'getStatus', 'getCanon']) {
      assert.equal(await service[name]({ cwd, book: BOOK }), null);
    }
    assert.deepEqual(await service.getArtifact({ cwd, book: BOOK, artifactId: 'missing' }), { found: false, artifactId: 'missing' });
  }
});

test('M2 getRevision：整数账本版本与最后 revision id 分离，子目录锚定一致', async (t) => {
  const { dir, data, service } = await fixture(t, artifactData);
  const expected = { revision: 17, updatedAt: AT, latestRevisionId: 'r-1' };
  assert.deepEqual(await service.getRevision({ cwd: dir }), expected);
  assert.deepEqual(await service.getRevision({ cwd: join(dir, '正文', '不存在'), book: BOOK }), expected);
  assert.equal(computeRevision(data), 17);
});

test('M2 getRevision：旧 v2 没有 revision 时沿用 M1 的 audit + revisions 计算', async (t) => {
  const { dir, service } = await fixture(t, (data) => {
    artifactData(data);
    delete data.revision;
    delete data.updatedAt;
    data.audit.push({ at: AT, action: 'plan' }, { at: AT, action: 'commit' });
  });
  assert.deepEqual(await service.getRevision({ cwd: dir }), { revision: 3, updatedAt: null, latestRevisionId: 'r-1' });
});

for (const status of ['proposed', 'asked']) {
  test(`M2 getStatus：${status} 的 pending 与 open 来自 gateFromBook`, async (t) => {
    const { dir, data, service } = await fixture(t, (data) => {
      decision(data, { status });
      decision(data, { status: 'committed', id: 'committed' });
      decision(data, { chapter: 2, id: 'other-chapter' });
      data.chapters['1'].continuationCheckRequired = true;
      data.chapters['1'].verifiedAt = AT;
    });
    const result = await service.getStatus({ cwd: dir, chapter: 1 });
    assert.deepEqual(result.pending, [{ id: 'b-1', status, title: '是否救人' }]);
    assert.deepEqual(result.stateDetail, gateFromBook(data).chapters['1']);
    assert.equal(result.openDecisions, result.stateDetail.open);
    assert.equal(result.chapterState, 'open');
    assert.equal(result.revision, 17);
  });
}

test('M4a getStatus：answered + pendingChoice 与 gate 一致，映射为 pending_confirm 且不重复计数', async (t) => {
  const { dir, data, service } = await fixture(t, (data) => {
    decision(data, { status: 'answered', pendingChoice: { label: '救人' } });
  });
  const result = await service.getStatus({ cwd: dir, chapter: 1 });
  assert.equal(result.chapterState, 'pending_confirm');
  assert.equal(result.stateDetail.pendingConfirm, 1);
  assert.equal(result.stateDetail.open, 0);
  assert.equal(result.openDecisions, 0);
  assert.deepEqual(result.stateDetail, gateFromBook(data).chapters['1']);
  assert.deepEqual(result.pending, [{ id: 'b-1', status: 'answered', title: '是否救人' }]);
});

test('M4a gateFromBook：待确认与 proposed 分开计数，正文写入仍拦截', () => {
  for (const [status, pendingChoice, open, pendingConfirm] of [
    ['answered', { label: '救人' }, 0, 1],
    ['proposed', null, 1, 0],
    ['answered', null, 1, 0],
  ]) {
    const gate = gateFromBook({ decisions: [{ id: 'b-1', chapter: 1, status, pendingChoice }] });
    assert.equal(gate.open, open);
    assert.deepEqual(gate.chapters['1'], { total: 1, open, awaitingSegment: 0, pendingConfirm, needsCheck: false });
    const write = evaluateWrite({
      toolName: 'write', args: { file_path: '正文/第1章.md' }, cwd: process.cwd(),
      state: { on: true, ...gate },
    });
    assert.equal(write.blocked, true);
    assert.equal(write.detail.code, 'PENDING_DECISIONS');
    if (pendingConfirm) assert.equal(write.detail.pendingConfirm, 1);
  }
});

test('M2 getStatus：已拍板未登记段落优先于续写检查和 verified', async (t) => {
  const { dir, data, service } = await fixture(t, (data) => {
    decision(data, { status: 'committed' });
    data.chapters['1'] = { continuationCheckRequired: true, verifiedAt: AT };
  });
  const result = await service.getStatus({ cwd: dir, chapter: 1 });
  assert.deepEqual(result.stateDetail, gateFromBook(data).chapters['1']);
  assert.equal(result.chapterState, 'awaiting_segment');
  assert.equal(result.openDecisions, 0);
  assert.deepEqual(result.pending, []);
});

test('M2 getStatus：仅章节续写检查时补齐五个 stateDetail 字段', async (t) => {
  const { dir, service } = await fixture(t, (data) => {
    data.chapters['4'] = { continuationCheckRequired: true, verifiedAt: AT };
  });
  const result = await service.getStatus({ cwd: dir, chapter: 4 });
  assert.equal(result.chapterState, 'needs_check');
  assert.deepEqual(result.stateDetail, { total: 0, open: 0, awaitingSegment: 0, pendingConfirm: 0, needsCheck: true });
});

for (const [name, configure, expected] of [
  ['verified', (data) => { data.chapters['1'] = { verifiedAt: AT }; }, 'verified'],
  ['已有决策', (data) => { decision(data, { status: 'cancelled' }); }, 'writing'],
  ['仅有段落', (data) => { segment(data); }, 'writing'],
  ['仅有回退段落', (data) => { segment(data, { status: 'reverted' }); }, 'writing'],
  ['空章', () => {}, 'empty'],
]) {
  test(`M2 getStatus：${name} 映射为 ${expected}`, async (t) => {
    const { dir, service } = await fixture(t, configure);
    assert.equal((await service.getStatus({ cwd: dir, chapter: 1 })).chapterState, expected);
  });
}

test('M2 getStatus：chapterMeta 原样返回，lastSegment 只取本章最后未回退段', async (t) => {
  const { dir, data, service } = await fixture(t, (data) => {
    segment(data);
    segment(data);
    segment(data, { status: 'reverted' });
    segment(data, { chapter: 2 });
    data.chapters['1'] = { verifiedAt: AT, stale: true, extra: { reason: '原样保留' } };
  });
  const result = await service.getStatus({ cwd: dir, chapter: 1 });
  assert.deepEqual(result.chapterMeta, data.chapters['1']);
  assert.deepEqual(result.lastSegment, { id: 's-2', chapter: 1, offsetStart: 20, offsetEnd: 40, chars: 20, decisionIds: [] });
  assert.equal((await service.getStatus({ cwd: dir, chapter: 99 })).lastSegment, null);
});

test('M2 默认当前章：最近决策优先，不受旧 open/task 或更高章号影响', async (t) => {
  const { dir, service } = await fixture(t, (data) => {
    decision(data, { chapter: 8 });
    decision(data, { chapter: 2, status: 'cancelled' });
    segment(data, { chapter: 9 });
    data.tasks.push({ id: 't-old', chapter: 8, state: 'writing' });
  });
  assert.equal((await service.getStatus({ cwd: dir })).chapter, 2);
  assert.deepEqual((await service.getCanon({ cwd: dir })).decisions.map((entry) => entry.id), ['b-2']);
});

test('M2 默认当前章：无决策时回退到最近段落所属章，再回退到 null', async (t) => {
  const { dir, service } = await fixture(t, (data) => {
    segment(data, { chapter: 2 });
    segment(data, { chapter: 4 });
    segment(data, { chapter: 9, status: 'reverted' });
  });
  const current = await service.getStatus({ cwd: dir });
  assert.equal(current.chapter, 9);
  assert.equal(current.lastSegment, null);
  const empty = await fixture(t);
  const result = await empty.service.getStatus({ cwd: empty.dir });
  assert.equal(result.chapter, null);
  assert.equal(result.chapterMeta, null);
  assert.equal(result.chapterState, 'empty');
  assert.deepEqual((await empty.service.getCanon({ cwd: empty.dir })).decisions, []);
});

test('M2 getCanon：保留全书 canon、只列未回收义务，决策按章投影及 choice 回退', async (t) => {
  const { dir, service } = await fixture(t, (data) => {
    decision(data, { status: 'committed', chosen: { label: '救人' } });
    decision(data, { status: 'answered', answerText: '先观察' });
    decision(data);
    decision(data, { chapter: 2 });
    data.canon.push({ entity: '林昭', key: '所在地', value: '城外', chapter: 2, decisionId: 'b-4' });
    data.canon.push({ entity: '玉佩', key: '颜色', value: '青色' });
    for (const [index, status] of ['open', 'due', 'paid', 'waived'].entries()) {
      data.obligations.push({ id: `o-${index}`, text: `约定 ${index}`, status, dueChapter: 9, sourceDecision: 'b-1' });
    }
  });
  assert.deepEqual(await service.getCanon({ cwd: dir, chapter: 1 }), {
    schemaVersion: 2, revision: 17,
    canon: [
      { entity: '林昭', key: '所在地', value: '城外', chapter: 2 },
      { entity: '玉佩', key: '颜色', value: '青色', chapter: null },
    ],
    obligations: [
      { id: 'o-0', text: '约定 0', status: 'open', dueChapter: 9, sourceDecision: 'b-1' },
      { id: 'o-1', text: '约定 1', status: 'due', dueChapter: 9, sourceDecision: 'b-1' },
    ],
    decisions: [
      { id: 'b-1', chapter: 1, status: 'committed', title: '是否救人', choice: '救人', segmentId: null },
      { id: 'b-2', chapter: 1, status: 'answered', title: '是否救人', choice: '先观察', segmentId: null },
      { id: 'b-3', chapter: 1, status: 'proposed', title: '是否救人', choice: null, segmentId: null },
    ],
  });
});

for (const [kind, artifactId, field] of [['segment', 's-1', 'segment'], ['decision', 'b-1', 'decision'], ['revision', 'r-1', 'revisionRecord']]) {
  test(`M2 getArtifact：${kind} 返回 hash、revisionId、当前整数 revision 及原记录`, async (t) => {
    const { dir, data, service } = await fixture(t, artifactData);
    const result = await service.getArtifact({ cwd: dir, artifactId });
    assert.equal(result.found, true);
    assert.equal(result.kind, kind);
    assert.equal(result.artifactId, artifactId);
    assert.equal(result.revision, 17);
    assert.equal(result.revisionId, 'r-1');
    assert.equal(result.hash, data.segments[0].hash);
    assert.equal(result.at, AT);
    assert.deepEqual(result[field], data[kind === 'revision' ? 'revisions' : `${kind}s`][0]);
  });
}

test('M2 getArtifact：未绑定段落的 decision hash 为 null', async (t) => {
  const { dir, service } = await fixture(t, (data) => { decision(data); });
  const result = await service.getArtifact({ cwd: dir, artifactId: 'b-1' });
  assert.equal(result.found, true);
  assert.equal(result.kind, 'decision');
  assert.equal(result.hash, null);
  assert.equal(result.revisionId ?? null, null);
});

test('M2 getArtifact：rewind 读取真实账本快照格式，sha1 对原文件字节计算', async (t) => {
  const { dir, directory, data, service } = await fixture(t, artifactData);
  const bytes = `${JSON.stringify(data, null, 2)}\n`;
  await mkdir(join(directory, 'rewinds'));
  await writeFile(join(directory, 'rewinds', 'rw-example.json'), bytes, 'utf8');
  const result = await service.getArtifact({ cwd: dir, artifactId: 'rw-example' });
  assert.equal(result.found, true);
  assert.equal(result.kind, 'rewind');
  assert.equal(result.artifactId, 'rw-example');
  assert.equal(result.revision, 17);
  assert.equal(result.hash, createHash('sha1').update(bytes).digest('hex'));
  assert.ok(Number.isFinite(Date.parse(result.at)));
});

test('M2 getArtifact：同 id 按 segment → decision → revision → rewind 优先查找', async (t) => {
  const { dir, directory, file, data, service } = await fixture(t, (data) => {
    decision(data, { id: 'shared' });
    segment(data, { id: 'shared', revisionId: 'shared' });
  });
  await mkdir(join(directory, 'rewinds'));
  await writeFile(join(directory, 'rewinds', 'shared.json'), JSON.stringify(data), 'utf8');
  assert.equal((await service.getArtifact({ cwd: dir, artifactId: 'shared' })).kind, 'segment');
  data.segments = [];
  data.revisions[0].segmentId = null;
  await writeFile(file, JSON.stringify(validateBook(data)), 'utf8');
  assert.equal((await service.getArtifact({ cwd: dir, artifactId: 'shared' })).kind, 'decision');
  data.decisions = [];
  await writeFile(file, JSON.stringify(validateBook(data)), 'utf8');
  assert.equal((await service.getArtifact({ cwd: dir, artifactId: 'shared' })).kind, 'revision');
  data.revisions = [];
  await writeFile(file, JSON.stringify(validateBook(data)), 'utf8');
  assert.equal((await service.getArtifact({ cwd: dir, artifactId: 'shared' })).kind, 'rewind');
});

test('M2 getArtifact：不存在及跨目录 id 返回 found:false，不越过 rewinds 目录', async (t) => {
  const { dir, directory, service } = await fixture(t);
  await mkdir(join(directory, 'rewinds'));
  await writeFile(join(directory, 'outside.json'), '{"secret":"fixture"}', 'utf8');
  for (const artifactId of ['missing', '../outside', '..\\outside', '../book', join(directory, 'outside')]) {
    assert.deepEqual(await service.getArtifact({ cwd: dir, artifactId }), { found: false, artifactId });
  }
});

test('M2 query：仅新增 schemaVersion/revision，旧字段、筛选与记录形状不变', async (t) => {
  const { dir, data, service } = await fixture(t, (data) => {
    artifactData(data);
    decision(data, { chapter: 2 });
    data.obligations.push({ id: 'o-paid', text: '已完成', status: 'paid', dueChapter: 1 });
    data.obligations.push({ id: 'o-other', text: '别章', status: 'open', dueChapter: 2 });
  });
  const result = await service.query({ cwd: dir, chapter: 1 });
  assert.deepEqual(result, {
    book: BOOK, version: 2, schemaVersion: 2, revision: 17, chapter: 1,
    decisions: [{ id: 'b-1', chapter: 1, title: '是否救人', status: 'committed', choice: '救人', segmentId: 's-1' }],
    canon: [],
    obligations: [{ id: 'o-paid', text: '已完成', status: 'paid', dueChapter: 1, sourceDecision: null }],
    segments: [{ id: 's-1', chapter: 1, file: '正文/第1章.md', offsetStart: 0, offsetEnd: 20, chars: 20, decisionIds: ['b-1'] }],
    chapters: data.chapters,
  });
  assert.equal((await service.query({ cwd: dir })).decisions.length, 2);
  assert.deepEqual(await service.resolveBook(dir), { book: BOOK, dir });
});

test('M2 自动选书与显式指定：最近修改书为默认，显式书独立读取', async (t) => {
  const { dir, file, service } = await fixture(t);
  const other = emptyBook({ book: '另一本', now: AT });
  other.revision = 29;
  const otherDirectory = join(dir, '.dsh-novel-beat', other.book);
  await mkdir(otherDirectory);
  const otherFile = join(otherDirectory, 'book.json');
  await writeFile(otherFile, JSON.stringify(other), 'utf8');
  await utimes(file, new Date('2026-11-01'), new Date('2026-11-01'));
  await utimes(otherFile, new Date('2026-11-02'), new Date('2026-11-02'));
  assert.equal((await service.getRevision({ cwd: dir })).revision, 29);
  assert.equal((await service.getStatus({ cwd: dir })).book, '另一本');
  assert.equal((await service.getRevision({ cwd: dir, book: BOOK })).revision, 17);
});

test('M2 所有读取：现代账本、快照及正文的内容/mtime/文件集合完全不变', async (t) => {
  const { dir, directory, data, service } = await fixture(t, artifactData);
  await mkdir(join(directory, 'rewinds'));
  await writeFile(join(directory, 'rewinds', 'rw-readonly.json'), JSON.stringify(data), 'utf8');
  await mkdir(join(dir, '正文'));
  await writeFile(join(dir, '正文', '第1章.md'), '正文必须保持不变。', 'utf8');
  const before = await treeSnapshot(dir);
  const events = [];
  const off = service.onDidCommit((event) => events.push(event));
  service.identity();
  await service.resolveBook(dir);
  await service.query({ cwd: dir });
  await service.getRevision({ cwd: dir });
  await service.getStatus({ cwd: dir });
  await service.getCanon({ cwd: dir });
  for (const artifactId of ['s-1', 'b-1', 'r-1', 'rw-readonly', 'missing']) {
    await service.getArtifact({ cwd: dir, artifactId });
  }
  off();
  assert.deepEqual(events, []);
  assert.deepEqual(await treeSnapshot(dir), before);
});

test('M2 五件套只读旧 v1：内存迁移结果稳定，不生成 bak 或重写账本', async (t) => {
  const { dir, file, data, service } = await fixture(t);
  data.schemaVersion = 1;
  delete data.revision;
  delete data.segments;
  delete data.revisions;
  delete data.requests;
  delete data.tasks;
  data.decisions = [{ id: 'old-1', chapter: 1, title: '旧拍板', status: 'decided', chosen: { label: '救人' }, decidedAt: AT }];
  data.chapters = { 1: { decisionIds: ['old-1'], verifiedAt: AT } };
  await writeFile(file, JSON.stringify(data), 'utf8');
  const before = await treeSnapshot(dir);
  const first = await service.getRevision({ cwd: dir });
  assert.ok(Number.isInteger(first.revision));
  assert.deepEqual(await service.getRevision({ cwd: dir, book: BOOK }), first);
  assert.equal((await service.getStatus({ cwd: dir })).chapter, 1);
  assert.equal((await service.getCanon({ cwd: dir })).decisions[0].status, 'committed');
  assert.equal((await service.getArtifact({ cwd: dir, artifactId: 'old-1' })).found, true);
  assert.deepEqual(await treeSnapshot(dir), before);
});
