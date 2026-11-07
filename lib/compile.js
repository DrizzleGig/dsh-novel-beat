// lib/compile.js — 把已拍板决策编译成写作约束
// self 是 0.6.0 的默认格式，自带「必须发生 / 不得出现 / 义务 / canon」；
// novel-forge 只是兼容导出，不再作为主路径。

import { fail } from './schema.js';

export const COMPILE_FORMATS = ['self', 'novel-forge'];

function activeDecisions(data, chapter) {
  return data.decisions.filter(
    (decision) => decision.chapter === chapter && decision.status !== 'superseded',
  );
}

function chosenOf(decision) {
  return decision.chosen && typeof decision.chosen.label === 'string' ? decision.chosen : null;
}

function formatChange(change) {
  const from = change.from ? `${change.from} → ` : '';
  const evidence = Array.isArray(change.evidence) && change.evidence.length > 0
    ? `（证据：${change.evidence.join('、')}）`
    : '';
  return `  - ${change.entity}.${change.key}：${from}${change.to}${evidence}`;
}

function dueObligations(data, chapter) {
  return data.obligations.filter(
    (obligation) =>
      obligation.status === 'open' &&
      obligation.dueChapter !== null &&
      obligation.dueChapter !== undefined &&
      obligation.dueChapter <= chapter,
  );
}

function buildContract(data, chapter, decisions) {
  return {
    chapter,
    decisions: decisions.map((decision) => {
      const chosen = chosenOf(decision);
      return {
        id: decision.id,
        title: decision.title,
        change: decision.change,
        legacy: Boolean(decision.legacy),
        choice: chosen ? chosen.label : null,
        changes: chosen && Array.isArray(chosen.changes) ? chosen.changes : [],
        forbidden: chosen && Array.isArray(chosen.forbidden) ? chosen.forbidden : [],
      };
    }),
    obligations: dueObligations(data, chapter).map((obligation) => ({
      id: obligation.id,
      text: obligation.text,
      dueChapter: obligation.dueChapter,
      evidence: obligation.evidence,
    })),
    canon: data.canon.map((entry) => ({
      entity: entry.entity,
      key: entry.key,
      value: entry.value,
      chapter: entry.chapter,
    })),
  };
}

function renderSelf(data, chapter, decisions) {
  const lines = ['## 本章决策约束', ''];

  for (const decision of decisions) {
    const chosen = chosenOf(decision);
    lines.push(`### ${decision.id} ${decision.title}`);
    lines.push(`- 已拍板：${chosen ? chosen.label : '（未记录）'}`);

    if (decision.legacy) {
      lines.push(`- 旧版决策，只有拍板文本，没有结构化 changes：${decision.change}`);
      lines.push('- 旧版决策不参与严格校验；建议重新 beat_plan / beat_decide。');
    } else if (chosen && Array.isArray(chosen.changes) && chosen.changes.length > 0) {
      lines.push('- 必须发生：');
      for (const change of chosen.changes) lines.push(formatChange(change));
    } else {
      lines.push(`- 必须发生：${decision.change}`);
    }

    const forbidden = chosen && Array.isArray(chosen.forbidden) ? chosen.forbidden : [];
    if (forbidden.length > 0) lines.push(`- 不得出现：${forbidden.join('、')}`);
    lines.push('');
  }

  const obligations = dueObligations(data, chapter);
  lines.push('## 本章必须回应的既有义务');
  if (obligations.length === 0) {
    lines.push('- （无）');
  } else {
    for (const obligation of obligations) {
      const due = obligation.dueChapter === null || obligation.dueChapter === undefined
        ? '无期限'
        : `第 ${obligation.dueChapter} 章前`;
      const evidence = obligation.evidence?.length ? `；证据：${obligation.evidence.join('、')}` : '';
      lines.push(`- ${obligation.id} ${obligation.text}（${due}${evidence}）`);
    }
  }
  lines.push('');

  lines.push('## 全书 canon（不得违反）');
  if (data.canon.length === 0) {
    lines.push('- （无）');
  } else {
    for (const entry of data.canon) {
      lines.push(`- ${entry.entity}.${entry.key} = ${entry.value}（第 ${entry.chapter} 章）`);
    }
  }

  return lines.join('\n');
}

function renderForge(data, chapter, decisions) {
  const scenes = decisions.map((decision) => {
    const chosen = chosenOf(decision);
    const choice = chosen ? chosen.label : '（未记录）';
    return `- ${decision.title}：${decision.change}（已拍板：${choice}）`;
  });
  const forbidden = [];
  for (const decision of decisions) {
    const chosen = chosenOf(decision);
    forbidden.push(`- 不得改写已拍板决策：${decision.title} → ${chosen ? chosen.label : '（未记录）'}`);
    if (chosen && Array.isArray(chosen.forbidden)) {
      for (const term of chosen.forbidden) forbidden.push(`- 不得出现：${term}`);
    }
  }
  forbidden.push('- 环境、天气、比喻、氛围等不影响走向的描写可自由发挥，但不得改变上述任何一条已拍板决策');

  return [
    '## 本章必写场景',
    ...scenes,
    '',
    '## 本章禁止偏离项',
    ...forbidden,
  ].join('\n');
}

/**
 * 生成编译结果。
 * - 本章没有决策点：返回空 markdown + warning no-decisions。
 * - 有未拍板：返回 missing，不产出 markdown。
 * - 全部拍板：按 format 产出 markdown + contract。
 */
export function buildCompile(data, chapter, format = 'self') {
  if (!COMPILE_FORMATS.includes(format)) {
    fail('bad-format', `format 只能是 ${COMPILE_FORMATS.join(' / ')}`);
  }

  const decisions = activeDecisions(data, chapter);
  const warnings = [];

  if (decisions.length === 0) {
    return {
      markdown: '',
      contract: null,
      missing: [],
      warnings: ['no-decisions:本章还没有决策点，先调用 beat_plan'],
    };
  }

  const pending = decisions.filter((decision) => decision.status !== 'decided');
  if (pending.length > 0) {
    return {
      markdown: '',
      contract: null,
      missing: pending.map((decision) => ({ id: decision.id, title: decision.title })),
      warnings,
    };
  }

  if (format === 'novel-forge') {
    warnings.push('novel-forge 格式已废弃：0.6.0 默认 self，此输出只做兼容。');
  }
  if (decisions.some((decision) => decision.legacy)) {
    warnings.push('legacy:本章有旧版决策，只有拍板文本，没有结构化 changes，严格校验会跳过。');
  }

  const contract = buildContract(data, chapter, decisions);
  const markdown = format === 'novel-forge'
    ? renderForge(data, chapter, decisions)
    : renderSelf(data, chapter, decisions);

  return { markdown, contract, missing: [], warnings };
}
