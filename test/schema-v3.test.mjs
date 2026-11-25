import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  computeLedgerHash, emptyBook, migrateBookV2ToV3, normalizeBeat, normalizeEvidenceRef, validateBook,
} from '../lib/schema.js';
import { bookFilePath, readBookData } from '../lib/store.js';

const AT = '2026-11-25T00:00:00.000Z';
const HASH = 'a'.repeat(64);
const FILE = '正文/第一章.md';

function evidence() {
  const quote = '林青不知道密令';
  return { kind: 'body', file: FILE, hash: HASH, offsetStart: 0, offsetEnd: quote.length, quote, sourceLength: 20 };
}

function structuredBook() {
  const data = emptyBook({ book: 'schema-fixture', now: AT });
  data.revision = 3;
  const ref = evidence();
  const delta = { entity: 'person:linqing', key: 'knowledge.awareness', from: 'unknown', to: 'aware', evidence: [ref] };
  const claim = { text: '林青可能参与行动', basis: 'inference', sourceRefs: [ref] };
  const option = {
    label: '告知', action: '向林青说明密令', costs: ['承担泄密风险'],
    outcomes: [claim], informationGain: [], risks: [claim], changes: [delta],
  };
  const beat = normalizeBeat({
    title: '林青是否知情', kind: '知情', change: '决定林青何时获知密令',
    gate: { ...delta, reason: '不能替作者决定人物是否知情', confidence: 0.9 },
    options: [option, { ...option, label: '稍后告知', action: '等会面时再说', changes: [{ ...delta, to: 'waiting' }] }],
  }, 1, 0);
  data.decisions.push({
    ...beat, id: 'd-fixture', chapter: 1, status: 'proposed', nodeKind: 'decision', legacyEvidence: false,
    sourceRefs: [ref], detectKey: 'detect-fixture', chosen: null,
    options: beat.options.map((value, index) => ({ ...value, id: `o-${index}` })),
  });
  return data;
}

function scanBook() {
  const data = emptyBook({ book: 'scan-fixture', now: AT });
  data.revision = 2;
  data.chapters['1'] = { decisionScan: {
    id: 'scan-fixture', status: 'no-candidate', reason: '正文只有环境描写，没有状态差分', scannedAt: AT,
    baseRevision: 1, resultRevision: 2, bodyHash: HASH, bodyFile: FILE, relevantInputHash: HASH,
    segmentIds: [], candidateCount: 0, sourceRefs: [evidence()],
  } };
  return data;
}

function seal(data) {
  data.integrity.ledgerHash = computeLedgerHash(data);
  return data;
}

function rejectsChanges(factory, cases) {
  for (const [description, mutate] of cases) {
    const data = factory();
    mutate(data);
    seal(data);
    assert.throws(() => validateBook(data), (error) => error.code === 'book-corrupt', description);
  }
}

test('v3 结构校验不改写已保存的可信证据，工具输入不能自带 sourceLength', () => {
  const data = seal(structuredBook());
  const before = JSON.stringify(data);
  assert.equal(validateBook(data), data);
  assert.equal(JSON.stringify(data), before);
  assert.equal(data.decisions[0].sourceRefs[0].sourceLength, 20);
  assert.equal(Object.hasOwn(normalizeEvidenceRef(evidence()), 'sourceLength'), false);
});

test('精确 EvidenceRef 保留引文两端空白、CRLF 与 UTF-16 范围', () => {
  const quote = '\r\n 🌙 林青 \t';
  const ref = { ...evidence(), quote, offsetStart: 5, offsetEnd: 5 + quote.length, sourceLength: 100 };
  const normalized = normalizeEvidenceRef(ref);
  assert.equal(normalized.quote, quote);
  assert.equal(normalized.offsetEnd - normalized.offsetStart, quote.length);
  const data = structuredBook();
  data.decisions[0].sourceRefs = [ref];
  validateBook(seal(data));
  assert.throws(() => normalizeEvidenceRef({ ...ref, quote: ' \t\r\n ' }), (error) => error.code === 'bad-evidence-ref');
  assert.throws(() => normalizeEvidenceRef({ ...ref, quote: ` ${'字'.repeat(500)}` }), (error) => error.code === 'bad-evidence-ref');
});

test('合法 ledgerHash 不能掩盖非法 revision 或缺失的新决策 revision', () => {
  rejectsChanges(structuredBook, [
    ['负数', (data) => { data.revision = -1; }],
    ['小数', (data) => { data.revision = 1.5; }],
    ['非安全整数', (data) => { data.revision = Number.MAX_SAFE_INTEGER + 1; }],
    ['缺失', (data) => { delete data.revision; }],
    ['字符串', (data) => { data.revision = '3'; }],
  ]);
});

