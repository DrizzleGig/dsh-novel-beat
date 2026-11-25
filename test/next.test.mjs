// 0.7.0 M3：beat_next —— 插件亲手问作者 + 作者凭据 + 原子决策组
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executePlan, executeNext, executeGate, executeDecide, executeSegment } from '../lib/tools.js';
import { readBookData } from '../lib/store.js';

const BOOK = '书';
const AGENT = { id: 'session-test' };

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-next-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function beat(title, from, to, labels = ['选 A', '选 B']) {
  return {
    title,
    kind: '分叉',
    change: `${title} 会改变走向`,
    options: [
      {
        label: labels[0],
        impact: `${labels[0]} 的后果`,
        changes: [{ entity: '林昭', key: title, from, to, evidence: ['证据一', '证据二'] }],
      },
      {
        label: labels[1],
        impact: `${labels[1]} 的后果`,
        changes: [{ entity: '林昭', key: title, from, to: `${to}（另一种）`, evidence: ['证据一'] }],
      },
    ],
  };
}

/** 0.7 起 beat_plan 一次只收一个决策点：这里的 hints 数组逐个登记。 */
async function plan(dir, chapter, beats) {
  const list = Array.isArray(beats) ? beats : [beats];
  let last = null;
  for (const item of list) {
    last = await executePlan({ dir, book: BOOK, chapter, beats: [item], append: true });
  }
  return last;
}

function askReturning(map) {
  const requests = [];
  const ask = async (request) => {
    requests.push(request);
    return {
      answers: request.questions.map((question) => {
        const picked = map[question.id];
        if (picked && typeof picked === 'object') return { id: question.id, selected: [], custom: picked.custom };
        return { id: question.id, selected: [picked] };
      }),
    };
  };
  return { ask, requests };
}

test('没有提问服务时 beat_next 明确拒绝（不偷偷替作者选）', async (t) => {
  const dir = await tempDir(t);
  await plan(dir, 1, [beat('要不要救', '旁观', '出手')]);
  await assert.rejects(
    () => executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: null }),
    (error) => error.code === 'no-user-questions',
  );
});

test('beat_next：一次只问一个决策，作者选完插件自己落账（origin=author）', async (t) => {
  const dir = await tempDir(t);
  await plan(dir, 1, [beat('要不要救', '旁观', '出手'), beat('玉佩怎么来', '没有', '有')]);
  const { ask, requests } = askReturning({ 'b1-1': '选 A' });

  const result = await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask });

  assert.equal(requests.length, 1, '只问一次');
  assert.equal(requests[0].questions.length, 1, '一次只问一个决策');
  assert.equal(requests[0].agent.id, 'session-test', '把当前会话交给提问服务');
  assert.equal(requests[0].questions[0].options.length, 2, '选项完整摆给作者');
  const detail = requests[0].questions[0].detail ?? '';
  for (const option of requests[0].questions[0].options) {
    assert.ok(!detail.includes(option.label), `detail 不能重复列选项（${option.label}）`);
  }

  assert.equal(result.committed.length, 1);
  assert.equal(result.committed[0].id, 'b1-1');
  assert.equal(result.remaining, 1);
  assert.equal(result.next.id, 'b1-2');
  assert.equal(result.done, false);

  const { data } = await readBookData(dir, BOOK);
  const decision = data.decisions.find((entry) => entry.id === 'b1-1');
  assert.equal(decision.status, 'committed');
  assert.equal(decision.chosen.label, '选 A');
  const receipt = data.requests.find((entry) => entry.id === decision.requestId);
  assert.equal(receipt.origin, 'author', '引擎亲手收到的答案，不是模型转述');
  assert.equal(receipt.agentId, 'session-test');
  assert.ok(receipt.askedAt, '问到作者的时间也记下来');
  assert.ok(receipt.answeredAt);
  assert.deepEqual(receipt.answer.selected, ['选 A']);
  assert.ok(data.canon.some((entry) => entry.entity === '林昭' && entry.key === '要不要救' && entry.value === '出手'));
});

test('beat_next：拒收 ids——一次只问一个决策点', async (t) => {
  const dir = await tempDir(t);
  await plan(dir, 1, [beat('要不要救', '旁观', '出手'), beat('玉佩怎么来', '没有', '有')]);
  const { ask } = askReturning({ 'b1-1': '选 A', 'b1-2': '选 B' });
  await assert.rejects(
    () => executeNext({ dir, book: BOOK, chapter: 1, ids: ['b1-1', 'b1-2'] }, { agent: AGENT }, { ask }),
    (error) => error.code === 'one-at-a-time',
  );
});

test('beat_next：上一条没登记段落就不发下一个（segment-required）', async (t) => {
  const dir = await tempDir(t);
  await plan(dir, 1, [beat('要不要救', '旁观', '出手'), beat('玉佩怎么来', '没有', '有')]);
  const { ask } = askReturning({ 'b1-1': '选 A' });
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask });

  await assert.rejects(
    () => executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask }),
    (error) => error.code === 'segment-required' && /beat_segment/.test(error.message),
  );
});

