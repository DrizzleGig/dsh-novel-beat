import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertBookName,
  assertChapter,
  normalizePlanBeats,
  normalizeCustomChoice,
  applyChangesToCanon,
  mergeObligations,
  nextDecisionId,
  nextObligationId,
  migrateLegacyChapter,
  KINDS,
} from '../lib/schema.js';

const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return null;
};

const change = (overrides = {}) => ({
  entity: '玉佩',
  key: '持有者',
  from: '拍卖行',
  to: '林砚',
  evidence: ['落槌'],
  ...overrides,
});

const option = (label, to, overrides = {}) => ({
  label,
  impact: '花钱得玉，得罪同场出价人。',
  changes: [change({ to })],
  ...overrides,
});

const beat = (overrides = {}) => ({
  title: '玉佩怎么到手',
  kind: '得失',
  change: '玉佩 从 拍卖品 变成 林砚持有',
  options: [option('拍卖会竞价拍下', '林砚'), option('黑市抢来', '黑市老板')],
  ...overrides,
});

test('KINDS has eight categories', () => {
  assert.equal(KINDS.length, 8);
});

test('normalizePlanBeats accepts a real fork', () => {
  const beats = normalizePlanBeats([beat()], 1);
  assert.equal(beats.length, 1);
  assert.equal(beats[0].options.length, 2);
  assert.equal(beats[0].options[0].changes[0].to, '林砚');
  assert.equal(beats[0].options[1].changes[0].to, '黑市老板');
});

test('rejects option counts outside 2-4', () => {
  assert.equal(codeOf(() => normalizePlanBeats([beat({ options: [option('唯一', '林砚')] })], 1)), 'too-few-options');
  const five = [1, 2, 3, 4, 5].map((index) => option(`选项${index}`, `结局${index}`));
  assert.equal(codeOf(() => normalizePlanBeats([beat({ options: five })], 1)), 'too-many-options');
});

test('rejects duplicate labels', () => {
  const duplicated = beat({ options: [option('拍下', '林砚'), option('拍下', '黑市老板')] });
  assert.equal(codeOf(() => normalizePlanBeats([duplicated], 1)), 'duplicate-label');
});

test('rejects options with identical change sets', () => {
  const duplicated = beat({ options: [option('拍下', '林砚'), option('抢来', '林砚')] });
  assert.equal(codeOf(() => normalizePlanBeats([duplicated], 1)), 'duplicate-changes');
});

test('rejects empty changes', () => {
  const empty = beat({ options: [option('拍下', '林砚', { changes: [] }), option('抢来', '黑市老板')] });
  assert.equal(codeOf(() => normalizePlanBeats([empty], 1)), 'empty-changes');
});

test('rejects unknown kind', () => {
  assert.equal(codeOf(() => normalizePlanBeats([beat({ kind: '随便' })], 1)), 'bad-kind');
});

test('rejects duplicate beat titles', () => {
  assert.equal(codeOf(() => normalizePlanBeats([beat(), beat()], 1)), 'duplicate-title');
});

test('rejects invalid chapter', () => {
  assert.equal(codeOf(() => assertChapter(0)), 'bad-chapter');
  assert.equal(codeOf(() => assertChapter(1.5)), 'bad-chapter');
  assert.equal(codeOf(() => assertChapter('1')), 'bad-chapter');
});

