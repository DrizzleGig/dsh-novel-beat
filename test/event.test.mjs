import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';

function fakeHost(dir) {
  const provided = new Map();
  const listeners = new Map();
  const agent = {
    id: 'event-test',
    session: { id: 'event-test' },
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
    tools: { register: () => () => {}, guard: () => () => {} },
    provide(name, value) {
      provided.set(name, value);
      return () => provided.delete(name);
    },
  };
  return { ctx, agent, provided, listeners };
}

async function install(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-event-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const host = fakeHost(dir);
  await apply(host.ctx);
  const service = host.provided.get('novelBeat');
  const events = [];
  service.onDidCommit((event) => events.push(event));
  const listener = host.listeners.get('tools/result').at(-1);
  return { ...host, service, events, listener };
}

function exec(name, args = {}) {
  return { name, agent: { id: 'event-test' }, arguments: { book: '书', chapter: 2, ...args } };
}

test('tools/result uses its second success argument and emits unique revision commit IDs', async (t) => {
  const host = await install(t);
  await host.listener(exec('beat_next'), {
    isError: false,
    value: { ok: true, committed: [{ id: 'b2-1' }], revision: 7 },
    content: [],
  });
  await host.listener(exec('beat_next'), {
    isError: false,
    value: { ok: true, committed: ['b2-2'], revision: 8 },
    content: [],
  });
  await host.listener(exec('beat_segment'), {
    isError: false,
    value: { ok: true, segment: { id: 's-0001' }, revision: 9 },
    content: [],
  });
  await host.listener(exec('beat_revert'), {
    isError: false,
    value: { ok: true, reverted: { revertedSegments: ['s-0001'] }, revision: 10 },
    content: [],
  });

  assert.equal(host.events.length, 4);
  assert.deepEqual(host.events.map((event) => event.ids), [['b2-1'], ['b2-2'], ['s-0001'], ['s-0001']]);
  assert.deepEqual(host.events.map((event) => event.revision), [7, 8, 9, 10]);
  assert.deepEqual(host.events.map((event) => event.commitId), ['书#7', '书#8', '书#9', '书#10']);
  assert.notEqual(host.events[0].commitId, host.events[1].commitId);
});

test('failed and non-beat results do not emit; beat_decide IDs are retained', async (t) => {
  const host = await install(t);
  await host.listener(exec('beat_next'), { isError: true, error: { message: 'failed' }, content: [] });
  await host.listener(exec('other_tool'), { isError: false, value: { revision: 1 }, content: [] });
  assert.equal(host.events.length, 0);

  await host.listener(exec('beat_decide'), {
    isError: false,
    value: { ok: true, id: 'b2-1', revision: 11 },
    content: [],
  });
  assert.equal(host.events.length, 1);
  assert.equal(host.events[0].kind, 'commit');
  assert.deepEqual(host.events[0].ids, ['b2-1']);
  assert.equal(host.events[0].commitId, '书#11');

  // 幂等重放没有写账本，不能重复发落账事件（Codex 复核 P2）。
  await host.listener(exec('beat_decide'), {
    isError: false,
    value: { ok: true, id: 'b2-1', revision: 11, idempotent: true },
    content: [],
  });
  assert.equal(host.events.length, 1, 'idempotent 分支不发事件');
});
