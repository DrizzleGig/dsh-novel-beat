// 数据层测试：schemaVersion 3 结构、作答凭据闸、逐版迁移、工作区锚定。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  SCHEMA_VERSION,
  DECISION_STATUS,
  REQUEST_ORIGIN,
  SEGMENT_STATUS,
  TASK_STATE,
  emptyBook,
  validateBook,
  migrateBookV1ToV2,
  migrateBookV2ToV3,
  computeLedgerHash,
  openDecisions,
  committedDecisions,
  nextSegmentId,
  nextRevisionId,
  nextTaskId,
  nextRequestId,
} from '../lib/schema.js';
import {
  bookDir,
  bookFilePath,
  readBookData,
  mutateBookData,
  resolveWorkspaceRoot,
  findBookCopies,
} from '../lib/store.js';

async function makeTemp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'beat-v2-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function validBook(book = '书') {
  return emptyBook({ book, meta: { title: book } });
}

function withCommitted(data, { id = 'b1-1', requestId = 'q-aaaaaa', answered = true } = {}) {
  data.requests.push({
    id: requestId,
    decisionId: id,
    chapter: 1,
    askedAt: answered ? '2026-11-14T00:00:00.000Z' : null,
    answeredAt: answered ? '2026-11-14T00:00:01.000Z' : null,
    options: [{ label: 'A', description: '' }, { label: 'B', description: '' }],
    answer: { selected: ['B'], custom: null },
    agentId: 'session-1',
    origin: REQUEST_ORIGIN.AUTHOR,
  });
  data.decisions.push({
    id,
    chapter: 1,
    title: '要不要救',
    kind: '分叉',
    change: '救或不救',
    status: DECISION_STATUS.COMMITTED,
    options: [{ label: 'A', impact: '', changes: [], obligations: [], forbidden: [] }, { label: 'B', impact: '', changes: [], obligations: [], forbidden: [] }],
    chosen: { label: 'B', impact: '', changes: [], obligations: [], forbidden: [] },
    requestId,
    askedAt: '2026-11-14T00:00:00.000Z',
    answeredAt: '2026-11-14T00:00:01.000Z',
    committedAt: '2026-11-14T00:00:01.000Z',
    segmentId: null,
    legacy: false,
    legacyReceipt: false,
    supersededBy: null,
  });
  return data;
}

test('emptyBook 产出 schemaVersion 3 与新字段', () => {
  const data = validBook();
  assert.equal(data.schemaVersion, SCHEMA_VERSION);
  for (const field of ['segments', 'revisions', 'requests', 'tasks']) {
    assert.deepEqual(data[field], [], field);
  }
  assert.deepEqual(data.transactions, []);
  assert.equal(data.integrity.algorithm, 'sha256');
  validateBook(data);
});

test('committed 决策缺 requestId → 判损坏（防伪造第一道闸）', () => {
  const data = withCommitted(validBook());
  delete data.decisions[0].requestId;
  assert.throws(() => validateBook(data), (error) => error.code === 'book-corrupt');
});

test('committed 决策的凭据没有 answeredAt → 判损坏', () => {
  const data = withCommitted(validBook());
  data.requests[0].answeredAt = null;
  assert.throws(() => validateBook(data), (error) => error.code === 'book-corrupt');
});

test('完整凭据的 committed 决策 → 通过', () => {
  const data = withCommitted(validBook());
  validateBook(data);
});

test('段落引用不存在的决策 → 判损坏', () => {
  const data = withCommitted(validBook());
  data.segments.push({
    id: 's-0001',
    chapter: 1,
    taskId: null,
    decisionIds: ['b9-9'],
    file: '正文/第001章.md',
    status: SEGMENT_STATUS.COMMITTED,
  });
  assert.throws(() => validateBook(data), (error) => error.code === 'book-corrupt');
});

test('同一条决策被两个未回退段落引用 → 判损坏；回退后可再引用', () => {
  const data = withCommitted(validBook());
  const base = {
    chapter: 1,
    taskId: null,
    decisionIds: ['b1-1'],
    file: '正文/第001章.md',
  };
  data.segments.push({ ...base, id: 's-0001', status: SEGMENT_STATUS.COMMITTED });
  data.segments.push({ ...base, id: 's-0002', status: SEGMENT_STATUS.COMMITTED });
  assert.throws(() => validateBook(data), (error) => error.code === 'book-corrupt');

  data.segments[0].status = SEGMENT_STATUS.REVERTED;
  validateBook(data);
});

test('任务状态非法 → 判损坏', () => {
  const data = validBook();
  data.tasks.push({ id: 't-0001', chapter: 1, file: null, state: 'nope' });
  assert.throws(() => validateBook(data), (error) => error.code === 'book-corrupt');
});

