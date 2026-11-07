import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';
import { getSessionMode } from '../lib/store.js';

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-index-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function fakeContext(dir) {
  const tools = [];
  const commands = [];
  const skills = [];
  const ctx = {
    effect(fn) {
      fn();
    },
    get(name) {
      if (name === 'commands') {
        return { register(definition) { commands.push(definition); } };
      }
      if (name === 'workingDirectory') {
        return { ensure: async () => dir, get: () => dir };
      }
      if (name === 'skills') {
        return { register(skill) { skills.push(skill); } };
      }
      return null;
    },
    tools: {
      register(definition, options) {
        tools.push({ definition, options });
      },
    },
  };
  return { ctx, tools, commands, skills };
}

test('apply 注册 7 个工具、/beat 命令和技能', async (t) => {
  const dir = await tempDir(t);
  const { ctx, tools, commands, skills } = fakeContext(dir);

  await apply(ctx);

  assert.deepEqual(
    tools.map((tool) => tool.definition.name),
    ['beat_plan', 'beat_list', 'beat_decide', 'beat_gate', 'beat_compile', 'beat_verify', 'beat_adjust'],
  );
  assert.equal(commands.length, 1);
  assert.equal(commands[0].name, 'beat');
  assert.equal(skills.length, 1);
  assert.equal(skills[0].name, 'novel-beat');
  assert.match(skills[0].content, /beat_verify/);
  assert.doesNotMatch(skills[0].content, /novel_outline save_chapter/);
});

test('默认关闭；/beat on 后 when 为 true；/beat off 后恢复 false', async (t) => {
  const dir = await tempDir(t);
  const { ctx, tools, commands } = fakeContext(dir);
  await apply(ctx);

  const when = tools[0].options.when;
  const context = { agent: { id: 'session-a' } };

  assert.equal(await when(context), false);
  assert.equal((await getSessionMode(dir, 'session-a')).mode, 'off');

  const on = await commands[0].handler({ agent: { id: 'session-a' }, rawInput: 'on' });
  assert.equal(on.kind, 'success');
  assert.match(on.text, /已开启/);
  assert.equal((await getSessionMode(dir, 'session-a')).mode, 'on');
  assert.equal(await when(context), true);

  const status = await commands[0].handler({ agent: { id: 'session-a' }, rawInput: 'status' });
  assert.match(status.text, /开/);

  const off = await commands[0].handler({ agent: { id: 'session-a' }, rawInput: '/beat off' });
  assert.equal(off.kind, 'success');
  assert.equal(await when(context), false);

  const bad = await commands[0].handler({ agent: { id: 'session-a' }, rawInput: 'maybe' });
  assert.equal(bad.kind, 'error');
});

test('默认关闭时给 agent 作用域加 restrict；/beat on 解除、off 再加', async (t) => {
  const dir = await tempDir(t);
  const restrictions = [];
  const disposals = [];
  const agent = {
    id: 'session-r',
    ctx: {
      tools: {
        restrict(filter) {
          restrictions.push(filter);
          return () => disposals.push(filter);
        },
      },
      effect(fn) {
        return fn();
      },
    },
  };
  const commands = [];
  const ctx = {
    effect(fn) { fn(); },
    get(name) {
      if (name === 'commands') return { register(definition) { commands.push(definition); } };
      if (name === 'workingDirectory') return { ensure: async () => dir, get: () => dir };
      if (name === 'agents') return { list: () => [agent] };
      return null;
    },
    tools: { register() {} },
  };

  await apply(ctx);
  assert.equal(restrictions.length, 1);
  assert.deepEqual(restrictions[0].deny, [
    'beat_plan', 'beat_list', 'beat_decide', 'beat_gate',
    'beat_compile', 'beat_verify', 'beat_adjust',
  ]);

  await commands[0].handler({ agent, rawInput: 'on' });
  assert.equal(disposals.length, 1);

  await commands[0].handler({ agent, rawInput: 'off' });
  assert.equal(restrictions.length, 2);
});

test('没有 commands / workingDirectory 时工具仍注册，不崩', async (t) => {
  const dir = await tempDir(t);
  const tools = [];
  const ctx = {
    effect(fn) { fn(); },
    get(name) {
      if (name === 'skills') return null;
      return null;
    },
    tools: { register(definition, options) { tools.push({ definition, options }); } },
  };
  await apply(ctx);
  assert.equal(tools.length, 7);
  assert.equal(await tools[0].options.when({ agent: { id: 'x' } }), false);
});
