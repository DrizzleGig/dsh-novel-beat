import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCompile } from '../lib/compile.js';

const bodyRef = {
  kind: 'body', file: '正文/第1章.md', hash: 'a'.repeat(64),
  offsetStart: 0, offsetEnd: 7, quote: '林青不知道密令', segmentId: 's-0001',
};
const authorRef = { kind: 'author', sourceId: 'q-0001', quote: '现在告知林青' };
const delta = {
  entity: 'person:linqing', entityLabel: '林青', key: 'knowledge.awareness', keyLabel: '知情状态',
  from: 'unknown', fromLabel: '不知情', to: 'aware', toLabel: '知情', evidence: [bodyRef],
};
const decision = {
  id: 'b1-1', chapter: 1, title: '是否告知林青', change: '决定林青是否知情',
  status: 'committed', legacy: false, detectKey: 'detect-stable',
  gate: { ...delta, reason: '需要作者决定是否告知。', confidence: 0.9 },
  sourceRefs: [bodyRef, authorRef],
  chosen: {
    id: 'option-stable', label: '告知', action: '现在告知林青',
    costs: ['暴露行动计划'],
    outcomes: [{ text: '林青可能加入行动。', basis: 'inference', sourceRefs: [bodyRef] }],
    informationGain: [{ text: '作者已选择告知。', basis: 'known-fact', sourceRefs: [authorRef] }],
    risks: [{ text: '消息可能被转告。', basis: 'inference', sourceRefs: [bodyRef] }],
    changes: [delta], forbidden: [], source: 'proposed', basedOnOptionId: 'option-stable', editedFields: [],
  },
};

const book = (entry = decision) => ({ decisions: [entry], obligations: [], canon: [] });

for (const format of ['self', 'novel-forge']) {
  test(`v3 ${format} compile 可回查 gate、六要素、稳定 ID 与原始 EvidenceRef`, () => {
    const result = buildCompile(book(), 1, format);
    const contract = result.contract.decisions[0];
    assert.deepEqual(contract.gate, decision.gate);
    assert.equal(contract.detectKey, 'detect-stable');
    assert.deepEqual(contract.sourceRefs, [bodyRef, authorRef]);
    assert.deepEqual(contract.chosen, decision.chosen);
    assert.equal(contract.chosen.id, 'option-stable');
    for (const field of ['action', 'costs', 'outcomes', 'informationGain', 'risks', 'changes']) {
      assert.deepEqual(contract.chosen[field], decision.chosen[field]);
    }
    assert.match(result.markdown, /林青\.知情状态：不知情 → 知情/);
    assert.match(result.markdown, /「林青不知道密令」［正文\/第1章\.md:0–7］/);
    assert.match(result.markdown, /「现在告知林青」［q-0001］/);
    assert.doesNotMatch(result.markdown, /\[object Object\]/);
    assert.match(result.markdown, /行动：现在告知林青/);
    assert.match(result.markdown, /代价：暴露行动计划/);
    assert.match(result.markdown, /【推演，尚未发生】林青可能加入行动。/);
    assert.match(result.markdown, /【已知事实】作者已选择告知。/);
    assert.match(result.markdown, /【推演，尚未发生】消息可能被转告。/);
    assert.match(result.markdown, /推演不得作为既成事实/);
    assert.match(result.markdown, /候选检查依据，不等于作者选择的结果/);
  });
}

test('v3 compile 到期义务的 EvidenceRef 显示原文引用', () => {
  const data = book();
  data.obligations.push({
    id: 'o-1', text: '回应消息泄露风险', status: 'open', dueChapter: 1,
    sourceDecision: decision.id, evidence: [bodyRef],
  });
  const result = buildCompile(data, 1);
  assert.match(result.markdown, /o-1 回应消息泄露风险（第 1 章前；证据：「林青不知道密令」/);
  assert.deepEqual(result.contract.obligations[0].evidence, [bodyRef]);
  assert.doesNotMatch(result.markdown, /\[object Object\]/);
});

test('v3 compile 跨章到期义务沿用来源决策的结构化证据格式', () => {
  const current = { ...decision, id: 'b2-1', chapter: 2 };
  const data = book();
  data.decisions.push(current);
  data.obligations.push({
    id: 'o-1', text: '回应第一章消息', status: 'open', dueChapter: 2,
    sourceDecision: decision.id, evidence: [bodyRef],
  });
  const result = buildCompile(data, 2);
  assert.match(result.markdown, /o-1 回应第一章消息（第 2 章前；证据：「林青不知道密令」/);
  assert.doesNotMatch(result.markdown, /\[object Object\]/);
});

test('无 gate 的 legacy/0.11 决策不增加 v3 contract 字段或推演提示', () => {
  const legacy = {
    id: 'b1-1', chapter: 1, title: '选择路线', change: '进入东门', status: 'committed',
    sourceSegmentId: 's-0001', sourceSegmentHash: 'b'.repeat(64),
    chosen: { label: '东门', changes: [{ entity: '主角', key: '位置', from: '城外', to: '东门', evidence: ['进入东门'] }], forbidden: ['西门'] },
  };
  for (const format of ['self', 'novel-forge']) {
    const result = buildCompile(book(legacy), 1, format);
    assert.deepEqual(result.contract.decisions[0], {
      id: 'b1-1', title: '选择路线', change: '进入东门', legacy: false, choice: '东门',
      changes: legacy.chosen.changes, forbidden: ['西门'],
    });
    assert.doesNotMatch(result.markdown, /推演|触发差分|行动：|代价：/);
  }
});
