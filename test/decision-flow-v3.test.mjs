import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executePlan, executeNext, executeDecide, executeSegment, executeVerify,
  executeGate, executeList,
} from '../lib/tools.js';
import { bookDir, bookFilePath, computeRevision, readBookData, mutateBookData } from '../lib/store.js';
import { hashText, verifyEvidenceRef } from '../lib/decision-gate.js';
import { executeRewind, planRewind } from '../lib/rewind.js';
import { hashRawBytes, readTransactionStatus } from '../lib/transaction.js';

const BOOK = 'v3-flow';
const FILE = '正文/第一章.md';
const START = '🌙 深夜。\r\n林青还不知道密令。\r\n';
const RESULT = '林青获知密令，决定动身。\r\n';
const QUOTE = '林青还不知道密令';

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-v3-flow-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '正文'));
  await writeFile(join(dir, FILE), START);
  const ref = {
    kind: 'body', file: FILE, hash: hashText(START), quote: QUOTE,
    offsetStart: START.indexOf(QUOTE), offsetEnd: START.indexOf(QUOTE) + QUOTE.length,
  };
  const delta = { entity: 'person:linqing', key: 'knowledge.awareness', from: 'unknown', to: 'aware', toLabel: '获知密令', evidence: [ref] };
  const claim = (text) => ({ text, basis: 'inference', sourceRefs: [ref] });
  const first = {
    label: '告知', action: '现在向林青传达密令', costs: ['承担泄密风险'],
    outcomes: [claim('林青能够参与行动')], informationGain: [claim('林青得到密令内容')],
    risks: [claim('行动可能暴露')], changes: [delta],
  };
  const second = {
    ...first, label: '暂缓', action: '推迟到会面时再说',
    changes: [{ ...delta, to: 'waiting', toLabel: '等待会面' }],
  };
  const beat = {
    title: '林青何时得到密令', kind: '知情', change: '由作者决定是否立即告诉林青密令',
    gate: { ...delta, reason: '未经询问就会替作者决定谁先知情', confidence: 0.9 },
    options: [first, second],
  };
  const planned = await executePlan({ dir, book: BOOK, chapter: 1, beats: [beat] }, { requireGate: true });
  return { dir, beat, id: planned.ids[0] };
}

async function choose(dir) {
  return executeNext({ dir, book: BOOK, chapter: 1 }, { agent: { id: 'fixture-author' } }, {
    ask: async ({ questions }) => ({ answers: questions.map(({ id }) => ({ id, selected: ['告知'] })) }),
  });
}

async function output(dir, id, text = RESULT) {
  await writeFile(join(dir, FILE), START + text);
  return executeSegment({ dir, book: BOOK, chapter: 1, file: FILE, decisionIds: [id], excerpt: text });
}

test('v3 全流程：提案 → 作者拍板 → CRLF 正文追加 → 段落绑定 → 验章并回查六要素', async (t) => {
  const { dir, id } = await setup(t);
  const answer = await choose(dir);
  assert.equal(answer.committed[0].id, id);
  const registered = await output(dir, id);
  const verified = await executeVerify({ dir, book: BOOK, chapter: 1, path: FILE });
  assert.equal(verified.pass, true);
  assert.equal(verified.verified, true);
  const { data } = await readBookData(dir, BOOK);
  const decision = data.decisions[0];
  assert.equal(decision.chosen.source, 'proposed');
  assert.deepEqual(decision.chosen.costs, ['承担泄密风险']);
  assert.equal(decision.chosen.basedOnOptionId, decision.options[0].id);
  assert.equal(decision.chosen.changes[0].evidence[0].sourceLength, START.length);
  assert.equal(decision.bodyBinding.segmentId, registered.segment.id);
  assert.equal(decision.bodyBinding.offsetEncoding, 'utf16-lf');
  assert.equal(data.integrity.bodyBindings[0].bodyHash, hashText(START + RESULT));
  assert.equal(data.integrity.bodyBindings[0].file, FILE);
  const list = await executeList({ dir, book: BOOK, chapter: 1 });
  assert.deepEqual(list.decisions[0].chosen, decision.chosen);
  assert.deepEqual(list.decisions[0].options, decision.options);
  assert.deepEqual(list.decisions[0].sourceRefs, decision.sourceRefs);
  const repeated = await executeVerify({ dir, book: BOOK, chapter: 1, path: FILE });
  assert.equal(repeated.revision, verified.revision);
});