test('rejects unsafe book names', () => {
  const unsafe = ['', '.', '..', 'a/b', 'a\\b', 'C:\\x', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b'];
  for (const name of unsafe) {
    assert.equal(codeOf(() => assertBookName(name)), 'bad-book', name);
  }
  assert.equal(assertBookName('示例书'), '示例书');
});

test('custom choice requires structured changes', () => {
  assert.equal(normalizeCustomChoice([change()]).length, 1);
  assert.equal(codeOf(() => normalizeCustomChoice([])), 'empty-changes');
  assert.equal(codeOf(() => normalizeCustomChoice([change({ evidence: [] })])), 'bad-evidence');
});

test('applyChangesToCanon: new, own, conflict, noop', () => {
  const base = { chapter: 1, decisionId: 'b1-1', now: '2026-11-07T00:00:00.000Z' };

  const empty = applyChangesToCanon([], [change()], base);
  assert.equal(empty.conflicts.length, 0);
  assert.equal(empty.canon[0].value, '林砚');
  assert.ok(empty.warnings.includes('from-unverified:玉佩.持有者'));

  const same = applyChangesToCanon(
    [{ entity: '玉佩', key: '持有者', value: '林砚', chapter: 1, decisionId: 'b1-1', updatedAt: 'x' }],
    [change()],
    base,
  );
  assert.equal(same.applied[0].noop, true);

  const own = applyChangesToCanon(
    [{ entity: '玉佩', key: '持有者', value: '拍卖行', chapter: 1, decisionId: 'b1-1', updatedAt: 'x' }],
    [change()],
    base,
  );
  assert.equal(own.conflicts.length, 0);
  assert.equal(own.canon[0].value, '林砚');

  const conflict = applyChangesToCanon(
    [{ entity: '玉佩', key: '持有者', value: '黑市', chapter: 1, decisionId: 'b1-0', updatedAt: 'x' }],
    [change()],
    base,
  );
  assert.equal(conflict.conflicts.length, 1);
  assert.equal(conflict.conflicts[0].current, '黑市');
  assert.equal(conflict.canon[0].value, '黑市');

  const transition = applyChangesToCanon(
    [{ entity: '玉佩', key: '持有者', value: '拍卖行', chapter: 1, decisionId: 'b1-0', updatedAt: 'x' }],
    [change()],
    base,
  );
  assert.equal(transition.conflicts.length, 0);
  assert.equal(transition.canon[0].value, '林砚');
  assert.equal(transition.canon[0].decisionId, 'b1-1');
});

test('mergeObligations is idempotent and numbers ids', () => {
  const addition = { text: '同场出价人记恨林砚', dueChapter: 3, evidence: ['出价人'] };
  const first = mergeObligations([], [addition], { decisionId: 'b1-1', now: 'now' });
  assert.equal(first.obligations[0].id, 'ob1');
  assert.equal(first.obligations[0].status, 'open');

  const second = mergeObligations(first.obligations, [addition], { decisionId: 'b1-1', now: 'now2' });
  assert.equal(second.created.length, 0);
  assert.equal(second.obligations.length, 1);

  const third = mergeObligations(
    first.obligations,
    [{ ...addition, text: '另一个义务' }],
    { decisionId: 'b1-1', now: 'now3' },
  );
  assert.equal(third.obligations[1].id, 'ob2');
});

test('nextDecisionId and nextObligationId', () => {
  assert.equal(nextDecisionId([{ id: 'b1-1' }, { id: 'b1-3' }], 1), 'b1-4');
  assert.equal(nextDecisionId([], 2), 'b2-1');
  assert.equal(nextObligationId([{ id: 'ob1' }, { id: 'ob3' }]), 'ob4');
  assert.equal(nextObligationId([]), 'ob1');
});

test('migrateLegacyChapter marks legacy and preserves choice', () => {
  const [decided, pending] = migrateLegacyChapter(
    2,
    {
      beats: [
        {
          title: '旧决策',
          change: '玉佩到手',
          status: 'decided',
          choice: '拍下',
          options: [{ label: '拍下', impact: 'x' }],
        },
        { title: '未拍板', change: '旧敌是否认出', status: 'pending', options: [] },
      ],
    },
    'now',
  );
  assert.equal(decided.id, 'b2-1');
  assert.equal(decided.legacy, true);
  assert.equal(decided.status, 'decided');
  assert.equal(decided.chosen.label, '拍下');
  assert.deepEqual(decided.chosen.changes, []);
  assert.equal(pending.id, 'b2-2');
  assert.equal(pending.status, 'pending');
  assert.equal(pending.chosen, null);
});
