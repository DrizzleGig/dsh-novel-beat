import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executeAppend, executeFinish } from '../lib/segment-loop.js';
import { executeNext, executePlan, executeRevert, executeSegment, executeVerify, toolDefinitions } from '../lib/tools.js';
import { assertParameterSchema } from '../lib/tool-schema.mjs';
import { readBookData } from '../lib/store.js';

const BOOK = '循环夹具';
const AGENT = { id: 'segment-loop-test' };

async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-loop-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function revision(dir) {
  const { data } = await readBookData(dir, BOOK);
  return data?.revision ?? 0;
}

async function append(dir, text, operationId, chapter = 1) {
  const result = await executeAppend({
    dir, book: BOOK, chapter, text, operationId, expectedRevision: await revision(dir),
  }, { segmentLoop: true });
  const segment = result.segment ?? result;
  return { ...result, ...segment, segmentId: segment.id ?? result.segmentId, chapter, text };
}

function beat(title = '是否告知林青') {
  return {
    title,
    kind: '分叉',
    change: `${title}会改变后续走向`,
    options: [
      {
        label: '暂时隐瞒', impact: '避免立刻牵连林青',
        changes: [{ entity: title, key: '处理方式', from: '未定', to: '暂缓', evidence: ['谈话', '隐瞒'] }],
      },
      {
        label: '现在告知', impact: '林青也会被卷入',
        changes: [{ entity: title, key: '处理方式', from: '未定', to: '告知', evidence: ['说明', '知情'] }],
      },
    ],
  };
}

async function scan(dir, segment, { decision = false, title } = {}) {
  const result = await executePlan({
    dir,
    book: BOOK,
    chapter: segment.chapter ?? 1,
    expectedRevision: await revision(dir),
    segmentId: segment.segmentId ?? segment.id,
    segmentHash: segment.textHash ?? segment.textHash,
    beats: decision ? [beat(title)] : [],
    ...(decision ? {} : { reason: '这一段只交代已经发生的行动，没有新增状态分叉。' }),
  }, { segmentLoop: true });
  return result;
}

async function choose(dir, id, label = '暂时隐瞒') {
  return executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, {
    segmentLoop: true,
    ask: async (request) => ({
      answers: request.questions.map((question) => ({ id: question.id, selected: [label] })),
    }),
  });
}

async function emptyCheckedSegment(dir, text, operationId) {
  const segment = await append(dir, text, operationId);
  const checked = await scan(dir, segment);
  return { segment, checked };
}

async function makeThreeSegmentDecisionLoop(dir) {
  const first = await append(dir, '门外的灯闪了一下。', 'append-1');
  const plan1 = await scan(dir, first, { decision: true, title: '要不要告诉林青' });
  const decision1 = plan1.ids[0];
  await choose(dir, decision1, '暂时隐瞒');
  const second = await append(dir, '沈砚把话咽了回去。', 'append-2');

  const plan2 = await scan(dir, second, { decision: true, title: '是否立刻离开' });
  const decision2 = plan2.ids[0];
  await choose(dir, decision2, '现在告知');
  const third = await append(dir, '楼道里传来渐远的脚步声。', 'append-3');
  const plan3 = await scan(dir, third);
  return { first, second, third, plan1, plan2, plan3, decision1, decision2 };
}

