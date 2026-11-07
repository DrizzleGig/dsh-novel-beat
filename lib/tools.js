// lib/tools.js — 0.6.0 的七个工具：plan / list / decide / gate / compile / verify / adjust
// 工具本身不依赖任何其他插件；所有数据都在 <dir>/.dsh-novel-beat/<book>/book.json。

import {
  fail,
  assertBookName,
  assertChapter,
  normalizePlanBeats,
  normalizeCustomChoice,
  nextDecisionId,
  applyChangesToCanon,
  mergeObligations,
  changeSetKey,
  nowIso,
  KINDS,
  LIMITS,
} from './schema.js';
import { readBookData, mutateBookData, readChapterText, bookFilePath } from './store.js';
import { buildCompile } from './compile.js';
import { verifyChapter } from './verify.js';

function requireDir(args) {
  if (typeof args?.dir !== 'string' || args.dir.trim() === '') fail('bad-dir', 'dir 不能为空');
  return args.dir;
}

function activeDecisions(data, chapter) {
  return data.decisions.filter(
    (decision) => decision.chapter === chapter && decision.status !== 'superseded',
  );
}

function recentDecisions(data) {
  return data.decisions.slice(-5).map((decision) => ({
    id: decision.id,
    chapter: decision.chapter,
    title: decision.title,
    status: decision.status,
    choice: decision.chosen?.label ?? null,
    legacy: Boolean(decision.legacy),
  }));
}

function contextFor(data, chapter, entities) {
  const scoped = entities && entities.size > 0
    ? data.canon.filter((entry) => entities.has(entry.entity))
    : data.canon;
  const canon = scoped.slice(0, LIMITS.canonEntries).map((entry) => ({
    entity: entry.entity,
    key: entry.key,
    value: entry.value,
    chapter: entry.chapter,
    decisionId: entry.decisionId,
  }));
  const obligations = data.obligations
    .filter((obligation) => obligation.status === 'open')
    .map((obligation) => ({
      id: obligation.id,
      text: obligation.text,
      dueChapter: obligation.dueChapter,
      overdue: obligation.dueChapter !== null
        && obligation.dueChapter !== undefined
        && obligation.dueChapter <= chapter,
      evidence: obligation.evidence,
    }));
  return {
    canon,
    canonTruncated: scoped.length > LIMITS.canonEntries,
    obligations,
    recent: recentDecisions(data),
  };
}

function refreshChapter(data, chapter) {
  const list = activeDecisions(data, chapter);
  const decided = list.filter((decision) => decision.status === 'decided');
  const previous = data.chapters[String(chapter)] ?? {};
  data.chapters[String(chapter)] = {
    ...previous,
    status: list.length > 0 && decided.length === list.length ? 'decided' : 'pending',
    decisionIds: list.map((decision) => decision.id),
    verifiedAt: null,
  };
}

function simplifyDecision(decision) {
  return {
    id: decision.id,
    chapter: decision.chapter,
    title: decision.title,
    kind: decision.kind,
    change: decision.change,
    status: decision.status,
    legacy: Boolean(decision.legacy),
    choice: decision.chosen?.label ?? null,
    changes: decision.chosen?.changes ?? [],
    forbidden: decision.chosen?.forbidden ?? [],
    options: (decision.options ?? []).map((option) => ({
      label: option.label,
      impact: option.impact,
      changes: option.changes,
    })),
    decidedAt: decision.decidedAt ?? null,
  };
}

// ── beat_plan ────────────────────────────────────────────────────────────────

