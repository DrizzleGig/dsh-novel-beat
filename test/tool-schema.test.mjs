// 参数 schema 的守卫测试：挡住「整张参数表直接交给宿主」这一类错误。
// 这类错误 fanfic 0.2.0 发布过一次：单元测试不炸，装着插件的人的 DSH 每条消息 400。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../index.js';
import { assertParameterSchema, captureToolDefinitions } from '../lib/tool-schema.mjs';

const definitions = () => captureToolDefinitions(apply, {});

test('所有工具的参数都是可接受的 JSON Schema', () => {
  const tools = definitions();
  assert.ok(tools.length > 0, '没有抓到任何工具注册');
  for (const definition of tools) {
    assertParameterSchema(definition.name, definition.parameters);
  }
});

test('工具名唯一', () => {
  const names = definitions().map((definition) => definition.name);
  assert.equal(new Set(names).size, names.length);
});

test('参数名都是字符串、required 里只有名字、属性里没有 required', () => {
  for (const definition of definitions()) {
    const { parameters } = definition;
    assert.equal(parameters.type, 'object');
    assert.equal(typeof parameters.properties, 'object');
    for (const [name, schema] of Object.entries(parameters.properties)) {
      assert.equal(typeof name, 'string');
      assert.equal(Object.hasOwn(schema, 'required'), false, `${definition.name}.${name} 的 schema 里有 required`);
    }
    for (const name of parameters.required || []) {
      assert.equal(typeof name, 'string');
      assert.ok(Object.hasOwn(parameters.properties, name), `${definition.name} 的 required 含未知参数 ${name}`);
    }
  }
});

test('0.2.0 的形状一定被拦下：参数表顶到根级、title 是对象', () => {
  const broken = {
    chapter: { type: 'string', required: true, description: '章 id' },
    title: { type: 'string', description: '这一章的一句话标题' },
  };
  assert.throws(() => assertParameterSchema('broken', broken), /根级出现 "chapter"/);
});
