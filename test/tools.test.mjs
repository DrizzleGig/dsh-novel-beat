import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executePlan,
  executeList,
  executeDecide,
  executeGate,
  executeCompile,
  executeVerify,
  executeAdjust,
} from '../lib/tools.js';

const BOOK = '测试书';

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-tools-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function planArgs(dir, chapter = 1) {
  return {
    dir,
    book: BOOK,
    chapter,
    beats: [{
      title: '玉佩怎么到手',
      kind: '得失',
      change: '玉佩 从 拍卖品 变成 林砚持有',
      options: [
        {
          label: '拍卖会竞价拍下',
          impact: '花钱得玉，得罪同场出价人，后续被盯上',
          changes: [
            { entity: '玉佩', key: '持有者', from: '拍卖行', to: '林砚', evidence: ['落槌', '玉佩归他'] },
            { entity: '林砚', key: '现银', from: '充足', to: '见底', evidence: ['钱袋空了'] },
          ],
          obligations: [{
            text: '同场出价人记恨林砚',
            dueChapter: 3,
            evidence: ['出价人', '记恨'],
          }],
          forbidden: ['当众揭穿'],
        },
        {
          label: '黑市捡漏',
          impact: '低价得玉，欠中间人一个人情',
          changes: [
            { entity: '玉佩', key: '持有者', from: '拍卖行', to: '林砚', evidence: ['黑市', '捡漏'] },
          ],
        },
      ],
    }],
  };
}

function secondBeat() {
  return {
    title: '旧敌是否认出他',
    kind: '知情',
    change: '旧敌 从 不知情 变成 认出林砚',
    options: [
      {
        label: '认出但不说破',
        impact: '旧敌暗中记下纹样，后续设局',
        changes: [
          { entity: '旧敌', key: '认知', from: '不知情', to: '认出林砚', evidence: ['袖口', '纹样'] },
        ],
      },
      {
        label: '当场叫破',
        impact: '冲突提前爆发',
        changes: [
          { entity: '旧敌', key: '认知', from: '不知情', to: '当场叫破', evidence: ['当场', '叫破'] },
        ],
      },
    ],
  };
}

