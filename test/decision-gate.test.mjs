import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executePlan, executeGate, executeVerify, executeNext, executeAdjust, executeSegment } from '../lib/tools.js';
import { toolDefinitions } from '../lib/tools.js';
import { assertParameterSchema } from '../lib/tool-schema.mjs';
import { hashText, verifyEvidenceRef, createDetectKey, stableOptionId } from '../lib/decision-gate.js';
import { readBookData, mutateBookData } from '../lib/store.js';

const BOOK = 'decision-gate-test';
const BODY = '林青不知道密令。林青站在房间。钥匙由档案室保管。';
const BODY_FILE = '正文/第一章.md';

async function workspace(t, body = BODY) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-gate-'));
  await mkdir(join(dir, '正文'), { recursive: true });
  await writeFile(join(dir, BODY_FILE), body, 'utf8');
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function ref(body, quote, overrides = {}) {
  const offsetStart = body.indexOf(quote);
  assert.notEqual(offsetStart, -1, `fixture quote not found: ${quote}`);
  return {
    kind: 'body',
    file: BODY_FILE,
    hash: hashText(body),
    offsetStart,
    offsetEnd: offsetStart + quote.length,
    quote,
    ...overrides,
  };
}

function claim(text, sourceRefs = [], basis = 'inference') {
  return { text, basis, sourceRefs };
}

function candidate({
  title = '是否告知林青',
  key = 'knowledge.awareness',
  entity = 'person:linqing',
  from = 'unknown',
  to = 'aware',
  alt = 'partly-aware',
  evidence,
  costs = ['需要承担关系紧张的代价。'],
  outcomes = [claim('林青之后会主动核验密令。')],
  risks = null,
  actionA = '现在告知林青',
  actionB = '只告知部分密令',
  deltaA = to,
  deltaB = alt,
} = {}) {
  const source = evidence ?? ref(BODY, '林青不知道密令');
  return {
    title,
    kind: '知情',
    change: `${entity}.${key} 从 ${from} 改变`,
    gate: {
      entity, key, from, to,
      evidence: [source],
      reason: '不在此处决定会替作者確定林青是否知情。',
      confidence: 0.91,
    },
    options: [
      {
        label: '告知', impact: '林青获得信息并参与行动。', action: actionA,
        costs, outcomes, informationGain: [claim('林青会确认密令内容。')],
        risks: risks ?? [claim('泄露后会让行动计划暴露。', [source])],
        changes: [{ entity, key, from, to: deltaA, evidence: [source] }],
      },
      {
        label: '部分告知', impact: '林青获得有限信息，暂缓参与核心行动。', action: actionB,
        costs, outcomes: [claim('核心行动细节继续保密。')], informationGain: [claim('林青只知道密令的非核心部分。')],
        risks: [claim('后续发现信息不全时信任可能下降。', [source])],
        changes: [{ entity, key, from, to: deltaB, evidence: [source] }],
      },
    ],
  };
}

async function plan(dir, beat, extra = {}) {
  return executePlan({ dir, book: BOOK, chapter: 1, beats: [beat], ...extra });
}

test('n 个可回查的真实状态变化只登记 n 个稳定决策', async (t) => {
  const dir = await workspace(t);
  const fixtures = [
    candidate({ title: '林青是否知情', key: 'knowledge.awareness', evidence: ref(BODY, '林青不知道密令') }),
    candidate({ title: '林青是否离开', key: 'location.current', from: 'room', to: 'street', alt: 'courtyard', evidence: ref(BODY, '林青站在房间') }),
    candidate({ title: '钥匙由谁保管', entity: 'object:key', key: 'possession.holder', from: 'archive', to: 'linqing', alt: 'archivist', evidence: ref(BODY, '钥匙由档案室保管') }),
  ];
  const ids = [];
  for (let index = 0; index < fixtures.length; index += 1) {
    const result = await plan(dir, fixtures[index], index ? { append: true } : {});
    ids.push(result.ids[0]);
  }
  const { data } = await readBookData(dir, BOOK);
  const structured = data.decisions.filter((decision) => decision.gate && decision.legacyEvidence === false);
  assert.equal(structured.length, 3);
  assert.equal(new Set(ids).size, 3);
  assert.ok(structured.every((decision) => decision.id.startsWith('d-') && decision.detectKey.startsWith('detect-')));
  assert.ok(structured.every((decision) => decision.options.every((option) => option.id.startsWith('o-'))));
  assert.deepEqual(data.canon, [], '候选只提案，作者选择前不得写入 canon');
});

