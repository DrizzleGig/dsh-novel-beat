// lib/verify.js — 写后确定性校验（纯函数；不调用模型，不做语义审稿）
// 只回答三件事：该发生的变化有没有证据、有没有踩禁项、到期的义务有没有回应。

function normalize(text) {
  return String(text).replace(/\s+/g, '');
}

function hasTerm(normalizedBody, term) {
  const needle = normalize(term);
  return needle.length > 0 && normalizedBody.includes(needle);
}

function activeDecisions(data, chapter) {
  return data.decisions.filter(
    (decision) => decision.chapter === chapter && decision.status !== 'superseded',
  );
}

/**
 * @param {object} data book.json
 * @param {number} chapter
 * @param {string} text 正文
 * @param {{strict?: boolean}} options strict=true 时缺证据算失败；false 时降级为 warning
 */
export function verifyChapter(data, chapter, text, { strict = true } = {}) {
  const decisions = activeDecisions(data, chapter);
  const failures = [];
  const warnings = [];
  const paidObligationIds = [];
  const stats = {
    decisions: decisions.length,
    changes: 0,
    covered: 0,
    forbiddenHits: 0,
    obligationsDue: 0,
  };

  if (decisions.length === 0) {
    failures.push({
      code: 'no-decisions',
      message: `第 ${chapter} 章还没有决策点；先 beat_plan，再写正文。`,
    });
    return { pass: false, failures, warnings, paidObligationIds, stats };
  }

  const body = normalize(text);

  for (const decision of decisions) {
    if (decision.status !== 'decided') {
      failures.push({
        code: 'not-decided',
        decisionId: decision.id,
        message: `决策点 ${decision.id} 还没有拍板。`,
      });
      continue;
    }

    if (decision.legacy) {
      warnings.push(`legacy-weak:${decision.id}:旧版决策只有拍板文本，没有结构化 changes，跳过严格校验`);
      continue;
    }

    const chosen = decision.chosen;
    if (!chosen) {
      failures.push({
        code: 'no-choice',
        decisionId: decision.id,
        message: `决策点 ${decision.id} 标记为已拍板，但没有 chosen。`,
      });
      continue;
    }

    const changes = Array.isArray(chosen.changes) ? chosen.changes : [];
    if (changes.length === 0) {
      warnings.push(`no-changes:${decision.id}:没有结构化 changes，无法校验状态变化`);
    }

    for (const change of changes) {
      stats.changes += 1;
      const evidence = Array.isArray(change.evidence) ? change.evidence : [];
      if (evidence.some((term) => hasTerm(body, term))) {
        stats.covered += 1;
        continue;
      }
      if (hasTerm(body, change.to)) {
        stats.covered += 1;
        warnings.push(
          `weak-evidence:${decision.id}:${change.entity}.${change.key}:正文只出现结果值「${change.to}」，没有出现证据短语`,
        );
        continue;
      }
      const message = `${change.entity}.${change.key} 应变成「${change.to}」，正文里找不到证据（${evidence.join(' / ')}）`;
      if (strict) {
        failures.push({
          code: 'missing-change',
          decisionId: decision.id,
          message,
          evidence,
        });
      } else {
        warnings.push(`missing-change:${decision.id}:${message}`);
      }
    }

    const forbidden = Array.isArray(chosen.forbidden) ? chosen.forbidden : [];
    for (const term of forbidden) {
      if (hasTerm(body, term)) {
        stats.forbiddenHits += 1;
        failures.push({
          code: 'forbidden-hit',
          decisionId: decision.id,
          message: `正文出现禁项「${term}」`,
        });
      }
    }
  }

  for (const obligation of data.obligations) {
    if (obligation.status !== 'open') continue;
    if (obligation.dueChapter === null || obligation.dueChapter === undefined) continue;
    if (obligation.dueChapter > chapter) continue;

    stats.obligationsDue += 1;
    const evidence = Array.isArray(obligation.evidence) ? obligation.evidence : [];
    if (evidence.some((term) => hasTerm(body, term))) {
      paidObligationIds.push(obligation.id);
    } else {
      warnings.push(
        `obligation-due:${obligation.id}:义务「${obligation.text}」应在第 ${obligation.dueChapter} 章前回应，正文没有证据`,
      );
    }
  }

  return {
    pass: failures.length === 0,
    failures,
    warnings,
    paidObligationIds,
    stats,
  };
}