test('beat_decide：能自己问作者时被拒，只认 beat_next', async (t) => {
  const dir = await tempDir(t);
  await plan(dir, 1, [beat('要不要救', '旁观', '出手')]);
  await assert.rejects(
    () => executeDecide({ dir, book: BOOK, chapter: 1, id: 'b1-1', choice: '选 A' }, { agent: AGENT }, { askAvailable: true }),
    (error) => error.code === 'use-beat-next',
  );
});

test('beat_next：作者自己写答案 → 不编 changes，转成待补（deferred）', async (t) => {
  const dir = await tempDir(t);
  await plan(dir, 1, [beat('要不要救', '旁观', '出手')]);
  const { ask } = askReturning({ 'b1-1': { custom: '先不动，等他自己送上门' } });

  const result = await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask });

  assert.equal(result.committed.length, 0);
  assert.equal(result.deferred.length, 1);
  assert.equal(result.deferred[0].answerText, '先不动，等他自己送上门');
  assert.match(result.deferred[0].next, /beat_decide/);
  assert.equal(result.remaining, 1, '还没落成 committed，所以仍算未决');

  const { data } = await readBookData(dir, BOOK);
  const decision = data.decisions.find((entry) => entry.id === 'b1-1');
  assert.equal(decision.status, 'answered');
  assert.equal(decision.answerText, '先不动，等他自己送上门');
  assert.equal(decision.pendingCustom.text, '先不动，等他自己送上门', '作者原文要在账本里挂起，右栏才看得见');
  assert.equal(data.requests.length, 1, '作者作答本身要留 author 凭据');
  assert.equal(data.requests[0].origin, 'author');
  assert.equal(data.requests[0].answer.custom, '先不动，等他自己送上门');
  assert.equal(decision.requestId, data.requests[0].id, '作者凭据要绑到决策上');
});

test('beat_next：作者自定还没补六要素时，不再问下一题', async (t) => {
  const dir = await tempDir(t);
  await plan(dir, 1, [beat('要不要救', '旁观', '出手')]);
  const { ask, requests } = askReturning({ 'b1-1': { custom: '先不动，等他自己送上门' } });
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask });
  const asked = requests.length;

  const again = await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask });
  assert.equal(again.deferred.length, 1);
  assert.equal(again.deferred[0].id, 'b1-1');
  assert.match(again.message, /补完整六要素/);
  assert.equal(requests.length, asked, '待补期间不再打扰作者');
});

test('beat_next：选项和自定义文本同时回来 → 歧义拒绝，不落账', async (t) => {
  const dir = await tempDir(t);
  await plan(dir, 1, [beat('要不要救', '旁观', '出手')]);
  const ask = async (request) => ({
    answers: request.questions.map((question) => ({
      id: question.id, selected: ['选 A'], custom: '我自己写的另一种',
    })),
  });
  await assert.rejects(
    () => executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask }),
    (error) => error.code === 'ambiguous-answer',
  );
  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.decisions[0].status, 'proposed');
});

test('beat_next：作者自定待补时 beat_plan(reset:true) 能重开，不留孤儿凭据', async (t) => {
  const dir = await tempDir(t);
  await plan(dir, 1, [beat('要不要救', '旁观', '出手')]);
  const { ask } = askReturning({ 'b1-1': { custom: '先不动，等他自己送上门' } });
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask });

  const rebuilt = await executePlan({
    dir, book: BOOK, chapter: 1, reset: true, beats: [beat('要不要救', '旁观', '出手')],
  });
  assert.equal(rebuilt.ok, true);
  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.requests.length, 0, '重开时不能留下指向已删决策的凭据');
  assert.equal(data.decisions.length, 1, '旧决策被清掉，新决策立起来');
  assert.equal(data.decisions[0].status, 'proposed');
});

test('beat_decide：超长作者原文落账后再重试仍幂等（不用被截断的 label 比对）', async (t) => {
  const dir = await tempDir(t);
  await plan(dir, 1, [beat('要不要救', '旁观', '出手')]);
  const long = '先不动，等他自己送上门。'.repeat(10);
  assert.ok(long.length > 80);
  const { ask } = askReturning({ 'b1-1': { custom: long } });
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask });

  const args = {
    dir, book: BOOK, chapter: 1, id: 'b1-1', choice: long,
    changes: [{ entity: '林昭', key: '要不要救', from: '旁观', to: '等他自己送上门', evidence: ['证据一'] }],
  };
  const first = await executeDecide(args);
  assert.equal(first.status, 'committed');
  const second = await executeDecide(args);
  assert.equal(second.idempotent, true, '同一原文重试要给成功回执，不能报已拍板');
  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.decisions[0].chosen.customText, long);
});

test('beat_next：拍板并登记段落后才算这一段结束，全部完成后 done', async (t) => {
  const dir = await tempDir(t);
  await plan(dir, 1, [beat('要不要救', '旁观', '出手')]);
  const { ask, requests } = askReturning({ 'b1-1': '选 A' });
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask });

  await mkdir(join(dir, '正文'), { recursive: true });
  const prose = '林昭冲了出去。\n';
  await writeFile(join(dir, '正文', '第1章.md'), prose, 'utf8');
  await executeSegment({ dir, book: BOOK, chapter: 1, file: '正文/第1章.md', decisionIds: ['b1-1'], excerpt: prose });

  const again = await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask });
  assert.equal(requests.length, 1, '第二次没有再打扰作者');
  assert.equal(again.done, true);
  assert.equal(again.remaining, 0);
});

