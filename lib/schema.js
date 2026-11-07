// lib/schema.js — 0.6.0 数据结构、校验与纯函数
// 只依赖 Node 内置；不 import 任何第三方包，也不 import novel-forge。

export const SCHEMA_VERSION = 1;

export const KINDS = ['动作', '知情', '关系', '得失', '状态', '承诺', '时序', '分叉'];

export const DECISION_STATUS = Object.freeze({
  PENDING: 'pending',
  DECIDED: 'decided',
  SUPERSEDED: 'superseded',
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
  const change = asText(beat.change, `beats[${index}].change`, { min: 4, max: LIMITS.change });
  if (!Array.isArray(beat.options)) fail('bad-option', `beats[${index}].options 必须是数组`);
  if (beat.options.length < LIMITS.minOptions) fail('too-few-options', `beats[${index}].options 至少 ${LIMITS.minOptions} 个`);
  if (beat.options.length > LIMITS.maxOptions) fail('too-many-options', `beats[${index}].options 最多 ${LIMITS.maxOptions} 个`);
  const rawOptions = beat.options;
  const options = rawOptions.map((option, optionIndex) => normalizeOption(option, optionIndex, chapter));

  const labels = new Set();
  const changeSets = new Map();
  for (const option of options) {
    if (labels.has(option.label)) fail('duplicate-label', `beats[${index}] 的选项 label 重复：${option.label}`);
    labels.add(option.label);
    const setKey = changeSetKey(option.changes);
    if (changeSets.has(setKey)) {
      fail('duplicate-changes', `beats[${index}] 的选项 changes 相同：${option.label} 与 ${changeSets.get(setKey)}`);
    }
    changeSets.set(setKey, option.label);
  }

  return { title, kind, change, options };
}

export function normalizePlanBeats(beats, chapter) {
  assertChapter(chapter);
  if (!Array.isArray(beats)) fail('empty-beats', 'beats 必须是数组');
  if (beats.length === 0) fail('empty-beats', 'beats 不能为空');
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
  return {
    schemaVersion: SCHEMA_VERSION,
    book: name,
    meta: normalizeBookMeta(meta, name),
    createdAt: now,
    updatedAt: now,
    chapters: {},
    decisions: [],
    canon: [],
    obligations: [],
    audit: [],
  };
}

export function validateBook(data) {
  if (!isPlainObject(data)) fail('book-corrupt', 'book.json 不是对象');
  if (data.schemaVersion !== SCHEMA_VERSION) {
    fail('book-invalid', `不支持的 schemaVersion：${data.schemaVersion}`);
  }
  if (typeof data.book !== 'string' || !data.book) fail('book-corrupt', 'book.json 缺少 book');
  for (const key of ['decisions', 'canon', 'obligations', 'audit']) {
    if (!Array.isArray(data[key])) fail('book-corrupt', `book.json 缺少数组 ${key}`);
  }
  if (!isPlainObject(data.chapters)) fail('book-corrupt', 'book.json 缺少 chapters');

  const decisionIds = new Set();
  for (const decision of data.decisions) {
    if (!isPlainObject(decision) || typeof decision.id !== 'string' || !decision.id) {
      fail('book-corrupt', 'decisions 有条目缺少 id');
    }
    if (decisionIds.has(decision.id)) fail('book-corrupt', `decisions id 重复：${decision.id}`);
    decisionIds.add(decision.id);
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

  return data;
}

export function nextDecisionId(decisions, chapter) {
  const pattern = new RegExp(`^b${chapter}-(\\d+)$`);
  let max = 0;
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

export function applyChangesToCanon(canon, changes, { chapter, decisionId, now = nowIso() } = {}) {
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