export async function executePlan(args) {
  const dir = requireDir(args);
  const book = assertBookName(args.book);
  const chapter = assertChapter(args.chapter);
  const beats = normalizePlanBeats(args.beats, chapter);
  if (args.append === true && args.reset === true) {
    fail('bad-args', 'append 与 reset 不能同时为 true');
  }
  const append = args.append === true;
  const reset = args.reset === true;

  const { result, warnings: storeWarnings } = await mutateBookData(dir, book, (data) => {
    const existing = activeDecisions(data, chapter);

    if (reset) {
      if (existing.some((decision) => decision.status === 'decided')) {
        fail('chapter-locked', '本章已有拍板，不能 reset；要改已拍板决策请用 beat_decide(supersede) 或 beat_adjust');
      }
      data.decisions = data.decisions.filter((decision) => decision.chapter !== chapter);
      delete data.chapters[String(chapter)];
      data.audit.push({ at: nowIso(), action: 'reset', chapter });
    } else if (existing.length > 0 && !append) {
      fail(
        'chapter-locked',
        `第 ${chapter} 章已有 ${existing.length} 个决策点；要追加用 append:true，要重排未拍板的用 reset:true`,
      );
    }

    const titles = new Set(existing.map((decision) => decision.title));
    for (const beat of beats) {
      if (titles.has(beat.title)) fail('duplicate-title', `本章已有同名决策点：${beat.title}`);
      titles.add(beat.title);
    }

    const warnings = [];
    const ids = [];
    const now = nowIso();

    for (const beat of beats) {
      const id = nextDecisionId(data.decisions, chapter);
      const decision = {
        id,
        chapter,
        title: beat.title,
        kind: beat.kind,
        change: beat.change,
        status: 'pending',
        legacy: false,
        options: beat.options,
        chosen: null,
        createdAt: now,
        decidedAt: null,
        supersededBy: null,
      };
      data.decisions.push(decision);
      ids.push(id);

      for (const option of beat.options) {
        for (const change of option.changes) {
          const current = data.canon.find(
            (entry) => entry.entity === change.entity && entry.key === change.key,
          );
          if (!current || current.value === change.to) continue;
          if (change.from !== undefined && current.value === change.from) continue;
          warnings.push(
            `canon-conflict-preview:${id}:${change.entity}.${change.key} 当前是「${current.value}」，选「${option.label}」会变成「${change.to}」`,
          );
        }
      }
    }

    refreshChapter(data, chapter);
    data.audit.push({ at: now, action: 'plan', chapter, count: beats.length });

    const list = activeDecisions(data, chapter);
    const entities = new Set();
    for (const beat of beats) {
      for (const option of beat.options) {
        for (const change of option.changes) entities.add(change.entity);
      }
    }
    return {
      total: list.length,
      pending: list.filter((decision) => decision.status !== 'decided').length,
      ids,
      warnings,
      context: contextFor(data, chapter, entities),
    };
  }, { create: true, meta: { title: book } });

  return {
    ok: true,
    book,
    chapter,
    path: bookFilePath(dir, book),
    ...result,
    warnings: [...storeWarnings, ...(result.warnings ?? [])],
  };
}

// ── beat_list ────────────────────────────────────────────────────────────────

export async function executeList(args) {
  const dir = requireDir(args);
  const book = assertBookName(args.book);
  const chapter = args.chapter === undefined || args.chapter === null
    ? null
    : assertChapter(args.chapter);

  const { data, warnings } = await readBookData(dir, book);
  const path = bookFilePath(dir, book);
  if (!data) {
    return { ok: true, exists: false, book, path, warnings: [...warnings, 'no-book'] };
  }

  if (args.context === true) {
    return {
      ok: true,
      exists: true,
      book,
      path,
      context: contextFor(data, chapter ?? 1, null),
      canonCount: data.canon.length,
      openObligations: data.obligations.filter((obligation) => obligation.status === 'open').length,
      warnings,
    };
  }

  if (chapter !== null) {
    let list = data.decisions.filter((decision) => decision.chapter === chapter);
    if (args.onlyPending === true) list = list.filter((decision) => decision.status === 'pending');
    return {
      ok: true,
      exists: true,
      book,
      path,
      chapter,
      decisions: list.map(simplifyDecision),
      warnings,
    };
  }

  const list = data.decisions.filter((decision) => decision.status !== 'superseded');
  const openObligations = data.obligations.filter((obligation) => obligation.status === 'open');
  return {
    ok: true,
    exists: true,
    book,
    path,
    chapters: Object.keys(data.chapters).length,
    pending: list.filter((decision) => decision.status !== 'decided').length,
    canonCount: data.canon.length,
    openObligations: openObligations.length,
    overdueObligations: openObligations.filter(
      (obligation) => obligation.dueChapter !== null
        && obligation.dueChapter !== undefined
        && obligation.dueChapter <= (chapter ?? 1),
    ).length,
    recent: recentDecisions(data),
    warnings,
  };
}

