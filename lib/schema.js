// lib/schema.js — 0.7.0 数据结构、校验与纯函数
// 只依赖 Node 内置；不 import 任何第三方包，也不 import novel-forge。

import { createHash } from 'node:crypto';

/** 0.10.0 的账本版本；早期版本由 store 的迁移层逐版升级。 */
export const SCHEMA_VERSION = 3;

/** 0.6.x 及更早的账本版本（只读兼容，靠 migrateBookV1ToV2 升级）。 */
export const LEGACY_SCHEMA_VERSION = 1;

export const KINDS = ['动作', '知情', '关系', '得失', '状态', '承诺', '时序', '分叉'];

/** 新决策持久化与提案闸门共用的状态键白名单。 */
export const STATE_KEY_ALLOWLIST = Object.freeze({
  'knowledge.awareness': '知情状态',
  'location.current': '当前位置',
  'possession.holder': '持有者',
  'relationship.stance': '关系立场',
  'commitment.status': '承诺状态',
  'obligation.status': '义务状态',
  'timeline.position': '时序位置',
  'identity.exposure': '身份暴露',
  'possession.quantity': '持有数量',
  'institution.rank': '机构排名',
});

/**
 * 决策状态。0.7 起把"作者是否真的被问过"做成状态的一部分：
 * proposed（模型提案，作者还没被问）→ asked（问题已送到作者面前）→ answered（作者已作答，尚未落账）
 * → committed（已落账，可写正文）。superseded/cancelled 是终态支路。
 */
export const DECISION_STATUS = Object.freeze({
  PROPOSED: 'proposed',
  ASKED: 'asked',
  ANSWERED: 'answered',
  COMMITTED: 'committed',
  SUPERSEDED: 'superseded',
  CANCELLED: 'cancelled',
});

/** 还没拍板的状态（写正文前必须清空）。 */
export const OPEN_DECISION_STATUSES = Object.freeze([
  DECISION_STATUS.PROPOSED,
  DECISION_STATUS.ASKED,
  DECISION_STATUS.ANSWERED,
]);

export const DECISION_STATUSES = Object.freeze(Object.values(DECISION_STATUS));

/** 段落状态：正文里的一段文字与哪些决策绑定、后来是否被回退。 */
export const SEGMENT_STATUS = Object.freeze({
  OPEN: 'open',
  COMMITTED: 'committed',
  REVERTED: 'reverted',
  STALE: 'stale',
});

/** 修订类型：登记段落 / 字级修订 / 回退。 */
export const REVISION_KIND = Object.freeze({
  SEGMENT: 'segment',
  ADJUST: 'adjust',
  REVERT: 'revert',
});

/** 作者主动插的岔路请求：open = 还没写进决策点；planned = 已被 beat_plan 消化；dropped = 作者撤回。 */
export const FORK_STATUS = Object.freeze({
  OPEN: 'open',
  PLANNED: 'planned',
  DROPPED: 'dropped',
});

export const FORK_STATUSES = Object.values(FORK_STATUS);

/** 创作任务状态（与决策状态是两套机器，绝不混用）。 */
export const TASK_STATE = Object.freeze({
  CREATED: 'created',
  PLANNING: 'planning',
  AWAITING_AUTHOR: 'awaiting_author',
  WRITING: 'writing',
  SEGMENT_COMMITTED: 'segment_committed',
  VERIFYING: 'verifying',
  COMPLETED: 'completed',
});

/** 作答凭据的来源：author = 引擎自己问到的；model-relayed = 模型转述作者口头意见；legacy = 0.6 旧账。 */
export const REQUEST_ORIGIN = Object.freeze({
  AUTHOR: 'author',
  MODEL_RELAYED: 'model-relayed',
  LEGACY: 'legacy',
});

export const OBLIGATION_STATUS = Object.freeze({
  OPEN: 'open',
  PAID: 'paid',
  WAIVED: 'waived',
});

export const LIMITS = Object.freeze({
  bookName: 80,
  title: 60,
  change: 300,
  impact: 400,
  entity: 40,
  key: 40,
  value: 80,
  evidence: 24,
  obligationText: 120,
  forbidden: 12,
  minOptions: 2,
  maxOptions: 4,
  changesPerOption: 8,
  obligationsPerOption: 6,
  forbiddenPerOption: 6,
  beatsPerChapter: 20,
  canonEntries: 200,
  path: 260,
  reason: 200,
  maxDecisionGroup: 3,
});

export class BeatError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'BeatError';
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details = undefined) {
  throw new BeatError(code, message, details);
}

export function nowIso() {
  return new Date().toISOString();
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value, field, { min = 0, max = Infinity, required = true, code = 'bad-field' } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(code, `${field} 不能为空`);
    return '';
  }
  if (typeof value !== 'string') fail(code, `${field} 必须是字符串`);
  const text = value.trim();
  if (text.length < min) fail(code, `${field} 至少 ${min} 个字`);
  if (text.length > max) fail(code, `${field} 最多 ${max} 个字`);
  return text;
}

export function assertBookName(book) {
  const name = asText(book, 'book', { min: 1, max: LIMITS.bookName, code: 'bad-book' });
  if (name === '.' || name === '..') fail('bad-book', 'book 不能是 . 或 ..');
  if (/[\\/:*?"<>|]/.test(name)) fail('bad-book', 'book 不能包含路径分隔符或 Windows 非法字符');
  if (/^[A-Za-z]:/.test(name)) fail('bad-book', 'book 不能是盘符路径');
  if (/[\u0000-\u001f]/.test(name)) fail('bad-book', 'book 不能包含控制字符');
  return name;
}

export function assertChapter(chapter, field = 'chapter') {
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 9999) {
    fail('bad-chapter', `${field} 必须是 1–9999 的整数`);
  }
  return chapter;
}

export function normalizeEvidence(value, field = 'evidence', { required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) fail('bad-evidence', `${field} 不能为空`);
    return [];
  }
  if (!Array.isArray(value)) fail('bad-evidence', `${field} 必须是数组`);
  if (value.length < (required ? 1 : 0)) fail('bad-evidence', `${field} 不能为空`);
  if (value.length > 3) fail('bad-evidence', `${field} 最多 3 项`);
  const out = [];
  for (const item of value) {
    const text = asText(item, field, { min: 2, max: LIMITS.evidence, code: 'bad-evidence' });
    if (!out.includes(text)) out.push(text);
  }
  if (required && out.length === 0) fail('bad-evidence', `${field} 不能为空`);
  return out;
}

export function normalizeChange(change, index, { requireEvidence = true } = {}) {
  if (!isPlainObject(change)) fail('bad-change', `changes[${index}] 必须是对象`);
  const entity = asText(change.entity, `changes[${index}].entity`, { min: 1, max: LIMITS.entity });
  const key = asText(change.key, `changes[${index}].key`, { min: 1, max: LIMITS.key });
  const to = asText(change.to, `changes[${index}].to`, { min: 1, max: LIMITS.value });
  const from =
    change.from === undefined || change.from === null || change.from === ''
      ? undefined
      : asText(change.from, `changes[${index}].from`, { min: 1, max: LIMITS.value });
  if (from !== undefined && from === to) {
    fail('no-op-change', `changes[${index}] 的 from 与 to 相同`);
  }
  const evidence = normalizeEvidence(change.evidence, `changes[${index}].evidence`, { required: requireEvidence });
  return { entity, key, ...(from !== undefined ? { from } : {}), to, evidence };
}

