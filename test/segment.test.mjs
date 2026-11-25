// 0.7.0 M4：段落登记（beat_segment）与安全回退（beat_revert）
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executePlan,
  executeNext,
  executeSegment,
  executeRevert,
  executeVerify,
} from '../lib/tools.js';
import { readBookData } from '../lib/store.js';

const BOOK = '书';
const AGENT = { id: 'session-seg' };
const FILE = '正文/第1章.md';
const PREAMBLE = '开场白。\n';
const FIRST = '林昭冲了出去。\n他拽住了那个人。\n';
const SECOND = '玉佩落在掌心，凉的。\n玉佩又亮了一下。\n';

async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-seg-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '正文'), { recursive: true });
  return dir;
}

function beat(title, key, from, to, labels = ['选 A', '选 B']) {
  return {
    title,
    kind: '分叉',
    change: `${title} 会改变走向`,
    options: [
      {
        label: labels[0],
        impact: `${labels[0]} 的后果`,
        changes: [{ entity: '林昭', key, from, to, evidence: ['证据一', '证据二'] }],
        obligations: [{ text: `${title} 留下的钩子`, dueChapter: 3, evidence: ['钩子'] }],
      },
      {
        label: labels[1],
        impact: `${labels[1]} 的后果`,
        changes: [{ entity: '林昭', key, from, to: `${to}（另一种）`, evidence: ['证据一'] }],
      },
    ],
  };
}

function askReturning(map) {
  return async (request) => ({
    answers: request.questions.map((question) => ({ id: question.id, selected: [map[question.id]] })),
  });
}

/** 一个决策点已拍板、正文只有开场白：留给调用方"写这一段 + 登记"。 */
async function setupOne(t) {
  const dir = await workspace(t);
  await writeFile(join(dir, FILE), PREAMBLE, 'utf8');
  await executePlan({
    dir, book: BOOK, chapter: 1, beats: [beat('要不要救', '救人与否', '旁观', '出手')],
  });
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askReturning({ 'b1-1': '选 A' }) });
  return { dir };
}

/** 两个决策点：b1-1 已拍板并登记成段落，b1-2 已拍板但还没登记。 */
async function setupPair(t) {
  const dir = await workspace(t);
  await writeFile(join(dir, FILE), PREAMBLE + FIRST, 'utf8');
  await executePlan({
    dir, book: BOOK, chapter: 1, beats: [beat('要不要救', '救人与否', '旁观', '出手')],
  });
  await executePlan({
    dir, book: BOOK, chapter: 1, append: true, beats: [beat('玉佩怎么来', '玉佩来源', '没有', '有')],
  });
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askReturning({ 'b1-1': '选 A' }) });
  const one = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'], excerpt: FIRST,
  });
  // 节奏：先问下一个岔路（此时正文里没有"多写没登记"的字），再写这一段正文。
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askReturning({ 'b1-2': '选 A' }) });
  await writeFile(join(dir, FILE), PREAMBLE + FIRST + SECOND, 'utf8');
  return { dir, one };
}

test('beat_segment：登记刚写的这一段（快照 + hash + 挂决策点）', async (t) => {
  const { dir } = await setupOne(t);
  await writeFile(join(dir, FILE), PREAMBLE + FIRST, 'utf8');

  const result = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'], excerpt: FIRST,
  });

  assert.equal(result.segment.chapter, 1);
  assert.equal(result.segment.file, FILE);
  assert.equal(result.segment.offsetStart, PREAMBLE.length);
  assert.equal(result.segment.offsetEnd, PREAMBLE.length + FIRST.length);
  assert.equal(result.segment.chars, FIRST.length);
  assert.deepEqual(result.segment.decisionIds, ['b1-1']);
  assert.ok(result.text.includes('林昭冲了出去'), '登记成功要把这一段正文回显给作者看');
  assert.equal(result.segment.status, 'committed');

  const snapshot = await readFile(
    join(dir, '.dsh-novel-beat', BOOK, 'revisions', `${result.revisionRecord.id}.md`),
    'utf8',
  );
  assert.equal(snapshot, FIRST);

  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.segments.length, 1);
  assert.equal(data.revisions.length, 1);
  assert.equal(data.revisions[0].kind, 'segment');
  assert.equal(data.decisions.find((entry) => entry.id === 'b1-1').segmentId, result.segment.id);
});