test('新决策拒绝伪 legacy、残缺 gate、白名单外键与残缺六要素', () => {
  rejectsChanges(structuredBook, [
    ['伪 legacy', (data) => { data.decisions[0].legacyEvidence = true; }],
    ['残缺 gate', (data) => { data.decisions[0].gate = {}; }],
    ['错误 nodeKind', (data) => { data.decisions[0].nodeKind = 'description'; }],
    ['未知状态键', (data) => { data.decisions[0].gate.key = 'mood.nice'; }],
    ['错误状态 ID', (data) => { data.decisions[0].options[0].changes[0].to = '已知'; }],
    ['缺少来源', (data) => { data.decisions[0].sourceRefs = []; }],
    ['重复选项 ID', (data) => { data.decisions[0].options[1].id = 'o-0'; }],
    ['少一个选项', (data) => { data.decisions[0].options.pop(); }],
    ['缺六要素', (data) => { delete data.decisions[0].options[0].costs; }],
    ['错误 detectKey', (data) => { data.decisions[0].detectKey = 7; }],
  ]);
});

test('所有新证据位置拒绝 sourceLength 越界、错误范围与无来源已知事实', () => {
  rejectsChanges(structuredBook, [
    ['sourceLength 负数', (data) => { data.decisions[0].sourceRefs[0].sourceLength = -1; }],
    ['sourceLength 小数', (data) => { data.decisions[0].gate.evidence[0].sourceLength = 10.5; }],
    ['sourceLength 不覆盖 quote', (data) => { data.decisions[0].options[0].changes[0].evidence[0].sourceLength = 1; }],
    ['sourceLength 非安全整数', (data) => { data.decisions[0].options[0].risks[0].sourceRefs[0].sourceLength = Number.MAX_SAFE_INTEGER + 1; }],
    ['quote 长度不符', (data) => { data.decisions[0].sourceRefs[0].offsetEnd += 1; }],
    ['范围非安全整数', (data) => { data.decisions[0].sourceRefs[0].offsetEnd = Number.MAX_SAFE_INTEGER + 1; }],
    ['路径逃逸', (data) => { data.decisions[0].sourceRefs[0].file = '../正文.md'; }],
    ['canon 错带 sourceLength', (data) => { data.decisions[0].sourceRefs = [{ kind: 'canon', sourceId: 'd-old', quote: 'aware', sourceLength: 20 }]; }],
    ['已知事实缺来源', (data) => { data.decisions[0].options[0].outcomes[0] = { text: '已经知情', basis: 'known-fact', sourceRefs: [] }; }],
  ]);
});

test('chosen 六要素快照必须保留有效来源和编辑前后记录', () => {
  const factory = () => {
    const data = structuredBook();
    data.decisions[0].chosen = { ...structuredClone(data.decisions[0].options[0]), source: 'proposed', basedOnOptionId: 'o-0', editedFields: [] };
    return data;
  };
  validateBook(seal(factory()));
  rejectsChanges(factory, [
    ['错误选择来源', (data) => { data.decisions[0].chosen.source = 'model'; }],
    ['引用不存在的选项', (data) => { data.decisions[0].chosen.basedOnOptionId = 'o-missing'; }],
    ['缺编辑快照', (data) => { data.decisions[0].chosen.editedFields = [{ field: 'action', at: AT }]; }],
    ['伪自定义来源', (data) => { data.decisions[0].chosen.source = 'author-custom'; }],
    ['chosen 来源内部范围损坏', (data) => { data.decisions[0].chosen.changes[0].evidence[0].sourceLength = 0; }],
  ]);
});

test('no-candidate 收据拒绝残缺 hash、倒退 revision、错误数量与空理由', () => {
  validateBook(seal(scanBook()));
  rejectsChanges(scanBook, [
    ['空理由', (data) => { data.chapters['1'].decisionScan.reason = ''; }],
    ['负 revision', (data) => { data.chapters['1'].decisionScan.baseRevision = -1; }],
    ['跳号 revision', (data) => { data.chapters['1'].decisionScan.resultRevision = 1; }],
    ['超前 revision', (data) => { data.revision = 1; }],
    ['残缺 bodyHash', (data) => { data.chapters['1'].decisionScan.bodyHash = null; }],
    ['错误 relevantInputHash', (data) => { data.chapters['1'].decisionScan.relevantInputHash = 'fake'; }],
    ['伪零候选', (data) => { data.chapters['1'].decisionScan.candidateCount = 1; }],
    ['错误 segmentIds', (data) => { data.chapters['1'].decisionScan.segmentIds = 's-1'; }],
    ['错误来源', (data) => { data.chapters['1'].decisionScan.sourceRefs = 'fake'; }],
  ]);
});