export function normalizeChanges(value, field = 'changes', { min = 1, max = LIMITS.changesPerOption, requireEvidence = true } = {}) {
  if (!Array.isArray(value)) fail('bad-field', `${field} 必须是数组`);
  if (value.length < min) fail(min === 1 ? 'empty-changes' : 'bad-field', `${field} 至少 ${min} 项`);
  if (value.length > max) fail('too-many-changes', `${field} 最多 ${max} 项`);
  const out = [];
  const seen = new Set();
  value.forEach((change, index) => {
    const normalized = normalizeChange(change, index, { requireEvidence });
    const key = `${normalized.entity}\u0000${normalized.key}`;
    if (seen.has(key)) fail('duplicate-change', `${field} 里 ${normalized.entity}.${normalized.key} 重复`);
    seen.add(key);
    out.push(normalized);
  });
  return out;
}

export function normalizeEvidenceRef(ref, field = 'sourceRefs') {
  if (!isPlainObject(ref)) fail('bad-evidence-ref', `${field} 必须是 EvidenceRef 对象`);
  const kind = asText(ref.kind, `${field}.kind`, { min: 1, max: 20, code: 'bad-evidence-ref' });
  if (!['body', 'outline', 'canon', 'author'].includes(kind)) {
    fail('bad-evidence-ref', `${field}.kind 必须是 body/outline/canon/author`);
  }
  asText(ref.quote, `${field}.quote`, { min: 1, max: 500, code: 'bad-evidence-ref' });
  // quote 是原始 UTF-16 切片；允许两端空白，不能 trim 后破坏 offset/quote 对应关系。
  const quote = ref.quote;
  if (quote.length > 500) fail('bad-evidence-ref', `${field}.quote 最多 500 个字`);
  if (kind === 'body' || kind === 'outline') {
    const file = asText(ref.file, `${field}.file`, { min: 1, max: LIMITS.path, code: 'bad-evidence-ref' });
    const hash = asText(ref.hash, `${field}.hash`, { min: 64, max: 64, code: 'bad-evidence-ref' });
    if (!/^[a-f0-9]{64}$/i.test(hash)) fail('bad-evidence-ref', `${field}.hash 必须是 SHA-256`);
    if (!Number.isInteger(ref.offsetStart) || !Number.isInteger(ref.offsetEnd)
      || ref.offsetStart < 0 || ref.offsetEnd <= ref.offsetStart) {
      fail('bad-evidence-ref', `${field} 必须提供合法的 UTF-16 offsetStart/offsetEnd`);
    }
    return {
      kind, file, hash: hash.toLowerCase(), offsetStart: ref.offsetStart, offsetEnd: ref.offsetEnd, quote,
      ...(ref.chapter !== undefined ? { chapter: assertChapter(ref.chapter, `${field}.chapter`) } : {}),
      ...(typeof ref.segmentId === 'string' ? { segmentId: ref.segmentId } : {}),
    };
  }
  const sourceId = asText(ref.sourceId, `${field}.sourceId`, { min: 1, max: 100, code: 'bad-evidence-ref' });
  return { kind, sourceId, quote };
}

function normalizeClaimList(value, field, { min = 0, max = 8 } = {}) {
  if (!Array.isArray(value)) fail('incomplete-option', `${field} 必须是数组`);
  if (value.length < min || value.length > max) fail('incomplete-option', `${field} 数量必须为 ${min}–${max}`);
  return value.map((claim, index) => {
    if (!isPlainObject(claim)) fail('incomplete-option', `${field}[${index}] 必须是 Claim 对象`);
    const text = asText(claim.text, `${field}[${index}].text`, { min: 1, max: 400, code: 'incomplete-option' });
    const basis = claim.basis;
    if (!['known-fact', 'inference'].includes(basis)) fail('incomplete-option', `${field}[${index}].basis 必须是 known-fact/inference`);
    if (!Array.isArray(claim.sourceRefs)) fail('incomplete-option', `${field}[${index}].sourceRefs 必须是数组`);
    return {
      text,
      basis,
      sourceRefs: claim.sourceRefs.map((ref, refIndex) => normalizeEvidenceRef(ref, `${field}[${index}].sourceRefs[${refIndex}]`)),
    };
  });
}

function normalizeStateDeltas(value, field) {
  if (!Array.isArray(value) || value.length < 1 || value.length > LIMITS.changesPerOption) {
    fail('incomplete-option', `${field} 至少一项，最多 ${LIMITS.changesPerOption} 项`);
  }
  const seen = new Set();
  return value.map((delta, index) => {
    if (!isPlainObject(delta)) fail('bad-change', `${field}[${index}] 必须是 StateDelta`);
    const entity = asText(delta.entity ?? delta.entityId, `${field}[${index}].entity`, { min: 1, max: 100 });
    const key = asText(delta.key ?? delta.keyId, `${field}[${index}].key`, { min: 1, max: 80 });
    const from = asText(delta.from ?? delta.fromId, `${field}[${index}].from`, { min: 1, max: 120 });
    const to = asText(delta.to ?? delta.toId, `${field}[${index}].to`, { min: 1, max: 120 });
    if (from === to) fail('no-op-change', `${field}[${index}] 的 from 与 to 相同`, { reason: 'no-op-change', field: `${field}[${index}]` });
    const identity = `${entity}\u0000${key}`;
    if (seen.has(identity)) fail('duplicate-change', `${field} 里 ${entity}.${key} 重复`);
    seen.add(identity);
    if (!Array.isArray(delta.evidence) || delta.evidence.length < 1 || delta.evidence.length > 8) {
      fail('missing-evidence', `${field}[${index}].evidence 至少一条`, { reason: 'missing-evidence', field: `${field}[${index}].evidence` });
    }
    return {
      entity, key, from, to,
      ...(typeof delta.entityLabel === 'string' ? { entityLabel: delta.entityLabel } : {}),
      ...(typeof delta.keyLabel === 'string' ? { keyLabel: delta.keyLabel } : {}),
      ...(typeof delta.fromLabel === 'string' ? { fromLabel: delta.fromLabel } : {}),
      ...(typeof delta.toLabel === 'string' ? { toLabel: delta.toLabel } : {}),
      evidence: delta.evidence.map((ref, refIndex) => normalizeEvidenceRef(ref, `${field}[${index}].evidence[${refIndex}]`)),
    };
  });
}