test('v1→v2→v3 迁移保留旧选择并为证据标 legacy', () => {
  const v1 = {
    schemaVersion: 1,
    book: '书',
    meta: { title: '书', genre: '', logline: '' },
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    chapters: { 1: { status: 'pending', decisionIds: ['b1-1', 'b1-2'], verifiedAt: null } },
    decisions: [
      {
        id: 'b1-1',
        chapter: 1,
        title: '拍下玉佩',
        kind: '得失',
        change: '玉佩到手',
        status: 'decided',
        options: [{ label: '拍下', impact: '花钱' }, { label: '放弃', impact: '省钱' }],
        chosen: { label: '拍下', impact: '花钱', changes: [], obligations: [], forbidden: [] },
        createdAt: '2026-11-01T00:00:00.000Z',
        decidedAt: '2026-11-02T00:00:00.000Z',
        supersededBy: null,
        legacy: false,
      },
      {
        id: 'b1-2',
        chapter: 1,
        title: '要不要回头',
        kind: '分叉',
        change: '回头或离开',
        status: 'pending',
        options: [],
        chosen: null,
        createdAt: '2026-11-01T00:00:00.000Z',
        decidedAt: null,
        supersededBy: null,
        legacy: false,
      },
    ],
    canon: [],
    obligations: [],
    audit: [],
  };

  const v2 = migrateBookV1ToV2(v1, { now: '2026-11-14T00:00:00.000Z' });
  assert.equal(v2.schemaVersion, 2);
  assert.equal(v2.decisions[0].status, DECISION_STATUS.COMMITTED);
  assert.equal(v2.decisions[0].legacyReceipt, true);
  assert.equal(v2.decisions[0].requestId, v2.requests[0].id);
  assert.equal(v2.requests[0].origin, REQUEST_ORIGIN.LEGACY);
  assert.deepEqual(v2.requests[0].answer.selected, ['拍下']);
  assert.equal(v2.decisions[1].status, DECISION_STATUS.PROPOSED);
  assert.match(v2.audit.at(-1).action, /migrate-0\.7/);
  const v3 = migrateBookV2ToV3(v2, { now: '2026-11-15T00:00:00.000Z' });
  assert.equal(v3.schemaVersion, 3);
  assert.equal(v3.decisions[0].gate, null);
  assert.equal(v3.decisions[0].legacyEvidence, true);
  assert.deepEqual(v3.decisions[0].options, v2.decisions[0].options);
  validateBook(v3);
  // 原对象不被改动
  assert.equal(v1.schemaVersion, 1);
  assert.equal(v1.decisions[0].status, 'decided');
});

test('读盘时 0.6 账本自动升级并留 .bak', async (t) => {
  const dir = await makeTemp(t);
  const directory = bookDir(dir, '书');
  await mkdir(directory, { recursive: true });
  const v1 = {
    schemaVersion: 1,
    book: '书',
    meta: { title: '书', genre: '', logline: '' },
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    chapters: {},
    decisions: [
      {
        id: 'b1-1',
        chapter: 1,
        title: '已拍板',
        kind: '分叉',
        change: '选了A',
        status: 'decided',
        options: [{ label: 'A', impact: '' }],
        chosen: { label: 'A', impact: '', changes: [], obligations: [], forbidden: [] },
        decidedAt: '2026-11-02T00:00:00.000Z',
      },
      { id: 'b1-2', chapter: 1, title: '未拍板', kind: '分叉', change: '待定', status: 'pending', options: [] },
    ],
    canon: [],
    obligations: [],
    audit: [],
  };
  await writeFile(join(directory, 'book.json'), JSON.stringify(v1), 'utf8');

  const read = await readBookData(dir, '书');
  assert.equal(read.migrated, true);
  assert.match(read.warnings[0], /schemaVersion 1/);
  assert.equal(read.data.schemaVersion, 3);
  assert.equal(read.data.decisions[0].status, DECISION_STATUS.COMMITTED);
  assert.equal(read.data.decisions[1].status, DECISION_STATUS.PROPOSED);

  const onDisk = JSON.parse(await readFile(join(directory, 'book.json'), 'utf8'));
  assert.equal(onDisk.schemaVersion, 3);
  const backup = JSON.parse(await readFile(join(directory, 'book.json.bak'), 'utf8'));
  assert.equal(backup.schemaVersion, 1);

  // 第二次读不再迁移
  const again = await readBookData(dir, '书');
  assert.equal(again.migrated, false);
});

