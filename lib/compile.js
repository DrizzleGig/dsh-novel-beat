// lib/compile.js — 把已拍板决策编译成写作约束
// self 是 0.6.0 的默认格式，自带「必须发生 / 不得出现 / 义务 / canon」；
// novel-forge 只是兼容导出，不再作为主路径。

import { fail, DECISION_STATUS } from './schema.js';

export const COMPILE_FORMATS = ['self', 'novel-forge'];

function activeDecisions(data, chapter) {
  return data.decisions.filter(
    (decision) => decision.chapter === chapter && decision.status !== 'superseded',
  );
}

function chosenOf(decision) {
  return decision.chosen && typeof decision.chosen.label === 'string' ? decision.chosen : null;
}

function formatEvidence(ref) {
  if (typeof ref === 'string') return ref;
  if (!ref || typeof ref !== 'object') return '';
  const quote = typeof ref.quote === 'string' ? ref.quote : ref.label ?? '';
  const location = ref.file
    ? `${ref.file}:${ref.offsetStart}–${ref.offsetEnd}`
    : ref.sourceId ?? '';
  return `「${quote}」${location ? `［${location}］` : ''}`;
}

function formatChange(change, structured = false) {
  const label = (field) => structured ? change[`${field}Label`] ?? change[field] : change[field];
  const from = label('from') ? `${label('from')} → ` : '';
  const evidence = Array.isArray(change.evidence) && change.evidence.length > 0
    ? `（证据：${structured ? change.evidence.map(formatEvidence).join('、') : change.evidence.join('、')}）`
    : '';
  return `  - ${label('entity')}.${label('key')}：${from}${label('to')}${evidence}`;
}

function renderGateDetails(decision, chosen) {
  if (!decision.gate) return [];
  const lines = [
    '- 触发差分（候选检查依据，不等于作者选择的结果）：',
    formatChange(decision.gate, true),
    `- 触发理由：${decision.gate.reason}`,
  ];
  if (!chosen) return lines;
  lines.push(`- 行动：${chosen.action ?? '（未记录）'}`);
  lines.push(`- 代价：${(chosen.costs ?? []).join('、') || '（无）'}`);
  for (const [field, title] of [['outcomes', '后果'], ['informationGain', '信息增益'], ['risks', '风险']]) {
    lines.push(`- ${title}（推演不得作为既成事实）：`);
    if (!chosen[field]?.length) lines.push('  - （无）');
    for (const claim of chosen[field] ?? []) {
      const basis = claim.basis === 'known-fact' ? '已知事实' : '推演，尚未发生';
      const refs = (claim.sourceRefs ?? []).map(formatEvidence).join('、');
      lines.push(`  - 【${basis}】${claim.text}${refs ? `（依据：${refs}）` : ''}`);
    }
  }
  return lines;
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
        ...(decision.gate ? {
          gate: decision.gate,
          detectKey: decision.detectKey ?? null,
          sourceRefs: decision.sourceRefs ?? [],
          chosen,
        } : {}),
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
    lines.push(...renderGateDetails(decision, chosen));

    if (decision.legacy) {
      lines.push(`- 旧版决策，只有拍板文本，没有结构化 changes：${decision.change}`);
      lines.push('- 旧版决策不参与严格校验；建议重新 beat_plan / beat_decide。');
    } else if (chosen && Array.isArray(chosen.changes) && chosen.changes.length > 0) {
      lines.push('- 必须发生：');
      for (const change of chosen.changes) lines.push(formatChange(change, Boolean(decision.gate)));
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
      const source = data.decisions.find((decision) => decision.id === obligation.sourceDecision);
      const evidence = obligation.evidence?.length
        ? `；证据：${source?.gate ? obligation.evidence.map(formatEvidence).join('、') : obligation.evidence.join('、')}`
        : '';
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
    const summary = `- ${decision.title}：${decision.change}（已拍板：${choice}）`;
    if (!decision.gate) return summary;
    return [
      summary,
      ...renderGateDetails(decision, chosen),
      '- 必须发生：',
      ...(chosen?.changes ?? []).map((change) => formatChange(change, true)),
    ].join('\n');
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

  const pending = decisions.filter((decision) => decision.status !== DECISION_STATUS.COMMITTED);
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