function normalizeDecisionGate(gate, field) {
  if (!isPlainObject(gate)) fail('bad-gate', `${field} 必须是状态差分闸门`);
  const entity = asText(gate.entity ?? gate.entityId, `${field}.entity`, { min: 1, max: 100 });
  const key = asText(gate.key ?? gate.keyId, `${field}.key`, { min: 1, max: 80 });
  const from = asText(gate.from ?? gate.fromId, `${field}.from`, { min: 1, max: 120 });
  const to = asText(gate.to ?? gate.toId, `${field}.to`, { min: 1, max: 120 });
  const reason = asText(gate.reason, `${field}.reason`, { min: 4, max: LIMITS.change });
  if (!Number.isFinite(gate.confidence) || gate.confidence < 0 || gate.confidence > 1) {
    fail('bad-gate', `${field}.confidence 必须在 0 到 1 之间`);
  }
  if (from === to) fail('no-op-change', `${field} 的 from 与 to 相同`, { reason: 'no-op-change', field });
  if (!Array.isArray(gate.evidence) || gate.evidence.length < 1 || gate.evidence.length > 8) {
    fail('missing-evidence', `${field}.evidence 至少一条`, { reason: 'missing-evidence', field: `${field}.evidence` });
  }
  return {
    entity, key, from, to,
    ...(typeof gate.entityLabel === 'string' ? { entityLabel: gate.entityLabel } : {}),
    ...(typeof gate.keyLabel === 'string' ? { keyLabel: gate.keyLabel } : {}),
    ...(typeof gate.fromLabel === 'string' ? { fromLabel: gate.fromLabel } : {}),
    ...(typeof gate.toLabel === 'string' ? { toLabel: gate.toLabel } : {}),
    evidence: gate.evidence.map((ref, index) => normalizeEvidenceRef(ref, `${field}.evidence[${index}]`)),
    reason,
    confidence: gate.confidence,
  };
}

export function changeSetKey(changes) {
  return changes
    .map((change) => `${change.entity}\u0000${change.key}\u0000${change.to}`)
    .sort()
    .join('\u0001');
}

export function normalizeForbidden(value, field = 'forbidden') {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('bad-forbidden', `${field} 必须是数组`);
  if (value.length > LIMITS.forbiddenPerOption) fail('bad-forbidden', `${field} 最多 ${LIMITS.forbiddenPerOption} 项`);
  const out = [];
  for (const item of value) {
    const text = asText(item, field, { min: 2, max: LIMITS.forbidden, code: 'bad-forbidden' });
    if (!out.includes(text)) out.push(text);
  }
  return out;
}

export function normalizeObligations(value, chapter, field = 'obligations') {
  if (value === undefined || value === null) return [];
  assertChapter(chapter);
  if (!Array.isArray(value)) fail('bad-obligation', `${field} 必须是数组`);
  if (value.length > LIMITS.obligationsPerOption) fail('bad-obligation', `${field} 最多 ${LIMITS.obligationsPerOption} 项`);
  return value.map((item, index) => {
    if (!isPlainObject(item)) fail('bad-obligation', `${field}[${index}] 必须是对象`);
    const text = asText(item.text, `${field}[${index}].text`, { min: 1, max: LIMITS.obligationText });
    let dueChapter = null;
    if (item.dueChapter !== undefined && item.dueChapter !== null) {
      dueChapter = assertChapter(item.dueChapter, `${field}[${index}].dueChapter`);
      if (dueChapter < chapter) fail('bad-due', `${field}[${index}].dueChapter 不能早于本章 ${chapter}`);
    }
    const evidence = normalizeEvidence(item.evidence, `${field}[${index}].evidence`, { required: true });
    return { text, dueChapter, evidence };
  });
}

export function normalizeOption(option, index, chapter) {
  if (!isPlainObject(option)) fail('bad-option', `options[${index}] 必须是对象`);
  const strictFields = ['action', 'costs', 'outcomes', 'informationGain', 'risks', 'changes'];
  const strict = ['action', 'costs', 'outcomes', 'informationGain', 'risks'].some((key) => Object.hasOwn(option, key));
  if (strict) {
    for (const key of strictFields) {
      if (!Object.hasOwn(option, key)) fail('incomplete-option', `options[${index}] 缺少六要素 ${key}`);
    }
    const action = asText(option.action, `options[${index}].action`, { min: 2, max: LIMITS.impact, code: 'incomplete-option' });
    if (!Array.isArray(option.costs)) fail('incomplete-option', `options[${index}].costs 必须是数组`);
    if (option.costs.length > 8) fail('incomplete-option', `options[${index}].costs 最多 8 项`);
    const costs = option.costs.map((item) => asText(item, `options[${index}].costs`, { min: 1, max: 400, code: 'incomplete-option' }));
    const outcomes = normalizeClaimList(option.outcomes, `options[${index}].outcomes`, { min: 0, max: 8 });
    const informationGain = normalizeClaimList(option.informationGain, `options[${index}].informationGain`, { min: 0, max: 8 });
    const risks = normalizeClaimList(option.risks, `options[${index}].risks`, { min: 0, max: 8 });
    const changes = normalizeStateDeltas(option.changes, `options[${index}].changes`);
    const labels = typeof option.label === 'string' ? option.label : action;
    const impact = [action, ...costs, ...outcomes.map((claim) => claim.text), ...risks.map((claim) => claim.text)].join('；').slice(0, LIMITS.impact);
    const obligations = normalizeObligations(option.obligations, chapter, `options[${index}].obligations`);
    const forbidden = normalizeForbidden(option.forbidden, `options[${index}].forbidden`);
    return {
      ...(typeof option.id === 'string' ? { id: option.id } : {}),
      label: asText(labels, `options[${index}].label`, { min: 1, max: 80 }),
      impact: asText(impact, `options[${index}].impact`, { min: 1, max: LIMITS.impact }),
      action, costs, outcomes, informationGain, risks, changes, obligations, forbidden,
    };
  }
  const label = asText(option.label, `options[${index}].label`, { min: 1, max: 80 });
  const impact = asText(option.impact, `options[${index}].impact`, { min: 1, max: LIMITS.impact });
  const changes = normalizeChanges(option.changes, `options[${index}].changes`, {
    min: 1,
    max: LIMITS.changesPerOption,
    requireEvidence: true,
  });
  const obligations = normalizeObligations(option.obligations, chapter, `options[${index}].obligations`);
  const forbidden = normalizeForbidden(option.forbidden, `options[${index}].forbidden`);
  return { label, impact, changes, obligations, forbidden };
}

export function normalizeBeat(beat, chapter, index) {
  if (!isPlainObject(beat)) fail('bad-beat', `beats[${index}] 必须是对象`);
  const title = asText(beat.title, `beats[${index}].title`, { min: 1, max: LIMITS.title });
  const kind = asText(beat.kind, `beats[${index}].kind`, { min: 1, max: 10 });
  if (!KINDS.includes(kind)) fail('bad-kind', `beats[${index}].kind 必须是 ${KINDS.join('/')}`);
  const gate = beat.gate === undefined ? null : normalizeDecisionGate(beat.gate, `beats[${index}].gate`);
  const change = asText(beat.change ?? gate?.reason, `beats[${index}].change`, { min: 4, max: LIMITS.change });
  if (!Array.isArray(beat.options)) fail('bad-option', `beats[${index}].options 必须是数组`);
  if (beat.options.length < LIMITS.minOptions) fail('too-few-options', `beats[${index}].options 至少 ${LIMITS.minOptions} 个`);
  if (beat.options.length > LIMITS.maxOptions) fail('too-many-options', `beats[${index}].options 最多 ${LIMITS.maxOptions} 个`);
  const rawOptions = beat.options;
  const options = rawOptions.map((option, optionIndex) => normalizeOption(option, optionIndex, chapter));

  const labels = new Set();
  const changeSets = new Map();
  const strict = options.some((option) => Boolean(option.action));
  for (const option of options) {
    if (labels.has(option.label)) fail('duplicate-label', `beats[${index}] 的选项 label 重复：${option.label}`);
    labels.add(option.label);
    const setKey = strict
      ? option.changes.map((delta) => `${delta.entity}\u0000${delta.key}\u0000${delta.from}\u0000${delta.to}`).sort().join('\u0001')
      : changeSetKey(option.changes);
    if (changeSets.has(setKey)) {
      if (!strict) fail('duplicate-changes', `beats[${index}] 的选项 changes 相同：${option.label} 与 ${changeSets.get(setKey)}`);
    }
    changeSets.set(setKey, option.label);
  }

  if (!gate && options.some((option) => option.action)) fail('bad-gate', '完整六要素候选必须同时提供 gate 状态差分');
  if (gate && options.some((option) => !option.action)) fail('incomplete-option', 'gate 决策必须完整提供六要素');
  return { title, kind, change, ...(gate ? { gate } : {}), options };
}

