// 0.7.0：写作单元闸（第 7 条回归）——不许先写完整章、再回头问作者
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executePlan, executeNext, executeSegment } from '../lib/tools.js';

const BOOK = '书';
const AGENT = { id: 'session-unit' };
const FILE = '正文/第1章.md';
const PREAMBLE = '开场白。\n';
const FIRST = '林昭冲了出去。\n他拽住了那个人。\n';
const SECOND = '玉佩落在掌心，凉的。\n';
const THIRD = '街口传来敲锣声。\n';

async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-unit-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '正文'), { recursive: true });
  return dir;
}

function beat(title, key, from, to) {
  return {
    title,
    kind: '分叉',
    change: `${title} 会改变走向`,
    options: [
      {
        label: '选 A',
        impact: 'A 的后果',
        changes: [{ entity: '林昭', key, from, to, evidence: ['证据一', '证据二'] }],
      },
      {
        label: '选 B',
        impact: 'B 的后果',
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

/** 开场白 + 第一段已登记、第二个决策点已拍板（闸门锚点 = PREAMBLE+FIRST 的长度）。 */
async function setupSecond(t) {
  const dir = await workspace(t);
  await writeFile(join(dir, FILE), PREAMBLE + FIRST, 'utf8');
  await executePlan({ dir, book: BOOK, chapter: 1, beats: [beat('要不要救', '救人与否', '旁观', '出手')] });
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askReturning({ 'b1-1': '选 A' }) });
  await executeSegment({ dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'], excerpt: FIRST });
  await executePlan({
    dir, book: BOOK, chapter: 1, append: true, beats: [beat('玉佩怎么来', '玉佩来源', '没有', '有')],
  });
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askReturning({ 'b1-2': '选 A' }) });
  return { dir, anchor: PREAMBLE.length + FIRST.length };
}

test('写作单元闸 A：正文里有多写没登记的字时，不许再问下一个岔路', async (t) => {
  const dir = await workspace(t);
  await writeFile(join(dir, FILE), PREAMBLE + FIRST, 'utf8');
  await executePlan({ dir, book: BOOK, chapter: 1, beats: [beat('要不要救', '救人与否', '旁观', '出手')] });
  await executePlan({
    dir, book: BOOK, chapter: 1, append: true, beats: [beat('玉佩怎么来', '玉佩来源', '没有', '有')],
  });
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askReturning({ 'b1-1': '选 A' }) });
  await executeSegment({ dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'], excerpt: FIRST });

  // 又把下一段写进了文件、却还没登记：这时去问 b1-2 必须被拦。
  await writeFile(join(dir, FILE), PREAMBLE + FIRST + SECOND, 'utf8');
  await assert.rejects(
    () => executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askReturning({ 'b1-2': '选 A' }) }),
    (error) => {
      assert.equal(error.code, 'write-ahead');
      assert.match(error.message, /还没登记成段落/);
      return true;
    },
  );

  // 把多写的删掉（恢复成"已登记到锚点"），再问就正常。
  await writeFile(join(dir, FILE), PREAMBLE + FIRST, 'utf8');
  const asked = await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askReturning({ 'b1-2': '选 A' }) });
  assert.deepEqual(asked.committed.map((item) => item.id), ['b1-2']);
});

test('写作单元闸 B：这一段必须正好接在拍板时的锚点上（unit-gap）', async (t) => {
  const { dir, anchor } = await setupSecond(t);

  // 跳过了证物那一段，直接登记更后面的一段：中间的字没有决策。
  await writeFile(join(dir, FILE), PREAMBLE + FIRST + SECOND + THIRD, 'utf8');
  await assert.rejects(
    () => executeSegment({
      dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-2'], excerpt: THIRD,
    }),
    (error) => {
      assert.equal(error.code, 'unit-gap');
      assert.match(error.message, /拍板时正文停在/);
      return true;
    },
  );

  // 从锚点开始登记就正常。
  const segment = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-2'], excerpt: SECOND,
  });
  assert.equal(segment.segment.offsetStart, anchor);
});

test('写作单元闸 B：拍板时已登记的前缀被改写后再登记，会因 hash 不符被拒', async (t) => {
  const { dir } = await setupSecond(t);

  // 把拍板时就在的开场白改掉（同样长度，位置不变），再接上这一段。
  await writeFile(join(dir, FILE), '开场白！\n' + FIRST + SECOND, 'utf8');
  await assert.rejects(
    () => executeSegment({
      dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-2'], excerpt: SECOND,
    }),
    (error) => {
      assert.equal(error.code, 'prefix-rewritten');
      assert.match(error.message, /被改过/);
      return true;
    },
  );
});