test('真实状态变化数 n=1/2/5 时登记数逐次恰为 n', async (t) => {
  const body = `${BODY}林青仍戒备许澈。林青尚未承诺护送。`;
  const fixtures = [
    candidate({ title: '是否告知密令', evidence: ref(body, '林青不知道密令') }),
    candidate({ title: '选择离开去向', key: 'location.current', from: 'room', to: 'street', alt: 'courtyard', evidence: ref(body, '林青站在房间') }),
    candidate({ title: '决定钥匙归属', entity: 'object:key', key: 'possession.holder', from: 'archive', to: 'linqing', alt: 'archivist', evidence: ref(body, '钥匙由档案室保管') }),
    candidate({ title: '改变同伴立场', entity: 'pair:linqing-xuche', key: 'relationship.stance', from: 'guarded', to: 'trusting', alt: 'hostile', evidence: ref(body, '林青仍戒备许澈') }),
    candidate({ title: '决定护送承诺', entity: 'promise:escort', key: 'commitment.status', from: 'unpromised', to: 'promised', alt: 'declined', evidence: ref(body, '林青尚未承诺护送') }),
  ];
  for (const n of [1, 2, 5]) {
    await t.test(`n=${n}`, async (st) => {
      const dir = await workspace(st, body);
      const ids = [];
      for (const [index, beat] of fixtures.slice(0, n).entries()) {
        const result = await plan(dir, beat, index ? { append: true } : {});
        ids.push(...result.ids);
        assert.equal((await readBookData(dir, BOOK)).data.decisions.length, index + 1);
      }
      const { data } = await readBookData(dir, BOOK);
      assert.equal(data.decisions.length, n);
      assert.equal(new Set(ids).size, n);
      assert.equal(data.revision, n);
      assert.deepEqual(data.canon, [], '状态提案不能提前成为 canon');
    });
  }
});

test('九类描写/重复/伪差分候选全部拒绝，并给出明确拒因且不写账本', async (t) => {
  const cases = [
    { name: '白名单外键', beat: candidate({ key: 'mood.description' }), code: 'unknown-state-key', reason: 'unknown-state-key' },
    { name: 'no-op', beat: candidate({ from: 'aware', to: 'aware', alt: 'unknown' }), code: 'no-op-change', reason: 'no-op-change' },
    { name: '同差分换标签', beat: candidate({ deltaB: 'aware' }), code: 'false-fork', reason: 'same-state-delta' },
    { name: '只改动作措辞', beat: candidate({ actionB: '现在告知林青' }), code: 'false-fork', reason: 'wording-only' },
    { name: '没有代价', beat: candidate({ costs: ['无代价'] }), code: 'false-fork', reason: 'no-cost-or-risk' },
    { name: '没有后果', beat: candidate({ outcomes: [] }), code: 'false-fork', reason: 'no-consequence' },
    { name: 'canon 起点冲突', beat: candidate(), canon: 'already-different', code: 'false-fork', reason: 'conflicts-known-canon' },
    { name: '作者已决定', beat: candidate(), canon: 'aware', code: 'author-already-decided', reason: 'author-already-decided' },
  ];
  for (const item of cases) {
    await t.test(item.name, async (st) => {
      const dir = await workspace(st);
      if (item.canon) {
        await mutateBookData(dir, BOOK, (data) => {
          data.canon.push({ entity: 'person:linqing', key: 'knowledge.awareness', value: item.canon, chapter: 1, decisionId: null });
          return { seeded: true };
        }, { create: true });
      }
      await assert.rejects(plan(dir, item.beat), (error) => {
        assert.equal(error.code, item.code);
        assert.equal(error.details?.reason ?? error.code, item.reason);
        return true;
      });
      const read = await readBookData(dir, BOOK);
      if (item.canon) {
        assert.equal(read.data.decisions.length, 0);
        assert.equal(read.data.revision, 1);
      } else {
        assert.equal(read.data, null, '拒绝的首次候选不得创建账本');
      }
    });
  }
  await t.test('重复候选', async (st) => {
    const dir = await workspace(st);
    const beat = candidate();
    await plan(dir, beat);
    const before = await readBookData(dir, BOOK);
    await assert.rejects(plan(dir, { ...beat, title: '同一决定换标题再问' }, { append: true }), (error) => {
      assert.equal(error.code, 'false-fork');
      assert.equal(error.details.reason, 'duplicate-candidate');
      return true;
    });
    const after = await readBookData(dir, BOOK);
    assert.equal(after.data.revision, before.data.revision);
    assert.equal(after.data.decisions.length, 1);
  });
});