test('三段、两次作者拍板、末段空扫描后按序合并并返回稳定 hash', async (t) => {
  const dir = await workspace(t);
  const chain = await makeThreeSegmentDecisionLoop(dir);
  const before = await readBookData(dir, BOOK);
  const expected = [chain.first, chain.second, chain.third]
    .map((segment) => segment.text)
    .join('\n\n');

  const merged = await executeFinish({
    dir, book: BOOK, chapter: 1, expectedRevision: before.data.revision,
  }, { segmentLoop: true });
  const receipt = merged.receipt ?? merged;

  assert.equal(merged.text, expected);
  assert.deepEqual(receipt.orderedSegmentIds ?? receipt.segmentIds,
    [chain.first.segmentId, chain.second.segmentId, chain.third.segmentId]);
  assert.equal(receipt.chapterHash, createHash('sha256').update(expected, 'utf8').digest('hex'));
  assert.equal(receipt.charCount, Array.from(expected).length);
  assert.equal(receipt.sourceRevision, before.data.revision);
  assert.equal(receipt.status, 'merged');
  assert.equal(receipt.separator, '\n\n');
  assert.match(chain.first.textRef, /^segments\//);
  const ledgerDir = join(dir, '.dsh-novel-beat', BOOK);
  assert.deepEqual((await readdir(join(ledgerDir, 'segments'))).sort(), ['s-0001.txt', 's-0002.txt', 's-0003.txt']);
  await assert.rejects(access(join(dir, '正文')));
});

test('每个追加段落必须先有扫描收据；拒绝时 revision 和段数不变', async (t) => {
  const dir = await workspace(t);
  await append(dir, '第一段。', 'missing-check-1');
  const before = await readBookData(dir, BOOK);
  await assert.rejects(
    append(dir, '第二段。', 'missing-check-2'),
    (error) => error.code === 'segment-check-required',
  );
  const after = await readBookData(dir, BOOK);
  assert.equal(after.data.revision, before.data.revision);
  assert.equal(after.data.segments.length, before.data.segments.length);
});

test('发现待拍板决策后必须等作者选择才可追加', async (t) => {
  const dir = await workspace(t);
  const first = await append(dir, '她握住门把。', 'pending-1');
  await scan(dir, first, { decision: true });
  const before = await readBookData(dir, BOOK);
  await assert.rejects(
    append(dir, '她推门走了进去。', 'pending-2'),
    (error) => error.code === 'pending-decision',
  );
  assert.equal((await readBookData(dir, BOOK)).data.revision, before.data.revision);

  const { data } = before;
  const decision = data.decisions.find((entry) => entry.chapter === 1 && entry.status !== 'superseded');
  assert.ok(decision);
  await choose(dir, decision.id);
  const second = await append(dir, '她推门走了进去。', 'pending-2');
  assert.equal(second.seq, 2);
  assert.deepEqual(second.decisionIds, [decision.id]);
});

test('beats:[] 必须有理由，且检查收据绑定段 ID、hash 和 revision', async (t) => {
  const dir = await workspace(t);
  const first = await append(dir, '雨停了。', 'scan-receipt-1');
  await assert.rejects(executePlan({
    dir, book: BOOK, chapter: 1,
    expectedRevision: await revision(dir),
    segmentId: first.segmentId, segmentHash: first.textHash,
    beats: [], reason: ' ',
  }, { segmentLoop: true }), (error) => error.code === 'no-reason');

  await scan(dir, first);
  const { data } = await readBookData(dir, BOOK);
  const stored = data.segments.find((entry) => entry.id === first.segmentId);
  assert.equal(stored.scanReceipt.segmentId, first.segmentId);
  assert.equal(stored.scanReceipt.segmentHash, first.textHash);
  assert.equal(stored.scanReceipt.result, 'no-candidate');
  assert.ok(Number.isInteger(stored.scanReceipt.baseRevision));
});

test('段后扫描必须绑定当前 revision、segmentId 和 SHA-256', async (t) => {
  const dir = await workspace(t);
  const segment = await append(dir, '墙上的钟停了。', 'scan-binding');
  const actualRevision = await revision(dir);
  const plan = {
    dir, book: BOOK, chapter: 1, beats: [beat()], append: true,
    segmentId: segment.segmentId, segmentHash: segment.textHash,
  };
  await assert.rejects(executePlan({ ...plan, expectedRevision: actualRevision - 1 }, { segmentLoop: true }),
    (error) => error.code === 'revision-conflict');
  await assert.rejects(executePlan({ ...plan, expectedRevision: actualRevision, segmentHash: '0'.repeat(64) }, { segmentLoop: true }),
    (error) => error.code === 'revision-conflict');
  await assert.rejects(executePlan({ ...plan, expectedRevision: actualRevision, segmentId: 's-9999' }, { segmentLoop: true }),
    (error) => error.code === 'revision-conflict');
  assert.equal(await revision(dir), actualRevision, '三种陈旧扫描输入均不得写账本');
});

test('仅接受一个非空自然段：空白与各种换行均拒绝且不落账', async (t) => {
  const invalid = ['', ' \t ', '一段。\n第二段。', '一段。\r\n第二段。', '一段。\r第二段。', '一段。\u2028第二段。', '一段。\u2029第二段。'];
  for (const text of invalid) {
    await t.test(JSON.stringify(text), async (st) => {
      const dir = await workspace(st);
      await assert.rejects(
        append(dir, text, `invalid-${Buffer.from(text).toString('hex') || 'empty'}`),
        (error) => error.code === 'one-paragraph-only',
      );
      const { data } = await readBookData(dir, BOOK);
      assert.equal(data, null, '非法输入不得创建账本');
    });
  }
});

test('实验模式的工具说明和等待错误指向 beat_append，legacy 文案保持不变', async (t) => {
  const loopTools = toolDefinitions({ segmentLoop: true });
  const legacyTools = toolDefinitions();
  assert.equal(loopTools.length, 13);
  assert.equal(legacyTools.length, 11);
  assert.ok(loopTools.some((tool) => tool.name === 'beat_append'));
  assert.ok(loopTools.some((tool) => tool.name === 'beat_finish'));
  assert.ok(!legacyTools.some((tool) => tool.name === 'beat_append' || tool.name === 'beat_finish'));
  for (const tool of loopTools) assertParameterSchema(tool.name, tool.parameters);
  const loopPlan = loopTools.find((tool) => tool.name === 'beat_plan');
  const loopNext = loopTools.find((tool) => tool.name === 'beat_next');
  assert.match(loopPlan.description, /beat_append/);
  assert.match(loopNext.description, /beat_append/);
  assert.doesNotMatch(loopPlan.description, /beat_segment/);
  assert.doesNotMatch(loopNext.description, /beat_segment/);
  assert.match(legacyTools.find((tool) => tool.name === 'beat_plan').description, /beat_segment/);

  const dir = await workspace(t);
  const segment = await append(dir, '她把信封收进袖中。', 'wait-for-output');
  const planned = await scan(dir, segment, { decision: true });
  await choose(dir, planned.ids[0]);
  await assert.rejects(
    executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, {
      segmentLoop: true,
      ask: async () => ({ answers: [] }),
    }),
    (error) => error.code === 'segment-required' && /beat_append/.test(error.message)
      && !/beat_segment/.test(error.message),
  );
});