// ── beat_decide ──────────────────────────────────────────────────────────────

export async function executeDecide(args) {
  const dir = requireDir(args);
  const book = assertBookName(args.book);
  const chapter = assertChapter(args.chapter);
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  if (!id) fail('bad-id', 'id 不能为空');
  const choice = typeof args.choice === 'string' ? args.choice.trim() : '';
  if (!choice) fail('bad-choice', 'choice 不能为空');
  const supersede = args.supersede === true;
  const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
  const note = typeof args.note === 'string' ? args.note.trim() : '';

  const { result, warnings: storeWarnings } = await mutateBookData(dir, book, (data) => {
    const decision = data.decisions.find(
      (entry) => entry.id === id && entry.chapter === chapter,
    );
    if (!decision) fail('no-decision', `第 ${chapter} 章没有决策点 ${id}`);
    if (decision.status === 'superseded') {
      fail('decision-superseded', `决策点 ${id} 已被撤销；要重新拍板请先 beat_adjust 或重新 plan`);
    }

    const option = (decision.options ?? []).find((entry) => entry.label === choice) ?? null;
    let changes;
    let obligations;
    let forbidden;
    let impact = '';

    if (option) {
      changes = option.changes;
      obligations = option.obligations ?? [];
      forbidden = option.forbidden ?? [];
      impact = option.impact;
    } else {
      if (!Array.isArray(args.changes)) {
        fail('custom-changes-required', '作者自定义 choice 时必须同时给 changes（结构化状态变化）');
      }
      changes = normalizeCustomChoice(args.changes);
      obligations = [];
      forbidden = [];
    }

    const sameChanges = decision.chosen && Array.isArray(decision.chosen.changes)
      ? changeSetKey(decision.chosen.changes) === changeSetKey(changes)
      : false;

    if (decision.status === 'decided') {
      if (decision.chosen?.label === choice && sameChanges && !supersede) {
        const list = activeDecisions(data, chapter);
        return {
          id,
          status: 'decided',
          choice,
          remaining: list.filter((entry) => entry.status !== 'decided').length,
          total: list.length,
          idempotent: true,
          canonChanges: [],
          obligations: [],
          warnings: [],
        };
      }
      if (!supersede) {
        fail(
          'already-decided',
          `决策点 ${id} 已拍板为「${decision.chosen?.label ?? '（空）'}」；要改请传 supersede:true 和 reason`,
        );
      }
      if (!reason) fail('reason-required', '重拍已拍板决策必须写 reason（作者为什么改主意）');
    }

    const warnings = [];
    const applied = applyChangesToCanon(data.canon, changes, {
      chapter,
      decisionId: decision.id,
    });
    if (applied.conflicts.length > 0) {
      fail('canon-conflict', '与全书 canon 冲突', { conflicts: applied.conflicts });
    }
    data.canon = applied.canon;

    const oldOpen = data.obligations.filter(
      (obligation) => obligation.sourceDecision === decision.id && obligation.status === 'open',
    );
    if (supersede && oldOpen.length > 0) {
      warnings.push(
        `old-obligations-remain:${oldOpen.map((obligation) => obligation.id).join(',')}:旧选择留下的义务仍 open，需要 beat_adjust waive 或后续章节回应`,
      );
    }

    const merged = mergeObligations(data.obligations, obligations, {
      decisionId: decision.id,
    });
    data.obligations = merged.obligations;

    const previousChoice = decision.chosen?.label ?? null;
    decision.chosen = {
      label: choice,
      impact,
      changes,
      obligations,
      forbidden,
      custom: !option,
    };
    decision.status = 'decided';
    decision.decidedAt = nowIso();
    decision.supersededBy = null;
    if (note) decision.note = note;

    data.audit.push({
      at: decision.decidedAt,
      action: supersede ? 'supersede' : 'decide',
      chapter,
      decisionId: decision.id,
      choice,
      ...(previousChoice ? { previousChoice } : {}),
      ...(reason ? { reason } : {}),
      ...(note ? { note } : {}),
    });

    refreshChapter(data, chapter);
    const list = activeDecisions(data, chapter);
    return {
      id,
      status: 'decided',
      choice,
      remaining: list.filter((entry) => entry.status !== 'decided').length,
      total: list.length,
      canonChanges: applied.applied,
      obligations: merged.created,
      warnings: [...applied.warnings, ...warnings],
    };
  });

  return {
    ok: true,
    book,
    chapter,
    path: bookFilePath(dir, book),
    ...result,
    warnings: [...storeWarnings, ...(result.warnings ?? [])],
  };
}

