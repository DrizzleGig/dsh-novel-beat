// 工具参数 schema 的守卫：把「模型接口会拒绝的形状」挡在发布之前。
//
// 背景（2026-11-21）：fanfic 0.2.0 把插件内部的「参数名 → 描述对象」表直接交给
// `ctx.tools.register()`。这版 DSH 的 register() 收的是**编译好的 JSON Schema**
// （简写只对 `defineTool()` 生效），宿主不校验就透传给模型接口；接口把 parameters 当 schema
// 解析根级键，`fic_plan` 的参数名 `title` 正好是注解关键字（值必须是字符串），于是每条消息都 400，
// 且 /fic on 会持久化到 prefs.json，重启后每个新会话都中招。
//
// 检查口径按模型接口实际接受的 JSON Schema（标准关键字；未知关键字会被忽略，但已知关键字
// 类型不对就整份拒绝）。所以真正要拦的是：
//   1. 参数表顶到根级（根键不是 schema 关键字）；
//   2. 注解关键字（title / description）拿到对象；
//   3. required 不是参数名数组、属性里混进 required；
//   4. 属性缺 type、数组缺 items。

// 标准 JSON Schema（draft-07 子集）+ 常见 OpenAPI 扩展：根级与属性级都允许。
const SCHEMA_KEYWORDS = new Set([
  // 结构
  'type', 'oneOf', 'anyOf', 'allOf', 'not', 'properties', 'patternProperties', 'propertyNames',
  'required', 'additionalProperties', 'items', 'contains', 'definitions', '$ref', 'nullable',
  // 取值
  'enum', 'const', 'default', 'examples',
  // 数字 / 字符串 / 数组 / 对象约束
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minLength', 'maxLength', 'pattern', 'format',
  'minItems', 'maxItems', 'uniqueItems',
  'minProperties', 'maxProperties',
  // 注解
  'description', 'title', 'deprecated', 'readOnly', 'writeOnly',
]);
const ALLOWED_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null', 'array', 'object']);

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 断言一份工具参数是模型接口可接受的 JSON Schema。
 * @param {string} toolName 工具名，只用来把错误信息指到具体工具。
 * @param {unknown} parameters 注册给 ctx.tools.register() 的 parameters。
 */
export function assertParameterSchema(toolName, parameters) {
  const fail = (message) => {
    throw new Error(`工具 ${toolName} 的 parameters 不是可接受的 JSON Schema：${message}`);
  };
  if (!isPlainObject(parameters)) fail('根必须是对象');

  // 1. 根级：只能是 schema 关键字；title / description 必须是字符串（0.2.0 的确切形状）。
  for (const [key, value] of Object.entries(parameters)) {
    if (!SCHEMA_KEYWORDS.has(key)) {
      fail(
        `根级出现 "${key}"。参数名要放进 properties，根级只允许 schema 关键字；`
        + '整张参数表直接交给宿主正是 0.2.0 的 400 根因。',
      );
    }
    if ((key === 'title' || key === 'description') && typeof value !== 'string') {
      fail(`根级 ${key} 必须是字符串，现在拿到的是 ${JSON.stringify(value)}`);
    }
  }

  // 2. 根必须是 object，且有 properties。
  if (parameters.type !== 'object') fail('根级 type 必须是 "object"');
  if (!isPlainObject(parameters.properties)) fail('properties 必须是对象');

  // 3. 每个属性：有 type（或 oneOf），数组有 items，不许出现 required。
  for (const [name, schema] of Object.entries(parameters.properties)) {
    if (!isPlainObject(schema)) fail(`参数 ${name} 的 schema 必须是对象`);
    if (Object.hasOwn(schema, 'required')) {
      fail(`参数 ${name} 的 schema 里出现 required（required 是参数名数组，属于根级）`);
    }
    const hasOneOf = Array.isArray(schema.oneOf);
    if (!hasOneOf && typeof schema.type !== 'string') fail(`参数 ${name} 缺少 type`);
    if (!hasOneOf && !ALLOWED_TYPES.has(schema.type)) fail(`参数 ${name} 的 type "${schema.type}" 不在支持列表`);
    if (schema.type === 'array') {
      if (!isPlainObject(schema.items) && typeof schema.items !== 'boolean') {
        fail(`参数 ${name} 是数组，但缺少 items`);
      }
      if (isPlainObject(schema.items) && typeof schema.items.type !== 'string' && !Array.isArray(schema.items.oneOf)) {
        fail(`参数 ${name}.items 缺少 type`);
      }
    }
    for (const [key, value] of Object.entries(schema)) {
      if (key === 'required') continue;
      if (!SCHEMA_KEYWORDS.has(key)) fail(`参数 ${name} 里有不支持的键 "${key}"`);
      if ((key === 'title' || key === 'description') && typeof value !== 'string') {
        fail(`参数 ${name} 的 ${key} 必须是字符串`);
      }
    }
  }

  // 4. required：参数名数组，且每个都在 properties 里。
  if (Object.hasOwn(parameters, 'required')) {
    if (!Array.isArray(parameters.required)) fail('根级 required 必须是数组');
    for (const name of parameters.required) {
      if (typeof name !== 'string') fail(`required 里出现非字符串：${JSON.stringify(name)}`);
      if (!Object.hasOwn(parameters.properties, name)) fail(`required 里的 "${name}" 不在 properties 中`);
    }
  }
}

/**
 * 用假的 ctx 调一次插件 apply()，把注册的工具定义抓出来。
 * 覆盖各插件用到的 ctx 面（tools/commands/provide/effect/on/get/logger）。
 * @param {(ctx: object, config?: object) => void} applyFn 插件的 apply。
 * @param {object} config 传给 apply 的配置。
 */
export function captureToolDefinitions(applyFn, config = {}) {
  const definitions = [];
  const noop = () => {};
  const ctx = {
    tools: {
      register(definition) {
        definitions.push(definition);
        return noop;
      },
    },
    commands: { register: () => noop },
    provide: noop,
    effect: (fn) => {
      const result = typeof fn === 'function' ? fn() : undefined;
      return typeof result === 'function' ? result : noop;
    },
    on: () => noop,
    get: () => undefined,
    logger: { info: noop, warn: noop, error: noop, debug: noop },
  };
  applyFn(ctx, config);
  return definitions;
}