test('证据 quote/hash/offset 任一篡改都拒绝且不落账', async (t) => {
  const cases = [
    { name: 'quote', code: 'evidence-offset-mismatch', change: (source) => ({ ...source, quote: '林青知道密令' }) },
    { name: 'hash', code: 'stale-evidence', change: (source) => ({ ...source, hash: '0'.repeat(64) }) },
    { name: 'offset', code: 'evidence-offset-mismatch', change: (source) => ({ ...source, offsetStart: source.offsetStart + 1, offsetEnd: source.offsetEnd + 1 }) },
  ];
  for (const item of cases) {
    await t.test(item.name, async (st) => {
      const dir = await workspace(st);
      const source = ref(BODY, '林青不知道密令');
      await assert.rejects(plan(dir, candidate({ evidence: item.change(source) })), (error) => error.code === item.code);
      assert.equal((await readBookData(dir, BOOK)).data, null);
    });
  }
});

test('0.10.0 与 0.11 开关两态工具 schema 均有效且实验工具默认隐藏', () => {
  const stable = new Map();
  for (const enabled of [false, true]) {
    const definitions = toolDefinitions({ segmentLoop: enabled });
    const names = definitions.map((definition) => definition.name);
    assert.equal(names.includes('beat_append'), enabled);
    assert.equal(names.includes('beat_finish'), enabled);
    assert.equal(names.filter((name) => name === 'beat_plan').length, 1);
    for (const definition of definitions) assertParameterSchema(definition.name, definition.parameters);
    const segment = definitions.find((definition) => definition.name === 'beat_segment');
    stable.set(enabled, JSON.stringify(segment.parameters));
    if (!enabled) {
      const plan = definitions.find((definition) => definition.name === 'beat_plan');
      const beat = plan.parameters.properties.beats.items;
      assert.ok(plan.parameters.properties.beats.items.properties.gate);
      assert.ok(plan.parameters.properties.beats.items.required.includes('gate'));
      assert.ok(beat.properties.options.items.properties.action);
      assert.ok(beat.properties.options.items.required.includes('risks'));
    }
  }
  assert.equal(stable.get(false), stable.get(true), 'legacy beat_segment schema 不随实验开关变化');
});

test('正式 beat_plan execute 拒绝 legacy 绕闸，实验入口保留旧 schema 和调用契约', async (t) => {
  const legacy = {
    title: '旧候选', kind: '知情', change: '林青是否得知密令内容',
    options: [
      { label: '告知', impact: '进入协同行动', changes: [{ entity: '林青', key: '知情', from: '未知', to: '知道', evidence: ['密令内容'] }] },
      { label: '暂缓', impact: '继续保持隐蔽', changes: [{ entity: '林青', key: '知情', from: '未知', to: '怀疑', evidence: ['有所怀疑'] }] },
    ],
  };
  const dir = await workspace(t);
  const stable = toolDefinitions().find((tool) => tool.name === 'beat_plan');
  await assert.rejects(stable.execute({ dir, book: BOOK, chapter: 1, beats: [legacy] }),
    (error) => error.code === 'gate-required');
  assert.equal((await readBookData(dir, BOOK)).data, null);
  const experimental = toolDefinitions({ segmentLoop: true }).find((tool) => tool.name === 'beat_plan');
  const schema = experimental.parameters.properties.beats.items;
  assert.deepEqual(schema.required, ['title', 'kind', 'change', 'options']);
  assert.deepEqual(schema.properties.options.items.required, ['label', 'impact', 'changes']);
  assert.equal(Object.hasOwn(schema.properties, 'gate'), false);
  assert.equal(Object.hasOwn(experimental.parameters.properties, 'sourceRefs'), false);
  const result = await experimental.execute({ dir, book: BOOK, chapter: 1, beats: [legacy] });
  assert.equal(result.ids.length, 1);
  assert.equal((await readBookData(dir, BOOK)).data.decisions[0].legacyEvidence, true);
});

