import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyChapter } from '../lib/verify.js';

const decided = {
  id: 'b1-1',
  chapter: 1,
  title: '玉佩怎么到手',
  kind: '得失',
  change: '玉佩 从 拍卖品 变成 林砚持有',
  status: 'decided',
  legacy: false,
  chosen: {
    label: '拍卖会竞价拍下',
    changes: [
      { entity: '玉佩', key: '持有者', from: '拍卖行', to: '林砚', evidence: ['落槌', '玉佩归他'] },
      { entity: '林砚', key: '现银', from: '充足', to: '见底', evidence: ['钱袋空了'] },
    ],
    forbidden: ['当众揭穿'],
  },
};

const make = ({ decision = decided, obligations = [] } = {}) => ({
  decisions: [decision],
  obligations,
  canon: [],
});

test('证据齐全 + 到期义务回应 → pass', () => {
  const data = make({
    obligations: [{
      id: 'ob1', text: '同场出价人记恨林砚', dueChapter: 1, status: 'open',
      evidence: ['出价人', '记恨'], sourceDecision: 'b1-1',
    }],
  });
  const result = verifyChapter(data, 1, '拍卖师落槌，玉佩归他。钱袋空了。旁边的出价人记恨地看了他一眼。');

  assert.equal(result.pass, true);
  assert.equal(result.failures.length, 0);
  assert.equal(result.stats.covered, 2);
  assert.equal(result.stats.obligationsDue, 1);
  assert.deepEqual(result.paidObligationIds, ['ob1']);
});

test('缺证据 → missing-change failure', () => {
  const result = verifyChapter(make(), 1, '他走进拍卖行，找了个位置坐下。');

  assert.equal(result.pass, false);
  assert.equal(result.failures.length, 2);
  assert.ok(result.failures.every((failure) => failure.code === 'missing-change'));
  assert.equal(result.stats.covered, 0);
});

test('只出现结果值 → 通过但带 weak-evidence warning', () => {
  const result = verifyChapter(make(), 1, '玉佩归林砚，他的现银见底了。');

  assert.equal(result.pass, true);
  assert.equal(result.stats.covered, 2);
  assert.equal(result.warnings.filter((warning) => warning.startsWith('weak-evidence:')).length, 2);
});

test('命中禁项 → forbidden-hit failure', () => {
  const result = verifyChapter(make(), 1, '落槌，钱袋空了。有人当众揭穿了他。');

  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.code === 'forbidden-hit'));
});

test('未拍板 → not-decided failure', () => {
  const pending = { ...decided, status: 'pending', chosen: null };
  const result = verifyChapter(make({ decision: pending }), 1, '随便写点。');

  assert.equal(result.pass, false);
  assert.equal(result.failures[0].code, 'not-decided');
});

test('没有决策点 → no-decisions failure', () => {
  const result = verifyChapter({ decisions: [], obligations: [], canon: [] }, 1, '随便写点。');

  assert.equal(result.pass, false);
  assert.equal(result.failures[0].code, 'no-decisions');
});

test('strict:false 时缺证据降级为 warning 仍然 pass', () => {
  const result = verifyChapter(make(), 1, '他走进拍卖行。', { strict: false });

  assert.equal(result.pass, true);
  assert.equal(result.warnings.filter((warning) => warning.startsWith('missing-change:')).length, 2);
});

test('legacy 决策跳过严格校验，只留 warning', () => {
  const legacy = { ...decided, legacy: true };
  const result = verifyChapter(make({ decision: legacy }), 1, '什么都没写。');

  assert.equal(result.pass, true);
  assert.ok(result.warnings.some((warning) => warning.startsWith('legacy-weak:')));
});

test('到期义务没有证据 → obligation-due warning，不阻塞 pass', () => {
  const data = make({
    obligations: [{
      id: 'ob1', text: '同场出价人记恨林砚', dueChapter: 1, status: 'open',
      evidence: ['出价人'], sourceDecision: 'b1-1',
    }],
  });
  const result = verifyChapter(data, 1, '落槌，钱袋空了。');

  assert.equal(result.pass, true);
  assert.ok(result.warnings.some((warning) => warning.startsWith('obligation-due:ob1')));
  assert.deepEqual(result.paidObligationIds, []);
});

test('未到期义务不计入 obligationsDue', () => {
  const data = make({
    obligations: [{
      id: 'ob2', text: '三个月后回访', dueChapter: 5, status: 'open',
      evidence: ['回访'], sourceDecision: 'b1-1',
    }],
  });
  const result = verifyChapter(data, 1, '落槌，钱袋空了。');

  assert.equal(result.stats.obligationsDue, 0);
  assert.deepEqual(result.paidObligationIds, []);
});

test('空白差异不影响证据匹配', () => {
  const result = verifyChapter(make(), 1, '落 槌\n\n钱袋  空了');

  assert.equal(result.pass, true);
  assert.equal(result.stats.covered, 2);
});