// ── beat_gate ────────────────────────────────────────────────────────────────

export async function executeGate(args) {
  const dir = requireDir(args);
  const book = assertBookName(args.book);
  const chapter = assertChapter(args.chapter);
  const { data, warnings } = await readBookData(dir, book);

  if (!data) {
    return {
      ok: true,
      pass: false,
      book,
      chapter,
      total: 0,
      pending: [],
      message: `第 ${chapter} 章还没有账本；先调用 beat_plan。`,
      warnings: [...warnings, 'no-book'],
    };
  }

  const list = activeDecisions(data, chapter);
  if (list.length === 0) {
    return {
      ok: true,
      pass: false,
      book,
      chapter,
      total: 0,
      pending: [],
      message: `第 ${chapter} 章还没有决策点；先调用 beat_plan。`,
      warnings,
    };
  }

  const pending = list.filter((decision) => decision.status !== 'decided');
  const legacy = list.filter((decision) => decision.legacy);
  const gateWarnings = [...warnings];
  if (legacy.length > 0) {
    gateWarnings.push(`legacy:${legacy.map((decision) => decision.id).join(',')}:旧版决策只有拍板文本，verify 只能弱校验`);
  }

  return {
    ok: true,
    pass: pending.length === 0,
    book,
    chapter,
    total: list.length,
    pending: pending.map((decision) => ({ id: decision.id, title: decision.title })),
    message: pending.length === 0
      ? `第 ${chapter} 章 ${list.length} 个决策点全部拍板，可以写正文了。`
      : `第 ${chapter} 章还有 ${pending.length} 个决策点未拍板，不能写正文。`,
    warnings: gateWarnings,
  };
}

// ── beat_compile ─────────────────────────────────────────────────────────────

export async function executeCompile(args) {
  const dir = requireDir(args);
  const book = assertBookName(args.book);
  const chapter = assertChapter(args.chapter);
  const format = args.format ?? 'self';
  const { data, warnings } = await readBookData(dir, book);
  if (!data) fail('no-book', `书「${book}」还没有账本，请先 beat_plan`);

  const out = buildCompile(data, chapter, format);
  return {
    ok: true,
    book,
    chapter,
    path: bookFilePath(dir, book),
    ...out,
    warnings: [...warnings, ...out.warnings],
  };
}

// ── beat_verify ──────────────────────────────────────────────────────────────

