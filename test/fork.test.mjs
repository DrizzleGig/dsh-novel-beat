// 0.7.0 P1：作者主动插岔路（/beat fork → beat_plan(forkId) → beat_next）
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeFork, executePlan, executeNext, executeList } from '../lib/tools.js';
import { readBookData } from '../lib/store.js';

const BOOK = '书';
const AGENT = { id: 'session-fork' };

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-fork-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function beat(title, labels = ['杀掉', '留活口']) {
  return {
    title,
    kind: '分叉',
    change: '这决定独孤博还在不在',
    options: [
      {
        label: labels[0],
        impact: `${labels[0]}的后果`,
        changes: [{ entity: '独孤博', key: '生死', from: '活着', to: '死', evidence: ['血溅当场'] }],
      },
      {
        label: labels[1],
        impact: `${labels[1]}的后果`,
        changes: [{ entity: '独孤博', key: '态度', from: '警惕', to: '戒备', evidence: ['他还在'] }],
      },
    ],
  };
}

function askReturning(label) {
  return async (request) => ({
    answers: request.questions.map((question) => ({ id: question.id, selected: [label] })),
  });
}

test('beat_fork：作者插的岔路必须先被 beat_plan(forkId) 消化，否则 beat_next 拒绝发新题', async (t) => {
  const dir = await tempDir(t);

  const forked = await executeFork({ dir, book: BOOK, chapter: 1, text: '要不要当场杀掉独孤博' });
  assert.equal(forked.fork.status, 'open');
  assert.equal(forked.fork.id, 'f-0001');
  assert.match(forked.message, /forkId/);

  // 岔路还没写成决策点 → 不许问下一题
  const blocked = await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askReturning('被杀掉') })
    .catch((error) => error);
  assert.equal(blocked.code, 'fork-required');
  assert.match(blocked.message, /f-0001/);

  // 不带 forkId 直接登记也不行
  const unlinked = await executePlan({
    dir, book: BOOK, chapter: 1, beats: [beat('独孤博死活')],
  }).catch((error) => error);
  assert.equal(unlinked.code, 'fork-required');

  // 带上 forkId 才放行，并把岔路标成 planned、挂到新决策上
  const planned = await executePlan({
    dir, book: BOOK, chapter: 1, forkId: 'f-0001', beats: [beat('独孤博死活')],
  });
  assert.deepEqual(planned.ids, ['b1-1']);

  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.forks.length, 1);
  assert.equal(data.forks[0].status, 'planned');
  assert.equal(data.forks[0].decisionId, 'b1-1');

  // 现在可以问作者了，问的就是作者自己插进来的那一条
  const asked = await executeNext(
    { dir, book: BOOK, chapter: 1 },
    { agent: AGENT },
    { ask: askReturning('杀掉') },
  );
  assert.deepEqual(asked.committed.map((item) => item.id), ['b1-1']);
});

test('beat_fork：同一条岔路重复登记不产生新记录', async (t) => {
  const dir = await tempDir(t);
  const first = await executeFork({ dir, book: BOOK, chapter: 1, text: '要不要杀掉独孤博' });
  const again = await executeFork({ dir, book: BOOK, chapter: 1, text: '要不要杀掉独孤博' });
  assert.equal(again.duplicate, true);
  assert.equal(again.fork.id, first.fork.id);
  assert.match(again.message, /已经记过/);

  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.forks.length, 1);
});

test('beat_fork：岔路描述不能为空；beat_list 能看到待处理的岔路', async (t) => {
  const dir = await tempDir(t);
  const empty = await executeFork({ dir, book: BOOK, chapter: 1, text: '   ' }).catch((error) => error);
  assert.equal(empty.code, 'no-text');

  await executeFork({ dir, book: BOOK, chapter: 1, text: '要不要把玉佩交给秦岳' });
  const listed = await executeList({ dir, book: BOOK, chapter: 1 });
  assert.equal(listed.forks.length, 1);
  assert.equal(listed.forks[0].text, '要不要把玉佩交给秦岳');
});
