// 0.7.0 三层强制接线测试：guard / 系统提示 / 技能，全部走假 ctx（不需要真宿主）
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../index.js';
import { hashText } from '../lib/decision-gate.js';

async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-wire-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function fakeHost(dir) {
  const tools = new Map();
  const commands = [];
  const guards = [];
  const sections = [];
  const skills = [];
  const listeners = new Map();

  const agent = {
    id: 'session-1',
    session: { id: 'session-1' },
    ctx: {
      get(name) {
        if (name === 'skills') {
          return { register(skill) { skills.push(skill); return () => {}; } };
        }
        return null;
      },
      effect(fn) { return fn(); },
      tools: { restrict() { return () => {}; } },
    },
  };

  const ctx = {
    effect(fn) { return fn(); },
    on(name, fn) {
      const list = listeners.get(name) ?? [];
      list.push(fn);
      listeners.set(name, list);
      return () => {};
    },
    get(name) {
      if (name === 'commands') return { register(definition) { commands.push(definition); } };
      if (name === 'workingDirectory') return { ensure: async () => dir, get: () => dir };
      if (name === 'agents') return { list: () => [] };
      if (name === 'skills') return { register(skill) { skills.push(skill); return () => {}; } };
      if (name === 'systemPrompt') {
        return { section(definition) { sections.push(definition); return () => {}; } };
      }
      return null;
    },
    tools: {
      register(definition) { tools.set(definition.name, definition); return () => {}; },
      guard(fn) { guards.push(fn); return () => {}; },
    },
  };

  const emit = async (name, payload) => {
    for (const fn of listeners.get(name) ?? []) await fn(payload);
  };

  return { ctx, agent, tools, commands, guards, sections, skills, emit };
}

async function planOneBeat(h, dir, chapter = 1) {
  const plan = h.tools.get('beat_plan');
  assert.ok(plan, 'beat_plan 已注册');
  const context = '林昭还没有表明立场。';
  await writeFile(join(dir, '起点.md'), context);
  const evidence = [{ kind: 'outline', file: '起点.md', quote: context,
    hash: hashText(context), offsetStart: 0, offsetEnd: context.length }];
  const delta = { entity: 'person:linzhao', key: 'relationship.stance', from: 'neutral', to: 'rescue', evidence };
  const claim = (text) => ({ text, basis: 'inference', sourceRefs: evidence });
  const result = await plan.execute({
    dir,
    book: '书',
    chapter,
    beats: [
      {
        title: '要不要救',
        kind: '分叉',
        change: '林昭 从 旁观 变成 出手相救',
        gate: { ...delta, reason: '这次选择会决定林昭与对方的关系', confidence: 0.9 },
        options: [
          {
            label: '出手',
            impact: '欠下人情，卷进主线',
            action: '出手救下对方', costs: ['暴露自己的立场'],
            outcomes: [claim('卷入双方的争执')], informationGain: [], risks: [claim('可能受伤')],
            changes: [delta],
          },
          {
            label: '旁观',
            impact: '保住低调，错过线索',
            action: '明确拒绝帮助并离开', costs: ['错过追问线索的机会'],
            outcomes: [claim('对方失去支援')], informationGain: [], risks: [claim('被对方视为敌人')],
            changes: [{ ...delta, to: 'refuse' }],
          },
        ],
      },
    ],
  });
  return result;
}