test('v3 回退改选：预览保持精简投影，执行从 options 取完整选项并通过严格 schema', async (t) => {
  const { dir, id } = await setup(t);
  await choose(dir);
  await output(dir, id);

  const { data: before } = await readBookData(dir, BOOK);
  const target = before.decisions.find((decision) => decision.id === id);
  const alternate = target.options[1];
  const preview = planRewind({ data: before, decisionId: id, choice: alternate.label });
  assert.equal(preview.ok, true);
  assert.equal(preview.newChoice.label, alternate.label);
  assert.equal(Object.hasOwn(preview.newChoice, 'id'), false);
  assert.equal(Object.hasOwn(preview.newChoice, 'action'), false);

  const result = await executeRewind({ dir, book: BOOK, decisionId: id, choice: alternate.label, confirm: true });
  assert.equal(result.ok, true);
  const { data: after } = await readBookData(dir, BOOK);
  const rewound = after.decisions.find((decision) => decision.id === id);
  assert.equal(rewound.status, 'committed');
  assert.equal(rewound.chosen.label, alternate.label);
  assert.equal(rewound.chosen.id, alternate.id);
  assert.equal(rewound.chosen.source, 'proposed');
  assert.equal(rewound.chosen.basedOnOptionId, alternate.id);
  assert.deepEqual(rewound.chosen.costs, alternate.costs);
  assert.deepEqual(rewound.chosen.outcomes, alternate.outcomes);
  assert.deepEqual(rewound.chosen.informationGain, alternate.informationGain);
  assert.deepEqual(rewound.chosen.risks, alternate.risks);
  assert.deepEqual(rewound.chosen.changes, alternate.changes);
  assert.equal(after.canon.find((entry) => entry.entity === 'person:linqing' && entry.key === 'knowledge.awareness')?.value, 'waiting');
});

test('v3 缺少输出结果时 strict:false 也不能用起点证据冒充完成', async (t) => {
  const { dir, id } = await setup(t);
  await choose(dir);
  await output(dir, id, '两人沉默了一会儿。\r\n');
  const result = await executeVerify({ dir, book: BOOK, chapter: 1, path: FILE, strict: false });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some(({ code }) => code === 'missing-change'));
});

test('v3 验章拒绝伪造 text，即使真实文件和已登记段都未改变', async (t) => {
  const { dir, id } = await setup(t);
  await choose(dir);
  await output(dir, id, '林青仍然不知内情，低头沉思。\r\n');
  const result = await executeVerify({ dir, book: BOOK, chapter: 1, text: START + RESULT });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some(({ code }) => code === 'stale-evidence'));
});

test('v3 拍板后可追加但不允许改写证据前缀，输出段篡改也拒绝', async (t) => {
  for (const mode of ['source', 'output']) {
    await t.test(mode, async (st) => {
      const { dir, id } = await setup(st);
      await choose(dir);
      await output(dir, id);
      await writeFile(join(dir, FILE), mode === 'source'
        ? START.replace('深夜', '凌晨') + RESULT
        : START + RESULT.replace('获知', '遗忘'));
      await assert.rejects(executeVerify({ dir, book: BOOK, chapter: 1, path: FILE }), { code: 'stale-evidence' });
      const gate = await executeGate({ dir, book: BOOK, chapter: 1 });
      assert.equal(gate.pass, false);
      assert.equal(gate.code, 'stale-evidence');
    });
  }
});

