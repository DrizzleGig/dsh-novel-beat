import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  executePlan,
  executeDecide,
  executeGate,
  executeCompile,
  executeVerify,
  executeList,
} from '../lib/tools.js';

const BOOK = '三章测试';

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-e2e-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function dealArgs(dir, chapter) {
  return {
    dir,
    book: BOOK,
    chapter,
    beats: [{
      title: '玉佩怎么到手',
      kind: '得失',
      change: '玉佩 从 拍卖品 变成 林砚持有',
      options: [{
        label: '拍卖会竞价拍下',
        impact: '花钱得玉，得罪同场出价人',
        changes: [{
          entity: '玉佩', key: '持有者', from: '拍卖品', to: '林砚', evidence: ['落槌'],
        }],
        obligations: [{
          text: '同场出价人记恨林砚', dueChapter: 3, evidence: ['出价人'],
        }],
      }, {
        label: '黑市捡漏',
        impact: '同样拿到玉佩，但欠中间人一个人情',
        changes: [{
          entity: '玉佩', key: '持有者', from: '拍卖品', to: '林砚', evidence: ['黑市'],
        }, {
          entity: '林砚', key: '人情', from: '无', to: '欠中间人', evidence: ['中间人'],
        }],
      }],
    }],
  };
}

test('三章端到端：canon 跨章可见，到期义务在第三章被兑现', async (t) => {
  const dir = await tempDir(t);

  // 第 1 章：玉佩到手，埋下「出价人记恨」义务（第 3 章到期）。
  const ch1 = await executePlan(dealArgs(dir, 1));
  await executeDecide({
    dir, book: BOOK, chapter: 1, id: ch1.ids[0], choice: '拍卖会竞价拍下',
  });
  assert.equal((await executeGate({ dir, book: BOOK, chapter: 1 })).pass, true);
  const ch1Text = await executeCompile({ dir, book: BOOK, chapter: 1 });
  assert.match(ch1Text.markdown, /玉佩\.持有者：拍卖品 → 林砚/);
  assert.equal((await executeVerify({
    dir, book: BOOK, chapter: 1, text: '拍卖师落槌，玉佩归了林砚。',
  })).pass, true);

  // 第 2 章：旧敌认出林砚，写进 canon。
  const ch2 = await executePlan({
    dir, book: BOOK, chapter: 2,
    beats: [{
      title: '旧敌是否认出他',
      kind: '知情',
      change: '旧敌 从 不知情 变成 认出林砚',
      options: [{
        label: '认出但不说破',
        impact: '旧敌暗中记下纹样，后续设局',
        changes: [{
          entity: '旧敌', key: '认知', from: '不知情', to: '认出林砚', evidence: ['袖口'],
        }],
      }, {
        label: '当场叫破',
        impact: '旧敌当众发难，林砚被迫提前摊牌',
        changes: [{
          entity: '旧敌', key: '认知', from: '不知情', to: '当场叫破', evidence: ['当场'],
        }],
      }],
    }],
  });
  await executeDecide({
    dir, book: BOOK, chapter: 2, id: ch2.ids[0], choice: '认出但不说破',
  });
  assert.equal((await executeVerify({
    dir, book: BOOK, chapter: 2, text: '旧敌盯着他袖口的纹样，认出了他。',
  })).pass, true);

  // 第 3 章：plan 的 context 必须带出前两章的 canon 和到期义务。
  const ch3 = await executePlan({
    dir, book: BOOK, chapter: 3,
    beats: [{
      title: '玉佩怎么出手',
      kind: '得失',
      change: '玉佩 从 林砚持有 变成 当铺',
      options: [{
        label: '当掉换钱',
        impact: '解一时之急，但玉佩落入当铺',
        changes: [{
          entity: '玉佩', key: '持有者', from: '林砚', to: '当铺', evidence: ['当票'],
        }],
      }, {
        label: '抵押给当铺',
        impact: '暂时不卖断，留了赎回的后路',
        changes: [{
          entity: '玉佩', key: '持有者', from: '林砚', to: '抵押', evidence: ['抵押'],
        }],
      }],
    }],
  });
  assert.equal(ch3.context.canon.length, 1);
  assert.equal(ch3.context.canon[0].entity, '玉佩');
  assert.ok(ch3.context.obligations.some((obligation) => obligation.id === 'ob1' && obligation.overdue));

  await executeDecide({
    dir, book: BOOK, chapter: 3, id: ch3.ids[0], choice: '当掉换钱',
  });
  const compiled = await executeCompile({ dir, book: BOOK, chapter: 3 });
  assert.match(compiled.markdown, /## 本章必须回应的既有义务/);
  assert.match(compiled.markdown, /ob1 同场出价人记恨林砚（第 3 章前；证据：出价人）/);

  const verified = await executeVerify({
    dir, book: BOOK, chapter: 3,
    text: '他走进当铺，把玉佩拍在柜台上。当票开出来。柜台后的出价人认出了他。',
  });
  assert.equal(verified.pass, true);
  assert.deepEqual(verified.paidObligationIds, ['ob1']);

  const context = await executeList({ dir, book: BOOK, context: true });
  assert.equal(context.context.canon.length, 2);
  assert.equal(context.context.obligations.length, 0);

  const overview = await executeList({ dir, book: BOOK });
  assert.equal(overview.chapters, 3);
  assert.equal(overview.openObligations, 0);
});