test('三层接线：/beat on 后 guard 拦写正文、off 后放行', async (t) => {
  const dir = await tempDir(t);
  const h = fakeHost(dir);
  await apply(h.ctx);

  assert.equal(h.guards.length, 1, '根 ctx 注册一个全局 guard');
  assert.equal(h.sections.length, 1, '注册一个系统提示段');

  const guard = h.guards[0];
  const bodyFile = join(dir, '正文', '第001章.md');
  const call = (file_path) => guard({ name: 'write', arguments: { file_path }, agent: h.agent });

  // 模式关：写正文放行
  assert.equal(call(bodyFile), undefined);

  // 开启
  const on = await h.commands[0].handler({ agent: h.agent, rawInput: 'on' });
  assert.equal(on.kind, 'success');
  assert.match(on.text, /已开启/);
  assert.equal(h.skills.length, 1, '开启后技能出现');
  assert.match(h.sections[0].text({ scope: { id: 'session-1' } }), /拍板模式/);
  assert.equal(h.sections[0].text({ scope: { id: 'other' } }), '', '别人的会话不注入');

  // 一章还没登记决策：允许先写开场
  assert.equal(call(bodyFile), undefined);

  // 登记一个待拍板决策后：PENDING_DECISIONS
  const planned = await planOneBeat(h, dir);
  assert.ok(planned, 'beat_plan 成功');
  await h.emit('tools/result', { name: 'beat_plan', agent: h.agent });
  const pending = call(bodyFile);
  assert.match(pending, /PENDING_DECISIONS/);
  assert.match(pending, /还有 1 个岔路没问/);

  // 刚拍完板、还没登记段落：放行（正在写这一段）
  const decide = h.tools.get('beat_decide');
  await decide.execute({ dir, book: '书', chapter: 1, id: planned.ids[0], choice: '出手' });
  await h.emit('tools/result', { name: 'beat_decide', agent: h.agent });
  assert.equal(call(bodyFile), undefined, '拍板后正在写这一段，不该拦');

  // 非正文路径始终放行
  assert.equal(call(join(dir, '设定', '人物.md')), undefined);

  // 关闭后全部放行，技能撤下
  const off = await h.commands[0].handler({ agent: h.agent, rawInput: 'off' });
  assert.match(off.text, /已关闭/);
  assert.equal(call(bodyFile), undefined);
  assert.equal(h.sections[0].text({ scope: { id: 'session-1' } }), '');
});

test('guard 按章判：第 1 章有未问的岔路要拦，第 2 章还没登记则允许开场', async (t) => {
  const dir = await tempDir(t);
  const h = fakeHost(dir);
  await apply(h.ctx);
  await h.commands[0].handler({ agent: h.agent, rawInput: 'on' });
  await planOneBeat(h, dir);
  await h.emit('tools/result', { name: 'beat_plan', agent: h.agent });

  const guard = h.guards[0];
  const call = (name) => guard({ name: 'write', arguments: { file_path: join(dir, '正文', name) }, agent: h.agent });

  assert.match(call('第001章.md'), /PENDING_DECISIONS/, '第 1 章还有岔路没问');
  assert.equal(call('第002章.md'), undefined, '第 2 章还没登记岔路 → 允许写开场');

  // 给第 2 章登记一条之后，第 2 章就进入"先问"状态
  await planOneBeat(h, dir, 2);
  await h.emit('tools/result', { name: 'beat_plan', agent: h.agent });
  assert.match(call('第002章.md'), /第 2 章还有 1 个岔路没问/);
});

test('guard 对非写盘工具与未知 agent 一律放行', async (t) => {
  const dir = await tempDir(t);
  const h = fakeHost(dir);
  await apply(h.ctx);
  await h.commands[0].handler({ agent: h.agent, rawInput: 'on' });

  const guard = h.guards[0];
  const bodyFile = join(dir, '正文', '第001章.md');
  assert.equal(guard({ name: 'read', arguments: { file_path: bodyFile }, agent: h.agent }), undefined);
  assert.equal(guard({ name: 'pwsh', arguments: { command: 'echo x > 正文/a.md' }, agent: h.agent }), undefined);
  assert.equal(guard({ name: 'write', arguments: { file_path: bodyFile } }), undefined, '没有 agent 不拦');
});

test('/beat body 追加与重置受保护目录', async (t) => {
  const dir = await tempDir(t);
  const h = fakeHost(dir);
  await apply(h.ctx);
  await h.commands[0].handler({ agent: h.agent, rawInput: 'on' });

  const added = await h.commands[0].handler({ agent: h.agent, rawInput: 'body 稿件' });
  assert.match(added.text, /稿件/);

  // 给第 2 章登记一条待问的岔路，验证"稿件/"也在保护范围内
  await planOneBeat(h, dir, 2);
  await h.emit('tools/result', { name: 'beat_plan', agent: h.agent });

  const guard = h.guards[0];
  const second = join(dir, '稿件', '第002章.md');
  assert.match(guard({ name: 'write', arguments: { file_path: second }, agent: h.agent }), /PENDING_DECISIONS/);

  const reset = await h.commands[0].handler({ agent: h.agent, rawInput: 'body reset' });
  assert.doesNotMatch(reset.text, /稿件/);
  assert.equal(guard({ name: 'write', arguments: { file_path: second }, agent: h.agent }), undefined);
});