test('Unicode code point 字符数准确，原文本不 trim 或改写', async (t) => {
  const dir = await workspace(t);
  const text = '  星𠮷与🙂。  ';
  const result = await append(dir, text, 'unicode-count');
  assert.equal(result.charCount, Array.from(text).length);
  assert.equal(result.textHash, createHash('sha256').update(text, 'utf8').digest('hex'));
  assert.equal(result.text, text);
});

test('相同 operationId 和 payload 重放原 receipt；payload 不同则冲突', async (t) => {
  const dir = await workspace(t);
  const first = await append(dir, '雾从桥面升起。', 'retry-same');
  const afterFirst = await revision(dir);
  const replay = await executeAppend({
    dir, book: BOOK, chapter: 1, text: '雾从桥面升起。',
    operationId: 'retry-same', expectedRevision: 0,
  }, { segmentLoop: true });
  assert.equal(replay.segmentId, first.segmentId);
  assert.deepEqual(replay.receipt ?? replay, first.receipt ?? first);
  assert.equal(await revision(dir), afterFirst);

  await assert.rejects(
    executeAppend({
      dir, book: BOOK, chapter: 1, text: '雾从桥面散去。',
      operationId: 'retry-same', expectedRevision: 0,
    }, { segmentLoop: true }),
    (error) => error.code === 'idempotency-conflict',
  );
  assert.equal(await revision(dir), afterFirst);
});

test('operationId 全书唯一：同 ID 异章不能被当作成功重放', async (t) => {
  const dir = await workspace(t);
  await append(dir, '第一章段落。', 'global-operation');
  await assert.rejects(
    executeAppend({
      dir, book: BOOK, chapter: 2, text: '第二章段落。',
      operationId: 'global-operation', expectedRevision: await revision(dir),
    }, { segmentLoop: true }),
    (error) => error.code === 'idempotency-conflict',
  );
});

test('expectedRevision 漂移时 fail closed，且不得增加段落或 revision', async (t) => {
  const dir = await workspace(t);
  const stale = await revision(dir);
  await append(dir, '先登记第一段。', 'revision-first');
  await assert.rejects(executeAppend({
    dir, book: BOOK, chapter: 1, text: '陈旧调用不能覆盖状态。',
    operationId: 'revision-stale', expectedRevision: stale,
  }, { segmentLoop: true }), (error) => error.code === 'revision-conflict');
  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.segments.length, 1);
});

