// 0.10.0 状态差分闸门：结构化候选只在全部证据与选项检查通过后进入账本。
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolveBodyFile, normalizeNewlines, sliceHash } from './segment.js';
import { fail, DECISION_STATUS, STATE_KEY_ALLOWLIST } from './schema.js';
export { STATE_KEY_ALLOWLIST } from './schema.js';

function digest(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : stableStringify(value), 'utf8').digest('hex');
}

export function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashText(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function stateId(value, field) {
  if (typeof value !== 'string' || value.length > 120 || !/^[a-z0-9][a-z0-9._:/-]*$/u.test(value)) {
    fail('bad-state-id', `${field} 必须是小写字母/数字及 ._:/- 组成的稳定 ID；显示文本放在对应 Label 中`);
  }
  return value;
}

function deltaKey(delta) {
  return [delta.entity, delta.key, delta.from, delta.to].join('\u0000');
}

function optionDeltaKey(option) {
  return (option.changes ?? []).map(deltaKey).sort().join('\u0001');
}

function evidenceRefs(beat) {
  const refs = [...(beat.gate?.evidence ?? [])];
  for (const option of beat.options ?? []) {
    for (const delta of option.changes ?? []) refs.push(...(delta.evidence ?? []));
    for (const field of ['costs', 'outcomes', 'informationGain', 'risks']) {
      for (const claim of option[field] ?? []) refs.push(...(claim.sourceRefs ?? []));
    }
  }
  return refs;
}

export async function verifyEvidenceRef(dir, data, ref, chapter, { allowAppend = false } = {}) {
  if (!ref || !['body', 'outline', 'canon', 'author'].includes(ref.kind)) {
    fail('bad-evidence-ref', '证据必须声明 body/outline/canon/author 来源类型');
  }
  if (ref.kind === 'body' || ref.kind === 'outline') {
    const source = await resolveBodyFile(dir, ref.file);
    const bytes = await readFile(source.real);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const text = bytes.toString('utf8');
    const appendOnly = allowAppend && ref.kind === 'body' && Number.isInteger(ref.sourceLength)
      && ref.sourceLength >= ref.offsetEnd && ref.sourceLength <= text.length
      && hashText(text.slice(0, ref.sourceLength)) === ref.hash;
    if (hash !== ref.hash && !appendOnly) fail('stale-evidence', `证据文件已改变：${ref.file} 的 hash 不匹配`);
    if (!Number.isInteger(ref.offsetStart) || !Number.isInteger(ref.offsetEnd)
      || ref.offsetStart < 0 || ref.offsetEnd <= ref.offsetStart
      || ref.offsetEnd > text.length || text.slice(ref.offsetStart, ref.offsetEnd) !== ref.quote) {
      fail('evidence-offset-mismatch', `证据 ${ref.file} 的 offset 与 quote 不匹配；不做模糊重定位`);
    }
    let segmentId = ref.segmentId;
    if (segmentId) {
      const segment = (data.segments ?? []).find((item) => item.id === segmentId
        && item.status !== 'reverted' && item.status !== 'stale');
      // legacy segment offsets use normalized LF; EvidenceRef offsets always use raw UTF-16.
      const start = normalizeNewlines(text.slice(0, ref.offsetStart)).length;
      const end = normalizeNewlines(text.slice(0, ref.offsetEnd)).length;
      if (!segment || segment.file?.replaceAll('\\', '/') !== source.rel
        || (ref.chapter !== undefined && ref.chapter !== segment.chapter)
        || start < segment.offsetStart || end > segment.offsetEnd
        || segment.offsetEnd > normalizeNewlines(text).length
        || segment.hash !== sliceHash(text, segment.offsetStart, segment.offsetEnd)) {
        fail('stale-evidence', `证据所指段落 ${segmentId} 已不存在、已回退或不包含该范围`);
      }
    }
    return { ...ref, file: source.rel, sourceLength: ref.sourceLength ?? text.length, ...(segmentId ? { segmentId } : {}) };
  }
  if (ref.kind === 'canon') {
    const sourceDecision = (data.decisions ?? []).find((item) => item.id === ref.sourceId);
    const sourceCanon = (data.canon ?? []).find((item) => item.id === ref.sourceId || item.decisionId === ref.sourceId);
    if (sourceDecision?.status === DECISION_STATUS.SUPERSEDED || sourceDecision?.status === DECISION_STATUS.CANCELLED
      || ((!sourceDecision || sourceDecision.status !== DECISION_STATUS.COMMITTED)
        && (!sourceCanon || sourceCanon.status === 'superseded'))) {
      fail('stale-evidence', `canon 来源 ${ref.sourceId} 不存在或已失效`);
    }
    const quotes = new Set([
      sourceCanon?.value,
      ...(sourceDecision?.chosen?.changes ?? []).filter((change) => (data.canon ?? []).some((entry) =>
        entry.decisionId === sourceDecision.id && entry.entity === change.entity && entry.key === change.key
        && entry.value === change.to && entry.status !== 'superseded'))
        .flatMap((change) => [change.to, change.toLabel]),
    ].filter((value) => typeof value === 'string'));
    if (!quotes.has(ref.quote)) fail('stale-evidence', `EvidenceRef quote 与 canon 来源 ${ref.sourceId} 不匹配`);
    return ref;
  }
  const request = (data.requests ?? []).find((item) => item.id === ref.sourceId && item.answeredAt);
  if (!request) fail('stale-evidence', `作者来源 ${ref.sourceId} 不是已回答的 request receipt`);
  const authorQuotes = [
    ...(request.answer?.selected ?? []),
    request.answer?.custom,
  ].filter((value) => typeof value === 'string');
  if (!authorQuotes.includes(ref.quote)) fail('stale-evidence', `EvidenceRef quote 与作者回执 ${ref.sourceId} 不匹配`);
  return ref;
}

export async function validateEvidenceRefs(dir, data, refs, chapter, options = {}) {
  for (const ref of refs ?? []) await verifyEvidenceRef(dir, data, ref, chapter, options);
  return true;
}

/** Submitted evidence stays bound to its exact original bytes. After an author
 * commit, the same body may only grow after that verified prefix; no relocation. */
export async function validateDecisionEvidence(dir, data, decision) {
  if (!decision.gate || decision.legacyEvidence) return;
  const refs = [...(decision.sourceRefs ?? []), ...evidenceRefs(decision)];
  if (decision.chosen) refs.push(...evidenceRefs({ options: [decision.chosen] }));
  await validateEvidenceRefs(dir, data, refs, decision.chapter, {
    allowAppend: decision.status === DECISION_STATUS.COMMITTED,
  });
  if (decision.segmentId) {
    const segment = (data.segments ?? []).find((entry) => entry.id === decision.segmentId);
    if (!segment || segment.status !== 'committed') fail('stale-evidence', `决策 ${decision.id} 的输出段已经失效`);
    const source = await resolveBodyFile(dir, segment.file);
    if (segment.offsetEnd > source.text.length
      || segment.hash !== sliceHash(source.text, segment.offsetStart, segment.offsetEnd)) {
      fail('stale-evidence', `决策 ${decision.id} 的输出段 ${segment.id} 已改变`);
    }
  }
}

export async function validateSelectedOption(dir, data, decision, option, { allowAppend = false } = {}) {
  const peerless = { ...data, decisions: data.decisions.filter((entry) => entry.id !== decision.id) };
  const beat = { gate: decision.gate, options: [option] };
  validateKnownKeys(beat);
  qualityCheck(beat, peerless, decision.chapter);
  await validateEvidenceRefs(dir, data, evidenceRefs(beat), decision.chapter, { allowAppend });
  const result = structuredClone(option);
  for (const delta of result.changes) {
    delta.evidence = await Promise.all(delta.evidence.map((ref) => verifyEvidenceRef(dir, data, ref, decision.chapter, { allowAppend })));
  }
  for (const field of ['outcomes', 'informationGain', 'risks']) {
    for (const claim of result[field]) {
      if (claim.basis === 'known-fact' && !claim.sourceRefs.length) fail('missing-evidence', '已知事实必须有可回查来源');
      claim.sourceRefs = await Promise.all(claim.sourceRefs.map((ref) => verifyEvidenceRef(dir, data, ref, decision.chapter, { allowAppend })));
    }
  }
  return result;
}

function currentCanon(data, entity, key) {
  return (data.canon ?? []).find((entry) => entry.entity === entity && entry.key === key) ?? null;
}

function validateKnownKeys(beat) {
  const deltas = [
    ...(beat.options ?? []).flatMap((option) => option.changes ?? []),
    beat.gate,
  ].filter(Boolean);
  for (const delta of deltas) {
    stateId(delta.entity, 'entity');
    stateId(delta.key, 'key');
    stateId(delta.from, 'from');
    stateId(delta.to, 'to');
    if (!Object.hasOwn(STATE_KEY_ALLOWLIST, delta.key)) {
      fail('unknown-state-key', `不允许的状态键 ${delta.key}；只接受已定义的稳定 key`, { reason: 'unknown-state-key', key: delta.key });
    }
    if (delta.from === delta.to) fail('no-op-change', `${delta.entity}.${delta.key} 的 from 与 to 相同`, { reason: 'no-op-change', entity: delta.entity, key: delta.key });
  }
}

function qualityCheck(beat, data, chapter) {
  const options = beat.options;
  const signatures = new Map();
  const actionKeys = new Map();
  for (const option of options) {
    const signature = optionDeltaKey(option);
    if (signatures.has(signature)) {
      fail('false-fork', '选项只有措辞不同，状态差分完全相同。', {
        reason: 'same-state-delta', options: [signatures.get(signature), option.id ?? option.label], fields: ['changes'],
      });
    }
    signatures.set(signature, option.id ?? option.label);
  }
  for (const option of options) {
    const actionKey = option.action.trim().toLocaleLowerCase();
    if (actionKeys.has(actionKey)) {
      fail('false-fork', '选项动作重复，只更换了表述。', {
        reason: 'wording-only', options: [actionKeys.get(actionKey), option.id ?? option.label], fields: ['action'],
      });
    }
    actionKeys.set(actionKey, option.id ?? option.label);
    const usableCost = option.costs.some((cost) => !/^\s*(无|没有(?:任何)?(?:代价|成本)|无代价|不需要(?:付出|成本))\s*[。.!！]?\s*$/u.test(cost));
    if (!usableCost) fail('false-fork', `选项「${option.label}」没有具体代价。`, { reason: 'no-cost-or-risk', optionId: option.id ?? option.label, fields: ['costs'] });
    if (!option.outcomes.length || option.outcomes.every((claim) => !claim.text.trim())) {
      fail('false-fork', `选项「${option.label}」没有可说明的后果。`, { reason: 'no-consequence', optionId: option.id ?? option.label, fields: ['outcomes'] });
    }
    if (option.risks.length === 0) fail('false-fork', `选项「${option.label}」没有说明风险。`, { reason: 'no-consequence', optionId: option.id ?? option.label, fields: ['risks'] });
    const ungroundedRisk = option.risks.find((claim) => claim.sourceRefs.length === 0);
    if (ungroundedRisk) fail('false-fork', `选项「${option.label}」的风险没有来源依据。`, { reason: 'no-consequence', optionId: option.id ?? option.label, fields: ['risks'] });
    for (const delta of option.changes) {
      const canon = currentCanon(data, delta.entity, delta.key);
      if (canon && canon.value === delta.to) {
        fail('author-already-decided', `${delta.entity}.${delta.key} 已经是「${delta.to}」，不应再次询问。`, {
          reason: 'author-already-decided', optionId: option.id ?? option.label, sourceDecisionId: canon.decisionId,
        });
      }
      if (canon && canon.value !== delta.from) {
        fail('false-fork', `${delta.entity}.${delta.key} 的已知 canon 是「${canon.value}」，候选却以「${delta.from}」为起点。`, {
          reason: 'conflicts-known-canon', optionId: option.id ?? option.label, fields: ['changes.from'], canonValue: canon.value,
        });
      }
    }
  }
  const gate = beat.gate;
  if (gate && options.some((option) => !option.changes.some((delta) => delta.entity === gate.entity
    && delta.key === gate.key && delta.from === gate.from))) {
    fail('false-fork', '每个选项都必须对闸门提出的状态作出真实选择。', { reason: 'same-state-delta', fields: ['gate', 'changes'] });
  }

  const detectKey = createDetectKey(beat, chapter);
  const candidateSet = options.map(optionDeltaKey).sort().join('\u0002');
  const prior = (data.decisions ?? []).find((decision) => decision.chapter === chapter
    && decision.status !== DECISION_STATUS.SUPERSEDED
    && (decision.detectKey === detectKey
      || (decision.options?.map(optionDeltaKey).sort().join('\u0002') === candidateSet)));
  if (prior) {
    const authorAnswered = prior.status === DECISION_STATUS.COMMITTED
      || (data.requests ?? []).some((request) => request.decisionId === prior.id && request.answeredAt);
    if (authorAnswered) fail('author-already-decided', `候选与已由作者决定的 ${prior.id} 相同。`, { reason: 'author-already-decided', decisionId: prior.id });
    fail('false-fork', `候选与已有决策 ${prior.id} 重复。`, { reason: 'duplicate-candidate', decisionId: prior.id });
  }
  return detectKey;
}

export function createDetectKey(beat, chapter) {
  return `detect-${digest({ chapter, gate: deltaKey(beat.gate), deltas: beat.options.map(optionDeltaKey).sort() }).slice(0, 24)}`;
}

export function stableDecisionId(detectKey, generation = 0) {
  const base = `d-${digest(detectKey).slice(0, 20)}`;
  return generation > 0 ? `${base}-${generation + 1}` : base;
}

export function stableOptionId(detectKey, option) {
  return `o-${digest({ detectKey, deltas: optionDeltaKey(option) }).slice(0, 16)}`;
}

/** 在任何写盘前完成白名单、EvidenceRef、canon、判重和假分叉核验。 */
export async function validateDecisionCandidate(dir, data, beat, chapter) {
  if (!beat?.gate || !beat.options?.every((option) => option.action)) return null;
  validateKnownKeys(beat);
  qualityCheck(beat, data, chapter);
  const canonical = new Map();
  for (const ref of evidenceRefs(beat)) {
    const verified = await verifyEvidenceRef(dir, data, ref, chapter);
    canonical.set(ref, verified);
  }
  for (const option of beat.options) {
    for (const field of ['costs', 'outcomes', 'informationGain', 'risks']) {
      for (const claim of option[field]) {
        if (claim.basis === 'known-fact' && claim.sourceRefs.length === 0) {
          fail('missing-evidence', `${field} 中的已知事实「${claim.text}」必须有 EvidenceRef`);
        }
      }
    }
  }
  const detectKey = createDetectKey(beat, chapter);
  const gate = {
    ...beat.gate,
    evidence: beat.gate.evidence.map((ref) => canonical.get(ref) ?? ref),
  };
  const options = beat.options.map((option) => ({
    ...option,
    id: stableOptionId(detectKey, option),
    changes: option.changes.map((delta) => ({
      ...delta,
      evidence: delta.evidence.map((ref) => canonical.get(ref) ?? ref),
    })),
    ...Object.fromEntries(['outcomes', 'informationGain', 'risks'].map((field) => [field,
      option[field].map((claim) => ({
        ...claim,
        sourceRefs: claim.sourceRefs.map((ref) => canonical.get(ref) ?? ref),
      })),
    ])),
  }));
  return {
    gate,
    options,
    detectKey,
    id: stableDecisionId(detectKey, Math.max(
      (data.decisions ?? []).filter((decision) => decision.detectKey === detectKey).length,
      data.counters?.detects?.[detectKey] ?? 0,
    )),
    sourceRefs: evidenceRefs({ gate, options }).map((ref) => canonical.get(ref) ?? ref),
  };
}

export function relevantInputHash(data, chapter, sourceRefs = []) {
  const current = (data.canon ?? []).filter((entry) => entry.chapter == null || entry.chapter <= chapter)
    .map(({ entity, key, value, decisionId }) => ({ entity, key, value, decisionId }))
    .sort((a, b) => `${a.entity}\u0000${a.key}`.localeCompare(`${b.entity}\u0000${b.key}`));
  const obligations = (data.obligations ?? []).filter((entry) => {
    const source = (data.decisions ?? []).find((decision) => decision.id === entry.sourceDecision);
    return (entry.status === 'open' || entry.paidChapter === chapter) && (!source || source.chapter <= chapter);
  })
    .map(({ id, text, dueChapter, evidence, sourceDecision, status, paidChapter }) => ({
      id, text, dueChapter, evidence: evidence ?? [], sourceDecision,
      status: paidChapter === chapter ? 'open' : status,
    }));
  const decisions = (data.decisions ?? []).filter((entry) => entry.chapter === chapter
    && entry.status !== DECISION_STATUS.SUPERSEDED)
    .map(({ id, status, detectKey, chosen }) => ({ id, status, detectKey: detectKey ?? null, chosen: chosen ?? null }));
  const segments = (data.segments ?? []).filter((entry) => entry.chapter === chapter && entry.status !== 'reverted')
    .map(({ id, hash, textHash, status }) => ({ id, hash: hash ?? textHash ?? null, status }));
  const forks = (data.forks ?? []).filter((entry) => entry.chapter === chapter && entry.status === 'open')
    .map(({ id, text }) => ({ id, text }));
  return digest({ chapter, canon: current, obligations, decisions, segments, forks, sourceRefs });
}

export function scanId({ chapter, bodyHash, relevantHash, bodyFile = null, detectKey = null }) {
  return `scan-${digest({ chapter, bodyHash, relevantHash, bodyFile, detectKey }).slice(0, 24)}`;
}

/** 确定性检查 no-candidate 收据；全账本 revision 可因无关写入增长。 */
export async function validateDecisionScan(dir, data, chapter, bodyText) {
  const scan = data.chapters?.[String(chapter)]?.decisionScan;
  if (!scan || scan.status !== 'no-candidate' || typeof scan.reason !== 'string' || !scan.reason.trim()) {
    fail('scan-required', `第 ${chapter} 章没有有效的零候选扫描收据；先 beat_plan(beats: [], reason, path/text)`);
  }
  if (!Number.isInteger(scan.resultRevision) || scan.resultRevision > (data.revision ?? 0)
    || !Number.isInteger(scan.baseRevision) || scan.resultRevision !== scan.baseRevision + 1) {
    fail('stale-scan', '零候选扫描的 revision 回执无效或已过期，请重新扫描');
  }
  if (typeof scan.bodyHash !== 'string' || scan.bodyHash !== hashText(bodyText)) {
    fail('stale-scan', '零候选扫描绑定的正文 hash 已改变，请重新扫描');
  }
  if (scan.id !== scanId({ chapter, bodyHash: scan.bodyHash, relevantHash: scan.relevantInputHash, bodyFile: scan.bodyFile ?? null })) {
    fail('stale-scan', '零候选扫描 ID 与其正文/相关输入 hash 不匹配');
  }
  if (scan.relevantInputHash !== relevantInputHash(data, chapter, scan.sourceRefs ?? [])) {
    fail('stale-scan', '零候选扫描依赖的决策/canon/义务状态已改变，请重新扫描');
  }
  if (scan.bodyFile) {
    const source = await resolveBodyFile(dir, scan.bodyFile);
    const bytes = await readFile(source.real);
    const currentHash = createHash('sha256').update(bytes).digest('hex');
    if (currentHash !== scan.bodyHash) {
      fail('stale-scan', `零候选扫描绑定的文件 ${scan.bodyFile} 已改变，请重新扫描`);
    }
  }
  await validateEvidenceRefs(dir, data, scan.sourceRefs, chapter);
  const open = (data.decisions ?? []).filter((decision) => decision.chapter === chapter
    && [DECISION_STATUS.PROPOSED, DECISION_STATUS.ASKED, DECISION_STATUS.ANSWERED].includes(decision.status));
  if (open.length) fail('stale-scan', `第 ${chapter} 章仍有未拍板决策，不能按零候选验章`, { decisionIds: open.map((item) => item.id) });
  return scan;
}