test('精确提案重放返回同一 ID/scan 且不增 revision；旧 revision 仍优先拒绝', async (t) => {
  const dir = await workspace(t);
  const beat = candidate();
  const first = await plan(dir, beat, { expectedRevision: 0 });
  const before = (await readBookData(dir, BOOK)).data;
  const second = await plan(dir, structuredClone(beat), { expectedRevision: first.revision });
  const after = (await readBookData(dir, BOOK)).data;
  assert.deepEqual(second.ids, first.ids);
  assert.equal(second.revision, first.revision);
  assert.deepEqual(after, before, '幂等重放不得改审计、扫描收据或 updatedAt');
  await assert.rejects(plan(dir, beat, { expectedRevision: 0 }),
    (error) => error.code === 'revision-conflict');
  assert.deepEqual((await readBookData(dir, BOOK)).data, before);
});

test('状态身份不依赖 confidence、显示标签或提案顺序', () => {
  const original = candidate();
  const reordered = structuredClone(original);
  reordered.gate.confidence = 0.12;
  reordered.gate.reason = '另一种解释仍然询问相同状态转移。';
  reordered.gate.entityLabel = '林青';
  reordered.options.reverse();
  const key = createDetectKey(original, 1);
  assert.equal(createDetectKey(reordered, 1), key);
  const renamed = { ...original.options[0], action: '更换显示动作文本', label: '新标签' };
  assert.equal(stableOptionId(key, renamed), stableOptionId(key, original.options[0]));
});

test('CRLF 与 emoji 正文证据按原始 UTF-16 定位并兼容 legacy 段落范围', async (t) => {
  const body = '开场🌙。\r\n\r\n林青🔑不知道密令。\r\n';
  const quote = '林青🔑不知道密令。';
  const dir = await workspace(t, body);
  await mutateBookData(dir, BOOK, () => ({ initialized: true }), { create: true });
  const registered = await executeSegment({ dir, book: BOOK, chapter: 1, file: BODY_FILE, decisionIds: [], excerpt: quote });
  const { data } = await readBookData(dir, BOOK);
  const source = ref(body, quote, { chapter: 1, segmentId: registered.segment.id });
  assert.notEqual(source.offsetStart, registered.segment.offsetStart, 'CRLF fixture 必须确实存在两套偏移');
  const accepted = await verifyEvidenceRef(dir, data, source, 1);
  assert.equal(accepted.offsetStart, body.indexOf(quote));
  assert.equal(accepted.offsetEnd - accepted.offsetStart, quote.length);
  assert.equal(accepted.quote, quote);
  assert.equal(accepted.hash, hashText(body));
  assert.equal(await readFile(join(dir, BODY_FILE), 'utf8'), body, '登记段落不改写 CRLF 或 emoji');
  await assert.rejects(verifyEvidenceRef(dir, data, {
    ...source,
    offsetStart: Array.from(body.slice(0, source.offsetStart)).length,
    offsetEnd: Array.from(body.slice(0, source.offsetEnd)).length,
  }, 1), (error) => error.code === 'evidence-offset-mismatch');
  const stale = structuredClone(data);
  stale.segments[0].hash = '0'.repeat(64);
  await assert.rejects(verifyEvidenceRef(dir, stale, source, 1),
    (error) => error.code === 'stale-evidence');
});

test('EvidenceRef author/canon quote 必须精确来自已登记来源', async () => {
  const data = {
    decisions: [{ id: 'd-source', status: 'committed', chosen: {
      label: '告知', changes: [{ to: 'aware', toLabel: '知道密令' }],
    } }],
    canon: [{ id: 'c-source', decisionId: 'd-source', value: '知道密令' }],
    requests: [{ id: 'q-source', decisionId: 'd-source', answeredAt: '2026-11-25T00:00:00.000Z',
      answer: { selected: ['告知'], custom: null } }],
  };
  await assert.rejects(verifyEvidenceRef('D:\\Novel-gate', data,
    { kind: 'author', sourceId: 'q-source', quote: '任意伪造作者原话' }, 1),
  (error) => error.code === 'stale-evidence');
  await assert.rejects(verifyEvidenceRef('D:\\Novel-gate', data,
    { kind: 'canon', sourceId: 'd-source', quote: '任意伪造设定' }, 1),
  (error) => error.code === 'stale-evidence');
});