export function normalizePlanBeats(beats, chapter) {
  assertChapter(chapter);
  if (!Array.isArray(beats)) fail('empty-beats', 'beats 必须是数组');
  // beats 为空是合法的：它表示"续写检查的结论是这里没有真岔路"，不登记决策点。
  if (beats.length > LIMITS.beatsPerChapter) fail('too-many-beats', `beats 最多 ${LIMITS.beatsPerChapter} 个`);
  const out = [];
  const titles = new Set();
  beats.forEach((beat, index) => {
    const normalized = normalizeBeat(beat, chapter, index);
    if (titles.has(normalized.title)) fail('duplicate-title', `beats 标题重复：${normalized.title}`);
    titles.add(normalized.title);
    out.push(normalized);
  });
  return out;
}

export function normalizeCustomChoice(changes) {
  return normalizeChanges(changes, 'changes', { min: 1, max: LIMITS.changesPerOption, requireEvidence: true });
}

export function normalizeBookMeta(meta, book) {
  const source = isPlainObject(meta) ? meta : {};
  const title =
    source.title === undefined ? book : asText(source.title, 'meta.title', { min: 1, max: LIMITS.bookName });
  const genre =
    source.genre === undefined
      ? ''
      : asText(source.genre, 'meta.genre', { min: 0, max: 40, required: false });
  const logline =
    source.logline === undefined
      ? ''
      : asText(source.logline, 'meta.logline', { min: 0, max: 300, required: false });
  return { title, genre, logline };
}

export function emptyBook({ book, meta, now = nowIso() }) {
  const name = assertBookName(book);
  const data = {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    book: name,
    meta: normalizeBookMeta(meta, name),
    createdAt: now,
    updatedAt: now,
    chapters: {},
    decisions: [],
    canon: [],
    obligations: [],
    audit: [],
    segments: [],
    revisions: [],
    requests: [],
    tasks: [],
    forks: [],
    transactions: [],
    integrity: { algorithm: 'sha256', ledgerHash: null, bodyBindings: [] },
  };
  data.integrity.ledgerHash = computeLedgerHash(data);
  return data;
}

/** 0.7 的账本数组一律存在；缺数组直接判损坏（补齐只发生在迁移里）。 */
const ARRAY_FIELDS = ['decisions', 'canon', 'obligations', 'audit', 'segments', 'revisions', 'requests', 'tasks'];

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** ledgerHash 不自引用；对象键排序，数组保持其语义顺序。 */
export function computeLedgerHash(data) {
  const copy = cloneJson(data);
  if (isPlainObject(copy.integrity)) copy.integrity.ledgerHash = null;
  return createHash('sha256').update(stableJson(copy), 'utf8').digest('hex');
}

function assertUniqueIds(list, field) {
  const seen = new Set();
  for (const entry of list) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string' || !entry.id) {
      fail('book-corrupt', `${field} 有条目缺少 id`);
    }
    if (seen.has(entry.id)) fail('book-corrupt', `${field} id 重复：${entry.id}`);
    seen.add(entry.id);
  }
  return seen;
}

function storedInteger(value, field, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    fail('book-corrupt', `${field} 必须是 0–${max} 的安全整数`);
  }
}

function storedText(value, field) {
  if (typeof value !== 'string' || !value.trim()) fail('book-corrupt', `${field} 必须是非空字符串`);
}

function storedHash(value, field) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) {
    fail('book-corrupt', `${field} 必须是 SHA-256`);
  }
}

function storedPath(value, field) {
  storedText(value, field);
  if (value.length > LIMITS.path || /^[\\/]|^[a-z]:/i.test(value)
    || value.split(/[\\/]/).includes('..') || /[\u0000-\u001f]/u.test(value)) {
    fail('book-corrupt', `${field} 必须是工作区内的相对路径`);
  }
}

function storedStringList(value, field) {
  if (!Array.isArray(value)) fail('book-corrupt', `${field} 必须是数组`);
  value.forEach((item, index) => storedText(item, `${field}[${index}]`));
  if (new Set(value).size !== value.length) fail('book-corrupt', `${field} 不能有重复项`);
}

// 读取时只校验，不用 normalize 的返回值覆盖旧数据或丢弃可信 sourceLength。
function storedEvidenceRefs(refs, field) {
  if (!Array.isArray(refs)) fail('book-corrupt', `${field} 必须是数组`);
  refs.forEach((ref, index) => {
    const path = `${field}[${index}]`;
    normalizeEvidenceRef(ref, path);
    if (ref.kind === 'body' || ref.kind === 'outline') {
      storedPath(ref.file, `${path}.file`);
      storedInteger(ref.offsetStart, `${path}.offsetStart`);
      storedInteger(ref.offsetEnd, `${path}.offsetEnd`);
      if (ref.offsetEnd - ref.offsetStart !== ref.quote.length) {
        fail('book-corrupt', `${path}.quote 长度与 UTF-16 范围不一致`);
      }
      if (Object.hasOwn(ref, 'sourceLength')) {
        storedInteger(ref.sourceLength, `${path}.sourceLength`);
        if (ref.sourceLength < ref.offsetEnd) fail('book-corrupt', `${path}.sourceLength 不能小于 offsetEnd`);
      }
      if (ref.segmentId !== undefined) storedText(ref.segmentId, `${path}.segmentId`);
    } else if (Object.hasOwn(ref, 'sourceLength')) {
      fail('book-corrupt', `${path}.sourceLength 只适用于正文或大纲证据`);
    }
  });
}

function storedDelta(delta, field) {
  if (!isPlainObject(delta)) fail('book-corrupt', `${field} 必须是状态差分对象`);
  for (const key of ['entity', 'key', 'from', 'to']) {
    if (typeof delta[key] !== 'string' || delta[key].length > 120 || !/^[a-z0-9][a-z0-9._:/-]*$/u.test(delta[key])) {
      fail('book-corrupt', `${field}.${key} 必须是稳定状态 ID`);
    }
  }
  if (!Object.hasOwn(STATE_KEY_ALLOWLIST, delta.key)) fail('book-corrupt', `${field}.key 不在状态键白名单内`);
  for (const key of ['entityLabel', 'keyLabel', 'fromLabel', 'toLabel']) {
    if (delta[key] !== undefined && typeof delta[key] !== 'string') fail('book-corrupt', `${field}.${key} 必须是字符串`);
  }
  storedEvidenceRefs(delta.evidence, `${field}.evidence`);
}