test('v3 作者自填选项仍过六要素闸门，保存快照而不改原选项', async (t) => {
  const { dir, beat, id } = await setup(t);
  const draft = {
    ...beat.options[0], label: '先验证再告知', action: '请信使先核验密令，再通知林青',
    changes: [{ ...beat.options[0].changes[0], to: 'verified-aware', toLabel: '核验后知情' }],
  };
  await assert.rejects(executeDecide({ dir, book: BOOK, chapter: 1, id, choice: draft.label }), { code: 'incomplete-option' });
  await assert.rejects(executeDecide({ dir, book: BOOK, chapter: 1, id, choice: draft.label, optionDraft: { ...draft, costs: ['无代价'] } }), { code: 'false-fork' });
  await executeDecide({ dir, book: BOOK, chapter: 1, id, choice: draft.label, optionDraft: draft });
  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.decisions[0].chosen.source, 'author-custom');
  assert.equal(data.decisions[0].chosen.action, draft.action);
  assert.equal(data.decisions[0].chosen.changes[0].to, 'verified-aware');
  assert.equal(data.decisions[0].options[0].changes[0].to, 'aware');
  assert.ok(data.decisions[0].chosen.editedFields.some(({ field }) => field === 'action'));
  const replay = await executeDecide({ dir, book: BOOK, chapter: 1, id, choice: draft.label, optionDraft: draft });
  assert.equal(replay.idempotent, true);
  await assert.rejects(executeDecide({ dir, book: BOOK, chapter: 1, id, choice: draft.label,
    optionDraft: { ...draft, costs: ['付出完全不同的代价'] } }), { code: 'already-decided' });
});

test('v3 重置未答候选不复用已记录在审计中的稳定决策 ID', async (t) => {
  const { dir, beat, id } = await setup(t);
  const reset = await executePlan({ dir, book: BOOK, chapter: 1, reset: true, beats: [beat] }, { requireGate: true });
  assert.notEqual(reset.ids[0], id);
  const again = await executePlan({ dir, book: BOOK, chapter: 1, reset: true, beats: [beat] }, { requireGate: true });
  assert.notEqual(again.ids[0], reset.ids[0]);
});

test('零章重扫新正文后验章更新正文绑定，重复验章才幂等', async (t) => {
  const { dir } = await setup(t);
  const chapter = 2;
  await executePlan({ dir, book: BOOK, chapter, beats: [], reason: '本章只有景色描写', path: FILE });
  const first = await executeVerify({ dir, book: BOOK, chapter, path: FILE });
  const nextText = START + '远处天色发白。\r\n';
  await writeFile(join(dir, FILE), nextText);
  await executePlan({ dir, book: BOOK, chapter, beats: [], reason: '本章只有景色描写', path: FILE });
  const next = await executeVerify({ dir, book: BOOK, chapter, path: FILE });
  assert.ok(next.revision > first.revision);
  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.integrity.bodyBindings.find((entry) => entry.file === FILE).bodyHash, hashText(nextText));
  const replay = await executeVerify({ dir, book: BOOK, chapter, path: FILE });
  assert.equal(replay.revision, next.revision);
});

test('开启实验工具后，普通零决策章的 gate 与 verify 仍使用同一扫描规则', async (t) => {
  const { dir } = await setup(t);
  await executePlan({ dir, book: BOOK, chapter: 2, beats: [], reason: '此章只有过渡描写', path: FILE });
  const gate = await executeGate({ dir, book: BOOK, chapter: 2 }, { segmentLoop: true });
  assert.equal(gate.pass, true);
  const verified = await executeVerify({ dir, book: BOOK, chapter: 2, path: FILE }, { segmentLoop: true });
  assert.equal(verified.pass, true);
  assert.equal(gate.noDecision.scanId, verified.noDecision.scanId);
});

test('已被后续 canon 覆盖的旧决策不能充当当前状态证据', async (t) => {
  const { dir, id } = await setup(t);
  await choose(dir);
  await mutateBookData(dir, BOOK, (data) => {
    data.canon[0].value = 'forgotten';
    data.canon[0].decisionId = 'later-decision';
    return {};
  });
  const { data } = await readBookData(dir, BOOK);
  await assert.rejects(verifyEvidenceRef(dir, data, { kind: 'canon', sourceId: id, quote: 'aware' }, 1), { code: 'stale-evidence' });
});

test('回退或改选在提交前重新验证 gate 证据，失效时正文/账本/事务目录均不变', async (t) => {
  const { dir, id } = await setup(t);
  await choose(dir);
  await output(dir, id);
  const bookDirectory = join(dir, '.dsh-novel-beat', BOOK);
  const ledgerFile = join(bookDirectory, 'book.json');
  const bodyFile = join(dir, FILE);
  const ledgerBefore = await readFile(ledgerFile);
  const changedBody = (await readFile(bodyFile, 'utf8')).replace(QUOTE, '林青早已知道密令');
  await writeFile(bodyFile, changedBody);
  const changedBodyBytes = await readFile(bodyFile);

  await assert.rejects(executeRewind({
    dir, book: BOOK, decisionId: id, choice: '暂缓', confirm: true,
  }), { code: 'stale-evidence' });

  assert.deepEqual(await readFile(ledgerFile), ledgerBefore);
  assert.deepEqual(await readFile(bodyFile), changedBodyBytes);
  await assert.rejects(access(join(bookDirectory, 'transactions')), { code: 'ENOENT' });
});