test('beat_next：选到会改设定的选项时不硬失败，暂存待确认；确认后覆盖并留痕', async (t) => {
  const dir = await tempDir(t);
  await plan(dir, 1, [beat('玉佩怎么来', '没有', '有')]);
  const first = askReturning({ 'b1-1': '选 A' });
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: first.ask });

  // 第二章重复同一 from、却给出不同的结果：与第一章写下的 canon 对不上，必然冲突
  await plan(dir, 2, [beat('玉佩怎么来', '没有', '有')]);
  const second = askReturning({ 'b2-1': '选 B' });
  const pending = await executeNext({ dir, book: BOOK, chapter: 2 }, { agent: AGENT }, { ask: second.ask });

  assert.equal(pending.conflictPending.length, 1, '冲突被记成待确认，而不是把作者的选择丢掉');
  assert.equal(pending.committed.length, 0);
  assert.match(pending.message, /是否允许这次剧情改这个设定/);

  const before = await readBookData(dir, BOOK);
  const decision = before.data.decisions.find((entry) => entry.id === 'b2-1');
  assert.equal(decision.status, 'answered');
  assert.equal(decision.pendingChoice.label, '选 B');
  assert.equal(before.data.requests.length, 1, '没确认之前不写凭据');
  const beforeValue = before.data.canon.find((entry) => entry.key === '玉佩怎么来').value;

  // 作者确认"这次可以改设定"→ 覆盖 canon，并留下 canon-overridden 记录
  const confirmed = await executeNext(
    { dir, book: BOOK, chapter: 2, confirmCanon: true },
    { agent: AGENT },
    { ask: second.ask },
  );
  assert.equal(confirmed.committed.length, 1);
  assert.equal(confirmed.warnings.some((warning) => warning.startsWith('canon-overridden:')), true);

  const after = await readBookData(dir, BOOK);
  assert.equal(after.data.requests.length, 2, '确认之后才写凭据');
  assert.equal(after.data.decisions.find((entry) => entry.id === 'b2-1').status, 'committed');
  const afterValue = after.data.canon.find((entry) => entry.key === '玉佩怎么来').value;
  assert.notEqual(afterValue, beforeValue, '确认后 canon 真的被改掉了');
});

test('beat_plan：一次只收一个决策点（多给直接拒，从入口掐掉按章批处理）', async (t) => {
  const dir = await tempDir(t);
  await assert.rejects(
    () => executePlan({
      dir, book: BOOK, chapter: 1, beats: [beat('要不要救', '旁观', '出手'), beat('玉佩怎么来', '没有', '有')],
    }),
    (error) => error.code === 'one-at-a-time',
  );
});

test('作者自己写了答案之后，beat_decide 能补齐 changes 落账（不再是死锁）', async (t) => {
  const dir = await tempDir(t);
  await plan(dir, 1, [beat('要不要救', '旁观', '出手')]);
  const { ask } = askReturning({ 'b1-1': { custom: '先按兵不动，等他先动手' } });
  const first = await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask });
  assert.equal(first.deferred.length, 1);

  const decided = await executeDecide(
    {
      dir,
      book: BOOK,
      chapter: 1,
      id: 'b1-1',
      choice: '先按兵不动，等他先动手',
      changes: [{ entity: '林昭', key: '要不要救', from: '旁观', to: '按兵不动', evidence: ['按兵不动'] }],
    },
    { agent: AGENT },
    { askAvailable: true },
  );
  assert.equal(decided.status, 'committed', '作者的原话要能落成 committed，否则第 2 段起永远登记不上');
});

test('beat_gate：闸门下放到本段（给 ids 只对本段判）', async (t) => {
  const dir = await tempDir(t);
  await plan(dir, 1, [beat('要不要救', '旁观', '出手'), beat('玉佩怎么来', '没有', '有')]);
  const { ask } = askReturning({ 'b1-1': '选 A' });
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask });

  const whole = await executeGate({ dir, book: BOOK, chapter: 1 });
  assert.equal(whole.pass, false, '整章还有一条没拍');
  assert.equal(whole.scope, 'chapter');
  assert.deepEqual(whole.pending.map((entry) => entry.id), ['b1-2']);

  const segment = await executeGate({ dir, book: BOOK, chapter: 1, ids: ['b1-1'] });
  assert.equal(segment.scope, 'segment');
  assert.equal(segment.pass, true, '本段（b1-1）已经拍完，可以写这一段');
  assert.equal(segment.total, 1);

  const unknown = await executeGate({ dir, book: BOOK, chapter: 1, ids: ['b1-9'] });
  assert.equal(unknown.pass, false);
  assert.ok(unknown.warnings.some((entry) => entry.startsWith('unknown:b1-9')));
});