function storedOption(option, chapter, field) {
  if (!isPlainObject(option) || typeof option.action !== 'string') fail('book-corrupt', `${field} 缺少选项六要素`);
  normalizeOption(option, 0, chapter);
  option.changes.forEach((delta, index) => storedDelta(delta, `${field}.changes[${index}]`));
  for (const key of ['outcomes', 'informationGain', 'risks']) {
    option[key].forEach((claim, index) => {
      storedEvidenceRefs(claim.sourceRefs, `${field}.${key}[${index}].sourceRefs`);
      if (claim.basis === 'known-fact' && claim.sourceRefs.length === 0) {
        fail('book-corrupt', `${field}.${key}[${index}] 的已知事实缺少来源`);
      }
    });
  }
}

function storedBodyBinding(binding, field, revision, { decision = false } = {}) {
  if (!isPlainObject(binding)) fail('book-corrupt', `${field} 必须是对象`);
  storedPath(binding.file, `${field}.file`);
  storedHash(binding.bodyHash, `${field}.bodyHash`);
  if (decision) {
    storedText(binding.segmentId, `${field}.segmentId`);
    storedInteger(binding.offsetStart, `${field}.offsetStart`);
    storedInteger(binding.offsetEnd, `${field}.offsetEnd`);
    if (binding.offsetEnd <= binding.offsetStart || binding.offsetEncoding !== 'utf16-lf') {
      fail('book-corrupt', `${field} 必须使用有效的 UTF-16/LF 段落范围`);
    }
    storedInteger(binding.segmentRevision, `${field}.segmentRevision`, revision);
  } else {
    assertChapter(binding.chapter, `${field}.chapter`);
    storedInteger(binding.revision, `${field}.revision`, revision);
    storedText(binding.updatedAt, `${field}.updatedAt`);
  }
}

function hasStructuredDecision(decision) {
  return decision?.gate != null || decision?.legacyEvidence === false || decision?.detectKey != null
    || (Array.isArray(decision?.options) && decision.options.some((option) => isPlainObject(option) && Object.hasOwn(option, 'action')));
}

function validateV3Fields(data) {
  const hasNewFields = data.decisions.some(hasStructuredDecision)
    || Object.values(data.chapters).some((chapter) => chapter?.decisionScan != null)
    || data.integrity.bodyBindings.length > 0
    || data.decisions.some((decision) => decision.bodyBinding != null)
    || data.segments.some((segment) => segment.bodyHash !== undefined || segment.segmentRevision !== undefined);
  // 0.7/0.8 的历史账形状仍可按 revisions/audit 计数续写；新 v3 记录不能借此绕过 revision。
  if (data.revision !== undefined || hasNewFields) storedInteger(data.revision, 'revision');
  const revision = data.revision ?? data.revisions.length + data.audit.length;

  for (const decision of data.decisions) {
    const field = `决策 ${decision.id}`;
    if (decision.nodeKind !== undefined && decision.nodeKind !== 'decision') fail('book-corrupt', `${field}.nodeKind 非法`);
    if (decision.legacyEvidence !== undefined && typeof decision.legacyEvidence !== 'boolean') fail('book-corrupt', `${field}.legacyEvidence 必须是布尔值`);
    if (decision.sourceRefs !== undefined) storedEvidenceRefs(decision.sourceRefs, `${field}.sourceRefs`);
    if (hasStructuredDecision(decision)) {
      assertChapter(decision.chapter, `${field}.chapter`);
      if (decision.nodeKind !== 'decision' || decision.legacyEvidence !== false) fail('book-corrupt', `${field} 缺少新决策标记`);
      normalizeDecisionGate(decision.gate, `${field}.gate`);
      storedDelta(decision.gate, `${field}.gate`);
      storedText(decision.detectKey, `${field}.detectKey`);
      storedEvidenceRefs(decision.sourceRefs, `${field}.sourceRefs`);
      if (decision.sourceRefs.length === 0) fail('book-corrupt', `${field}.sourceRefs 不能为空`);
      if (!Array.isArray(decision.options) || decision.options.length < 2 || decision.options.length > 4) {
        fail('book-corrupt', `${field}.options 必须有 2–4 个选项`);
      }
      const optionIds = assertUniqueIds(decision.options, `${field}.options`);
      decision.options.forEach((option, index) => storedOption(option, decision.chapter, `${field}.options[${index}]`));
      if (decision.chosen != null) {
        storedOption(decision.chosen, decision.chapter, `${field}.chosen`);
        if (!['proposed', 'author-edited', 'author-custom'].includes(decision.chosen.source)
          || !Array.isArray(decision.chosen.editedFields)) fail('book-corrupt', `${field}.chosen 缺少选择来源/编辑记录`);
        if (decision.chosen.source === 'author-custom') {
          if (decision.chosen.basedOnOptionId !== null) fail('book-corrupt', `${field}.chosen 自定义选项不能伪装为原提案`);
        } else if (!optionIds.has(decision.chosen.basedOnOptionId)) {
          fail('book-corrupt', `${field}.chosen.basedOnOptionId 找不到原选项`);
        }
        decision.chosen.editedFields.forEach((edit, index) => {
          if (!isPlainObject(edit) || !Object.hasOwn(edit, 'before') || !Object.hasOwn(edit, 'after')) fail('book-corrupt', `${field}.chosen.editedFields[${index}] 缺少前后快照`);
          storedText(edit.field, `${field}.chosen.editedFields[${index}].field`);
          storedText(edit.at, `${field}.chosen.editedFields[${index}].at`);
        });
      } else if (decision.status === DECISION_STATUS.COMMITTED) {
        fail('book-corrupt', `${field} 已拍板但缺少 chosen 快照`);
      }
    }
    if (decision.bodyBinding != null) storedBodyBinding(decision.bodyBinding, `${field}.bodyBinding`, revision, { decision: true });
  }

  for (const [chapter, state] of Object.entries(data.chapters)) {
    const scan = state?.decisionScan;
    if (scan == null) continue;
    const field = `chapters.${chapter}.decisionScan`;
    if (!isPlainObject(scan) || !['candidates', 'no-candidate'].includes(scan.status)) fail('book-corrupt', `${field}.status 非法`);
    storedText(scan.id, `${field}.id`);
    storedText(scan.scannedAt, `${field}.scannedAt`);
    storedInteger(scan.baseRevision, `${field}.baseRevision`, revision);
    storedInteger(scan.resultRevision, `${field}.resultRevision`, revision);
    if (scan.resultRevision !== scan.baseRevision + 1) fail('book-corrupt', `${field}.resultRevision 必须比 baseRevision 大一`);
    storedHash(scan.relevantInputHash, `${field}.relevantInputHash`);
    storedStringList(scan.segmentIds, `${field}.segmentIds`);
    storedEvidenceRefs(scan.sourceRefs, `${field}.sourceRefs`);
    if (scan.bodyFile != null) storedPath(scan.bodyFile, `${field}.bodyFile`);
    if (scan.status === 'no-candidate') {
      storedText(scan.reason, `${field}.reason`);
      storedHash(scan.bodyHash, `${field}.bodyHash`);
      if (scan.candidateCount !== 0) fail('book-corrupt', `${field}.candidateCount 必须为 0`);
    } else {
      if (scan.bodyHash !== null) storedHash(scan.bodyHash, `${field}.bodyHash`);
      if (scan.candidateCount !== 1) fail('book-corrupt', `${field}.candidateCount 必须为 1`);
      storedText(scan.detectKey, `${field}.detectKey`);
      storedHash(scan.proposalHash, `${field}.proposalHash`);
      storedStringList(scan.decisionIds, `${field}.decisionIds`);
      if (scan.decisionIds.length !== 1) fail('book-corrupt', `${field}.decisionIds 必须只有一个候选`);
    }
  }

  data.segments.forEach((segment) => {
    if (segment.bodyHash !== undefined) storedHash(segment.bodyHash, `段落 ${segment.id}.bodyHash`);
    if (segment.segmentRevision !== undefined) storedInteger(segment.segmentRevision, `段落 ${segment.id}.segmentRevision`, revision);
    if (segment.sourceRefs !== undefined) storedEvidenceRefs(segment.sourceRefs, `段落 ${segment.id}.sourceRefs`);
  });
  const boundFiles = new Set();
  data.integrity.bodyBindings.forEach((binding, index) => {
    storedBodyBinding(binding, `integrity.bodyBindings[${index}]`, revision);
    if (boundFiles.has(binding.file)) fail('book-corrupt', `integrity.bodyBindings 重复绑定 ${binding.file}`);
    boundFiles.add(binding.file);
  });
}