test('v3 回退改选提交完整选项并原子落账；同一预览重试冲突且不重复提交', async (t) => {
  const { dir, id } = await setup(t);
  await choose(dir);
  await output(dir, id);

  const laterFile = '正文/第二章.md';
  const laterText = '林青收到一封没有署名的信。\r\n';
  await writeFile(join(dir, laterFile), laterText);
  const quote = '林青收到一封没有署名的信';
  const laterRef = {
    kind: 'body', file: laterFile, hash: hashText(laterText), quote,
    offsetStart: 0, offsetEnd: quote.length,
  };
  const laterDelta = {
    entity: 'person:linqing', key: 'commitment.status', from: 'undecided', to: 'investigate',
    evidence: [laterRef],
  };
  const laterClaim = (text) => ({ text, basis: 'inference', sourceRefs: [laterRef] });
  await executePlan({
    dir, book: BOOK, chapter: 2, beats: [{
      title: '林青是否调查来信', kind: '承诺', change: '由作者决定是否调查来信',
      gate: { ...laterDelta, reason: '是否调查会决定林青接下来的行动', confidence: 0.9 },
      options: [
        { label: '调查', action: '立即调查来信来源', costs: ['花费时间核实来源'], outcomes: [laterClaim('林青会找到寄信线索')], informationGain: [laterClaim('林青能确认来信来源')], risks: [laterClaim('调查可能暴露行踪')], changes: [{ ...laterDelta, to: 'investigating' }] },
        { label: '暂缓调查', action: '暂时保存来信并等待', costs: ['承担延误带来的不确定性'], outcomes: [laterClaim('林青保留当前安排')], informationGain: [laterClaim('后续仍可再查')], risks: [laterClaim('线索可能变旧')], changes: [{ ...laterDelta, to: 'waiting' }] },
      ],
    }],
  }, { requireGate: true });

  const bodyFile = join(dir, FILE);
  const ledgerFile = bookFilePath(dir, BOOK);
  const bodyBefore = await readFile(bodyFile);
  const ledgerBefore = await readFile(ledgerFile);
  const { data: beforeData } = await readBookData(dir, BOOK);
  const beforeRevision = computeRevision(beforeData);
  const laterBodyHash = hashRawBytes(await readFile(join(dir, laterFile)));
  const normalizedBody = bodyBefore.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const plan = planRewind({ data: beforeData, decisionId: id, choice: '暂缓', bodyText: normalizedBody, fileLength: normalizedBody.length });
  assert.equal(plan.ok, true);
  assert.equal(plan.newChoice.label, '暂缓');
  assert.equal(Object.hasOwn(plan.newChoice, 'action'), false, '预览继续使用精简 projection');

  const result = await executeRewind({
    dir, book: BOOK, decisionId: id, choice: '暂缓', confirm: true,
    expectedRevision: beforeRevision,
    expectedBodyHash: hashRawBytes(bodyBefore),
    expectedLedgerHash: beforeData.integrity.ledgerHash,
  });
  const bodyAfter = await readFile(bodyFile);
  const { data: afterData } = await readBookData(dir, BOOK);
  const ledgerAfter = await readFile(ledgerFile);
  const decision = afterData.decisions.find((entry) => entry.id === id);
  const targetOption = decision.options.find((option) => option.label === '暂缓');
  assert.equal(decision.chosen.label, '暂缓');
  assert.equal(decision.chosen.basedOnOptionId, targetOption.id);
  for (const field of ['action', 'costs', 'outcomes', 'informationGain', 'risks', 'changes']) {
    assert.deepEqual(decision.chosen[field], targetOption[field], `chosen.${field} 必须保留 v3 完整值`);
  }
  assert.equal(decision.chosen.action, '推迟到会面时再说');

  const journalFile = join(bookDir(dir, BOOK), 'transactions', result.txId, 'journal.json');
  const journal = JSON.parse(await readFile(journalFile, 'utf8'));
  const receipt = afterData.transactions.find((entry) => entry.id === result.txId);
  assert.equal(journal.stage, 'committed');
  assert.equal(journal.beforeRevision, beforeRevision);
  assert.equal(journal.afterRevision, result.transactionRevision);
  assert.equal(journal.bodyBeforeHash, hashRawBytes(bodyBefore));
  assert.equal(journal.ledgerBeforeHash, hashRawBytes(ledgerBefore));
  assert.equal(journal.bodyAfterHash, hashRawBytes(bodyAfter));
  assert.equal(journal.files.find((file) => file.path === FILE).beforeHash, journal.bodyBeforeHash);
  assert.equal(journal.files.find((file) => file.path === FILE).afterHash, journal.bodyAfterHash);
  assert.equal(journal.files.find((file) => file.path === 'book.json').beforeHash, journal.ledgerBeforeHash);
  assert.equal(journal.files.find((file) => file.path === 'book.json').afterHash, journal.ledgerAfterHash);
  assert.equal(receipt.stage, 'committed');
  assert.equal(receipt.receipt.txId, result.txId);
  assert.equal(receipt.receipt.bodyHash, journal.bodyAfterHash);
  assert.equal(receipt.receipt.revision, journal.afterRevision);
  assert.equal(receipt.files.find((file) => file.path === FILE).afterHash, journal.bodyAfterHash);
  assert.equal(afterData.chapters['2'].stale.sourceDecisionId, id);
  assert.equal(hashRawBytes(await readFile(join(dir, laterFile))), laterBodyHash);
  const transactionStatus = await readTransactionStatus(dir, BOOK);
  assert.equal(transactionStatus.latest.txId, result.txId);
  assert.equal(transactionStatus.latest.ledgerAfterHash, journal.ledgerAfterHash);
  assert.equal(transactionStatus.latest.snapshots.pairVerified, true);

  await assert.rejects(() => executeRewind({
    dir, book: BOOK, decisionId: id, choice: '暂缓', confirm: true,
    expectedRevision: beforeRevision,
    expectedBodyHash: hashRawBytes(bodyBefore),
    expectedLedgerHash: beforeData.integrity.ledgerHash,
  }), { code: 'revision-conflict' });
  assert.deepEqual(await readFile(bodyFile), bodyAfter);
  assert.deepEqual(await readFile(ledgerFile), ledgerAfter);
  assert.equal((await readBookData(dir, BOOK)).data.transactions.filter((entry) => entry.kind === 'revert-transaction').length, 1);
});

