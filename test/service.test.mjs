// 0.7.0 M5：进程内只读服务 novelBeat（给兄弟插件用的扩展窗口）
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';
import { executePlan } from '../lib/tools.js';
import { setSessionMode } from '../lib/store.js';

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-svc-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function fakeHost(dir, agentId = 'session-svc') {
  const provided = new Map();
  const listeners = new Map();
  const agent = {
    id: agentId,
    session: { id: agentId },
    ctx: {
      get: () => null,
      effect: (fn) => fn(),
      tools: { restrict: () => () => {} },
    },
  };
  const ctx = {
    effect: (fn) => fn(),
    on(name, fn) {
      const list = listeners.get(name) ?? [];
      list.push(fn);
      listeners.set(name, list);
      return () => {};
    },
    get(name) {
      if (name === 'commands') return { register: () => () => {} };
      if (name === 'workingDirectory') return { ensure: async () => dir, get: () => dir };
      if (name === 'agents') return { list: () => [] };
      return null;
    },
    tools: {
      register: () => () => {},
      guard: () => () => {},
    },
    provide(name, value) {
      provided.set(name, value);
      return () => provided.delete(name);
    },
  };
  const emit = async (name, payload) => {
    for (const fn of listeners.get(name) ?? []) await fn(payload);
  };
  return { ctx, agent, provided, emit };
}

function oneBeat() {
  return {
    title: '要不要救',
    kind: '分叉',
    change: '救不救会改变走向',
    options: [
      {
        label: '选 A',
        impact: 'A 的后果',
        changes: [{ entity: '林昭', key: '救人与否', from: '旁观', to: '出手', evidence: ['证据一', '证据二'] }],
      },
      {
        label: '选 B',
        impact: 'B 的后果',
        changes: [{ entity: '林昭', key: '救人与否', from: '旁观', to: '迟疑', evidence: ['证据一'] }],
      },
    ],
  };
}

test('novelBeat 服务：注册、版本、isOn 跟着 /beat 模式走', async (t) => {
  const dir = await tempDir(t);
  await mkdir(join(dir, '.dsh-novel-beat'), { recursive: true });
  await mkdir(join(dir, '正文'), { recursive: true });
  const h = fakeHost(dir);
  await apply(h.ctx);

  const service = h.provided.get('novelBeat');
  assert.ok(service, 'ctx.provide("novelBeat", …) 被调用');
  assert.equal(typeof service.version, 'string');
  assert.match(service.version, /^\d+\.\d+\.\d+/);

  assert.equal(service.isOn('session-svc'), false);
  await setSessionMode(dir, 'session-svc', 'on');
  await h.emit('agent/created', { agent: h.agent });
  assert.equal(service.isOn('session-svc'), true);
  assert.equal(service.isOn('别的会话'), false);
});

test('novelBeat 服务：query 只读快照 + 不暴露任何写入方法', async (t) => {
  const dir = await tempDir(t);
  await mkdir(join(dir, '.dsh-novel-beat'), { recursive: true });
  await mkdir(join(dir, '正文'), { recursive: true });
  const h = fakeHost(dir);
  await apply(h.ctx);
  const service = h.provided.get('novelBeat');

  await writeFile(join(dir, '正文', '第1章.md'), '开场白。\n', 'utf8');
  await executePlan({ dir, book: '书', chapter: 1, beats: [oneBeat()] });

  const resolved = await service.resolveBook(dir);
  assert.equal(resolved.book, '书');
  assert.equal(typeof resolved.dir, 'string');

  const snapshot = await service.query({ cwd: dir, chapter: 1 });
  assert.equal(snapshot.book, '书');
  assert.equal(snapshot.chapter, 1);
  assert.equal(snapshot.decisions.length, 1);
  assert.equal(snapshot.decisions[0].status, 'proposed');
  assert.ok(Array.isArray(snapshot.canon));
  assert.ok(Array.isArray(snapshot.segments));

  // 只读：服务面上没有任何改账本/写正文的入口
  for (const name of ['commit', 'decide', 'write', 'setMode', 'mutate', 'plan']) {
    assert.equal(typeof service[name], 'undefined', `${name} 不该暴露`);
  }
  // 子目录也能锚到同一个工作区（与工具里的 bookDir 一致）
  const fromSub = await service.query({ cwd: join(dir, '不存在'), chapter: 1 });
  assert.equal(fromSub.book, '书');
  // 完全没有账本的工作区：安静返回 null，不抛错
  const empty = await mkdtemp(join(tmpdir(), 'novel-beat-empty-'));
  t.after(() => rm(empty, { recursive: true, force: true }));
  assert.equal(await service.query({ cwd: empty }), null);
  assert.equal(await service.resolveBook(empty), null);
});

test('novelBeat 服务：onDidCommit 只在落账类工具后触发，可取消订阅', async (t) => {
  const dir = await tempDir(t);
  await mkdir(join(dir, '.dsh-novel-beat'), { recursive: true });
  await mkdir(join(dir, '正文'), { recursive: true });
  const h = fakeHost(dir);
  await apply(h.ctx);
  const service = h.provided.get('novelBeat');

  const events = [];
  const off = service.onDidCommit((event) => events.push(event));

  await h.emit('tools/result', {
    name: 'beat_plan',
    agent: h.agent,
    arguments: { book: '书', chapter: 1 },
  });
  assert.equal(events.length, 0, 'beat_plan 只是登记岔路，不算落账');

  await h.emit('tools/result', {
    name: 'beat_next',
    agent: h.agent,
    arguments: { book: '书', chapter: 1 },
    result: { value: { committed: [{ id: 'b1-1' }] } },
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'commit');
  assert.deepEqual(events[0].ids, ['b1-1']);
  assert.equal(events[0].book, '书');
  assert.equal(events[0].chapter, 1);

  await h.emit('tools/result', {
    name: 'beat_segment',
    agent: h.agent,
    arguments: { book: '书', chapter: 1 },
    result: { value: { segment: { id: 's-0001' } } },
  });
  assert.equal(events.length, 2);
  assert.equal(events[1].kind, 'segment');
  assert.deepEqual(events[1].ids, ['s-0001']);

  off();
  await h.emit('tools/result', {
    name: 'beat_revert',
    agent: h.agent,
    arguments: { book: '书', chapter: 1 },
    result: { value: { reverted: { revertedSegments: ['s-0001'] } } },
  });
  assert.equal(events.length, 2, '取消订阅后不再收到');
});