export async function executeVerify(args) {
  const dir = requireDir(args);
  const book = assertBookName(args.book);
  const chapter = assertChapter(args.chapter);
  const hasText = typeof args.text === 'string' && args.text.trim() !== '';
  const hasPath = typeof args.path === 'string' && args.path.trim() !== '';
  if (hasText && hasPath) fail('bad-args', 'text 与 path 只能给一个');
  if (!hasText && !hasPath) fail('bad-args', '必须给 text 或 path');

  let body = args.text;
  let resolvedPath = null;
  if (hasPath) {
    const read = await readChapterText(dir, args.path);
    body = read.text;
    resolvedPath = read.path;
  }

  const strict = args.strict !== false;
  const { data: before, warnings: readWarnings } = await readBookData(dir, book);
  if (!before) fail('no-book', `书「${book}」还没有账本，请先 beat_plan`);

  const first = verifyChapter(before, chapter, body, { strict });
  if (!strict) first.warnings.push('strict-off:缺证据按 warning 处理，章节仍可标记 verified');

  if (!first.pass) {
    return {
      ok: true,
      book,
      chapter,
      path: resolvedPath,
      verified: false,
      ...first,
      warnings: [...readWarnings, ...first.warnings],
    };
  }

  const { result, warnings: writeWarnings } = await mutateBookData(dir, book, (data) => {
    const check = verifyChapter(data, chapter, body, { strict });
    if (!check.pass) fail('verify-race', '账本在写入前发生了变化，请重试');
    if (!strict) check.warnings.push('strict-off:缺证据按 warning 处理，章节仍可标记 verified');

    const now = nowIso();
    const previous = data.chapters[String(chapter)] ?? {};
    data.chapters[String(chapter)] = {
      ...previous,
      status: 'verified',
      decisionIds: activeDecisions(data, chapter).map((decision) => decision.id),
      verifiedAt: now,
    };

    const paid = [];
    for (const obligationId of check.paidObligationIds) {
      const obligation = data.obligations.find((entry) => entry.id === obligationId);
      if (obligation && obligation.status === 'open') {
        obligation.status = 'paid';
        obligation.paidChapter = chapter;
        paid.push(obligationId);
      }
    }
    data.audit.push({ at: now, action: 'verify', chapter, paid });
    return { ...check, verified: true, paidObligationIds: paid };
  });

  return {
    ok: true,
    book,
    chapter,
    path: resolvedPath,
    ...result,
    warnings: [...readWarnings, ...writeWarnings, ...result.warnings],
  };
}

// ── beat_adjust ──────────────────────────────────────────────────────────────

export async function executeAdjust(args) {
  const dir = requireDir(args);
  const book = assertBookName(args.book);
  const action = args.action;
  if (action !== 'waive' && action !== 'supersede') {
    fail('bad-action', 'action 只能是 waive / supersede');
  }
  const id = typeof args.id === 'string' ? args.id.trim() : '';
  if (!id) fail('bad-id', 'id 不能为空');
  const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
  if (!reason) fail('reason-required', 'waive / supersede 必须写 reason');

  const { result, warnings } = await mutateBookData(dir, book, (data) => {
    if (action === 'waive') {
      const obligation = data.obligations.find((entry) => entry.id === id);
      if (!obligation) fail('no-obligation', `没有义务 ${id}`);
      if (obligation.status === 'paid') fail('already-paid', `义务 ${id} 已在第 ${obligation.paidChapter} 章回收`);
      if (obligation.status === 'waived') {
        return { id, status: 'waived', already: true };
      }
      obligation.status = 'waived';
      obligation.waivedReason = reason;
      data.audit.push({ at: nowIso(), action: 'waive', obligationId: id, reason });
      return { id, status: 'waived' };
    }

    const decision = data.decisions.find((entry) => entry.id === id);
    if (!decision) fail('no-decision', `没有决策点 ${id}`);
    if (decision.status === 'superseded') {
      return { id, status: 'superseded', already: true };
    }
    if (decision.status !== 'decided') {
      fail('not-decided', `决策点 ${id} 还没有拍板，不能 supersede`);
    }

    const owned = data.canon.filter((entry) => entry.decisionId === id);
    data.canon = data.canon.filter((entry) => entry.decisionId !== id);

    const waived = [];
    for (const obligation of data.obligations) {
      if (obligation.sourceDecision === id && obligation.status === 'open') {
        obligation.status = 'waived';
        obligation.waivedReason = `决策被撤销：${reason}`;
        waived.push(obligation.id);
      }
    }

    decision.status = 'superseded';
    decision.supersededBy = null;
    data.audit.push({
      at: nowIso(),
      action: 'supersede',
      decisionId: id,
      reason,
      removedCanon: owned.length,
      waivedObligations: waived,
      ...(Array.isArray(args.changes) ? { changes: args.changes } : {}),
    });
    refreshChapter(data, decision.chapter);
    return {
      id,
      status: 'superseded',
      removedCanon: owned.length,
      waivedObligations: waived.length,
    };
  });

  return {
    ok: true,
    book,
    action,
    path: bookFilePath(dir, book),
    ...result,
    warnings,
  };
}