test('finish 在缺段检查或待选择时拒绝；不生成 merge receipt', async (t) => {
  await t.test('缺检查', async (st) => {
    const dir = await workspace(st);
    await append(dir, '尚未检查。', 'finish-unchecked');
    await assert.rejects(executeFinish({
      dir, book: BOOK, chapter: 1, expectedRevision: await revision(dir),
    }, { segmentLoop: true }), (error) => error.code === 'segment-check-required');
  });
  await t.test('待拍板', async (st) => {
    const dir = await workspace(st);
    const first = await append(dir, '门外有人。', 'finish-pending');
    await scan(dir, first, { decision: true });
    await assert.rejects(executeFinish({
      dir, book: BOOK, chapter: 1, expectedRevision: await revision(dir),
    }, { segmentLoop: true }), (error) => error.code === 'pending-decision');
  });
});

test('finish 后相同 source revision 重放同一 receipt，不重复改变账本', async (t) => {
  const dir = await workspace(t);
  const { segment } = await emptyCheckedSegment(dir, '结尾已经收束。', 'finish-idempotent');
  const sourceRevision = await revision(dir);
  const first = await executeFinish({
    dir, book: BOOK, chapter: 1, expectedRevision: sourceRevision,
  }, { segmentLoop: true });
  const afterFirst = await revision(dir);
  const second = await executeFinish({
    dir, book: BOOK, chapter: 1, expectedRevision: sourceRevision,
  }, { segmentLoop: true });
  assert.deepEqual(second.receipt ?? second, first.receipt ?? first);
  assert.equal(second.text, first.text);
  assert.equal(await revision(dir), afterFirst);
  assert.equal((await readBookData(dir, BOOK)).data.segments[0].id, segment.segmentId);
  await assert.rejects(append(dir, '合并后不能偷偷续写。', 'after-merge'),
    (error) => error.code === 'chapter-already-merged');
});

test('beat_verify 在 finish 前拒绝；合并后验证精确文本，漂移时不盖章', async (t) => {
  const dir = await workspace(t);
  const first = await append(dir, '谈话时他选择隐瞒。', 'verify-loop-1');
  const plan = await scan(dir, first, { decision: true });
  await choose(dir, plan.ids[0], '暂时隐瞒');
  const second = await append(dir, '人群散去。', 'verify-loop-2');
  await scan(dir, second);
  await assert.rejects(executeVerify({
    dir, book: BOOK, chapter: 1, text: `${first.text}\n\n${second.text}`,
  }, { segmentLoop: true }), (error) => error.code === 'not-merged');

  const finished = await executeFinish({
    dir, book: BOOK, chapter: 1, expectedRevision: await revision(dir),
  }, { segmentLoop: true });
  const drifted = await executeVerify({ dir, book: BOOK, chapter: 1, text: `${finished.text}多出一个字` }, { segmentLoop: true })
    .catch((error) => error);
  assert.equal(drifted.code, 'merge-mismatch');
  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.chapters['1']?.verifiedAt, null, '漂移后不可留下 verified 标记');
  const exact = await executeVerify({ dir, book: BOOK, chapter: 1, text: finished.text }, { segmentLoop: true });
  assert.equal(exact.verified, true);
});

test('回退到第 2 段保留第 1 段、清除后缀检查和 merge，再追加新版本', async (t) => {
  const dir = await workspace(t);
  const one = await emptyCheckedSegment(dir, '保留的第一段。', 'revert-1');
  const two = await emptyCheckedSegment(dir, '应当回退的第二段。', 'revert-2');
  const three = await emptyCheckedSegment(dir, '应当回退的第三段。', 'revert-3');
  await executeFinish({ dir, book: BOOK, chapter: 1, expectedRevision: await revision(dir) }, { segmentLoop: true });

  const reverted = await executeRevert({
    dir, book: BOOK, chapter: 1, segment: two.segment.segmentId,
    expectedRevision: await revision(dir), reason: '作者要求从第二段重写。',
  }, { segmentLoop: true });
  assert.equal(reverted.reverted?.targetSegmentId, two.segment.segmentId);

  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.segments.find((entry) => entry.id === one.segment.segmentId).status, 'committed');
  assert.equal(data.segments.find((entry) => entry.id === two.segment.segmentId).status, 'reverted');
  assert.equal(data.segments.find((entry) => entry.id === three.segment.segmentId).status, 'reverted');
  assert.ok(!data.chapters['1'].mergeReceipt, '回退后必须清掉旧 merge receipt');

  const newTwo = await append(dir, '重新写过的第二段。', 'revert-2-new');
  await scan(dir, newTwo);
  const merge = await executeFinish({
    dir, book: BOOK, chapter: 1, expectedRevision: await revision(dir),
  }, { segmentLoop: true });
  assert.equal(merge.text, `${one.segment.text}\n\n${newTwo.text}`);
});