test('plan → decide → gate → compile → verify 端到端', async (t) => {
  const dir = await tempDir(t);

  const planned = await executePlan(planArgs(dir));
  assert.equal(planned.total, 1);
  assert.equal(planned.pending, 1);
  assert.equal(planned.ids.length, 1);

  const decided = await executeDecide({
    dir, book: BOOK, chapter: 1, id: planned.ids[0], choice: '拍卖会竞价拍下',
  });
  assert.equal(decided.remaining, 0);
  assert.equal(decided.canonChanges.length, 2);
  assert.equal(decided.obligations.length, 1);

  const gate = await executeGate({ dir, book: BOOK, chapter: 1 });
  assert.equal(gate.pass, true);
  assert.equal(gate.pending.length, 0);

  const compiled = await executeCompile({ dir, book: BOOK, chapter: 1 });
  assert.match(compiled.markdown, /## 本章决策约束/);
  assert.match(compiled.markdown, /玉佩\.持有者：拍卖行 → 林砚/);
  assert.match(compiled.markdown, /证据：落槌/);
  assert.match(compiled.markdown, /不得出现：当众揭穿/);

  const verified = await executeVerify({
    dir, book: BOOK, chapter: 1,
    text: '拍卖师落槌。玉佩归他。他数了数，钱袋空了。',
  });
  assert.equal(verified.pass, true);
  assert.equal(verified.verified, true);
  assert.equal(verified.stats.covered, 2);

  const overview = await executeList({ dir, book: BOOK });
  assert.equal(overview.exists, true);
  assert.equal(overview.chapters, 1);
  assert.equal(overview.canonCount, 2);
  assert.equal(overview.openObligations, 1);
  assert.equal(overview.pending, 0);

  const context = await executeList({ dir, book: BOOK, context: true });
  assert.equal(context.context.canon.length, 2);
  assert.equal(context.context.obligations.length, 1);
  assert.equal(context.context.recent.length, 1);
});

test('同章重复 plan 被锁；append 续号；已拍板后 reset 被拒', async (t) => {
  const dir = await tempDir(t);
  const first = await executePlan(planArgs(dir));

  await assert.rejects(
    () => executePlan(planArgs(dir)),
    (error) => error.code === 'chapter-locked',
  );

  const appended = await executePlan({
    ...planArgs(dir),
    beats: [secondBeat()],
    append: true,
  });
  assert.equal(appended.total, 2);
  assert.equal(appended.ids.length, 1);
  assert.equal(appended.ids[0], 'b1-2');

  await executeDecide({
    dir, book: BOOK, chapter: 1, id: first.ids[0], choice: '拍卖会竞价拍下',
  });
  await assert.rejects(
    () => executePlan({ ...planArgs(dir), reset: true }),
    (error) => error.code === 'chapter-locked',
  );
});

test('自定义 choice 必须带 changes；canon 冲突硬拒；状态推进可跨章', async (t) => {
  const dir = await tempDir(t);
  const first = await executePlan(planArgs(dir));

  await executeDecide({
    dir, book: BOOK, chapter: 1, id: first.ids[0],
    choice: '把玉佩扔进河里',
    changes: [{
      entity: '玉佩', key: '持有者', from: '拍卖行', to: '河底', evidence: ['扔进河里'],
    }],
  });

  const secondArgs = planArgs(dir, 2);
  secondArgs.beats[0].title = '玉佩怎么回到手里';
  secondArgs.beats[0].change = '玉佩 从 河底 变成 林砚持有';
  const second = await executePlan(secondArgs);

  await assert.rejects(
    () => executeDecide({
      dir, book: BOOK, chapter: 2, id: second.ids[0], choice: '拍卖会竞价拍下',
    }),
    (error) => error.code === 'canon-conflict',
  );

  const custom = await executeDecide({
    dir, book: BOOK, chapter: 2, id: second.ids[0],
    choice: '捞上来后当掉',
    changes: [{
      entity: '玉佩', key: '位置', from: '河底', to: '当铺', evidence: ['当铺'],
    }],
  });
  assert.equal(custom.remaining, 0);

  const chapter2 = await executeList({ dir, book: BOOK, chapter: 2 });
  assert.equal(chapter2.decisions[0].choice, '捞上来后当掉');

  const superseded = await executeAdjust({
    dir, book: BOOK, action: 'supersede', id: first.ids[0], reason: '作者改主意，不设这个节点',
  });
  assert.equal(superseded.status, 'superseded');
  assert.equal(superseded.removedCanon, 1);

  const gate = await executeGate({ dir, book: BOOK, chapter: 1 });
  assert.equal(gate.pass, false);
});

test('verify 失败不改章节；strict:false 降级；path 只读工作区', async (t) => {
  const dir = await tempDir(t);
  const planned = await executePlan(planArgs(dir));
  await executeDecide({
    dir, book: BOOK, chapter: 1, id: planned.ids[0], choice: '拍卖会竞价拍下',
  });

  const missing = await executeVerify({
    dir, book: BOOK, chapter: 1, text: '他走进拍卖行，找了个位置坐下。',
  });
  assert.equal(missing.pass, false);
  assert.ok(missing.failures.some((failure) => failure.code === 'missing-change'));

  const forbidden = await executeVerify({
    dir, book: BOOK, chapter: 1, text: '落槌，钱袋空了。有人当众揭穿了他。',
  });
  assert.equal(forbidden.pass, false);
  assert.ok(forbidden.failures.some((failure) => failure.code === 'forbidden-hit'));

  const lenient = await executeVerify({
    dir, book: BOOK, chapter: 1, text: '他走进拍卖行。', strict: false,
  });
  assert.equal(lenient.pass, true);
  assert.ok(lenient.warnings.some((warning) => warning.startsWith('missing-change:')));

  await writeFile(join(dir, 'chapter1.md'), '拍卖师落槌。玉佩归他。钱袋空了。', 'utf8');
  const byPath = await executeVerify({ dir, book: BOOK, chapter: 1, path: 'chapter1.md' });
  assert.equal(byPath.pass, true);
  assert.equal(byPath.verified, true);

  const outside = await mkdtemp(join(tmpdir(), 'novel-beat-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'outside.md'), '落槌，钱袋空了。', 'utf8');
  await assert.rejects(
    () => executeVerify({ dir, book: BOOK, chapter: 1, path: join(outside, 'outside.md') }),
    (error) => error.code === 'path-outside',
  );

  await assert.rejects(
    () => executeVerify({ dir, book: BOOK, chapter: 1, text: 'x', path: 'chapter1.md' }),
    (error) => error.code === 'bad-args',
  );
});

test('到期义务：warning → waive；已回收义务不能 waive', async (t) => {
  const dir = await tempDir(t);
  const args = planArgs(dir);
  args.beats[0].options[0].obligations[0].dueChapter = 1;
  const planned = await executePlan(args);
  await executeDecide({
    dir, book: BOOK, chapter: 1, id: planned.ids[0], choice: '拍卖会竞价拍下',
  });

  const warned = await executeVerify({
    dir, book: BOOK, chapter: 1, text: '落槌，钱袋空了。',
  });
  assert.equal(warned.pass, true);
  assert.ok(warned.warnings.some((warning) => warning.startsWith('obligation-due:ob1')));

  const waived = await executeAdjust({
    dir, book: BOOK, action: 'waive', id: 'ob1', reason: '这条伏笔不要了',
  });
  assert.equal(waived.status, 'waived');
  const again = await executeAdjust({
    dir, book: BOOK, action: 'waive', id: 'ob1', reason: '再次确认',
  });
  assert.equal(again.already, true);

  const dir2 = await tempDir(t);
  const args2 = planArgs(dir2);
  args2.beats[0].options[0].obligations[0].dueChapter = 1;
  const planned2 = await executePlan(args2);
  await executeDecide({
    dir: dir2, book: BOOK, chapter: 1, id: planned2.ids[0], choice: '拍卖会竞价拍下',
  });
  const paid = await executeVerify({
    dir: dir2, book: BOOK, chapter: 1, text: '落槌，钱袋空了。出价人记恨地看他。',
  });
  assert.equal(paid.pass, true);
  assert.deepEqual(paid.paidObligationIds, ['ob1']);
  await assert.rejects(
    () => executeAdjust({ dir: dir2, book: BOOK, action: 'waive', id: 'ob1', reason: '想撤' }),
    (error) => error.code === 'already-paid',
  );
});

test('没有账本时的错误边界', async (t) => {
  const dir = await tempDir(t);

  const listed = await executeList({ dir, book: BOOK });
  assert.equal(listed.exists, false);
  assert.ok(listed.warnings.includes('no-book'));

  const gate = await executeGate({ dir, book: BOOK, chapter: 1 });
  assert.equal(gate.pass, false);
  assert.ok(gate.warnings.includes('no-book'));

  await assert.rejects(
    () => executeCompile({ dir, book: BOOK, chapter: 1 }),
    (error) => error.code === 'no-book',
  );
  await assert.rejects(
    () => executeVerify({ dir, book: BOOK, chapter: 1, text: '正文' }),
    (error) => error.code === 'no-book',
  );
});