// ── 工具定义 ─────────────────────────────────────────────────────────────────

const evidenceSchema = {
  type: 'array',
  items: { type: 'string' },
  minItems: 1,
  maxItems: 3,
  description: '正文里必须出现的证据短语（2–24 字），任一条出现即算覆盖',
};

const changeSchema = {
  type: 'object',
  properties: {
    entity: { type: 'string', description: '实体（人物/物品/地点/组织）' },
    key: { type: 'string', description: '状态键（持有者/位置/境界/关系…）' },
    from: { type: 'string', description: '变化前的值；改已有 canon 时必须与当前值一致' },
    to: { type: 'string', description: '变化后的值' },
    evidence: evidenceSchema,
  },
  required: ['entity', 'key', 'to', 'evidence'],
};

const obligationSchema = {
  type: 'object',
  properties: {
    text: { type: 'string', description: '义务/后果/伏笔，例如「同场出价人记恨林砚」' },
    dueChapter: { type: 'number', description: '预计回收章号；不填则无期限' },
    evidence: evidenceSchema,
  },
  required: ['text', 'evidence'],
};

const optionSchema = {
  type: 'object',
  properties: {
    label: { type: 'string', description: '选项文本，作者会看到它' },
    impact: { type: 'string', description: '选了会发生什么：影响、后续、代价、伏笔' },
    changes: { type: 'array', items: changeSchema, minItems: 1, maxItems: 8 },
    obligations: { type: 'array', items: obligationSchema, maxItems: 6 },
    forbidden: { type: 'array', items: { type: 'string' }, maxItems: 6 },
  },
  required: ['label', 'impact', 'changes'],
};

const beatSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: '一句话标题' },
    kind: { type: 'string', enum: KINDS },
    change: { type: 'string', description: '谁/什么 从 A 变成 B（至少 4 字）' },
    options: { type: 'array', items: optionSchema, minItems: 2, maxItems: 4 },
  },
  required: ['title', 'kind', 'change', 'options'],
};

const output = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{
    type: 'text',
    text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
  }],
};

const compileOutput = {
  schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => {
    if (value.missing?.length) {
      return [{
        type: 'text',
        text: `还有 ${value.missing.length} 个决策点未拍板：${value.missing.map((item) => `${item.id} ${item.title}`).join('、')}`,
      }];
    }
    return [{ type: 'text', text: value.markdown || '本章还没有决策点。' }];
  },
};

const dirParam = { type: 'string', description: '工作区目录（绝对路径）' };
const bookParam = { type: 'string', description: '书名' };
const chapterParam = { type: 'number', description: '章号（1–9999）' };