test('candidates 收据保持一次一个候选，允许仅 canon 来源的空 bodyHash', () => {
  const factory = () => {
    const data = scanBook();
    Object.assign(data.chapters['1'].decisionScan, {
      status: 'candidates', reason: null, candidateCount: 1, bodyHash: null, bodyFile: null,
      sourceRefs: [{ kind: 'canon', sourceId: 'd-old', quote: 'unknown' }],
      detectKey: 'detect-fixture', proposalHash: HASH, decisionIds: ['d-fixture'],
    });
    return data;
  };
  validateBook(seal(factory()));
  rejectsChanges(factory, [
    ['两个候选', (data) => { data.chapters['1'].decisionScan.candidateCount = 2; }],
    ['两个决策 ID', (data) => { data.chapters['1'].decisionScan.decisionIds.push('d-other'); }],
    ['缺提案 hash', (data) => { delete data.chapters['1'].decisionScan.proposalHash; }],
  ]);
});

test('正文绑定拒绝损坏 hash、跨越 revision、重复文件与错误 UTF-16 范围', () => {
  const factory = () => {
    const data = structuredBook();
    data.integrity.bodyBindings.push({ file: FILE, bodyHash: HASH, chapter: 1, revision: 3, updatedAt: AT });
    data.decisions[0].bodyBinding = {
      file: FILE, bodyHash: HASH, segmentId: 's-1', offsetStart: 0, offsetEnd: 10,
      offsetEncoding: 'utf16-lf', segmentRevision: 3,
    };
    return data;
  };
  validateBook(seal(factory()));
  rejectsChanges(factory, [
    ['错误绑定 hash', (data) => { data.integrity.bodyBindings[0].bodyHash = 'fake'; }],
    ['超前绑定 revision', (data) => { data.integrity.bodyBindings[0].revision = 4; }],
    ['重复文件', (data) => { data.integrity.bodyBindings.push({ ...data.integrity.bodyBindings[0] }); }],
    ['空绑定范围', (data) => { data.decisions[0].bodyBinding.offsetEnd = 0; }],
    ['错误坐标编码', (data) => { data.decisions[0].bodyBinding.offsetEncoding = 'bytes'; }],
    ['超前段落 revision', (data) => { data.decisions[0].bodyBinding.segmentRevision = 4; }],
  ]);
});

test('重算合法 hash 的损坏 v3 文件在读盘时仍被拒绝，且不会改写原文件', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'beat-schema-v3-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const data = structuredBook();
  data.decisions[0].gate = {};
  seal(data);
  const path = bookFilePath(dir, data.book);
  await mkdir(join(dir, '.dsh-novel-beat', data.book), { recursive: true });
  const bytes = JSON.stringify(data);
  await writeFile(path, bytes);
  await assert.rejects(() => readBookData(dir, data.book), (error) => error.code === 'book-corrupt');
  assert.equal(await readFile(path, 'utf8'), bytes);
});

test('同原 v2 默认迁移确定且幂等，保留 legacy 与 0.11 实验字段', () => {
  const v2 = emptyBook({ book: 'legacy-fixture', now: AT });
  v2.schemaVersion = 2;
  delete v2.revision;
  delete v2.integrity;
  delete v2.transactions;
  v2.decisions.push({ id: 'b1-1', chapter: 1, status: 'proposed', options: [{ label: '旧选项', changes: [] }] });
  v2.chapters['1'] = { mode: 'segment-loop', segmentLoop: { checks: [{ legacy: true }], mergeReceipt: null } };
  const before = structuredClone(v2);
  const first = migrateBookV2ToV3(v2);
  const second = migrateBookV2ToV3(v2);
  assert.deepEqual(first, second);
  assert.deepEqual(v2, before);
  assert.deepEqual(first.chapters, before.chapters);
  assert.deepEqual(first.decisions[0].options, before.decisions[0].options);
  assert.equal(first.decisions[0].legacyEvidence, true);
  assert.equal(first.revision, before.revisions.length + before.audit.length, '迁移审计不增加语义 revision');
  assert.equal(first.audit.at(-1).at, AT);
  assert.deepEqual(migrateBookV2ToV3(first), first);
  validateBook(first);
  delete first.revision;
  validateBook(seal(first));
});