test('v2→v3 幂等留档：旧条目不改、.bak 等于原账本、正文 hash 不变', async (t) => {
  const dir = await makeTemp(t);
  const directory = bookDir(dir, '旧书');
  await mkdir(directory, { recursive: true });
  await mkdir(join(dir, '正文'), { recursive: true });
  const body = '旧正文，不迁移也不改写。\n';
  const bodyPath = join(dir, '正文', '第1章.md');
  await writeFile(bodyPath, body, 'utf8');
  const bodyHashBefore = createHash('sha256').update(await readFile(bodyPath)).digest('hex');
  const v2 = {
    schemaVersion: 2,
    revision: 7,
    book: '旧书',
    meta: { title: '旧书', genre: '', logline: '' },
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    chapters: { 1: { status: 'pending', decisionIds: ['b1-1'], verifiedAt: null } },
    decisions: [{
      id: 'b1-1', chapter: 1, title: '旧决策', kind: '分叉', change: '旧状态变化', status: 'proposed',
      options: [{ label: 'A', impact: '旧选项', changes: [{ entity: '人物', key: '位置', to: '城门', evidence: ['门开了'] }] }],
      chosen: null, requestId: null, askedAt: null, answeredAt: null, committedAt: null,
      segmentId: null, createdAt: '2026-11-02T00:00:00.000Z',
    }],
    canon: [], obligations: [], audit: [],
    segments: [{
      id: 's-0001', chapter: 1, decisionIds: [], file: '正文/第1章.md',
      offsetStart: 0, offsetEnd: 4, hash: 'legacy-hash', chars: 4, status: 'committed', revisionId: 'r-0001',
    }],
    revisions: [{ id: 'r-0001', kind: 'segment', chapter: 1, segmentId: 's-0001', snapshot: 'legacy', hash: 'legacy-hash' }],
    requests: [], tasks: [], forks: [],
  };
  const originalBytes = Buffer.from(`${JSON.stringify(v2)}\n`, 'utf8');
  const ledger = join(directory, 'book.json');
  await writeFile(ledger, originalBytes);

  const read = await readBookData(dir, '旧书');
  assert.equal(read.data.schemaVersion, 3);
  assert.equal(read.data.revision, 7, '语义迁移不提升 revision');
  assert.equal(read.data.decisions[0].gate, null);
  assert.equal(read.data.decisions[0].legacyEvidence, true);
  assert.deepEqual(read.data.decisions[0].options, v2.decisions[0].options);
  assert.deepEqual(read.data.segments, v2.segments);
  assert.deepEqual(read.data.revisions, v2.revisions);
  assert.equal(read.data.audit.filter((entry) => entry.action === 'migrate-0.10').length, 1);
  assert.equal(read.data.integrity.ledgerHash, computeLedgerHash(read.data));

  const backupBytes = await readFile(`${ledger}.bak`);
  assert.deepEqual(backupBytes, originalBytes);
  const bodyHashAfter = createHash('sha256').update(await readFile(bodyPath)).digest('hex');
  assert.equal(bodyHashAfter, bodyHashBefore);

  const migratedAgain = migrateBookV2ToV3(read.data, { now: '2026-11-25T12:00:00.000Z' });
  assert.deepEqual(migratedAgain, read.data, 'v3 重复迁移原样幂等');
  const secondRead = await readBookData(dir, '旧书');
  assert.equal(secondRead.migrated, false);
  assert.equal(secondRead.data.integrity.ledgerHash, read.data.integrity.ledgerHash);
});

test('bookDir 锚定工作区根：已有账本的树里，在 正文/ 子目录调用也只写一份账本', async (t) => {
  const root = await makeTemp(t);
  const sub = join(root, '正文');
  await mkdir(sub, { recursive: true });
  // 工作区根已有别的书的账本，锚点就确定了
  await mutateBookData(root, '另一本', () => 'ok', { create: true });

  const created = await mutateBookData(sub, '书', () => 'ok', { create: true });
  assert.equal(created.created, true);
  assert.equal(resolveWorkspaceRoot(sub), root);
  assert.equal(bookDir(sub, '书'), join(root, '.dsh-novel-beat', '书'));
  await access(join(root, '.dsh-novel-beat', '书', 'book.json'));

  const fromRoot = await readBookData(root, '书');
  assert.ok(fromRoot.data);
  assert.equal(fromRoot.data.book, '书');
});

test('findBookCopies 找得到深层副本，且不写盘', async (t) => {
  const root = await makeTemp(t);
  const deep = join(root, '正文', '第1部');
  await mkdir(join(deep, '.dsh-novel-beat', '书'), { recursive: true });
  await writeFile(
    join(deep, '.dsh-novel-beat', '书', 'book.json'),
    JSON.stringify(validBook()),
    'utf8',
  );
  const copies = await findBookCopies(root, '书');
  assert.equal(copies.length, 1);
  assert.match(copies[0], /第1部/);
});

test('openDecisions / committedDecisions 按章筛状态', () => {
  const data = withCommitted(validBook());
  data.decisions.push({ id: 'b1-2', chapter: 1, status: DECISION_STATUS.PROPOSED, title: 'x' });
  data.decisions.push({ id: 'b2-1', chapter: 2, status: DECISION_STATUS.PROPOSED, title: 'y' });
  assert.deepEqual(openDecisions(data.decisions, 1).map((d) => d.id), ['b1-2']);
  assert.deepEqual(committedDecisions(data.decisions, 1).map((d) => d.id), ['b1-1']);
});

test('ID 生成器：段落/修订/任务顺序递增，凭据随机且不重复', () => {
  assert.equal(nextSegmentId([]), 's-0001');
  assert.equal(nextSegmentId([{ id: 's-0009' }]), 's-0010');
  assert.equal(nextRevisionId([{ id: 'r-0002' }]), 'r-0003');
  assert.equal(nextTaskId([]), 't-0001');

  const first = nextRequestId([], () => 0.5);
  assert.match(first, /^q-[0-9a-f]{6}$/);
  assert.throws(
    () => nextRequestId([{ id: first }], () => 0.5),
    (error) => error.code === 'id-exhausted',
  );
  assert.notEqual(nextRequestId([{ id: first }], () => 0.25), first);
});