test('loop 章和 legacy beat_segment 双向拒绝混用，旧区间语义不变', async (t) => {
  await t.test('legacy 章拒绝 append', async (st) => {
    const dir = await workspace(st);
    await executePlan({ dir, book: BOOK, chapter: 1, beats: [beat('legacy setup')] });
    await assert.rejects(append(dir, '不允许切换模式。', 'legacy-to-loop'),
      (error) => error.code === 'chapter-already-merged' || error.code === 'chapter-mode-conflict');
  });
  await t.test('loop 章拒绝 legacy segment', async (st) => {
    const dir = await workspace(st);
    await append(dir, 'loop 段落。', 'loop-to-legacy');
    await mkdir(join(dir, '正文'), { recursive: true });
    const file = join(dir, '正文', '第1章.md');
    await writeFile(file, 'legacy 正文。', 'utf8');
    await assert.rejects(executeSegment({
      dir, book: BOOK, chapter: 1, file, decisionIds: [], excerpt: 'legacy 正文。',
    }), (error) => error.code === 'chapter-already-merged' || error.code === 'chapter-mode-conflict');
  });
});

test('实验开关关闭时新工具返回 feature-disabled，且不创建账本', async (t) => {
  const dir = await workspace(t);
  await assert.rejects(executeAppend({
    dir, book: BOOK, chapter: 1, text: '开关已关闭。',
    operationId: 'disabled', expectedRevision: 0,
  }), (error) => error.code === 'feature-disabled');
  assert.equal((await readBookData(dir, BOOK)).data, null);

  const active = await append(dir, '已启用切片创建的实验章。', 'disabled-generic-tool');
  await assert.rejects(executePlan({
    dir, book: BOOK, chapter: 1, beats: [], reason: '当前段没有剧情分叉。',
    expectedRevision: await revision(dir), segmentId: active.segmentId, segmentHash: active.textHash,
  }), (error) => error.code === 'feature-disabled');
  await assert.rejects(executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, {
    ask: async () => { throw new Error('disabled feature must not ask'); },
  }), (error) => error.code === 'feature-disabled');
  await assert.rejects(executeVerify({ dir, book: BOOK, chapter: 1, text: active.text }),
    (error) => error.code === 'feature-disabled');
  await assert.rejects(executeRevert({ dir, book: BOOK, chapter: 1, segment: active.segmentId, expectedRevision: await revision(dir) }),
    (error) => error.code === 'feature-disabled');
});

test('重启后重放 append 返回已落盘 receipt，不重复写段或提升 revision', async (t) => {
  const dir = await workspace(t);
  const first = await append(dir, '进程重启后仍能识别此操作。', 'restart-operation');
  const revisionAfterWrite = await revision(dir);
  const moduleUrl = new URL('../lib/segment-loop.js', import.meta.url).href;
  const script = `
    const { executeAppend } = await import(${JSON.stringify(moduleUrl)});
    const result = await executeAppend({
      dir: process.env.LOOP_FIXTURE_DIR, book: ${JSON.stringify(BOOK)}, chapter: 1,
      text: '进程重启后仍能识别此操作。', operationId: 'restart-operation', expectedRevision: 0
    }, { segmentLoop: true });
    process.stdout.write(JSON.stringify(result));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: dir,
    env: { ...process.env, LOOP_FIXTURE_DIR: dir },
    encoding: 'utf8',
  });
  assert.equal(child.status, 0, child.stderr);
  const replay = JSON.parse(child.stdout);
  assert.equal(replay.segmentId, first.segmentId);
  assert.equal(await revision(dir), revisionAfterWrite);
  assert.equal((await readBookData(dir, BOOK)).data.segments.length, 1);
});

test('同一 expectedRevision 的并发追加只有一个提交成功', async (t) => {
  const dir = await workspace(t);
  const first = await append(dir, '并发前的段落。', 'concurrency-first');
  await scan(dir, first);
  const expectedRevision = await revision(dir);
  const outcomes = await Promise.allSettled(['race-a', 'race-b'].map((operationId) => executeAppend({
    dir, book: BOOK, chapter: 1, text: `并发候选 ${operationId}。`, operationId, expectedRevision,
  }, { segmentLoop: true })));
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((item) => item.status === 'rejected').length, 1);
  const error = outcomes.find((item) => item.status === 'rejected').reason;
  assert.ok(['revision-conflict', 'segment-check-required'].includes(error.code));
  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.segments.filter((entry) => entry.status !== 'reverted').length, 2);
});