export function validateBook(data) {
  if (!isPlainObject(data)) fail('book-corrupt', 'book.json 不是对象');
  if (data.schemaVersion !== SCHEMA_VERSION) {
    fail('book-invalid', `不支持的 schemaVersion：${data.schemaVersion}`);
  }
  if (typeof data.book !== 'string' || !data.book) fail('book-corrupt', 'book.json 缺少 book');
  for (const key of ARRAY_FIELDS) {
    if (!Array.isArray(data[key])) fail('book-corrupt', `book.json 缺少数组 ${key}`);
  }
  if (!isPlainObject(data.chapters)) fail('book-corrupt', 'book.json 缺少 chapters');
  if (!Array.isArray(data.transactions)) {
    fail('book-corrupt', 'book.json 的 transactions 必须是数组');
  }
  if (!isPlainObject(data.integrity) || data.integrity.algorithm !== 'sha256'
    || !Array.isArray(data.integrity.bodyBindings)
    || !/^[a-f0-9]{64}$/i.test(data.integrity.ledgerHash ?? '')) {
    fail('book-corrupt', 'book.json 的 integrity 结构非法');
  }
  // forks 是 0.7 后加的：老账本没有这个字段也照常读，有就必须是合法数组。
  if (data.forks !== undefined) {
    if (!Array.isArray(data.forks)) fail('book-corrupt', 'book.json 的 forks 必须是数组');
    assertUniqueIds(data.forks, 'forks');
    for (const fork of data.forks) {
      if (!FORK_STATUSES.includes(fork.status)) {
        fail('book-corrupt', `岔路请求 ${fork.id} 的 status 非法：${fork.status}`);
      }
    }
  }

  const decisionIds = assertUniqueIds(data.decisions, 'decisions');
  const requestIds = assertUniqueIds(data.requests, 'requests');
  const segmentIds = assertUniqueIds(data.segments, 'segments');
  assertUniqueIds(data.revisions, 'revisions');
  assertUniqueIds(data.tasks, 'tasks');
  assertUniqueIds(data.transactions, 'transactions');
  for (const entry of data.transactions) {
    if (entry.kind !== 'revert-transaction') continue;
    assertChapter(entry.chapter, `事务 ${entry.id}.chapter`);
    if (entry.stage !== 'committed') fail('book-corrupt', `事务 ${entry.id}.stage 必须是 committed`);
    storedInteger(entry.revision, `事务 ${entry.id}.revision`, data.revision ?? Number.MAX_SAFE_INTEGER);
    if (!Array.isArray(entry.files) || entry.files.length !== 1
      || typeof entry.files[0]?.path !== 'string'
      || !/^[a-f0-9]{64}$/i.test(entry.files[0]?.beforeHash ?? '')
      || !/^[a-f0-9]{64}$/i.test(entry.files[0]?.afterHash ?? '')) {
      fail('book-corrupt', `事务 ${entry.id}.files 无效`);
    }
    if (!isPlainObject(entry.receipt) || entry.receipt.txId !== entry.id
      || entry.receipt.revision !== entry.revision
      || !/^[a-f0-9]{64}$/i.test(entry.receipt.bodyHash ?? '')) {
      fail('book-corrupt', `事务 ${entry.id}.receipt 无效`);
    }
    if (!['pending', 'complete'].includes(entry.staleStatus)
      || !Array.isArray(entry.stalePending)
      || !['pending', 'complete'].includes(entry.briefStatus)) {
      fail('book-corrupt', `事务 ${entry.id} 的 stale/brief 状态无效`);
    }
  }

  // 作者作答凭据：answeredAt 非空才算有效；decisionId 必须存在。
  const answeredRequests = new Set();
  for (const request of data.requests) {
    if (!decisionIds.has(request.decisionId)) {
      fail('book-corrupt', `requests ${request.id} 指向不存在的决策 ${request.decisionId}`);
    }
    if (typeof request.answeredAt === 'string' && request.answeredAt) answeredRequests.add(request.id);
  }

  // 决策：状态在枚举内；committed 必须有有效作答凭据（防伪造的第一道闸）。
  for (const decision of data.decisions) {
    if (typeof decision.status !== 'string' || !DECISION_STATUSES.includes(decision.status)) {
      fail('book-corrupt', `决策 ${decision.id} 的 status 非法：${decision.status}`);
    }
    if (decision.status === DECISION_STATUS.COMMITTED) {
      if (typeof decision.requestId !== 'string' || !decision.requestId) {
        fail('book-corrupt', `决策 ${decision.id} 已拍板但缺少 requestId（作答凭据）`);
      }
      if (!requestIds.has(decision.requestId)) {
        fail('book-corrupt', `决策 ${decision.id} 的 requestId 找不到对应凭据：${decision.requestId}`);
      }
      if (!answeredRequests.has(decision.requestId)) {
        fail('book-corrupt', `决策 ${decision.id} 的作答凭据 ${decision.requestId} 没有 answeredAt`);
      }
    }
  }

  // 段落：decisionIds 可为空（开场/过渡段），非空时引用必须存在；同一条决策只能被一个未回退段落引用。
  const claimedDecisions = new Set();
  for (const segment of data.segments) {
    if (!Array.isArray(segment.decisionIds)) {
      fail('book-corrupt', `段落 ${segment.id} 的 decisionIds 必须是数组（可以是空数组）`);
    }
    if (segment.status !== undefined && !Object.values(SEGMENT_STATUS).includes(segment.status)) {
      fail('book-corrupt', `段落 ${segment.id} 的 status 非法：${segment.status}`);
    }
    for (const id of segment.decisionIds) {
      if (!decisionIds.has(id)) fail('book-corrupt', `段落 ${segment.id} 引用不存在的决策 ${id}`);
      if (segment.status === SEGMENT_STATUS.REVERTED) continue;
      if (claimedDecisions.has(id)) {
        fail('book-corrupt', `决策 ${id} 被多个未回退段落引用`);
      }
      claimedDecisions.add(id);
    }
  }

  for (const revision of data.revisions) {
    if (!Object.values(REVISION_KIND).includes(revision.kind)) {
      fail('book-corrupt', `修订 ${revision.id} 的 kind 非法：${revision.kind}`);
    }
    if (revision.segmentId != null && !segmentIds.has(revision.segmentId)) {
      fail('book-corrupt', `修订 ${revision.id} 指向不存在的段落 ${revision.segmentId}`);
    }
  }

  for (const task of data.tasks) {
    if (!Object.values(TASK_STATE).includes(task.state)) {
      fail('book-corrupt', `任务 ${task.id} 的 state 非法：${task.state}`);
    }
  }

  const canonKeys = new Set();
  for (const entry of data.canon) {
    if (!isPlainObject(entry) || typeof entry.entity !== 'string' || typeof entry.key !== 'string') {
      fail('book-corrupt', 'canon 条目缺 entity/key');
    }
    const key = `${entry.entity}\u0000${entry.key}`;
    if (canonKeys.has(key)) fail('book-corrupt', `canon 重复：${entry.entity}.${entry.key}`);
    canonKeys.add(key);
  }

  const obligationIds = new Set();
  for (const obligation of data.obligations) {
    if (!isPlainObject(obligation) || typeof obligation.id !== 'string' || !obligation.id) {
      fail('book-corrupt', 'obligations 有条目缺少 id');
    }
    if (obligationIds.has(obligation.id)) fail('book-corrupt', `obligations id 重复：${obligation.id}`);
    obligationIds.add(obligation.id);
  }

  try {
    validateV3Fields(data);
  } catch (error) {
    if (error instanceof BeatError && error.code !== 'book-corrupt') {
      fail('book-corrupt', error.message, { cause: error.code });
    }
    throw error;
  }

  return data;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * 0.6（schemaVersion 1）→ 0.7（schemaVersion 2）。
 * - 决策：decided → committed，并补一条 legacy 凭据（这样"committed 必须有凭据"对旧账也成立）；
 *   pending → proposed。
 * - 新增空数组 segments/revisions/requests/tasks（已有则保留）。
 * - 不重算 hash、不重建锚点；写一条 audit。
 */
export function migrateBookV1ToV2(data, { now = nowIso() } = {}) {
  if (!isPlainObject(data)) fail('book-corrupt', 'book.json 不是对象');
  const next = cloneJson(data);
  next.schemaVersion = 2;
  for (const field of ['segments', 'revisions', 'requests', 'tasks']) {
    if (!Array.isArray(next[field])) next[field] = [];
  }
  if (!Array.isArray(next.decisions)) next.decisions = [];
  if (!isPlainObject(next.chapters)) next.chapters = {};
  if (!Array.isArray(next.audit)) next.audit = [];
  if (!Array.isArray(next.canon)) next.canon = [];
  if (!Array.isArray(next.obligations)) next.obligations = [];

  let seq = 0;
  const usedReceiptIds = new Set(next.requests.map((request) => request?.id).filter(Boolean));
  for (const decision of next.decisions) {
    if (!isPlainObject(decision)) continue;
    decision.requestId ??= null;
    decision.askedAt ??= null;
    decision.answeredAt ??= null;
    decision.committedAt ??= null;
    decision.segmentId ??= null;
    decision.legacyReceipt ??= false;
    if (decision.status === 'decided') {
      let id;
      do {
        id = `q-legacy-${++seq}`;
      } while (usedReceiptIds.has(id));
      usedReceiptIds.add(id);
      const answeredAt = typeof decision.decidedAt === 'string' ? decision.decidedAt : now;
      next.requests.push({
        id,
        decisionId: decision.id,
        chapter: decision.chapter ?? null,
        askedAt: null,
        answeredAt,
        options: Array.isArray(decision.options)
          ? decision.options.map((option) => ({
              label: String(option?.label ?? ''),
              description: String(option?.impact ?? ''),
            }))
          : [],
        answer: {
          selected: typeof decision.chosen?.label === 'string' && decision.chosen.label ? [decision.chosen.label] : [],
          custom: null,
        },
        agentId: null,
        origin: REQUEST_ORIGIN.LEGACY,
      });
      decision.status = DECISION_STATUS.COMMITTED;
      decision.requestId = id;
      decision.answeredAt = answeredAt;
      decision.committedAt = answeredAt;
      decision.legacyReceipt = true;
    } else if (decision.status === 'pending') {
      decision.status = DECISION_STATUS.PROPOSED;
    }
  }

  next.audit.push({
    at: now,
    action: 'migrate-0.7',
    detail: `schemaVersion 1 → 2；决策 ${next.decisions.length} 条（decided→committed，pending→proposed）`,
  });
  return next;
}

/** schemaVersion 2 → 3；只补新结构，不改写历史决策、选项、段落或正文锚点。 */
export function migrateBookV2ToV3(data, { now } = {}) {
  if (!isPlainObject(data)) fail('book-corrupt', 'book.json 不是对象');
  if (data.schemaVersion === SCHEMA_VERSION) return cloneJson(data);
  if (data.schemaVersion !== 2) fail('migration-version', `v2→v3 迁移要求 schemaVersion=2，当前为 ${data.schemaVersion}`);
  // 相同原账的纯迁移结果应确定；存储层可显式传入本次迁移时间。
  const migratedAt = now ?? data.updatedAt ?? data.createdAt ?? '1970-01-01T00:00:00.000Z';
  const next = cloneJson(data);
  next.schemaVersion = SCHEMA_VERSION;
  next.transactions = Array.isArray(next.transactions) ? next.transactions : [];
  next.integrity = isPlainObject(next.integrity)
    ? { algorithm: 'sha256', ledgerHash: null, bodyBindings: [], ...next.integrity }
    : { algorithm: 'sha256', ledgerHash: null, bodyBindings: [] };
  if (!Array.isArray(next.integrity.bodyBindings)) next.integrity.bodyBindings = [];
  if (!isPlainObject(next.chapters)) next.chapters = {};
  for (const decision of next.decisions ?? []) {
    if (!isPlainObject(decision)) continue;
    decision.nodeKind ??= 'decision';
    decision.gate ??= null;
    decision.sourceRefs ??= [];
    decision.detectKey ??= null;
    // 旧 options/evidence 只有短语；明确标记 legacy，不为其合成 offset/hash。
    decision.legacyEvidence ??= true;
  }
  next.audit = Array.isArray(next.audit) ? next.audit : [];
  if (!next.audit.some((entry) => entry?.action === 'migrate-0.10' && entry?.detail === 'schemaVersion 2 → 3')) {
    next.audit.push({ at: migratedAt, action: 'migrate-0.10', detail: 'schemaVersion 2 → 3' });
  }
  if (!Object.hasOwn(next, 'revision')) next.revision = (data.revisions?.length ?? 0) + (data.audit?.length ?? 0);
  next.integrity.ledgerHash = computeLedgerHash(next);
  return next;
}

/** 该章还没拍板的决策（proposed/asked/answered）。 */
export function openDecisions(decisions, chapter) {
  return decisions.filter(
    (decision) =>
      (chapter === undefined || decision.chapter === chapter) &&
      OPEN_DECISION_STATUSES.includes(decision.status),
  );
}

/** 该章已拍板、可以写正文的决策。 */
export function committedDecisions(decisions, chapter) {
  return decisions.filter(
    (decision) => decision.chapter === chapter && decision.status === DECISION_STATUS.COMMITTED,
  );
}

function nextSequenceId(list, prefix, width = 4) {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const entry of list) {
    const match = pattern.exec(String(entry?.id ?? ''));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(width, '0')}`;
}

export function nextSegmentId(segments) {
  return nextSequenceId(segments, 's');
}

export function nextRevisionId(revisions) {
  return nextSequenceId(revisions, 'r');
}

export function nextTaskId(tasks) {
  return nextSequenceId(tasks, 't');
}

export function nextForkId(forks) {
  return nextSequenceId(forks, 'f');
}

export function nextRequestId(requests, random = Math.random) {
  const used = new Set(requests.map((request) => request?.id).filter(Boolean));
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const suffix = Math.floor(random() * 0x1000000)
      .toString(16)
      .padStart(6, '0');
    const id = `q-${suffix}`;
    if (!used.has(id)) return id;
  }
  fail('id-exhausted', '生成作答凭据 ID 失败');
}

export function nextDecisionId(decisions, chapter, floor = 0) {
  const pattern = new RegExp(`^b${chapter}-(\\d+)$`);
  let max = Number(floor) || 0;
  for (const decision of decisions) {
    const match = pattern.exec(decision.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `b${chapter}-${max + 1}`;
}

export function nextObligationId(obligations) {
  let max = 0;
  for (const obligation of obligations) {
    const match = /^ob(\d+)$/.exec(obligation.id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `ob${max + 1}`;
}

export function applyChangesToCanon(canon, changes, { chapter, decisionId, now = nowIso(), override = false } = {}) {
  assertChapter(chapter);
  const next = canon.map((entry) => ({ ...entry }));
  const applied = [];
  const conflicts = [];
  const warnings = [];

  for (const change of changes) {
    const index = next.findIndex((entry) => entry.entity === change.entity && entry.key === change.key);
    if (index < 0) {
      next.push({
        entity: change.entity,
        key: change.key,
        value: change.to,
        chapter,
        decisionId,
        updatedAt: now,
      });
      applied.push({
        entity: change.entity,
        key: change.key,
        from: change.from ?? null,
        to: change.to,
        before: null,
      });
      if (change.from) warnings.push(`from-unverified:${change.entity}.${change.key}`);
      continue;
    }

    const current = next[index];
    if (current.value === change.to) {
      applied.push({
        entity: change.entity,
        key: change.key,
        from: change.from ?? null,
        to: change.to,
        before: current.value,
        noop: true,
      });
      continue;
    }

    if (current.decisionId !== decisionId) {
      // 合法推进：from 必须与 canon 当前值一致。这不是冲突，是故事状态在往前走。
      // 只有 from 缺失或对不上当前值，才说明作者/model 记错了状态，硬拒。
      if (change.from !== undefined && current.value === change.from) {
        applied.push({
          entity: change.entity,
          key: change.key,
          from: change.from,
          to: change.to,
          before: current.value,
          transition: true,
        });
        current.value = change.to;
        current.chapter = chapter;
        current.decisionId = decisionId;
        current.updatedAt = now;
        continue;
      }
      // 作者确认过"这次剧情可以改这个设定"（override）：按当前值覆盖，不当作冲突，
      // 但要在账本里留一条 canon-overridden 警告，事后能查出来这一处是作者亲手推翻的。
      if (override) {
        applied.push({
          entity: change.entity,
          key: change.key,
          from: current.value,
          to: change.to,
          before: current.value,
          overridden: true,
        });
        warnings.push(`canon-overridden:${change.entity}.${change.key}:${current.value}→${change.to}`);
        current.value = change.to;
        current.chapter = chapter;
        current.decisionId = decisionId;
        current.updatedAt = now;
        continue;
      }
      conflicts.push({
        entity: change.entity,
        key: change.key,
        current: current.value,
        from: change.from ?? null,
        to: change.to,
        decisionId: current.decisionId,
      });
      continue;
    }

    applied.push({
      entity: change.entity,
      key: change.key,
      from: change.from ?? null,
      to: change.to,
      before: current.value,
    });
    current.value = change.to;
    current.chapter = chapter;
    current.updatedAt = now;
  }

  if (conflicts.length > 0) return { canon, applied: [], conflicts, warnings };
  return { canon: next, applied, conflicts: [], warnings };
}

export function mergeObligations(obligations, additions, { decisionId, now = nowIso() } = {}) {
  const next = obligations.map((entry) => ({ ...entry }));
  const created = [];
  for (const addition of additions) {
    if (next.some((entry) => entry.text === addition.text && entry.sourceDecision === decisionId)) continue;
    const entry = {
      id: nextObligationId(next),
      text: addition.text,
      dueChapter: addition.dueChapter ?? null,
      status: OBLIGATION_STATUS.OPEN,
      sourceDecision: decisionId,
      evidence: addition.evidence,
      paidChapter: null,
      waivedReason: null,
      createdAt: now,
    };
    next.push(entry);
    created.push(entry);
  }
  return { obligations: next, created };
}

export function migrateLegacyChapter(chapter, raw, now = nowIso()) {
  assertChapter(chapter);
  const beats = Array.isArray(raw?.beats) ? raw.beats : [];
  return beats.map((beat, index) => {
    const decided =
      beat?.status === 'decided' || (typeof beat?.choice === 'string' && beat.choice.trim() !== '');
    const options = Array.isArray(beat?.options)
      ? beat.options.map((option) => ({
          label: typeof option?.label === 'string' ? option.label : '',
          impact: typeof option?.impact === 'string' ? option.impact : '',
          changes: [],
          obligations: [],
          forbidden: [],
        }))
      : [];
    return {
      id: `b${chapter}-${index + 1}`,
      chapter,
      title: typeof beat?.title === 'string' ? beat.title : `旧决策 ${index + 1}`,
      kind: KINDS.includes(beat?.kind) ? beat.kind : '分叉',
      change:
        typeof beat?.change === 'string' && beat.change.trim()
          ? beat.change
          : typeof beat?.title === 'string'
            ? beat.title
            : `旧决策 ${index + 1}`,
      status: decided ? 'decided' : 'pending',
      legacy: true,
      options,
      chosen: decided
        ? {
            label: typeof beat?.choice === 'string' ? beat.choice : '',
            impact: '',
            changes: [],
            obligations: [],
            forbidden: [],
          }
        : null,
      createdAt: typeof beat?.createdAt === 'string' ? beat.createdAt : now,
      decidedAt: decided ? (typeof beat?.decidedAt === 'string' ? beat.decidedAt : now) : null,
      supersededBy: null,
    };
  });
}