test('beat_segment：不传 excerpt 时接在上一段之后；excerpt 必须唯一', async (t) => {
  const { dir, one } = await setupPair(t);

  const ambiguous = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-2'], excerpt: '玉佩',
  }).catch((error) => error);
  assert.equal(ambiguous.code, 'excerpt-ambiguous', '摘录出现多次要拒绝');

  const missing = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-2'], excerpt: '根本没写这句',
  }).catch((error) => error);
  assert.equal(missing.code, 'excerpt-not-found');

  const two = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-2'],
  });
  assert.equal(two.segment.offsetStart, one.segment.offsetEnd, '接在上一段之后');
  assert.equal(two.segment.offsetEnd, PREAMBLE.length + FIRST.length + SECOND.length);

  const again = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-2'],
  }).catch((error) => error);
  assert.equal(again.code, 'already-segmented');
});

test('beat_segment：决策没拍板 / 重复登记 会被拒', async (t) => {
  const dir = await workspace(t);
  await writeFile(join(dir, FILE), '写的字。\n', 'utf8');
  await executePlan({
    dir, book: BOOK, chapter: 1, beats: [beat('要不要救', '救人与否', '旁观', '出手')],
  });

  const notYet = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'],
  }).catch((error) => error);
  assert.equal(notYet.code, 'not-committed');

  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askReturning({ 'b1-1': '选 A' }) });
  await executeSegment({ dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'] });
  const again = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'],
  }).catch((error) => error);
  assert.equal(again.code, 'already-segmented');
});

test('beat_segment：开场白可以登记成不挂决策的段落（要显式给范围）', async (t) => {
  const { dir } = await setupOne(t);
  await writeFile(join(dir, FILE), PREAMBLE + FIRST, 'utf8');

  const bare = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: [],
  }).catch((error) => error);
  assert.equal(bare.code, 'no-decisions', '不给范围会吞掉剩下的正文');

  const scene = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: [], excerpt: PREAMBLE,
  });
  assert.equal(scene.segment.offsetStart, 0);
  assert.deepEqual(scene.segment.decisionIds, []);
});

test('beat_revert(text)：正文退回这一段之前，决策可以重新登记', async (t) => {
  const dir = await workspace(t);
  await writeFile(join(dir, FILE), PREAMBLE, 'utf8');
  await executePlan({ dir, book: BOOK, chapter: 1, beats: [beat('要不要救', '救人与否', '旁观', '出手')] });
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askReturning({ 'b1-1': '选 A' }) });
  await writeFile(join(dir, FILE), PREAMBLE + FIRST, 'utf8');
  const { segment } = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'], excerpt: FIRST,
  });
  assert.equal(segment.offsetStart, PREAMBLE.length);

  const revert = await executeRevert({
    dir, book: BOOK, chapter: 1, segment: segment.id, mode: 'text',
  });
  assert.equal(revert.reverted.segmentId, segment.id);
  assert.equal(await readFile(join(dir, FILE), 'utf8'), PREAMBLE, '截掉这一段的正文');

  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.segments[0].status, 'reverted');
  assert.equal(data.decisions.find((entry) => entry.id === 'b1-1').segmentId, null);
  assert.equal(data.revisions.at(-1).kind, 'revert');

  // 回退后同一条决策可以重新登记
  const rewritten = '重写的一段。\n';
  await writeFile(join(dir, FILE), PREAMBLE + rewritten, 'utf8');
  const again = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'], excerpt: rewritten,
  });
  assert.equal(again.segment.offsetStart, PREAMBLE.length);
  assert.equal(again.segment.offsetEnd, PREAMBLE.length + rewritten.length);
});

test('beat_revert(ledger)：canon 与义务回到这一段之前，正文不动', async (t) => {
  const dir = await workspace(t);
  await writeFile(join(dir, FILE), PREAMBLE, 'utf8');
  await executePlan({
    dir, book: BOOK, chapter: 1, beats: [beat('要不要救', '救人与否', '旁观', '出手')],
  });
  await executePlan({
    dir, book: BOOK, chapter: 1, append: true, beats: [beat('玉佩怎么来', '玉佩来源', '没有', '有')],
  });
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askReturning({ 'b1-1': '选 A' }) });
  await writeFile(join(dir, FILE), PREAMBLE + FIRST, 'utf8');
  const { segment } = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'], excerpt: FIRST,
  });
  // 第二段：把第二条决策也写进正文并登记，用来验证"没回退的那条不动"
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askReturning({ 'b1-2': '选 A' }) });
  await writeFile(join(dir, FILE), PREAMBLE + FIRST + SECOND, 'utf8');
  await executeSegment({ dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-2'] });

  const revert = await executeRevert({
    dir, book: BOOK, chapter: 1, segment: segment.id, mode: 'ledger',
  });
  assert.equal(revert.reverted.restoredCanon, 1);
  assert.equal(revert.reverted.removedObligations, 1);

  const text = await readFile(join(dir, FILE), 'utf8');
  assert.ok(text.includes(FIRST), '正文没动');

  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.canon.length, 2, '两条 canon 都还在');
  const restored = data.canon.find((entry) => entry.key === '救人与否');
  assert.equal(restored.value, '旁观', '这一段的 canon 回到 from');
  assert.equal(data.canon.find((entry) => entry.key === '玉佩来源').value, '有', '没回退的那条不动');
  assert.equal(data.obligations.length, 1);
  assert.equal(data.segments[0].status, 'committed', 'ledger 模式不动正文，所以段落还在');
});