test('v3 回退 keep 保留当前自定义选项的六要素和 author-custom 来源', async (t) => {
  const { dir, beat, id } = await setup(t);
  const draft = {
    ...beat.options[0],
    label: '先核验再告知',
    action: '请信使先核验密令，再通知林青',
    changes: [{ ...beat.options[0].changes[0], to: 'verified-aware', toLabel: '核验后知情' }],
  };
  await executeDecide({ dir, book: BOOK, chapter: 1, id, choice: draft.label, optionDraft: draft });
  await output(dir, id);
  const result = await executeRewind({ dir, book: BOOK, decisionId: id, choice: 'keep', confirm: true });
  assert.equal(result.ok, true);
  const { data } = await readBookData(dir, BOOK);
  const chosen = data.decisions.find((entry) => entry.id === id).chosen;
  assert.equal(chosen.source, 'author-custom');
  assert.equal(chosen.basedOnOptionId, null);
  assert.equal(chosen.label, draft.label);
  assert.equal(chosen.action, draft.action);
  assert.deepEqual(chosen.costs, draft.costs);
  for (const field of ['outcomes', 'informationGain', 'risks']) {
    assert.equal(chosen[field][0].text, draft[field][0].text);
    assert.equal(chosen[field][0].basis, draft[field][0].basis);
    assert.equal(chosen[field][0].sourceRefs[0].quote, draft[field][0].sourceRefs[0].quote);
  }
  assert.deepEqual(chosen.changes.map(({ to }) => to), ['verified-aware']);
});