test('supersede 后同一 detectKey 用新稳定 ID，避免复用历史决策主键', async (t) => {
  const dir = await workspace(t);
  const beat = candidate();
  const first = await plan(dir, beat);
  const selected = '告知';
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: { id: 'gate-test' } }, {
    ask: async (request) => ({ answers: request.questions.map((question) => ({ id: question.id, selected: [selected] })) }),
  });
  await executeAdjust({ dir, book: BOOK, action: 'supersede', id: first.ids[0], reason: '作者改变决定并重新评估。' });
  const second = await plan(dir, candidate(), { append: true });
  assert.notEqual(second.ids[0], first.ids[0]);
  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.decisions.filter((decision) => decision.detectKey === data.decisions[0].detectKey).length, 2);
});

test('plan 后证据文件变化时 beat_next 在提问前拒绝旧候选', async (t) => {
  const dir = await workspace(t);
  await plan(dir, candidate());
  await writeFile(join(dir, BODY_FILE), `${BODY} 后来被改写。`, 'utf8');
  let asked = false;
  await assert.rejects(executeNext({ dir, book: BOOK, chapter: 1 }, { agent: { id: 'gate-test' } }, {
    ask: async () => { asked = true; return { answers: [] }; },
  }), (error) => error.code === 'stale-evidence');
  assert.equal(asked, false, '旧证据未通过前不能把候选摆给作者');
  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.decisions[0].status, 'proposed');
  assert.equal(data.revision, 1);
});

test('有效零候选扫描可 gate/verify；缺理由、缺扫描和过期 hash 均拒绝', async (t) => {
  const dir = await workspace(t);
  await assert.rejects(executePlan({ dir, book: BOOK, chapter: 1, beats: [], reason: '  ', path: BODY_FILE }),
    (error) => error.code === 'no-reason');

  const scanned = await executePlan({
    dir, book: BOOK, chapter: 1, beats: [],
    reason: '这一章只有既有行动的环境交代，没有新增状态变化。', path: BODY_FILE,
  });
  assert.equal(scanned.decisionScan.status, 'no-candidate');
  assert.equal(scanned.decisionScan.baseRevision + 1, scanned.decisionScan.resultRevision);
  assert.equal(scanned.decisionScan.resultRevision, scanned.revision);
  const gate = await executeGate({ dir, book: BOOK, chapter: 1 });
  assert.equal(gate.pass, true);
  assert.equal(gate.total, 0);

  const verified = await executeVerify({ dir, book: BOOK, chapter: 1, text: BODY });
  assert.equal(verified.verified, true);
  assert.equal(verified.stats.decisions, 0);
  assert.deepEqual(verified.noDecision, {
    reason: scanned.decisionScan.reason,
    scanId: scanned.decisionScan.id,
  });

  await t.test('缺扫描收据', async (st) => {
    const empty = await workspace(st);
    await mutateBookData(empty, BOOK, () => ({ initialized: true }), { create: true });
    await assert.rejects(executeVerify({ dir: empty, book: BOOK, chapter: 1, text: BODY }),
      (error) => error.code === 'scan-required');
  });

  await t.test('扫描后正文 hash 改变或源文件被改，旧扫描失效', async (st) => {
    const stale = await workspace(st);
    await executePlan({
      dir: stale, book: BOOK, chapter: 1, beats: [], reason: '这里不产生新的状态变化。', path: BODY_FILE,
    });
    await writeFile(join(stale, BODY_FILE), `${BODY} 作者补写一句。`, 'utf8');
    await assert.rejects(executeVerify({ dir: stale, book: BOOK, chapter: 1, text: BODY }),
      (error) => error.code === 'stale-scan');
  });

  await t.test('相关输入改变后旧扫描过期', async (st) => {
    const stale = await workspace(st);
    await executePlan({ dir: stale, book: BOOK, chapter: 1, beats: [], reason: '这里没有新增状态变化。', path: BODY_FILE });
    await mutateBookData(stale, BOOK, (data) => {
      data.canon.push({ entity: 'person:linqing', key: 'knowledge.awareness', value: 'aware', chapter: 1, decisionId: null });
      return { changed: true };
    });
    await assert.rejects(executeVerify({ dir: stale, book: BOOK, chapter: 1, text: BODY }),
      (error) => error.code === 'stale-scan');
  });

  await t.test('相同正文 hash 上无关 revision 增长不使扫描失效', async (st) => {
    const stable = await workspace(st);
    await executePlan({ dir: stable, book: BOOK, chapter: 1, beats: [], reason: '这一章没有需要作者选择的状态变化。', path: BODY_FILE });
    await mutateBookData(stable, BOOK, (data) => {
      data.audit.push({ at: '2026-11-25T00:00:00.000Z', action: 'unrelated', chapter: 9 });
      return { changed: true };
    });
    const result = await executeVerify({ dir: stable, book: BOOK, chapter: 1, text: BODY });
    assert.equal(result.verified, true);
  });
});

