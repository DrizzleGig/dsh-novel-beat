import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompile } from '../lib/compile.js';

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
  options: [],
};

const base = (decisions = [decided], obligations = [], canon = []) => ({
  decisions,
  obligations,
  canon,
});

test('self compile 产出约束、证据、禁项和 canon', () => {
  const canon = [
    { entity: '玉佩', key: '持有者', value: '林砚', chapter: 1, decisionId: 'b1-1' },
  ];
  const result = buildCompile(base([decided], [], canon), 1);

  assert.match(result.markdown, /## 本章决策约束/);
  assert.match(result.markdown, /### b1-1 玉佩怎么到手/);
  assert.match(result.markdown, /已拍板：拍卖会竞价拍下/);
  assert.match(result.markdown, /玉佩\.持有者：拍卖行 → 林砚（证据：落槌、玉佩归他）/);
  assert.match(result.markdown, /不得出现：当众揭穿/);
  assert.match(result.markdown, /## 全书 canon（不得违反）/);
  assert.match(result.markdown, /玉佩\.持有者 = 林砚（第 1 章）/);
  assert.equal(result.contract.chapter, 1);
  assert.equal(result.contract.decisions[0].changes.length, 2);
  assert.deepEqual(result.missing, []);
});

test('有未拍板时只返回 missing，不产出 markdown', () => {
  const pending = { ...decided, status: 'pending', chosen: null };
  const result = buildCompile(base([pending]), 1);

  assert.equal(result.markdown, '');
  assert.equal(result.contract, null);
  assert.deepEqual(result.missing, [{ id: 'b1-1', title: '玉佩怎么到手' }]);
});

test('本章没有决策点时给 no-decisions warning', () => {
  const result = buildCompile(base([]), 1);

  assert.equal(result.markdown, '');
  assert.equal(result.contract, null);
  assert.match(result.warnings[0], /^no-decisions:/);
});

test('forge 兼容格式带旧标题和废弃 warning', () => {
  const result = buildCompile(base([decided]), 1, 'novel-forge');

  assert.match(result.markdown, /## 本章必写场景/);
  assert.match(result.markdown, /## 本章禁止偏离项/);
  assert.match(result.markdown, /不得改写已拍板决策：玉佩怎么到手 → 拍卖会竞价拍下/);
  assert.ok(result.warnings.some((warning) => warning.includes('novel-forge 格式已废弃')));
});

test('到期的义务进入编译，未到期的不进入', () => {
  const obligations = [
    { id: 'ob1', text: '同场出价人记恨林砚', dueChapter: 1, status: 'open', evidence: ['出价人'], sourceDecision: 'b1-1' },
    { id: 'ob2', text: '三个月后回访', dueChapter: 5, status: 'open', evidence: ['回访'], sourceDecision: 'b1-1' },
  ];
  const result = buildCompile(base([decided], obligations), 1);

  assert.match(result.markdown, /## 本章必须回应的既有义务/);
  assert.match(result.markdown, /ob1 同场出价人记恨林砚（第 1 章前；证据：出价人）/);
  assert.doesNotMatch(result.markdown, /ob2/);
  assert.equal(result.contract.obligations.length, 1);
});

test('legacy 决策带弱校验 warning', () => {
  const legacy = { ...decided, legacy: true };
  const result = buildCompile(base([legacy]), 1);

  assert.ok(result.warnings.some((warning) => warning.startsWith('legacy:')));
  assert.match(result.markdown, /旧版决策，只有拍板文本/);
});

test('非法 format 直接拒绝', () => {
  assert.throws(
    () => buildCompile(base([decided]), 1, 'markdown'),
    (error) => error.code === 'bad-format',
  );
});