test('beat_revert：退第 N 段 = 截断到它的起点，其后各段一起作废（级联）', async (t) => {
  const { dir, one } = await setupPair(t);
  const two = await executeSegment({ dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-2'] });
  assert.equal(two.segment.offsetStart, PREAMBLE.length + FIRST.length);

  const revert = await executeRevert({ dir, book: BOOK, chapter: 1, segment: one.segment.id });

  assert.deepEqual(revert.reverted.revertedSegments, [one.segment.id, two.segment.id]);
  assert.equal(await readFile(join(dir, FILE), 'utf8'), PREAMBLE, '正文截到第 1 段起点');
  assert.match(revert.message, /后面 1 段一起作废/);

  const { data } = await readBookData(dir, BOOK);
  assert.ok(data.segments.every((segment) => segment.status === 'reverted'), '后面的段不能留成僵尸段');
  assert.equal(data.revisions.at(-1).kind, 'revert');
  assert.deepEqual(data.revisions.at(-1).revertedSegments, [one.segment.id, two.segment.id]);

  // 退掉之后可以重写这一段再登记
  const rewritten = '重写的一段。\n';
  await writeFile(join(dir, FILE), PREAMBLE + rewritten, 'utf8');
  const again = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'], excerpt: rewritten,
  });
  assert.equal(again.segment.offsetStart, PREAMBLE.length);
});

test('beat_revert：正文被改过但原文还在 → 先要 confirm，确认后才按新位置截断', async (t) => {
  const { dir } = await setupOne(t);
  await writeFile(join(dir, FILE), PREAMBLE + FIRST, 'utf8');
  const only = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'], excerpt: FIRST,
  });
  // 作者在这一段前面又补了一句：原文还在，但整段的 offset 已经往后挪了。
  const extraHead = '作者后来补的开头。\n';
  await writeFile(join(dir, FILE), extraHead + PREAMBLE + FIRST + SECOND, 'utf8');

  const unconfirmed = await executeRevert({
    dir, book: BOOK, chapter: 1, segment: only.segment.id, mode: 'text',
  }).catch((error) => error);
  assert.equal(unconfirmed.code, 'needs-confirm', '正文被改过不许直接截');
  assert.equal(await readFile(join(dir, FILE), 'utf8'), extraHead + PREAMBLE + FIRST + SECOND, '没确认时正文一个字都不能动');

  const confirmed = await executeRevert({
    dir, book: BOOK, chapter: 1, segment: only.segment.id, mode: 'text', confirm: true,
  });
  assert.equal(await readFile(join(dir, FILE), 'utf8'), extraHead + PREAMBLE, '确认后按原文找到的新位置截断');
  assert.ok(confirmed.warnings.some((entry) => entry.startsWith('relocated:')), '要说清是按原文重新定位的');
  assert.equal(confirmed.reverted.nextOffset, extraHead.length + PREAMBLE.length);
});

test('beat_revert：原文被改写/找不回来 → 拒绝，正文一个字都不动', async (t) => {
  const { dir } = await setupOne(t);
  await writeFile(join(dir, FILE), PREAMBLE + FIRST, 'utf8');
  const only = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'], excerpt: FIRST,
  });
  const rewritten = '作者把这一段整个重写了，原文已经不在了。\n';
  await writeFile(join(dir, FILE), rewritten, 'utf8');

  const refused = await executeRevert({ dir, book: BOOK, chapter: 1, segment: only.segment.id }).catch((error) => error);
  assert.equal(refused.code, 'cannot-locate');
  assert.equal(await readFile(join(dir, FILE), 'utf8'), rewritten, '宁可失败也不截错地方');

  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.segments[0].status, 'committed', '正文没动，账本也不能动');
});