test('相同内容切换正文路径会生成新扫描，重复同路径扫描保持幂等', async (t) => {
  const dir = await workspace(t);
  const otherFile = '正文/另一稿.md';
  await writeFile(join(dir, otherFile), BODY, 'utf8');
  const args = { dir, book: BOOK, chapter: 1, beats: [], reason: '本章只复述既有状态，没有新增决策。' };
  const first = await executePlan({ ...args, path: BODY_FILE });
  const second = await executePlan({ ...args, path: otherFile });
  assert.notEqual(second.decisionScan.id, first.decisionScan.id);
  assert.equal(second.revision, first.revision + 1);
  assert.equal(second.decisionScan.bodyFile, otherFile);
  const repeat = await executePlan({ ...args, path: otherFile });
  assert.equal(repeat.revision, second.revision);
  assert.deepEqual(repeat.decisionScan, second.decisionScan);
  await writeFile(join(dir, BODY_FILE), `${BODY}旧稿修改。`, 'utf8');
  assert.equal((await executeGate({ dir, book: BOOK, chapter: 1, path: otherFile })).pass, true);
  assert.equal((await executeVerify({ dir, book: BOOK, chapter: 1, path: otherFile })).verified, true);
});

test('零候选扫描绑定大纲来源，来源变更后 gate/verify 和旧来源重扫都拒绝', async (t) => {
  const dir = await workspace(t);
  const outlineFile = '大纲.md';
  const outline = '本章复述过去行动，下一章才公布密令。';
  await writeFile(join(dir, outlineFile), outline, 'utf8');
  const source = ref(outline, '下一章才公布密令', { kind: 'outline', file: outlineFile });
  const args = { dir, book: BOOK, chapter: 1, beats: [], reason: '依据大纲，本章没有新的状态分叉。', path: BODY_FILE, sourceRefs: [source] };
  const scan = await executePlan(args);
  const repeat = await executePlan(args);
  assert.equal(repeat.revision, scan.revision);
  assert.equal(repeat.decisionScan.id, scan.decisionScan.id);
  assert.equal((await executeGate({ dir, book: BOOK, chapter: 1 })).pass, true);
  await writeFile(join(dir, outlineFile), `${outline}现在作者要求本章公布。`, 'utf8');
  assert.equal((await executeGate({ dir, book: BOOK, chapter: 1 })).pass, false);
  await assert.rejects(executeVerify({ dir, book: BOOK, chapter: 1, path: BODY_FILE }),
    (error) => error.code === 'stale-evidence');
  await assert.rejects(executePlan(args), (error) => error.code === 'stale-evidence');
  assert.equal((await readBookData(dir, BOOK)).data.revision, scan.revision);
});

test('未来到期的开放义务变更也会使当前零候选扫描过期', async (t) => {
  const dir = await workspace(t);
  await mutateBookData(dir, BOOK, (data) => {
    data.obligations.push({
      id: 'ob-future', text: '第九章之前归还钥匙', dueChapter: 9,
      status: 'open', sourceDecision: null, evidence: ['归还钥匙'],
    });
    return { initialized: true };
  }, { create: true });
  await executePlan({ dir, book: BOOK, chapter: 1, beats: [], reason: '当前章没有新的状态分叉。', path: BODY_FILE });
  await mutateBookData(dir, BOOK, (data) => {
    data.obligations[0].text = '第九章之前必须销毁钥匙';
    return { changed: true };
  });
  assert.equal((await executeGate({ dir, book: BOOK, chapter: 1 })).pass, false);
  await assert.rejects(executeVerify({ dir, book: BOOK, chapter: 1, path: BODY_FILE }),
    (error) => error.code === 'stale-scan');
});