export function toolDefinitions() {
  return [
    {
      name: 'beat_plan',
      description: '登记本章会改变故事状态的决策点。每个决策点给 2–4 个真分叉；每个选项必须写 impact 和 changes（entity/key/from/to/evidence），不同选项的 changes 必须不同。已拍板的章不能重排；追加用 append:true，重排未拍板的用 reset:true。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam,
          book: bookParam,
          chapter: chapterParam,
          beats: { type: 'array', items: beatSchema, minItems: 1, maxItems: 20 },
          append: { type: 'boolean', description: '追加到本章已有决策点后面，保留已拍板' },
          reset: { type: 'boolean', description: '清空本章未拍板决策点后重排；有已拍板时拒绝' },
        },
        required: ['dir', 'book', 'chapter', 'beats'],
        additionalProperties: false,
      },
      output,
      execute: executePlan,
    },
    {
      name: 'beat_list',
      description: '查看账本。不传 chapter 看全书概览；传 chapter 看本章决策（含选项）；context:true 看全书 canon、未回收义务和最近决策。写下一章前先看 context。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam,
          book: bookParam,
          chapter: chapterParam,
          onlyPending: { type: 'boolean', description: '只列未拍板的决策点' },
          context: { type: 'boolean', description: '返回全书 canon + 未回收义务 + 最近 5 条决策' },
        },
        required: ['dir', 'book'],
        additionalProperties: false,
      },
      output,
      execute: executeList,
    },
    {
      name: 'beat_decide',
      description: '记录作者的拍板。choice 精确匹配选项 label；作者自定义的内容必须同时给 changes。已拍板的决策要改，传 supersede:true 和 reason；canon 冲突（from 与当前值对不上）会被硬拒。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam,
          book: bookParam,
          chapter: chapterParam,
          id: { type: 'string', description: '决策点 id，如 b1-1' },
          choice: { type: 'string', description: '作者选的 label，或作者自己写的原话' },
          changes: { type: 'array', items: changeSchema, minItems: 1, maxItems: 8, description: '自定义 choice 必填' },
          note: { type: 'string', description: '可选备注' },
          supersede: { type: 'boolean', description: '重拍已拍板决策时必须为 true' },
          reason: { type: 'string', description: '重拍原因（作者为什么改主意）' },
        },
        required: ['dir', 'book', 'chapter', 'id', 'choice'],
        additionalProperties: false,
      },
      output,
      execute: executeDecide,
    },
    {
      name: 'beat_gate',
      description: '检查本章是否所有决策点都已拍板。pass=false 时不许写正文。',
      parameters: {
        type: 'object',
        properties: { dir: dirParam, book: bookParam, chapter: chapterParam },
        required: ['dir', 'book', 'chapter'],
        additionalProperties: false,
      },
      output,
      execute: executeGate,
    },
    {
      name: 'beat_compile',
      description: '把本章已拍板决策编译成写作约束。默认 self 格式，自带「必须发生 / 不得出现 / 义务 / 全书 canon」；novel-forge 只是兼容导出。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam,
          book: bookParam,
          chapter: chapterParam,
          format: { type: 'string', enum: ['self', 'novel-forge'], description: '默认 self' },
        },
        required: ['dir', 'book', 'chapter'],
        additionalProperties: false,
      },
      output: compileOutput,
      execute: executeCompile,
    },
    {
      name: 'beat_verify',
      description: '写后校验：正文（text 或 path）是否出现每个变化的证据、是否踩禁项、到期的义务是否回应。失败要改稿；通过后标记 verified。path 只接受工作区内 .md/.txt（≤2MB）。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam,
          book: bookParam,
          chapter: chapterParam,
          text: { type: 'string', description: '正文全文（与 path 二选一）' },
          path: { type: 'string', description: '工作区内正文文件路径（与 text 二选一）' },
          strict: { type: 'boolean', description: '默认 true；false 时缺证据降级为 warning' },
        },
        required: ['dir', 'book', 'chapter'],
        additionalProperties: false,
      },
      output,
      execute: executeVerify,
    },
    {
      name: 'beat_adjust',
      description: '仅当作者明确要求时使用。waive：放弃一条义务；supersede：撤销一条已拍板决策（删它的 canon，并 waive 它留下的未回收义务）。两者都必须写 reason。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam,
          book: bookParam,
          action: { type: 'string', enum: ['waive', 'supersede'] },
          id: { type: 'string', description: '义务 id（ob1）或决策 id（b1-1）' },
          reason: { type: 'string', description: '作者为什么放弃/撤销' },
          changes: { type: 'array', items: changeSchema, description: '可选：只记录，不新建决策' },
        },
        required: ['dir', 'book', 'action', 'id', 'reason'],
        additionalProperties: false,
      },
      output,
      execute: executeAdjust,
    },
  ];
}