test('beat_revert：原文在正文里出现两次 → 分不清，拒绝', async (t) => {
  const { dir } = await setupOne(t);
  await writeFile(join(dir, FILE), PREAMBLE + FIRST, 'utf8');
  const only = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'], excerpt: FIRST,
  });
  // 前面被改过（原位对不上），同一段文本又在文件里出现了两次。
  const extraHead = '作者后来补的开头。\n';
  const doubled = extraHead + PREAMBLE + FIRST + FIRST;
  await writeFile(join(dir, FILE), doubled, 'utf8');

  const refused = await executeRevert({
    dir, book: BOOK, chapter: 1, segment: only.segment.id, confirm: true,
  }).catch((error) => error);
  assert.equal(refused.code, 'cannot-locate');
  assert.match(refused.message, /出现了 2 次/);
  assert.equal(await readFile(join(dir, FILE), 'utf8'), doubled);
});

test('beat_verify：段落被改过会报 drift，没登记的正文会报 unsegmented', async (t) => {
  const { dir } = await setupOne(t);
  await writeFile(join(dir, FILE), PREAMBLE + FIRST, 'utf8');
  const { segment } = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'], excerpt: FIRST,
  });

  const clean = await executeVerify({ dir, book: BOOK, chapter: 1, path: FILE, strict: false });
  assert.ok(!clean.warnings.some((entry) => entry.startsWith('drift:')), '没改过不该报 drift');
  assert.ok(
    clean.warnings.some((entry) => entry.startsWith('unsegmented:')),
    '开场白还没登记成段落，要提示',
  );

  const text = await readFile(join(dir, FILE), 'utf8');
  await writeFile(join(dir, FILE), text.replace('林昭冲了出去。', '林昭没有冲出去。'), 'utf8');
  const drifted = await executeVerify({ dir, book: BOOK, chapter: 1, path: FILE, strict: false });
  assert.ok(drifted.warnings.some((entry) => entry.startsWith(`drift:${segment.id}:`)));
});

test('beat_verify：零决策章缺少扫描收据时拒绝盖章（scan-required）', async (t) => {
  const dir = await workspace(t);
  await writeFile(join(dir, FILE), '整章闷头写完。\n', 'utf8');
  await executePlan({ dir, book: BOOK, chapter: 2, beats: [beat('别的章', '别的', '无', '有')] });

  await assert.rejects(
    () => executeVerify({ dir, book: BOOK, chapter: 1, path: FILE, strict: false }),
    (error) => error.code === 'scan-required',
  );
});

test('续写检查：登记一段后置标记，beat_plan(beats: []) 或登记真岔路才清掉', async (t) => {
  const { dir } = await setupOne(t);
  await writeFile(join(dir, FILE), PREAMBLE + FIRST, 'utf8');
  await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'], excerpt: FIRST,
  });

  const afterSegment = await readBookData(dir, BOOK);
  assert.equal(
    afterSegment.data.chapters['1'].continuationCheckRequired,
    true,
    '登记完一段 → 下一次写正文前必须先做续写检查',
  );

  // 结论一：这里没有真岔路
  const verdict = await executePlan({
    dir, book: BOOK, chapter: 1, beats: [], reason: '这一段只是交代路线，没有需要作者拍板的分叉。',
  });
  assert.equal(verdict.verdict, 'no-fork');
  assert.equal(verdict.cleared, true);

  const cleared = await readBookData(dir, BOOK);
  assert.equal(cleared.data.chapters['1'].continuationCheckRequired, false);
  assert.ok(cleared.data.audit.some((entry) => entry.action === 'continuation-check' && entry.verdict === 'no-fork'));

  // 结论二：又写了一段、又登记，这次检查出真岔路 → 登记决策点同样清掉标记
  await writeFile(join(dir, FILE), PREAMBLE + FIRST + SECOND, 'utf8');
  await executeSegment({ dir, book: BOOK, chapter: 1, file: FILE, decisionIds: [], excerpt: SECOND });
  await executePlan({
    dir, book: BOOK, chapter: 1, append: true, beats: [beat('玉佩怎么用', '玉佩用法', '收着', '亮出')],
  });
  const afterFork = await readBookData(dir, BOOK);
  assert.equal(afterFork.data.chapters['1'].continuationCheckRequired, false);
  assert.ok(afterFork.data.audit.some((entry) => entry.action === 'continuation-check' && entry.verdict === 'fork'));
});
