// lib/tools.js — 0.7.0 的九个工具：plan / next / segment / revert / list / decide / gate / compile / verify / adjust
// 工具本身不依赖任何其他插件；所有数据都在 <dir>/.dsh-novel-beat/<book>/book.json。

import { relative, sep } from 'node:path';
import { realpath, readFile } from 'node:fs/promises';
import {
  fail,
  DECISION_STATUS,
  OPEN_DECISION_STATUSES,
  REQUEST_ORIGIN,
  nextRequestId,
  assertBookName,
  assertChapter,
  normalizePlanBeats,
  normalizeOption,
  normalizeEvidenceRef,
  normalizeCustomChoice,
  nextDecisionId,
  applyChangesToCanon,
  mergeObligations,
  changeSetKey,
  nowIso,
  KINDS,
  LIMITS,
  STATE_KEY_ALLOWLIST,
  SEGMENT_STATUS,
  REVISION_KIND,
  FORK_STATUS,
  nextSegmentId,
  nextRevisionId,
  nextForkId,
} from './schema.js';
import {
  readBookData,
  mutateBookData,
  readChapterText,
  bookFilePath,
  resolveWorkspaceRoot,
  computeRevision,
  noChange,
} from './store.js';
import {
  resolveBodyFile,
  saveSnapshot,
  readSnapshot,
  sliceHash,
  segmentEndFor,
  laterSegments,
  normalizeNewlines,
  sha256,
} from './segment.js';
import { buildCompile } from './compile.js';
import { verifyChapter } from './verify.js';
import { commitPairTransaction, hashRawBytes } from './transaction.js';
import { clearRejectedCandidates, rememberRejectedCandidate } from './rejection-cache.js';
import {
  executeAppend,
  executeFinish,
  isSegmentLoop,
  loopScanTarget,
  recordLoopScan,
  revertLoop,
  verifyLoopMerge,
} from './segment-loop.js';
import {
  validateDecisionCandidate,
  relevantInputHash,
  hashText,
  scanId,
  validateDecisionScan,
  validateEvidenceRefs,
  verifyEvidenceRef,
  validateDecisionEvidence,
  validateSelectedOption,
  stableStringify,
} from './decision-gate.js';

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
  const decided = list.filter((decision) => decision.status === DECISION_STATUS.COMMITTED);
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
    ...(decision.gate ? {
      nodeKind: decision.nodeKind,
      gate: decision.gate,
      detectKey: decision.detectKey,
      sourceRefs: decision.sourceRefs,
      legacyEvidence: decision.legacyEvidence,
      chosen: decision.chosen ?? null,
      bodyBinding: decision.bodyBinding ?? null,
    } : {}),
    choice: decision.chosen?.label ?? null,
    changes: decision.chosen?.changes ?? [],
    forbidden: decision.chosen?.forbidden ?? [],
    options: (decision.options ?? []).map((option) => ({
      ...(decision.gate ? option : {}),
      label: option.label,
      impact: option.impact,
      changes: option.changes,
    })),
    decidedAt: decision.decidedAt ?? null,
  };
}

// ── beat_plan ────────────────────────────────────────────────────────────────

// requireGate is forced by the registered 0.10 tool. The exported legacy executor
// remains compatible with the pre-existing 0.11 slice and historical callers.
export async function executePlan(args, { segmentLoop = false, requireGate = false } = {}) {
  const dir = requireDir(args);
  const book = assertBookName(args.book);
  const chapter = assertChapter(args.chapter);
  const beats = normalizePlanBeats(args.beats, chapter);
  if (requireGate && beats.some((beat) => !beat.gate)) {
    fail('gate-required', '新候选必须提供 gate、EvidenceRef 和选项六要素，不能用 legacy 输入绕过闸门。');
  }
  // 一次只收一个：按章批量规划会把"岔路"变成按模板填空（真实账本里每章恰好 3 条、
  // 第三条总是"章末钩子"就是这么来的）。写到哪个岔路，才登记那一个。
  if (beats.length > 1) {
    const nextStep = segmentLoop
      ? '等作者拍板后，再用 beat_append 登记作者选择对应的下一段；不能先批量登记多个决策点。'
      : '等作者拍板、这一段写进正文并 beat_segment 登记之后，再登记下一个。';
    fail(
      'one-at-a-time',
      `一次只登记一个决策点：这次给了 ${beats.length} 个。写到哪个岔路就登记那一个，${nextStep}`,
    );
  }
  if (args.append === true && args.reset === true) {
    fail('bad-args', 'append 与 reset 不能同时为 true');
  }
  const append = args.append === true;
  const reset = args.reset === true;

  // beats 为空 = 读完这一段之后的"续写检查"结论：后面这里确实没有真岔路。
  // 它不是登记决策，只负责把 continuation_check_required 清掉，让正文可以继续往下写。
  if (beats.length === 0) {
    const reason = typeof args.reason === 'string' ? args.reason.trim() : '';
    if (reason.length < 2) {
      fail(
        'no-reason',
        'beats 为空时是在回答"这一段后面有没有真岔路"。请给 reason（一两句话：为什么这里确实不需要作者拍板）。',
      );
    }
    if (typeof args.text === 'string' && typeof args.path === 'string') {
      fail('bad-args', '零候选扫描的 text 与 path 只能给一个');
    }
    const { data: existingBook } = await readBookData(dir, book);
    if (isSegmentLoop(existingBook, chapter)) {
      if (!segmentLoop) fail('feature-disabled', 'segment-loop 实验功能已关闭，不能写入段后检查收据。');
      const { result: scan, revision } = await mutateBookData(dir, book, async (data) => {
        const segment = await loopScanTarget(dir, book, data, { ...args, chapter });
        const receipt = recordLoopScan(data, chapter, segment, { reason });
        return { receipt, reason };
      });
      return { ok: true, book, chapter, revision, ids: [], verdict: 'no-candidate', scanReceipt: scan.receipt, reason };
    }
    const { result: cleared, revision } = await mutateBookData(dir, book, async (data) => {
      if (args.expectedRevision !== undefined && args.expectedRevision !== computeRevision(data)) {
        fail('revision-conflict', '扫描前账本 revision 已变化，请刷新后重试');
      }
      const openFork = (data.forks ?? [])
        .find((fork) => fork.chapter === chapter && fork.status === FORK_STATUS.OPEN);
      if (openFork) {
        fail('fork-required', `作者插了岔路 ${openFork.id}「${openFork.text}」，得先把它写成决策点，再谈"这里没有岔路"。`);
      }
      const pending = activeDecisions(data, chapter);
      if (pending.some((decision) => decision.status !== DECISION_STATUS.COMMITTED)) {
        fail('pending-decision', `第 ${chapter} 章仍有待作者拍板的决策，不能登记零候选扫描。`);
      }
      let scanText = typeof args.text === 'string' ? args.text : null;
      let scanPath = null;
      if (typeof args.path === 'string' && args.path.trim()) {
        const read = await readChapterText(resolveWorkspaceRoot(dir), args.path);
        scanText = read.text;
        scanPath = relative(await realpath(resolveWorkspaceRoot(dir)), read.path).split(sep).join('/');
      } else if (scanText === null) {
        const latest = (data.segments ?? []).filter((item) => item.chapter === chapter && item.status === SEGMENT_STATUS.COMMITTED).at(-1);
        if (latest?.file) {
          const read = await readChapterText(resolveWorkspaceRoot(dir), latest.file);
          scanText = read.text;
          scanPath = relative(await realpath(resolveWorkspaceRoot(dir)), read.path).split(sep).join('/');
        }
      }
      if (scanText === null) fail('scan-source-required', '零候选扫描需要 text/path 或本章已登记段落的正文文件，不能生成无正文绑定的收据。');
      const bodyHash = scanText === null ? null : hashText(scanText);
      if (args.sourceRefs !== undefined && !Array.isArray(args.sourceRefs)) fail('bad-evidence-ref', 'sourceRefs 必须是数组');
      const sourceRefs = [];
      for (const ref of args.sourceRefs ?? []) {
        sourceRefs.push(await verifyEvidenceRef(dir, data, normalizeEvidenceRef(ref), chapter));
      }
      const relevantHash = relevantInputHash(data, chapter, sourceRefs);
      const previousScan = data.chapters[String(chapter)]?.decisionScan;
      if (previousScan?.status === 'no-candidate'
        && previousScan.reason === reason
        && (previousScan.bodyFile ?? null) === scanPath
        && previousScan.bodyHash === bodyHash
        && previousScan.relevantInputHash === relevantHash) {
        return noChange({ cleared: false, reason, decisionScan: previousScan, already: true });
      }
      const state = data.chapters[String(chapter)] ?? {};
      const wasRequired = state.continuationCheckRequired === true;
      const baseRevision = computeRevision(data);
      const at = nowIso();
      const decisionScan = {
        id: scanId({ chapter, bodyHash, relevantHash, bodyFile: scanPath }),
        status: 'no-candidate',
        reason,
        scannedAt: at,
        baseRevision,
        resultRevision: baseRevision + 1,
        bodyHash,
        bodyFile: scanPath,
        relevantInputHash: relevantHash,
        segmentIds: (data.segments ?? []).filter((entry) => entry.chapter === chapter && entry.status !== SEGMENT_STATUS.REVERTED).map((entry) => entry.id),
        candidateCount: 0,
        sourceRefs,
      };
      data.chapters[String(chapter)] = {
        ...state,
        continuationCheckRequired: false,
        continuationCheckedAt: at,
        decisionScan,
      };
      data.audit.push({
        at, action: 'decision-scan', chapter, verdict: 'no-candidate', reason, scanId: decisionScan.id,
      });
      data.audit.push({ at, action: 'continuation-check', chapter, verdict: 'no-fork', reason });
      return { cleared: wasRequired, reason, decisionScan };
    }, { create: true, meta: { title: book } });
    return {
      ok: true,
      book,
      chapter,
      revision,
      ids: [],
      verdict: 'no-fork',
      cleared: cleared.cleared,
      decisionScan: cleared.decisionScan,
      message: cleared.cleared
        ? `续写检查记下了：${reason}。可以接着写下一段正文。`
        : `续写检查记下了：${reason}。（这一段之前没有待检查的标记，记一笔留痕。）`,
      warnings: [],
    };
  }

  const { result, warnings: storeWarnings, revision } = await mutateBookData(dir, book, async (data) => {
    // 新决策的唯一入口也过闸 A：正文里有没登记的字时不许再登记新岔路，
    // 否则"先写完整章、再批量登记决策"就能从 beat_plan 这边绕过去。
    const loopChapter = isSegmentLoop(data, chapter);
    if (loopChapter && !segmentLoop) fail('feature-disabled', 'segment-loop 实验功能已关闭，不能修改该章。');
    if (!loopChapter && args.expectedRevision !== undefined && args.expectedRevision !== computeRevision(data)) {
      fail('revision-conflict', '候选扫描前账本 revision 已变化，请刷新后重试');
    }
    const previousScan = data.chapters[String(chapter)]?.decisionScan;
    if (!loopChapter && !reset && beats[0]?.gate && previousScan?.status === 'candidates'
      && previousScan.proposalHash === hashText(stableStringify(beats[0]))
      && previousScan.relevantInputHash === relevantInputHash(data, chapter)
      && previousScan.decisionIds?.every((id) => data.decisions.some((decision) => decision.id === id && decision.status === DECISION_STATUS.PROPOSED))) {
      await validateEvidenceRefs(dir, data, previousScan.sourceRefs, chapter);
      return noChange({ ids: previousScan.decisionIds, total: activeDecisions(data, chapter).length,
        pending: activeDecisions(data, chapter).filter((item) => item.status !== DECISION_STATUS.COMMITTED).length,
        decisionScan: previousScan, already: true, warnings: [] });
    }
    const loopSegment = loopChapter
      ? await loopScanTarget(dir, book, data, { ...args, chapter })
      : null;
    const pendingText = loopChapter ? null : await unitInspect(dir, data, chapter);
    if (!loopChapter && pendingText.last && pendingText.extra > 0) {
      fail(
        'write-ahead',
        `第 ${chapter} 章有 ${pendingText.extra} 字正文还没登记成段落（账本只登记到第 ${pendingText.anchor} 字）。`
        + '先把上一段用 beat_segment 登记，或者把多写的部分删掉，再来登记下一个岔路。',
      );
    }
    let existing = activeDecisions(data, chapter);

    // 先对照 detectKey/已拍板状态，再检查标题；同一真实候选换标题也必须作为重复候选拒收。
    if (!reset) {
      try {
        for (const beat of beats) await validateDecisionCandidate(dir, data, beat, chapter);
      } catch (error) {
        if (error?.code === 'false-fork' && beats.length === 1) {
          rememberRejectedCandidate({ dir, book, chapter, beat: beats[0], error });
        }
        throw error;
      }
    }

    // 作者主动插的岔路：有 open 的就必须先把它写成决策点（fork-required），
    // 带 forkId 登记的那一条会被标成 planned 并挂到新决策上。
    const openForks = (data.forks ?? [])
      .filter((fork) => fork.chapter === chapter && fork.status === FORK_STATUS.OPEN);
    let consumedFork = null;
    if (typeof args.forkId === 'string' && args.forkId) {
      consumedFork = openForks.find((fork) => fork.id === args.forkId) ?? null;
      if (!consumedFork) fail('unknown-fork', `第 ${chapter} 章没有待登记的岔路 ${args.forkId}`);
    } else if (openForks.length > 0) {
      const first = openForks[0];
      fail(
        'fork-required',
        `作者自己插了岔路 ${first.id}「${first.text}」。先把这一条写成决策点：beat_plan(dir, book, chapter, forkId: '${first.id}', beats: [2–4 个选项])。`,
      );
    }

    if (reset) {
      // reset 的语义：清掉"还没拍板"的决策，保留已拍板的决策和它们写进 canon 的结果。
      // 顺序很重要——先清、再查重名；反过来的话旧标题会把重建卡死（实测第 11 章就是这样卡了两轮）。
      const open = existing.filter((decision) => decision.status !== DECISION_STATUS.COMMITTED);
      const kept = data.decisions.filter(
        (decision) => decision.chapter !== chapter || decision.status === DECISION_STATUS.COMMITTED,
      );
      data.decisions = kept;
      for (const decision of open) {
        for (const fork of data.forks ?? []) {
          if (fork.decisionId === decision.id) {
            fork.status = FORK_STATUS.OPEN;
            fork.decisionId = null;
          }
        }
      }
      existing = activeDecisions(data, chapter);
      const chapterState = data.chapters[String(chapter)];
      if (chapterState && existing.length === 0 && !loopChapter) delete data.chapters[String(chapter)];
      data.audit.push({
        at: nowIso(), action: 'reset', chapter, cleared: open.map((decision) => decision.id),
      });
    } else if (existing.length > 0 && !append && !loopChapter) {
      fail(
        'chapter-locked',
        `第 ${chapter} 章已有 ${existing.length} 个决策点；要追加用 append:true，要重排未拍板的用 reset:true`,
      );
    }

    // reset 之后允许用原来的标题重建：已拍板的同名决策留在账本里当历史，
    // 不该把"重新规划同一条岔路"卡死（实测第 11 章就是被这条卡了两轮）。
    const titles = new Set(reset ? [] : existing.map((decision) => decision.title));
    for (const beat of beats) {
      if (titles.has(beat.title)) fail('duplicate-title', `本章已有同名决策点：${beat.title}`);
      titles.add(beat.title);
    }

    const warnings = [];
    const ids = [];
    const now = nowIso();
    let acceptedCandidate = null;
    // 决策 ID 只增不减：reset 删掉未拍板决策后也不能复用旧编号，
    // 否则历史 audit / 段落引用会指到另一条决策上。
    data.counters = data.counters && typeof data.counters === 'object' ? data.counters : {};
    data.counters.decisions = data.counters.decisions && typeof data.counters.decisions === 'object'
      ? data.counters.decisions
      : {};
    const seqKey = String(chapter);

    for (const beat of beats) {
      const gateCandidate = await validateDecisionCandidate(dir, data, beat, chapter);
      const id = gateCandidate?.id
        ?? nextDecisionId(data.decisions, chapter, Number(data.counters.decisions[seqKey]) || 0);
      if (!gateCandidate) data.counters.decisions[seqKey] = Number(String(id).slice(`b${chapter}-`.length)) || 0;
      else {
        acceptedCandidate = gateCandidate;
        data.counters.detects ??= {};
        data.counters.detects[gateCandidate.detectKey] = Math.max(
          data.decisions.filter((entry) => entry.detectKey === gateCandidate.detectKey).length,
          data.counters.detects[gateCandidate.detectKey] ?? 0,
        ) + 1;
      }
      const decision = {
        id,
        chapter,
        title: beat.title,
        kind: beat.kind,
        change: beat.change,
        status: DECISION_STATUS.PROPOSED,
        legacy: false,
        nodeKind: 'decision',
        gate: gateCandidate?.gate ?? null,
        sourceRefs: gateCandidate?.sourceRefs ?? [],
        detectKey: gateCandidate?.detectKey ?? null,
        legacyEvidence: !gateCandidate,
        options: gateCandidate?.options ?? beat.options,
        chosen: null,
        createdAt: now,
        decidedAt: null,
        supersededBy: null,
      };
      data.decisions.push(decision);
      ids.push(id);

      if (loopChapter && loopSegment) {
        decision.sourceSegmentId = loopSegment.id;
        decision.sourceSegmentHash = loopSegment.textHash;
      }

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

    if (acceptedCandidate) {
      const baseRevision = computeRevision(data);
      const state = data.chapters[String(chapter)] ?? {};
      const bodyRef = acceptedCandidate.sourceRefs.find((ref) => ref.kind === 'body' || ref.kind === 'outline');
      const relevantHash = relevantInputHash(data, chapter);
      const decisionScan = {
        id: scanId({ chapter, bodyHash: bodyRef?.hash ?? null, relevantHash, detectKey: acceptedCandidate.detectKey }),
        status: 'candidates',
        reason: null,
        scannedAt: now,
        baseRevision,
        resultRevision: baseRevision + 1,
        bodyHash: bodyRef?.hash ?? null,
        relevantInputHash: relevantHash,
        segmentIds: (data.segments ?? []).filter((entry) => entry.chapter === chapter && entry.status !== SEGMENT_STATUS.REVERTED).map((entry) => entry.id),
        candidateCount: 1,
        sourceRefs: acceptedCandidate.sourceRefs,
        detectKey: acceptedCandidate.detectKey,
        proposalHash: hashText(stableStringify(beats[0])),
        decisionIds: ids,
      };
      data.chapters[String(chapter)] = { ...state, decisionScan };
    }

    if (loopChapter && loopSegment) {
      recordLoopScan(data, chapter, loopSegment, { decisionId: ids[0] });
    }

    refreshChapter(data, chapter);
    data.audit.push({ at: now, action: 'plan', chapter, count: beats.length });

    // 续写检查有结论了（登记了这一个真岔路）：清掉"必须先检查"的标记，
    // 让作者拍板、模型写完这一段之后能继续往下写。
    if (data.chapters[String(chapter)]?.continuationCheckRequired === true) {
      data.chapters[String(chapter)] = {
        ...data.chapters[String(chapter)],
        continuationCheckRequired: false,
        continuationCheckedAt: now,
      };
      data.audit.push({
        at: now, action: 'continuation-check', chapter, verdict: 'fork', decisionId: ids[0] ?? null,
      });
    }

    if (consumedFork) {
      consumedFork.status = FORK_STATUS.PLANNED;
      consumedFork.decisionId = ids[0] ?? null;
      consumedFork.plannedAt = now;
      data.audit.push({ at: now, action: 'fork-planned', chapter, forkId: consumedFork.id, decisionId: ids[0] ?? null });
    }

    const list = activeDecisions(data, chapter);
    const entities = new Set();
    for (const beat of beats) {
      for (const option of beat.options) {
        for (const change of option.changes) entities.add(change.entity);
      }
    }
    return {
      total: list.length,
      pending: list.filter((decision) => decision.status !== DECISION_STATUS.COMMITTED).length,
      ids,
      warnings,
      context: contextFor(data, chapter, entities),
      ...(acceptedCandidate ? { decisionScan: data.chapters[String(chapter)].decisionScan } : {}),
    };
  }, { create: true, meta: { title: book } });

  if (result.ids?.length) clearRejectedCandidates(dir, book, chapter);

  return {
    ok: true,
    book,
    chapter,
    path: bookFilePath(dir, book),
    revision,
    ...result,
    warnings: [...storeWarnings, ...(result.warnings ?? [])],
  };
}

// ── beat_fork（作者主动插岔路）───────────────────────────────────────────────

/**
 * 作者说"这里该有个岔路"——模型漏判时由作者发起。
 * 只登记一条岔路请求；随后 beat_plan(forkId) 把它写成 2–4 个选项的决策点，
 * beat_next 再问作者。这样作者插的岔路和模型发现的岔路走同一条账本路径。
 */
export async function executeFork(args, { segmentLoop = false } = {}) {
  const dir = requireDir(args);
  const book = assertBookName(args.book);
  const chapter = assertChapter(args.chapter);
  const text = typeof args.text === 'string' ? args.text.trim() : '';
  if (!text) fail('no-text', '岔路得说清"要决定什么"，例如「要不要当场杀掉独孤博」。');
  if (text.length > LIMITS.change) fail('bad-text', `岔路描述最多 ${LIMITS.change} 字`);

  const { result, warnings, revision } = await mutateBookData(dir, book, (data) => {
    if (isSegmentLoop(data, chapter) && !segmentLoop) {
      fail('feature-disabled', 'segment-loop 实验功能已关闭，不能修改该章。');
    }
    const at = nowIso();
    data.forks = data.forks ?? [];
    const duplicate = data.forks.find((fork) => fork.chapter === chapter
      && fork.status === FORK_STATUS.OPEN && fork.text === text);
    if (duplicate) return noChange({ fork: duplicate, duplicate: true, open: [] });
    const id = nextForkId(data.forks);
    const fork = { id, chapter, text, status: FORK_STATUS.OPEN, decisionId: null, createdAt: at };
    data.forks.push(fork);
    data.audit.push({ at, action: 'fork', chapter, forkId: id, text });
    refreshChapter(data, chapter);
    return {
      fork,
      duplicate: false,
      open: data.forks.filter((item) => item.chapter === chapter && item.status === FORK_STATUS.OPEN),
    };
  }, { create: true, meta: { title: book } });

  const forkId = result.fork.id;
  const message = result.duplicate
    ? `这条岔路已经记过了（${forkId}「${result.fork.text}」），别再重复登记。用 beat_plan(forkId: '${forkId}') 给它写选项。`
    : `已记下作者插的岔路 ${forkId}「${result.fork.text}」。用 beat_plan(dir, book, chapter: ${chapter}, forkId: '${forkId}', beats: [2–4 个选项]) 写成决策点，再 beat_next 问作者。`;
  return {
    ok: true,
    book,
    chapter,
    revision,
    fork: result.fork,
    duplicate: result.duplicate === true,
    open: result.open,
    message,
    warnings,
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
    if (args.onlyPending === true) list = list.filter((decision) => decision.status === DECISION_STATUS.PROPOSED);
    return {
      ok: true,
      exists: true,
      book,
      path,
      chapter,
      decisions: list.map(simplifyDecision),
      forks: (data.forks ?? []).filter((fork) => fork.chapter === chapter && fork.status === FORK_STATUS.OPEN),
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
    pending: list.filter((decision) => decision.status !== DECISION_STATUS.COMMITTED).length,
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

export async function executeDecide(args, exec, { askAvailable = false, segmentLoop = false } = {}) {
  // 宿主能自己问作者时，beat_decide 是旁路：模型会拿 ask_user_question 一次问三个，再逐条往这里落账，
  // 节奏就退回到"攒一批问完再写"。所以只要插件能自己问，就只认 beat_next。
  // 例外：作者在卡片里自己写了答案（status=answered），那条必须由模型补齐结构化 changes 才能落账，
  // 否则永远到不了 committed——这是硬死锁，不是旁路。
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

  const { result, warnings: storeWarnings, revision } = await mutateBookData(dir, book, async (data) => {
    if (isSegmentLoop(data, chapter) && !segmentLoop) {
      fail('feature-disabled', 'segment-loop 实验功能已关闭，不能写入作者选择。');
    }
    const decision = data.decisions.find(
      (entry) => entry.id === id && entry.chapter === chapter,
    );
    if (!decision) fail('no-decision', `第 ${chapter} 章没有决策点 ${id}`);
    await validateDecisionEvidence(dir, data, decision);
    if (askAvailable && decision.status !== DECISION_STATUS.ANSWERED) {
      fail(
        'use-beat-next',
        '开着拍板模式时用 beat_next 问作者——插件会自己问、自己落账（一次一个决策点）。'
        + 'beat_decide 只在宿主没有提问服务、或作者刚在卡片里自己写了答案（status=answered）需要补结构化 changes 时用。',
      );
    }
    if (decision.status === 'superseded') {
      fail('decision-superseded', `决策点 ${id} 已被撤销；要重新拍板请先 beat_adjust 或重新 plan`);
    }

    let option = (decision.options ?? []).find((entry) => entry.label === choice) ?? null;
    const proposedOption = option;
    if (decision.gate && (!option || args.optionDraft)) {
      if (!args.optionDraft) fail('incomplete-option', '新决策自定义选择必须提供 optionDraft 六要素，不能只提供 changes。');
      option = normalizeOption({ ...args.optionDraft, label: choice }, 0, chapter);
      if (!option.action) fail('incomplete-option', 'optionDraft 必须包含完整六要素');
    }
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

    if (decision.status === DECISION_STATUS.COMMITTED) {
      const sameOption = !decision.gate || !args.optionDraft || (() => {
        const old = normalizeOption(decision.chosen, 0, chapter);
        return ['action', 'costs', 'outcomes', 'informationGain', 'risks', 'changes', 'obligations', 'forbidden']
          .every((field) => stableStringify(old[field]) === stableStringify(option[field]));
      })();
      if (decision.chosen?.label === choice && sameChanges && sameOption && !supersede) {
        const list = activeDecisions(data, chapter);
        return noChange({
          id,
          status: DECISION_STATUS.COMMITTED,
          choice,
          remaining: list.filter((entry) => entry.status !== DECISION_STATUS.COMMITTED).length,
          total: list.length,
          idempotent: true,
          canonChanges: [],
          obligations: [],
          warnings: [],
        });
      }
      if (!supersede) {
        fail(
          'already-decided',
          `决策点 ${id} 已拍板为「${decision.chosen?.label ?? '（空）'}」；要改请传 supersede:true 和 reason`,
        );
      }
      if (!reason) fail('reason-required', '重拍已拍板决策必须写 reason（作者为什么改主意）');
    }

    if (decision.gate) {
      option = await validateSelectedOption(dir, data, decision, option);
      changes = option.changes;
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
      ...(decision.gate ? JSON.parse(JSON.stringify(option)) : {}),
      label: choice,
      impact,
      changes,
      obligations,
      forbidden,
      custom: decision.gate ? !proposedOption : !option,
      ...(decision.gate ? {
        source: args.optionDraft ? (proposedOption ? 'author-edited' : 'author-custom') : 'proposed',
        basedOnOptionId: proposedOption?.id ?? null,
        editedFields: args.optionDraft ? Object.keys(args.optionDraft).map((field) => ({
          field, before: proposedOption?.[field] ?? null, after: option[field] ?? null, at: nowIso(),
        })) : [],
      } : {}),
    };
    const decidedAt = nowIso();
    const receiptId = nextRequestId(data.requests);
    data.requests.push({
      id: receiptId,
      decisionId: decision.id,
      chapter,
      askedAt: typeof decision.askedAt === 'string' ? decision.askedAt : null,
      answeredAt: decidedAt,
      options: (decision.options ?? []).map((entry) => ({
        label: entry.label,
        description: entry.impact ?? '',
      })),
      answer: { selected: [choice], custom: (decision.gate ? proposedOption : option) ? null : choice },
      agentId: null,
      // 0.6 的调用路径：答案由模型转述，不是引擎亲手问到的。老实记 origin，别冒充 author。
      origin: REQUEST_ORIGIN.MODEL_RELAYED,
      relayedBy: 'beat_decide',
    });
    decision.requestId = receiptId;
    decision.askedAt = typeof decision.askedAt === 'string' ? decision.askedAt : null;
    decision.answeredAt = decidedAt;
    decision.status = DECISION_STATUS.COMMITTED;
    decision.decidedAt = decidedAt;
    decision.committedAt = decidedAt;
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
      status: DECISION_STATUS.COMMITTED,
      choice,
      remaining: list.filter((entry) => entry.status !== DECISION_STATUS.COMMITTED).length,
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
    revision,
    ...result,
    warnings: [...storeWarnings, ...(result.warnings ?? [])],
  };
}

// ── beat_next ────────────────────────────────────────────────────────────────

/**
 * 把「作者的选择」写进账本。问到的答案与确认过的冲突答案都走这里。
 * - 冲突时不再 fail：把选择存成 decision.pendingChoice（status=answered），交给作者确认是否改 canon。
 * - override=true 表示作者已经确认"这次剧情可以改这个设定"，按当前值覆盖并留 warning。
 */
export function commitAnswers(data, chapter, plan, {
  agentId,
  askedAt,
  override = false,
  allowAnswered = false,
  via = 'beat_next',
  gate = null,
} = {}) {
  let canon = data.canon;
  const committed = [];
  const deferred = [];
  const conflictPending = [];
  const statusWarnings = [];

  for (const item of plan) {
    const decision = data.decisions.find((entry) => entry.id === item.id);
    if (!decision) fail('no-decision', `账本里找不到决策点 ${item.id}`);
    if (isSegmentLoop(data, chapter)) {
      const source = (data.segments ?? []).find((segment) => segment.chapter === chapter
        && segment.status !== SEGMENT_STATUS.REVERTED
        && segment.scanReceipt?.decisionId === decision.id
        && segment.scanReceipt?.segmentHash === segment.textHash);
      if (!source) fail('segment-check-required', `决策点 ${decision.id} 没有绑定到当前段的有效续写检查`);
      decision.sourceSegmentId = source.id;
      decision.sourceSegmentHash = source.textHash;
    }
    const isOpen = OPEN_DECISION_STATUSES.includes(decision.status);
    if (!isOpen && !(allowAnswered && decision.status === DECISION_STATUS.ANSWERED)) {
      fail('not-open', `决策点 ${item.id} 已不是待拍板状态（${decision.status}）。`);
    }
    const answerText = item.option ? item.option.label : (item.custom || item.choice);

    if (!item.option) {
      // 作者写了自己的答案：插件不能替作者编 changes，转成"待补结构化变化"。
      const at = nowIso();
      decision.status = DECISION_STATUS.ANSWERED;
      decision.askedAt = decision.askedAt ?? askedAt;
      decision.answeredAt = at;
      decision.answerText = answerText;
      data.audit.push({
        at, action: 'answer-needs-changes', chapter, decisionId: decision.id, answer: answerText, agentId,
      });
      deferred.push({
        id: decision.id,
        answerText,
        reason: '作者写了自定义答案，缺少结构化 changes',
        next: `调 beat_decide（choice 用作者原话，并给 changes）把 ${decision.id} 落成 committed`,
      });
      continue;
    }

    const changes = item.option.changes ?? [];
    const applied = applyChangesToCanon(canon, changes, {
      chapter, decisionId: decision.id, override,
    });
    if (applied.conflicts.length > 0) {
      // 作者选了一个会改设定、但和当前 canon 对不上的选项。不能把选择丢掉，也不能沉默覆盖：
      // 先存成"待确认"（selected_pending_resolution），由 beat_next(confirmCanon:true) 再提交。
      const at = nowIso();
      decision.status = DECISION_STATUS.ANSWERED;
      decision.askedAt = decision.askedAt ?? askedAt;
      decision.answeredAt = at;
      decision.answerText = answerText;
      decision.pendingChoice = {
        label: answerText, at, agentId, conflicts: applied.conflicts,
      };
      data.audit.push({
        at, action: 'conflict-pending', chapter, decisionId: decision.id, choice: answerText, conflicts: applied.conflicts,
      });
      conflictPending.push({ id: decision.id, label: answerText, conflicts: applied.conflicts });
      continue;
    }
    canon = applied.canon;
    statusWarnings.push(...applied.warnings);
    const merged = mergeObligations(data.obligations, item.option.obligations ?? [], {
      decisionId: decision.id,
    });
    data.obligations = merged.obligations;

    const answeredAt = nowIso();
    const receiptId = nextRequestId(data.requests);
    data.requests.push({
      id: receiptId,
      decisionId: decision.id,
      chapter,
      askedAt,
      answeredAt,
      options: (decision.options ?? []).map((option) => ({
        label: option.label,
        description: option.impact ?? '',
      })),
      answer: { selected: [answerText], custom: null },
      agentId,
      origin: REQUEST_ORIGIN.AUTHOR,
    });
    decision.chosen = {
      ...(decision.gate ? JSON.parse(JSON.stringify(item.option)) : {}),
      label: answerText,
      impact: item.option.impact ?? '',
      changes,
      obligations: item.option.obligations ?? [],
      forbidden: item.option.forbidden ?? [],
      custom: false,
      ...(decision.gate ? { source: 'proposed', editedFields: [], basedOnOptionId: item.option.id } : {}),
    };
    decision.requestId = receiptId;
    decision.askedAt = decision.askedAt ?? askedAt;
    decision.answeredAt = answeredAt;
    decision.status = DECISION_STATUS.COMMITTED;
    decision.decidedAt = answeredAt;
    decision.committedAt = answeredAt;
    decision.supersededBy = null;
    delete decision.pendingChoice;
    committed.push({
      id: decision.id,
      choice: answerText,
      canonChanges: applied.applied,
      obligations: merged.created,
      canonOverride: override && applied.warnings.some((warning) => warning.startsWith('canon-overridden:')),
    });
    data.audit.push({
      at: answeredAt,
      action: 'commit',
      chapter,
      decisionId: decision.id,
      choice: answerText,
      via,
      agentId,
      ...(override ? { canonOverride: true } : {}),
    });
  }

  data.canon = canon;
  refreshChapter(data, chapter);
  // 写作单元闸门：记下"拍板那一刻正文停在哪、之前的字长什么样"，
  // 下一次 beat_segment 必须正好接在这个锚点上，且前缀没被改写（见单元闸 B）。
  if (gate) {
    const key = String(chapter);
    data.chapters = data.chapters ?? {};
    data.chapters[key] = {
      ...(data.chapters[key] ?? {}),
      gate: {
        ...gate,
        decisionIds: committed.map((item) => item.id),
        // gate 只能由"拍板"这一动作创建，并且被一次登记消费掉（见单元闸 B）。
        consumed: false,
      },
    };
  }
  const remainingList = activeDecisions(data, chapter)
    .filter((entry) => OPEN_DECISION_STATUSES.includes(entry.status))
    .sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
  return {
    committed,
    deferred,
    conflictPending,
    remaining: remainingList.length,
    total: activeDecisions(data, chapter).length,
    next: remainingList.length > 0 ? { id: remainingList[0].id, title: remainingList[0].title } : null,
    done: remainingList.length === 0 && conflictPending.length === 0,
    statusWarnings,
  };
}

/**
 * 读本章正文，算"锚点之后还有多少没登记成段落的正文"（写作单元闸 A）。
 * 读不到文件就当没有正文（不因为路径问题把模型挡在门外）。
 */
async function unitInspect(dir, data, chapter) {
  const segments = (data.segments ?? [])
    .filter((segment) => segment.chapter === chapter && segment.status === SEGMENT_STATUS.COMMITTED)
    .sort((a, b) => a.offsetEnd - b.offsetEnd);
  const last = segments.length > 0 ? segments[segments.length - 1] : null;
  if (!last) return { last: null, text: null, anchor: 0, extra: 0 };
  let body;
  try {
    body = await resolveBodyFile(dir, last.file);
  } catch {
    return { last, text: null, anchor: last.offsetEnd, extra: 0 };
  }
  const trimmed = body.text.replace(/\s+$/, '').length;
  return { last, text: body.text, anchor: last.offsetEnd, extra: Math.max(0, trimmed - last.offsetEnd) };
}

/**
 * 一次只推一个决策（或一组 2–3 个强耦合决策）：插件自己把选项摆给作者，
 * 拿到作者的原话再落账。凭据 origin=author、带 agentId 与 askedAt——不是模型转述的。
 */
export async function executeNext(args, exec, { ask, segmentLoop = false } = {}) {
  const dir = requireDir(args);
  const book = assertBookName(args.book);
  const chapter = assertChapter(args.chapter);
  if (typeof ask !== 'function') {
    fail(
      'no-user-questions',
      '宿主没有提供提问服务（userQuestions），插件没法亲自问作者。改用 ask_user_question 追问，再 beat_decide 落账。',
    );
  }
  const agent = exec?.agent;
  if (!agent?.id) fail('no-agent', '拿不到当前会话，插件无法替作者提问。');

  const { data, warnings: storeWarnings } = await readBookData(dir, book);
  if (!data) fail('no-book', `还没有账本：${bookFilePath(dir, book)}`);
  if (isSegmentLoop(data, chapter) && !segmentLoop) {
    fail('feature-disabled', 'segment-loop 实验功能已关闭，不能写入作者选择。');
  }
  const currentRevision = computeRevision(data);

  // 作者自己插的岔路还没写成决策点，就先别问下一题——否则那条请求会被模型悄悄跳过。
  const openForks = (data.forks ?? [])
    .filter((fork) => fork.chapter === chapter && fork.status === FORK_STATUS.OPEN);
  if (openForks.length > 0) {
    const first = openForks[0];
    fail(
      'fork-required',
      `作者自己插了一条岔路 ${first.id}「${first.text}」，还没写成决策点。`
      + `先 beat_plan(dir, book, chapter, forkId: '${first.id}', beats: [给它写 2–4 个选项])，再来 beat_next 问作者。`,
    );
  }

  // 写作单元闸 A：拍板之前，正文里不能有"还没登记成段落"的字。
  // 否则就是"先把整章写完、再回头问作者"——作者看到的时候正文已经定了，节奏闸形同虚设。
  const unit = await unitInspect(dir, data, chapter);
  if (unit.last && unit.extra > 0) {
    fail(
      'write-ahead',
      `第 ${chapter} 章有 ${unit.extra} 字正文还没登记成段落（账本只登记到第 ${unit.anchor} 字）。`
      + '先把上一段用 beat_segment 登记（它对应上一个已拍板的决策），'
      + '或者把多写的部分删掉，再来问下一个岔路——不许先写完整章再问。',
    );
  }
  const gate = unit.last && typeof unit.text === 'string'
    ? {
      file: unit.last.file,
      offset: unit.anchor,
      prefixHash: sha256(unit.text.slice(0, unit.anchor)),
      at: nowIso(),
      decisionIds: [],
    }
    : null;

  // 作者上一次选中的选项会改设定、和当前 canon 对不上：选择已经存好了，等作者确认"能不能改"。
  const pendingChoices = data.decisions
    .filter((decision) => decision.chapter === chapter)
    .filter((decision) => decision.status === DECISION_STATUS.ANSWERED && decision.pendingChoice)
    .sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));

  // 选择摆到作者面前前，重新核验提案来源；文件在 plan 后改变时不发旧候选。
  for (const decision of data.decisions.filter((item) => item.chapter === chapter
    && OPEN_DECISION_STATUSES.includes(item.status))) {
    await validateDecisionEvidence(dir, data, decision);
  }

  if (args.confirmCanon === true) {
    if (pendingChoices.length === 0) {
      fail('no-pending-choice', `第 ${chapter} 章没有等待确认的冲突选择；正常拍板直接调 beat_next 就行。`);
    }
    const plan = pendingChoices.map((decision) => {
      const option = (decision.options ?? []).find((item) => item.label === decision.pendingChoice.label) ?? null;
      if (!option) {
        fail('no-option', `决策点 ${decision.id} 当时选的是「${decision.pendingChoice.label}」，但现在账本里找不到这个选项了。`);
      }
      return { id: decision.id, choice: option.label, custom: '', option };
    });
    const { result, revision } = await mutateBookData(dir, book, async (state) => {
      for (const decision of plan.map((item) => state.decisions.find((entry) => entry.id === item.id)).filter(Boolean)) {
        await validateDecisionEvidence(dir, state, decision);
        if (decision.gate) await validateSelectedOption(dir, state, decision, plan.find((item) => item.id === decision.id).option);
      }
      return commitAnswers(state, chapter, plan, {
        agentId: agent.id,
        askedAt: nowIso(),
        override: true,
        allowAnswered: true,
        via: 'beat_next-confirm',
        gate,
      });
    });
    return {
      ok: true,
      book,
      chapter,
      path: bookFilePath(dir, book),
      revision,
      committed: result.committed,
      deferred: result.deferred,
      conflictPending: result.conflictPending,
      remaining: result.remaining,
      total: result.total,
      next: result.next,
      done: result.done,
      message: result.committed.length > 0
        ? `已按作者的确认落账（${result.committed.map((item) => item.id).join('、')}），canon 里被覆盖的条目记了 canon-overridden 警告。`
        : '没有落账的决策。',
      warnings: [...storeWarnings, ...(result.statusWarnings ?? [])],
    };
  }

  if (pendingChoices.length > 0) {
    const first = pendingChoices[0];
    return {
      ok: true,
      book,
      chapter,
      path: bookFilePath(dir, book),
      revision: currentRevision,
      committed: [],
      deferred: [],
      needsCanonConfirm: pendingChoices.map((decision) => ({
        id: decision.id,
        label: decision.pendingChoice.label,
        conflicts: decision.pendingChoice.conflicts,
      })),
      remaining: activeDecisions(data, chapter).filter((d) => OPEN_DECISION_STATUSES.includes(d.status)).length,
      total: activeDecisions(data, chapter).length,
      next: { id: first.id, title: first.title },
      done: false,
      message: `作者选的是「${first.pendingChoice.label}」，它会改掉账本里的既有设定：`
        + `${first.pendingChoice.conflicts.map((c) => `${c.entity}.${c.key} 现在是「${c.current}」，会变成「${c.to}」`).join('；')}。`
        + '先问作者"是否允许这次剧情改这个设定"：'
        + '同意就 beat_next(dir, book, chapter, confirmCanon: true) 提交；'
        + '不同意就 beat_plan(reset:true) 重新给选项。',
      warnings: storeWarnings,
    };
  }

  const openAll = data.decisions
    .filter((decision) => decision.chapter === chapter && OPEN_DECISION_STATUSES.includes(decision.status))
    .sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));

  // 一次只问一个：上一条拍板了但还没写进正文、没登记段落，就不发下一题。
  // 这条闸是"写一段 → 登记 → 再问下一个"的节奏保证；不认这条，模型会把决策点攒起来一次问完。
  const pendingSegment = data.decisions
    .filter((decision) => decision.chapter === chapter)
    .filter((decision) => decision.status === DECISION_STATUS.COMMITTED)
    .filter((decision) => !decision.segmentId && decision.legacyReceipt !== true)
    .sort((a, b) => String(a.id).localeCompare(String(b.id), 'en', { numeric: true }));
  if (pendingSegment.length > 0) {
    const first = pendingSegment[0];
    const appendInstruction = isSegmentLoop(data, chapter)
      ? '先把作者选择对应的下一段交给 beat_append 登记；然后再 beat_next 问下一个决策点。一次只问一个。'
      : '先把这一段写完，用 beat_segment 登记；然后再 beat_next 问下一个决策点。一次只问一个。';
    fail(
      'segment-required',
      `第 ${chapter} 章的「${first.title}」已经拍板（${first.chosen?.label ?? first.answerText ?? '已选'}），`
      + (isSegmentLoop(data, chapter)
        ? '但作者选择对应的下一段还没有用 beat_append 登记。'
        : '但这一段还没写进正文、也没用 beat_segment 登记。')
      + appendInstruction,
    );
  }

  if (openAll.length === 0) {
    return {
      ok: true,
      book,
      chapter,
      path: bookFilePath(dir, book),
      revision: currentRevision,
      committed: [],
      deferred: [],
      remaining: 0,
      total: activeDecisions(data, chapter).length,
      done: true,
      next: null,
      message: isSegmentLoop(data, chapter)
        ? '本章当前没有待拍板的决策；继续写作时用 beat_append 登记下一段，章末再 beat_finish 并 beat_verify。'
        : '本章没有待拍板的决策了，可以写正文（写完记得 beat_verify）。',
      warnings: storeWarnings,
    };
  }

  const ids = Array.isArray(args.ids)
    ? args.ids.filter((id) => typeof id === 'string' && id.trim() !== '')
    : [];
  if (ids.length > 0) {
    fail(
      'one-at-a-time',
      isSegmentLoop(data, chapter)
        ? '一次只问一个决策点：别传 ids。问完这个、用 beat_append 登记作者选择对应的下一段，再 beat_next 问下一个。'
        : '一次只问一个决策点：别传 ids。问完这个、把这一段写出来并 beat_segment 登记，再 beat_next 问下一个。',
    );
  }
  const picked = [openAll[0]];

  const questions = picked.map((decision, index) => ({
    id: decision.id,
    header: `第 ${chapter} 章 · ${index + 1}/${picked.length}`,
    question: decision.title,
    // 选项只走 options（宿主会把它们渲染成可点选的条目）。这里再列一遍，
    // 提问卡片上就会出现两遍同样的选项——作者实测投诉过。detail 只讲"会改变什么"。
    detail: decision.change ? `这会改变：${decision.change}` : '',
    options: (decision.options ?? []).map((option) => ({
      label: option.label,
      description: option.impact ?? '',
    })),
    multiSelect: false,
  }));

  let answer;
  try {
    answer = await ask({
      questions,
      agent,
      ...(exec?.signal ? { signal: exec.signal } : {}),
    });
  } catch (err) {
    const code = err?.code ?? err?.info?.code ?? '';
    fail(
      'ask-failed',
      `插件没能亲自问到作者${code ? `（${code}）` : ''}：${err?.message ?? err}。可改用 ask_user_question 追问，再用 beat_decide 落账。`,
    );
  }

  const askedAt = nowIso();
  const answers = Array.isArray(answer?.answers) ? answer.answers : [];
  const plan = picked.map((decision) => {
    const entry = answers.find((item) => item?.id === decision.id) ?? null;
    const selected = Array.isArray(entry?.selected)
      ? entry.selected.filter((value) => typeof value === 'string' && value.trim() !== '')
      : [];
    const custom = typeof entry?.custom === 'string' ? entry.custom.trim() : '';
    const choice = String(selected[0] ?? '').trim();
    const option = (decision.options ?? []).find((item) => item.label === choice) ?? null;
    if (!choice && !custom) {
      fail('no-answer', `作者没有回答决策点 ${decision.id}（${decision.title}）；没有答案就不落账。`);
    }
    return { id: decision.id, choice, custom, option };
  });

  const { result, revision } = await mutateBookData(dir, book, async (data) => {
    for (const decision of plan.map((item) => data.decisions.find((entry) => entry.id === item.id)).filter(Boolean)) {
      await validateDecisionEvidence(dir, data, decision);
      const selected = plan.find((item) => item.id === decision.id).option;
      if (decision.gate && selected) await validateSelectedOption(dir, data, decision, selected);
    }
    return commitAnswers(data, chapter, plan, {
      agentId: agent.id,
      askedAt,
      via: 'beat_next',
      gate,
    });
  });

  return {
    ok: true,
    book,
    chapter,
    path: bookFilePath(dir, book),
    revision,
    committed: result.committed,
    deferred: result.deferred,
    conflictPending: result.conflictPending,
    remaining: result.remaining,
    total: result.total,
    next: result.next,
    done: result.done,
    warnings: [...storeWarnings, ...(result.statusWarnings ?? [])],
    ...(result.conflictPending.length > 0
      ? {
        message: `作者选的是「${result.conflictPending[0].label}」，它会改掉账本里的既有设定：`
          + `${result.conflictPending[0].conflicts.map((c) => `${c.entity}.${c.key} 现在是「${c.current}」，会变成「${c.to}」`).join('；')}。`
          + '先问作者"是否允许这次剧情改这个设定"：同意就 beat_next(dir, book, chapter, confirmCanon: true)；不同意就 beat_plan(reset:true) 重新给选项。',
      }
      : {}),
  };
}

// ── beat_segment ─────────────────────────────────────────────────────────────

/**
 * 登记"这一段正文"：把刚写的文字落成段落 + 快照，挂到对应的决策点上。
 * 不负责写正文（正文由模型/作者写），只负责"哪一段、由哪些决策推动、原文是什么"。
 */
export async function executeSegment(args) {
  const dir = requireDir(args);
  const book = assertBookName(args.book);
  const chapter = assertChapter(args.chapter);
  const { data: prior } = await readBookData(dir, book);
  if (isSegmentLoop(prior, chapter)) {
    fail('chapter-mode-conflict', `第 ${chapter} 章使用 segment-loop；请用 beat_append，禁止和 legacy beat_segment 混用`);
  }
  const decisionIds = Array.isArray(args.decisionIds) ? args.decisionIds.map(String) : [];
  if (decisionIds.length === 0) {
    // 允许"没推动任何决策的段落"（开场白/过渡段）——回退要靠段落定位，正文里不该有没登记的字。
    // 但必须显式给范围，否则会把剩下的正文一口气吞成一段。
    const hasRange = Boolean(args.excerpt) || Boolean(args.fromMarker) || Boolean(args.toMarker);
    if (!hasRange) {
      fail(
        'no-decisions',
        'decisionIds 为空时是"开场/过渡段"：用 excerpt（原文）或 fromMarker/toMarker 指定这一段的范围。',
      );
    }
  }
  if (decisionIds.length > LIMITS.maxDecisionGroup) {
    fail('bad-group', `一段最多登记 ${LIMITS.maxDecisionGroup} 个决策点，多了先拆段`);
  }

  const body = await resolveBodyFile(dir, args.file);
  const before = body.text;

  const { result, warnings, revision } = await mutateBookData(dir, book, async (data) => {
    if (isSegmentLoop(data, chapter)) {
      fail('chapter-mode-conflict', `第 ${chapter} 章已切到 segment-loop；禁止和 legacy beat_segment 混用`);
    }
    const picked = [];
    for (const id of decisionIds) {
      const decision = data.decisions.find((entry) => entry.id === id);
      if (!decision) fail('no-decision', `账本里找不到决策点 ${id}`);
      if (decision.chapter !== chapter) {
        fail('wrong-chapter', `决策点 ${id} 属于第 ${decision.chapter} 章，不是第 ${chapter} 章`);
      }
      if (decision.status !== DECISION_STATUS.COMMITTED) {
        fail('not-committed', `决策点 ${id} 还没拍板（${decision.status}），不能登记成段落`);
      }
      const owner = data.segments.find((segment) => segment.id === decision.segmentId
        && segment.status !== SEGMENT_STATUS.REVERTED);
      if (owner) fail('already-segmented', `决策点 ${id} 已经登记在段落 ${owner.id} 里`);
      const claimed = data.segments.find((segment) => segment.status !== SEGMENT_STATUS.REVERTED
        && Array.isArray(segment.decisionIds) && segment.decisionIds.includes(id));
      if (claimed) fail('already-segmented', `决策点 ${id} 已经被段落 ${claimed.id} 占了`);
      await validateDecisionEvidence(dir, data, decision);
      picked.push(decision);
    }

    const start = segmentEndFor(data.segments, body.rel);
    const text = body.text;
    let from = start;
    let to = text.length;
    if (typeof args.excerpt === 'string' && args.excerpt.trim() !== '') {
      const needle = normalizeNewlines(args.excerpt);
      const index = text.indexOf(needle, start);
      if (index < 0) {
        fail('excerpt-not-found', '在正文里找不到这段原文（可能在上一段之前，或文字不完全一致）');
      }
      if (text.indexOf(needle, index + 1) >= 0) {
        fail('excerpt-ambiguous', '这段原文在正文里出现不止一次，请带上前后文让它唯一');
      }
      from = index;
      to = index + needle.length;
    } else if (typeof args.fromMarker === 'string' || typeof args.toMarker === 'string') {
      if (typeof args.fromMarker !== 'string' || typeof args.toMarker !== 'string') {
        fail('bad-markers', 'fromMarker 和 toMarker 要一起给');
      }
      const head = text.indexOf(normalizeNewlines(args.fromMarker), start);
      if (head < 0) fail('marker-not-found', '找不到 fromMarker');
      const tail = text.indexOf(normalizeNewlines(args.toMarker), head);
      if (tail < 0) fail('marker-not-found', '找不到 toMarker');
      from = head;
      to = tail + normalizeNewlines(args.toMarker).length;
    }
    if (to <= from) fail('empty-segment', '这一段是空的：先把正文写出来，再登记');

    // 写作单元闸 B：拍板那一刻记下的闸门——这一段必须正好接在闸门锚点上，
    // 且锚点之前的已登记正文没被改写（否则就是"先写后改、再补登记"）。
    const chapterKey = String(chapter);
    const gate = data.chapters?.[chapterKey]?.gate ?? null;
    if (gate && gate.consumed !== true && gate.file === body.rel) {
      if (from !== gate.offset) {
        fail(
          'unit-gap',
          `这一段从第 ${from} 字开始，但拍板时正文停在 ${gate.offset} 字。`
          + `中间那 ${Math.max(0, from - gate.offset)} 字没有对应的决策：要么先把它登记成段落，要么删掉。`,
        );
      }
      if (typeof gate.prefixHash === 'string' && sha256(text.slice(0, gate.offset)) !== gate.prefixHash) {
        fail(
          'prefix-rewritten',
          `第 ${gate.offset} 字之前已经登记的正文被改过（hash 对不上）。`
          + '先 /beat revert 回到改动处重写，或者把改动退回去，再来登记这一段。',
        );
      }
      const allow = Array.isArray(gate.decisionIds) ? gate.decisionIds : [];
      const stray = picked.map((decision) => decision.id).filter((id) => !allow.includes(id));
      if (stray.length > 0) {
        fail(
          'gate-mismatch',
          `闸门是拍板 ${allow.join('、') || '（没记下 id）'} 时开的，这一段却挂着 ${stray.join('、')}。`
          + '一段正文只能对应它自己那一次拍板：先把这个决策点问完、写完、登记，再挂别的决策。',
        );
      }
    }

    const hash = sliceHash(text, from, to);
    const chars = to - from;
    const at = nowIso();
    const segmentId = nextSegmentId(data.segments);
    const revisionId = nextRevisionId(data.revisions);

    const canonBefore = [];
    const obligationIds = [];
    for (const decision of picked) {
      for (const change of decision.chosen?.changes ?? []) {
        const entry = data.canon.find((item) => item.entity === change.entity && item.key === change.key);
        if (canonBefore.some((item) => item.entity === change.entity && item.key === change.key)) continue;
        canonBefore.push({
          entity: change.entity,
          key: change.key,
          value: entry ? entry.value : null,
          existed: Boolean(entry),
        });
      }
      for (const obligation of data.obligations) {
        if (obligation.sourceDecision === decision.id) obligationIds.push(obligation.id);
      }
    }

    const snapshot = await saveSnapshot(dir, book, revisionId, text.slice(from, to));
    data.revisions.push({
      id: revisionId,
      kind: REVISION_KIND.SEGMENT,
      chapter,
      segmentId,
      file: body.rel,
      offsetStart: from,
      offsetEnd: to,
      hash,
      chars,
      createdAt: at,
      snapshot,
      canonBefore,
      obligationIds,
    });

    const taskId = data.tasks.find((task) => task.chapter === chapter
      && task.state !== 'completed')?.id ?? null;
    const segment = {
      id: segmentId,
      chapter,
      taskId,
      decisionIds: picked.map((decision) => decision.id),
      file: body.rel,
      fromMarker: typeof args.fromMarker === 'string' ? args.fromMarker : null,
      toMarker: typeof args.toMarker === 'string' ? args.toMarker : null,
      offsetStart: from,
      offsetEnd: to,
      hash,
      chars,
      unitChars: chars,
      bodyHash: hashText(await readFile(body.real, 'utf8')),
      segmentRevision: computeRevision(data) + 1,
      sourceRefs: picked.flatMap((decision) => decision.sourceRefs ?? []),
      status: SEGMENT_STATUS.COMMITTED,
      revisionId,
      createdAt: at,
    };
    data.segments.push(segment);
    for (const decision of picked) {
      decision.segmentId = segment.id;
      decision.committedAt = decision.committedAt ?? at;
      if (decision.gate) decision.bodyBinding = {
        file: body.rel, bodyHash: segment.bodyHash, segmentId: segment.id,
        offsetStart: from, offsetEnd: to, offsetEncoding: 'utf16-lf', segmentRevision: segment.segmentRevision,
      };
    }
    data.audit.push({
      at,
      action: 'segment',
      chapter,
      segmentId,
      decisionIds: segment.decisionIds,
      file: body.rel,
      chars,
      hash,
    });

    // 登记完一段，就写下"下一次写正文之前必须先做一次续写检查"：
    // 后面有真岔路 → beat_plan 登记那一个；没有 → beat_plan(beats: [], reason)。
    refreshChapter(data, chapter);
    data.chapters[String(chapter)] = {
      ...(data.chapters[String(chapter)] ?? {}),
      continuationCheckRequired: true,
      lastSegmentId: segmentId,
      lastSegmentEnd: to,
      // 闸门只对"下一段"有意义：这一段登记完了，闸门就该由下一次拍板重新记。
      gate: gate ? { ...gate, consumed: true, consumedBy: segmentId, consumedAt: at } : null,
    };

    return { segment, revision: { id: revisionId, snapshot, hash, chars }, text: text.slice(from, to) };
  });

  const registered = result.text ?? '';
  const preview = registered.length > 600
    ? `${registered.slice(0, 600)}…（共 ${registered.length} 字）`
    : registered;

  return {
    ok: true,
    book,
    chapter,
    file: result.segment.file,
    segment: result.segment,
    revision,
    revisionRecord: result.revision,
    // 作者要能在会话里看见"刚才写进文件的那一段"，而不是只看到账本 id。
    text: preview,
    warnings: [...warnings, ...(before.length === body.text.length ? [] : ['body-changed-during-register'])],
  };
}

// ── beat_revert ──────────────────────────────────────────────────────────────

/**
 * 用登记时的快照原文，在现在的正文里找这一段落在哪。
 * 只服务一件事：正文被手工改过之后，还能不能安全地截断。
 * 返回 { status: 'found', index } | { status: 'missing' } | { status: 'ambiguous', count }。
 */
async function locateSegmentText(dir, book, data, segment, bodyText) {
  const revision = (data.revisions ?? []).find((item) => item.segmentId === segment.id
    && item.kind === REVISION_KIND.SEGMENT && typeof item.snapshot === 'string');
  if (!revision) return { status: 'missing' };
  let needle;
  try {
    needle = normalizeNewlines(await readSnapshot(dir, book, revision.id));
  } catch {
    return { status: 'missing' };
  }
  if (!needle) return { status: 'missing' };
  const first = bodyText.indexOf(needle);
  if (first < 0) return { status: 'missing' };
  const second = bodyText.indexOf(needle, first + 1);
  if (second < 0) return { status: 'found', index: first };
  let count = 2;
  let cursor = second;
  while (count < 10) {
    const next = bodyText.indexOf(needle, cursor + 1);
    if (next < 0) break;
    count += 1;
    cursor = next;
  }
  return { status: 'ambiguous', count };
}

/**
 * 安全回退：把正文退回这一段之前，并把这一段的账本一起撤掉。
 * - 退第 N 段 = 在它的 offsetStart 处截断正文，第 N 段及其后所有已登记段落一律作废（级联），
 *   canon/义务按倒序撤回：后面的段落先退，才落得回最初的 from。
 * - mode=text/ledger/both 保留；ledger 只撤账本、不动正文。
 * - 正文被手工改过时不再照着旧 offset 硬截（会截坏作者改过的文字）：
 *   原文还在原位 → 直接退；原文能在文件里唯一定位 → 要 confirm 才动；
 *   找不回来 / 出现多次 → 直接拒绝（cannot-locate），宁可失败也不动正文。
 */
export async function executeRevert(args, { segmentLoop = false } = {}) {
  const dir = requireDir(args);
  const book = assertBookName(args.book);
  const chapter = assertChapter(args.chapter);
  const mode = args.mode ?? 'both';
  if (!['text', 'ledger', 'both'].includes(mode)) fail('bad-mode', 'mode 只能是 text / ledger / both');
  const wantText = mode === 'text' || mode === 'both';
  const wantLedger = mode === 'ledger' || mode === 'both';

  const { data, warnings: readWarnings } = await readBookData(dir, book);
  if (!data) fail('no-book', `书「${book}」还没有账本`);
  if (isSegmentLoop(data, chapter)) {
    if (!segmentLoop) fail('feature-disabled', 'segment-loop 实验功能已关闭，不能回退该章。');
    if (args.mode !== undefined && args.mode !== 'both') {
      fail('bad-mode', 'segment-loop 回退只处理段落账本和下游收据；mode 只能省略或为 both');
    }
    const { result, warnings, revision } = await mutateBookData(dir, book, (state) => revertLoop(state, {
      ...args,
      segmentId: args.segment ?? args.segmentId,
      chapter,
    }));
    return {
      ok: true,
      book,
      chapter,
      revision,
      ...result,
      receipt: result,
      reverted: result,
      warnings: [...readWarnings, ...(warnings ?? [])],
    };
  }

  const committed = data.segments
    .filter((segment) => segment.status === SEGMENT_STATUS.COMMITTED)
    .filter((segment) => (args.segment ? segment.id === args.segment : segment.chapter === chapter))
    .sort((left, right) => (right.offsetEnd ?? 0) - (left.offsetEnd ?? 0));
  const target = committed[0];
  if (!target) {
    fail('nothing-to-revert', args.segment
      ? `段落 ${args.segment} 不是"已登记未回退"状态`
      : `第 ${chapter} 章还没有登记过段落，没什么可回退`);
  }

  // 级联：正文模式下，这一段之后（含自己）登记过的段落全部作废。只退自己会留下
  // "正文已经不存在、段落还挂在账本上"的僵尸段，beat_verify 每次都会报假漂移。
  const cascade = (wantText
    ? data.segments.filter((segment) => segment.status === SEGMENT_STATUS.COMMITTED
      && segment.file === target.file
      && (segment.offsetStart ?? 0) >= (target.offsetStart ?? 0))
    : [target]).sort((left, right) => (left.offsetStart ?? 0) - (right.offsetStart ?? 0));
  const cascadeIds = cascade.map((segment) => segment.id);

  const body = await resolveBodyFile(dir, target.file);
  const originalBytes = await readFile(body.real);
  if (normalizeNewlines(originalBytes.toString('utf8')) !== body.text) {
    fail('body-hash-conflict', '正文在读取和计算回退影响之间发生变化；未执行回退，请刷新后重试。');
  }
  const warnings = [...readWarnings];
  const bodyText = normalizeNewlines(body.text);
  let cutAt = target.offsetStart;

  if (wantText) {
    const intact = target.offsetEnd <= bodyText.length
      && sliceHash(bodyText, target.offsetStart, target.offsetEnd) === target.hash;
    if (!intact) {
      const located = await locateSegmentText(dir, book, data, target, bodyText);
      if (located.status === 'missing') {
        fail('cannot-locate', `第 ${target.id} 段登记之后正文被改过，按登记时的原文已经找不回来（可能被改写或删掉了）。为避免截坏你写的东西，插件不动正文。请手工处理这一段，或先用 /beat list 看段落范围。`);
      }
      if (located.status === 'ambiguous') {
        fail('cannot-locate', `第 ${target.id} 段的原文在正文里出现了 ${located.count} 次，分不清该从哪截断。为避免截错，插件不动正文。请先手工删掉多余的重复内容，或先用 /beat list 看段落范围。`);
      }
      if (args.confirm !== true) {
        fail('needs-confirm', `第 ${target.id} 段登记之后正文被改过：按原文找到它在第 ${located.index} 字处（登记时是第 ${target.offsetStart} 字）。确认要从这里截断、把这一段和它后面已登记的段落一起作废吗？确认后带上 confirm:true 再调一次（命令里写 /beat revert <段号>!）。`);
      }
      cutAt = located.index;
      warnings.push(`relocated:${target.id}: 正文被改过，按原文重新定位到第 ${cutAt} 字处截断`);
    }
  }

  const expectedRevision = Number.isInteger(args.expectedRevision) ? args.expectedRevision : computeRevision(data);
  const expectedLedgerHash = data.integrity?.ledgerHash ?? null;
  const expectedBodyHash = hashRawBytes(originalBytes);
  const truncated = bodyText.slice(0, cutAt);
  const removedChars = Math.max(0, bodyText.length - truncated.length);
  const staleChapters = [...new Set([
    ...(data.decisions ?? []).filter((entry) => entry.chapter > target.chapter).map((entry) => entry.chapter),
    ...(data.segments ?? []).filter((entry) => entry.chapter > target.chapter).map((entry) => entry.chapter),
  ])].sort((left, right) => left - right);

  const transaction = await commitPairTransaction({
    dir,
    book,
    bodyFile: body.real,
    expectedRevision,
    expectedBodyHash,
    expectedLedgerHash,
    kind: 'beat-revert',
    chapter: target.chapter,
    decisionId: target.decisionIds?.[0] ?? null,
    staleChapters,
    mutate: ({ data: state, bodyBytes }) => {
      const wanted = new Set(cascadeIds);
      const at = nowIso();
      let restoredCanon = 0;
      let removedObligations = 0;
      const revertedDecisions = [];

      // 倒序：后面的段落先撤。两条决策改同一个 entity/key 时，正序会停在中间态。
      const ordered = state.segments
        .filter((segment) => wanted.has(segment.id))
        .sort((left, right) => (right.offsetStart ?? 0) - (left.offsetStart ?? 0));

      if (wantLedger) {
        for (const segment of ordered) {
          const revision = state.revisions.find((entry) => entry.id === segment.revisionId);
          const owned = new Set(segment.decisionIds ?? []);
          const kept = [];
          for (const entry of state.canon) {
            if (!owned.has(entry.decisionId)) {
              kept.push(entry);
              continue;
            }
            const decision = state.decisions.find((item) => item.id === entry.decisionId);
            const change = (decision?.chosen?.changes ?? [])
              .find((item) => item.entity === entry.entity && item.key === entry.key);
            if (!change || change.from === undefined || change.from === null) {
              // 这一段之前没有这条 canon，撤回就是删掉
              restoredCanon += 1;
              continue;
            }
            kept.push({ ...entry, value: change.from, decisionId: null, updatedAt: at });
            restoredCanon += 1;
          }
          state.canon = kept;

          const ownedObligations = new Set(revision?.obligationIds ?? []);
          const keep = [];
          for (const obligation of state.obligations) {
            if (ownedObligations.has(obligation.id) || owned.has(obligation.sourceDecision)) {
              removedObligations += 1;
              continue;
            }
            keep.push(obligation);
          }
          state.obligations = keep;

          for (const id of segment.decisionIds ?? []) {
            if (!revertedDecisions.includes(id)) revertedDecisions.push(id);
          }
        }
      }

      if (wantText) {
        for (const segment of state.segments) {
          if (wanted.has(segment.id)) segment.status = SEGMENT_STATUS.REVERTED;
        }
        for (const decision of state.decisions) {
          if (decision.segmentId && wanted.has(decision.segmentId)) decision.segmentId = null;
        }
      }

      const revertId = nextRevisionId(state.revisions);
      state.revisions.push({
        id: revertId,
        kind: REVISION_KIND.REVERT,
        chapter: target.chapter,
        segmentId: target.id,
        file: target.file,
        mode,
        revertedSegments: [...cascadeIds],
        revertedDecisions,
        charsBefore: cascade.reduce((sum, segment) => sum + (segment.chars ?? 0), 0),
        charsRemoved: wantText ? removedChars : 0,
        hashBefore: target.hash,
        createdAt: at,
      });
      state.audit.push({
        at,
        action: 'revert',
        chapter: target.chapter,
        segmentId: target.id,
        mode,
        revertedSegments: [...cascadeIds],
        restoredCanon,
        removedObligations,
        revisionId: revertId,
      });
      refreshChapter(state, target.chapter);
      const result = {
        segmentId: target.id,
        mode,
        file: target.file,
        revertedSegments: [...cascadeIds],
        revertedDecisions,
        restoredCanon,
        removedObligations,
        revisionId: revertId,
        nextOffset: cutAt,
      };
      return {
        body: wantText ? Buffer.from(truncated, 'utf8') : bodyBytes,
        result,
      };
    },
  });

  const extra = cascadeIds.length - 1;
  const message = [
    `第 ${target.chapter} 章 ${target.file} 的第 ${cutAt} 字之后已作废`,
    extra > 0 ? `（连它后面 ${extra} 段一起作废，共 ${cascadeIds.length} 段）` : '',
    wantText ? `，正文删掉 ${removedChars} 字` : '',
    `。从第 ${cutAt} 字处重写这一段，写完用 beat_segment 登记。`,
  ].join('');

  return {
    ok: true,
    book,
    chapter: target.chapter,
    revision: transaction.transactionRevision,
    txId: transaction.txId,
    postCommit: transaction.postCommit,
    reverted: transaction.result,
    message,
    warnings: [...warnings, ...(transaction.warnings ?? [])],
  };
}

// ── 段落清单（/beat list 用）─────────────────────────────────────────────────

/**
 * 本章已经登记过的段落，按在正文里的先后排序。
 * 作者要说"第 3 段不行、重写"时，靠它指认；模型写下一段之前也该先看一眼。
 */
export async function listSegments(args) {
  const dir = requireDir(args);
  const book = assertBookName(args.book);
  const chapter = assertChapter(args.chapter);
  const { data } = await readBookData(dir, book);
  if (!data) return { ok: true, book, chapter, segments: [], message: '这本书还没有账本' };
  const segments = data.segments
    .filter((segment) => segment.chapter === chapter)
    .sort((left, right) => (left.offsetStart ?? 0) - (right.offsetStart ?? 0))
    .map((segment) => ({
      id: segment.id,
      status: segment.status,
      file: segment.file,
      chars: segment.chars,
      offsetStart: segment.offsetStart,
      offsetEnd: segment.offsetEnd,
      decisions: (segment.decisionIds ?? []).map((id) => {
        const decision = data.decisions.find((item) => item.id === id);
        return { id, title: decision?.title ?? '', choice: decision?.chosen?.label ?? null };
      }),
    }));
  return { ok: true, book, chapter, segments };
}

// ── beat_gate ────────────────────────────────────────────────────────────────

export async function executeGate(args, { segmentLoop = false } = {}) {
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
  if (typeof args.text === 'string' && typeof args.path === 'string') {
    fail('bad-args', '零候选检查的 text 与 path 只能给一个');
  }

  const list = activeDecisions(data, chapter);
  if (list.length === 0) {
    if (!isSegmentLoop(data, chapter)) {
      try {
        const scan = data.chapters?.[String(chapter)]?.decisionScan;
        let body = typeof args.text === 'string' ? args.text : null;
        const path = args.path ?? scan?.bodyFile;
        if (body === null && typeof path === 'string') body = (await readChapterText(resolveWorkspaceRoot(dir), path)).text;
        if (body !== null) {
          const receipt = await validateDecisionScan(dir, data, chapter, body);
          return {
            ok: true, pass: true, book, chapter, scope: 'chapter', total: 0, pending: [],
            noDecision: { reason: receipt.reason, scanId: receipt.id },
            message: `第 ${chapter} 章已登记零候选扫描理由，可继续写作或验章。`,
            warnings,
          };
        }
      } catch (error) {
        return {
          ok: true, pass: false, book, chapter, total: 0, pending: [],
          code: error.code ?? 'scan-required', message: error.message, warnings: [...warnings, error.code ?? 'scan-required'],
        };
      }
    }
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

  // 0.7.0：闸门下放到"本段"。给了 ids 就只对本段这几个决策负责；
  // 不给就退化成"整章"（0.6 语义，兼容老调用）。
  const scope = Array.isArray(args.ids) && args.ids.length > 0 ? 'segment' : 'chapter';
  const wanted = scope === 'segment' ? args.ids.map(String) : null;
  const scoped = wanted ? list.filter((decision) => wanted.includes(decision.id)) : list;
  const known = new Set(scoped.map((decision) => decision.id));
  const missing = wanted ? wanted.filter((id) => !known.has(id)) : [];

  const pending = scoped.filter((decision) => decision.status !== DECISION_STATUS.COMMITTED);
  try {
    for (const decision of scoped) await validateDecisionEvidence(dir, data, decision);
  } catch (error) {
    return { ok: true, pass: false, book, chapter, total: scoped.length, pending: [],
      code: error.code, message: error.message, warnings: [...warnings, error.code] };
  }
  const legacy = scoped.filter((decision) => decision.legacy);
  const gateWarnings = [...warnings];
  if (legacy.length > 0) {
    gateWarnings.push(`legacy:${legacy.map((decision) => decision.id).join(',')}:旧版决策只有拍板文本，verify 只能弱校验`);
  }
  if (missing.length > 0) {
    gateWarnings.push(`unknown:${missing.join(',')}:这些决策点不在本章账本里`);
  }

  return {
    ok: true,
    pass: pending.length === 0 && missing.length === 0,
    book,
    chapter,
    scope,
    total: scoped.length,
    pending: pending.map((decision) => ({ id: decision.id, title: decision.title, status: decision.status })),
    message: missing.length > 0
      ? `第 ${chapter} 章账本里找不到决策点：${missing.join(', ')}。`
      : pending.length === 0
        ? (scope === 'segment'
          ? `本段对应的 ${scoped.length} 个决策点都已拍板，可以写这一段了。`
          : `第 ${chapter} 章 ${scoped.length} 个决策点全部拍板，可以写正文了。`)
        : (scope === 'segment'
          ? `本段还有 ${pending.length} 个决策点没拍板（${pending.map((entry) => entry.id).join(', ')}），不能写这一段。`
          : `第 ${chapter} 章还有 ${pending.length} 个决策点未拍板，不能写正文。`),
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

export async function executeVerify(args, { segmentLoop = false } = {}) {
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
  const currentRevision = computeRevision(before);

  if (isSegmentLoop(before, chapter)) {
    if (!segmentLoop) fail('feature-disabled', 'segment-loop 实验功能已关闭，不能校验该章。');
    if (!hasText) fail('not-merged', `segment-loop 的 beat_verify 必须传入 beat_finish 返回的合并全文 text`);
    await verifyLoopMerge(dir, book, before, chapter, body);
  }

  const drift = isSegmentLoop(before, chapter) ? [] : await segmentWarnings(dir, before, resolvedPath, body);

  const loopChapter = isSegmentLoop(before, chapter);
  if (!loopChapter) {
    for (const decision of activeDecisions(before, chapter)) await validateDecisionEvidence(dir, before, decision);
  }
  let noDecisionScan = null;
  if (!loopChapter && activeDecisions(before, chapter).length === 0) {
    noDecisionScan = await validateDecisionScan(dir, before, chapter, body);
  }
  const allowNoDecisions = loopChapter || Boolean(noDecisionScan);
  const first = verifyChapter(before, chapter, body, { strict, allowNoDecisions });
  if (!strict) first.warnings.push('strict-off:缺证据按 warning 处理，章节仍可标记 verified');

  if (!first.pass) {
    return {
      ok: true,
      book,
      chapter,
      path: resolvedPath,
      revision: currentRevision,
      verified: false,
      ...first,
      warnings: [...readWarnings, ...drift, ...first.warnings],
    };
  }

  const { result, warnings: writeWarnings, revision } = await mutateBookData(dir, book, async (data) => {
    if (isSegmentLoop(data, chapter)) {
      if (!segmentLoop) fail('feature-disabled', 'segment-loop 实验功能已关闭，不能校验该章。');
      await verifyLoopMerge(dir, book, data, chapter, body);
    } else if (loopChapter) {
      fail('revision-conflict', '章节模式在 verify 写入前发生变化，请刷新后重试。');
    }
    if (!loopChapter) {
      for (const decision of activeDecisions(data, chapter)) await validateDecisionEvidence(dir, data, decision);
    }
    const currentNoDecisionScan = !isSegmentLoop(data, chapter) && activeDecisions(data, chapter).length === 0
      ? await validateDecisionScan(dir, data, chapter, body)
      : null;
    const structuredVerification = Boolean(currentNoDecisionScan)
      || (!loopChapter && activeDecisions(data, chapter).some((decision) => decision.gate));
    if (structuredVerification && resolvedPath && hashText(await readFile(resolvedPath, 'utf8')) !== hashText(body)) {
      fail('stale-evidence', '正文在验章写入前已经改变，请重新验章');
    }
    const check = verifyChapter(data, chapter, body, {
      strict,
      allowNoDecisions: isSegmentLoop(data, chapter) || Boolean(currentNoDecisionScan),
    });
    if (!check.pass) fail('verify-race', '账本在写入前发生了变化，请重试');
    if (!strict) check.warnings.push('strict-off:缺证据按 warning 处理，章节仍可标记 verified');

    const now = nowIso();
    const previous = data.chapters[String(chapter)] ?? {};
    const decisionIds = activeDecisions(data, chapter).map((decision) => decision.id);
    const needsPayment = check.paidObligationIds.some((id) => (
      data.obligations.find((obligation) => obligation.id === id)?.status === 'open'
    ));
    if (previous.status === 'verified'
      && (!structuredVerification || previous.verifiedBodyHash === hashText(body))
      && (!structuredVerification || !resolvedPath || data.integrity.bodyBindings.some((entry) =>
        entry.chapter === chapter && entry.bodyHash === hashText(body)))
      && Array.isArray(previous.decisionIds)
      && previous.decisionIds.length === decisionIds.length
      && previous.decisionIds.every((id, index) => id === decisionIds[index])
      && !needsPayment) {
      return noChange({ ...check, verified: true, paidObligationIds: [] });
    }
    data.chapters[String(chapter)] = {
      ...previous,
      status: 'verified',
      decisionIds,
      verifiedAt: now,
      ...(structuredVerification ? { verifiedBodyHash: hashText(body) } : {}),
    };
    if (resolvedPath) {
      data.integrity ??= { algorithm: 'sha256', ledgerHash: null, bodyBindings: [] };
      const binding = {
        file: relative(await realpath(resolveWorkspaceRoot(dir)), resolvedPath).split(sep).join('/'),
        bodyHash: hashText(body),
        chapter,
        revision: computeRevision(data) + 1,
        updatedAt: now,
      };
      data.integrity.bodyBindings = Array.isArray(data.integrity.bodyBindings) ? data.integrity.bodyBindings : [];
      data.integrity.bodyBindings = data.integrity.bodyBindings.filter((entry) => entry.file !== binding.file);
      data.integrity.bodyBindings.push(binding);
    }

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
    revision,
    ...result,
    ...(noDecisionScan ? { noDecision: { reason: noDecisionScan.reason, scanId: noDecisionScan.id } } : {}),
    warnings: [...readWarnings, ...writeWarnings, ...drift, ...result.warnings],
  };
}

/** 已经登记的段落被改过没有、整个文件有没有没登记的正文：只报 warning，不拦 verify。 */
async function segmentWarnings(dir, data, absolutePath, body) {
  if (!absolutePath) return [];
  let rel;
  try {
    const root = await realpath(resolveWorkspaceRoot(dir));
    rel = relative(root, absolutePath).split(sep).join('/');
  } catch {
    return [];
  }
  const text = normalizeNewlines(body);
  const warnings = [];
  const mine = (data?.segments ?? []).filter((segment) => segment.file === rel);
  for (const segment of mine) {
    if (segment.status !== SEGMENT_STATUS.COMMITTED) continue;
    if (!Number.isInteger(segment.offsetStart) || !Number.isInteger(segment.offsetEnd)) continue;
    if (segment.offsetEnd > text.length) {
      warnings.push(`drift:${segment.id}:这一段在原位置已经不存在（正文变短了）`);
      continue;
    }
    const current = text.slice(segment.offsetStart, segment.offsetEnd);
    if (sha256(current) !== segment.hash) {
      warnings.push(`drift:${segment.id}:这一段登记后又被改过`);
    }
  }

  // 覆盖检查：正文里不该有"没登记成段落"的地方——回退和漂移都靠段落定位。
  const live = mine
    .filter((segment) => segment.status === SEGMENT_STATUS.COMMITTED)
    .filter((segment) => Number.isInteger(segment.offsetStart) && Number.isInteger(segment.offsetEnd))
    .sort((left, right) => left.offsetStart - right.offsetStart);
  if (live.length === 0) {
    if (text.trim() !== '') {
      warnings.push('unsegmented:整章还没有 beat_segment 登记；这样 beat_revert 退不了，漂移也查不出来');
    }
    return warnings;
  }
  let cursor = 0;
  let gaps = 0;
  for (const segment of live) {
    if (segment.offsetStart > cursor) {
      gaps += 1;
      if (gaps <= 3) {
        warnings.push(`unsegmented:第 ${cursor}–${segment.offsetStart} 字还没登记成段落（用 beat_segment 补；否则回退会退到别处）`);
      }
    }
    cursor = Math.max(cursor, segment.offsetEnd);
  }
  if (cursor < text.length) {
    gaps += 1;
    if (gaps <= 3) {
      warnings.push(`unsegmented:结尾 ${cursor}–${text.length} 字还没登记成段落（用 beat_segment 补）`);
    }
  }
  if (gaps > 3) warnings.push(`unsegmented:共 ${gaps} 处没登记，只列了前 3 处`);

  // 粒度诊断（只报数，不拦）：一段占了大半章，说明"先写完整章再登记"很可能又发生了。
  const total = text.trim().length;
  if (total > 1500 && live.length > 0) {
    for (const segment of live) {
      const share = (segment.offsetEnd - segment.offsetStart) / total;
      if (share > 0.6) {
        const words = segment.offsetEnd - segment.offsetStart;
        warnings.push(
          `coarse-unit:${segment.id}:这一段 ${words} 字，占本章 ${Math.round(share * 100)}%——`
          + '一段里塞了整章，说明中间那些岔路没被问到（下次写成一段就登记一段）',
        );
      }
    }
  }
  const chapterDecisions = (data?.decisions ?? []).filter((decision) => (
    decision.chapter === live[0]?.chapter
      && decision.legacyReceipt !== true
      && (decision.status === DECISION_STATUS.COMMITTED || OPEN_DECISION_STATUSES.includes(decision.status))
  ));
  if (total > 1500 && chapterDecisions.length <= 1) {
    warnings.push(
      `thin-forks:本章 ${total} 字、一共只问了 ${chapterDecisions.length} 个岔路——`
      + '按节奏至少该有几处会改变走向的选择，回头看看有没有该问没问的',
    );
  }
  return warnings;
}

// ── beat_adjust ──────────────────────────────────────────────────────────────

export async function executeAdjust(args, { segmentLoop = false } = {}) {
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

  const { result, warnings, revision } = await mutateBookData(dir, book, (data) => {
    if (action === 'waive') {
      const obligation = data.obligations.find((entry) => entry.id === id);
      if (!obligation) fail('no-obligation', `没有义务 ${id}`);
      const sourceDecision = data.decisions.find((entry) => entry.id === obligation.sourceDecision);
      if (sourceDecision && isSegmentLoop(data, sourceDecision.chapter) && !segmentLoop) {
        fail('feature-disabled', 'segment-loop 实验功能已关闭，不能修改该章的义务。');
      }
      if (obligation.status === 'paid') fail('already-paid', `义务 ${id} 已在第 ${obligation.paidChapter} 章回收`);
      if (obligation.status === 'waived') {
        return noChange({ id, status: 'waived', already: true });
      }
      obligation.status = 'waived';
      obligation.waivedReason = reason;
      data.audit.push({ at: nowIso(), action: 'waive', obligationId: id, reason });
      return { id, status: 'waived' };
    }

    const decision = data.decisions.find((entry) => entry.id === id);
    if (!decision) fail('no-decision', `没有决策点 ${id}`);
    if (isSegmentLoop(data, decision.chapter) && !segmentLoop) {
      fail('feature-disabled', 'segment-loop 实验功能已关闭，不能修改该章的决策。');
    }
    if (decision.status === 'superseded') {
      return noChange({ id, status: 'superseded', already: true });
    }
    if (decision.status !== DECISION_STATUS.COMMITTED) {
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
    revision,
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

const evidenceRefSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['body', 'outline', 'canon', 'author'] },
    chapter: { type: 'number' },
    segmentId: { type: 'string' },
    file: { type: 'string' },
    hash: { type: 'string' },
    offsetStart: { type: 'integer' },
    offsetEnd: { type: 'integer' },
    quote: { type: 'string' },
    sourceId: { type: 'string' },
  },
  required: ['kind', 'quote'],
  additionalProperties: false,
};

const claimSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    basis: { type: 'string', enum: ['known-fact', 'inference'] },
    sourceRefs: { type: 'array', items: evidenceRefSchema, maxItems: 8 },
  },
  required: ['text', 'basis', 'sourceRefs'],
  additionalProperties: false,
};

const stateDeltaSchema = {
  type: 'object',
  properties: {
    entity: { type: 'string' },
    entityLabel: { type: 'string' },
    key: { type: 'string', enum: Object.keys(STATE_KEY_ALLOWLIST) },
    keyLabel: { type: 'string' },
    from: { type: 'string' },
    fromLabel: { type: 'string' },
    to: { type: 'string' },
    toLabel: { type: 'string' },
    evidence: { type: 'array', items: evidenceRefSchema, minItems: 1, maxItems: 8 },
  },
  required: ['entity', 'key', 'from', 'to', 'evidence'],
  additionalProperties: false,
};

const decisionGateSchema = {
  type: 'object',
  properties: {
    entity: { type: 'string' },
    entityLabel: { type: 'string' },
    key: stateDeltaSchema.properties.key,
    keyLabel: { type: 'string' },
    from: { type: 'string' },
    fromLabel: { type: 'string' },
    to: { type: 'string' },
    toLabel: { type: 'string' },
    evidence: { type: 'array', items: evidenceRefSchema, minItems: 1, maxItems: 8 },
    reason: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
  required: ['entity', 'key', 'from', 'to', 'evidence', 'reason', 'confidence'],
  additionalProperties: false,
};

const optionSchemaV3 = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    label: { type: 'string' },
    impact: { type: 'string' },
    action: { type: 'string' },
    costs: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 8 },
    outcomes: { type: 'array', items: claimSchema, maxItems: 8 },
    informationGain: { type: 'array', items: claimSchema, maxItems: 8 },
    risks: { type: 'array', items: claimSchema, maxItems: 8 },
    changes: { type: 'array', items: stateDeltaSchema, minItems: 1, maxItems: 8 },
    obligations: { type: 'array', items: obligationSchema, maxItems: 6 },
    forbidden: { type: 'array', items: { type: 'string' }, maxItems: 6 },
  },
  required: ['action', 'costs', 'outcomes', 'informationGain', 'risks', 'changes'],
  additionalProperties: false,
};

const beatSchemaV3 = {
  ...beatSchema,
  properties: {
    ...beatSchema.properties,
    gate: decisionGateSchema,
    options: {
      type: 'array',
      items: optionSchemaV3,
      minItems: 2,
      maxItems: 4,
    },
  },
  required: ['title', 'kind', 'gate', 'options'],
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

export function toolDefinitions({ ask = null, askAvailable = false, segmentLoop = false } = {}) {
  const planDescription = segmentLoop
    ? '登记一个决策点（一章多次调用，每次一个）。走到真正的岔路才登记：写到那里、读者马上要看到结果时调。每个决策点给 2–4 个真分叉；每个选项必须写 impact 和 changes（entity/key/from/to/evidence），不同选项的 changes 必须不同。segment-loop 中每次调用都必须绑定最新 segmentId、segmentHash 和 expectedRevision；无岔路传 beats: [] + reason。作者选择后，下一次用 beat_append 登记对应的下一段。'
    : '只提交一个候选，不替作者决定。0.10.0 新候选必须包含 gate 状态差分、可精确回查的 EvidenceRef，以及每个选项的 action/costs/outcomes/informationGain/risks/changes；闸门会拒绝白名单外状态键、陈旧/错位证据、no-op、重复差分、已由作者决定和假分叉。beats:[] 必须给 reason，并绑定 path 或 text，写入 decisionScan 收据；零决策章只有收据和正文 hash 匹配才可 verify。旧版输入保留兼容读取，旧章节仍用 beat_segment。每次只登记一个候选。';
  const nextDescription = segmentLoop
    ? '把下一个待拍板的决策点由插件亲手摆给作者，作者本人选（一次只问一个决策点，不传 ids）。作者选完插件自己落账（凭据 origin=author），不用再调 beat_decide。如果作者选的选项会改掉既有设定（和 canon 对不上），插件不会硬失败：它把选择存成待确认，你去问作者"是否允许这次剧情改这个设定"，同意后 beat_next(confirmCanon: true) 提交。作者选择后，下一次用 beat_append 登记对应的下一段；没有登记前不会继续询问下一个决策点。'
    : '把下一个待拍板的决策点由插件亲手摆给作者，作者本人选（一次只问一个决策点，不传 ids）。作者选完插件自己落账（凭据 origin=author），不用再调 beat_decide。如果作者选的选项会改掉既有设定（和 canon 对不上），插件不会硬失败：它把选择存成待确认，你去问作者"是否允许这次剧情改这个设定"，同意后 beat_next(confirmCanon: true) 提交。问完就按答案写这一段正文，再用 beat_segment 登记；没有登记段落之前 asking 下一个会被拒（segment-required）。';
  return [
    {
      name: 'beat_plan',
      description: planDescription,
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam,
          book: bookParam,
          chapter: chapterParam,
          beats: { type: 'array', items: segmentLoop ? beatSchema : beatSchemaV3, minItems: 0, maxItems: 1 },
          reason: { type: 'string', description: '只有 beats 为空时用：为什么这一段后面确实没有需要作者拍板的岔路（续写检查的结论）' },
          ...(!segmentLoop ? {
            path: { type: 'string', description: '零候选扫描绑定的工作区内 .md/.txt 文件路径；与 text 二选一' },
            text: { type: 'string', description: '零候选扫描绑定的正文全文；与 path 二选一' },
            sourceRefs: { type: 'array', items: evidenceRefSchema, maxItems: 32, description: '本次零候选扫描读取的大纲/canon/作者来源；任何来源改变都需重扫' },
          } : {}),
          segmentId: { type: 'string', description: 'segment-loop 续写检查所绑定的最新段落 ID' },
          segmentHash: { type: 'string', description: 'segment-loop 续写检查所绑定的最新段落 SHA-256' },
          expectedRevision: { type: 'number', description: 'segment-loop 调用前读取到的账本 revision' },
          append: { type: 'boolean', description: '追加到本章已有决策点后面，保留已拍板' },
          reset: { type: 'boolean', description: '清掉本章未拍板的决策点后重建；已拍板的决策和它们写进 canon 的结果保留' },
          forkId: { type: 'string', description: '作者用 /beat fork 插的岔路 id（如 f-0001）。有 open 的岔路时必须带上它，登记后那条岔路自动标成 planned' },
        },
        required: ['dir', 'book', 'chapter', 'beats'],
        additionalProperties: false,
      },
      output,
      execute: (args) => executePlan(args, { segmentLoop, requireGate: !segmentLoop }),
    },
    {
      name: 'beat_next',
      description: nextDescription,
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam,
          book: bookParam,
          chapter: chapterParam,
          confirmCanon: {
            type: 'boolean',
            description: '作者已经口头确认"这次可以改设定"时传 true：把上一次因 canon 冲突而暂存的选择正式提交（覆盖 canon 并留 canon-overridden 记录）',
          },
        },
        required: ['dir', 'book', 'chapter'],
        additionalProperties: false,
      },
      output,
      execute: (args, exec) => executeNext(args, exec, { ask, segmentLoop }),
    },
    {
      name: 'beat_segment',
      description: '登记刚写的这一段正文：把 decisionIds 对应的已拍板决策挂到文件里的那一段上，存快照和 hash，之后 beat_revert 才能精确回退。登记成功会把这一段正文回显出来（作者看得见）。默认取"上一段之后到文件末尾"；给 excerpt（原文）或 fromMarker/toMarker 可指定范围。开场/过渡段可以不带决策，但必须给 excerpt 或 markers。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam,
          book: bookParam,
          chapter: chapterParam,
          file: { type: 'string', description: '正文文件路径（工作区内，.md/.txt）' },
          decisionIds: {
            type: 'array',
            items: { type: 'string' },
            minItems: 0,
            maxItems: 3,
            description: '推动这一段的决策点 id（必须都已拍板）；开场/过渡段可以为空数组',
          },
          excerpt: { type: 'string', description: '这一段的原文（可选，用于精确定位；必须唯一）' },
          fromMarker: { type: 'string', description: '段落起始标记（可选，和 toMarker 一起用）' },
          toMarker: { type: 'string', description: '段落结束标记（可选）' },
        },
        required: ['dir', 'book', 'chapter', 'file', 'decisionIds'],
        additionalProperties: false,
      },
      output,
      execute: executeSegment,
    },
    {
      name: 'beat_revert',
      description: '安全回退：退第 N 段 = 在它的起点截断正文，这一段和它后面所有已登记段落一起作废，canon/义务倒序撤回。默认退本章最后一段。作者说"这段不行、重写"时用它；返回的 message 就是让模型从哪重写。正文被手工改过时：找得回原文位置会先要 confirm:true，找不回来直接拒绝（cannot-locate），不会硬截。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam,
          book: bookParam,
          chapter: chapterParam,
          segment: { type: 'string', description: '要回退的段落 id（可选，默认本章最后一段）' },
          mode: { type: 'string', enum: ['text', 'ledger', 'both'], description: '默认 both' },
          confirm: { type: 'boolean', description: '正文被手工改过、按原文重新定位到新位置时才需要：确认后传 true 才会截断' },
          expectedRevision: { type: 'number', description: 'segment-loop 回退时必填的账本 revision' },
        },
        required: ['dir', 'book', 'chapter'],
        additionalProperties: false,
      },
      output,
      execute: (args) => executeRevert(args, { segmentLoop }),
    },
    {
      name: 'beat_fork',
      description: '作者主动插一条岔路：模型漏判、而作者认为"这里该让我拍板"时用。作者可以用 /beat fork 触发。登记后必须用 beat_plan（带 forkId）给它写 2–4 个选项，再 beat_next 问作者；在它被登记成决策点之前，beat_next 会拒绝发新题。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam,
          book: bookParam,
          chapter: chapterParam,
          text: { type: 'string', description: '一句话说清要决定什么，例如「要不要当场杀掉独孤博」' },
        },
        required: ['dir', 'book', 'chapter', 'text'],
        additionalProperties: false,
      },
      output,
      execute: (args) => executeFork(args, { segmentLoop }),
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
      description: '兼容入口，只在宿主没有提问服务时兜底。开着拍板模式且能自己问作者时会被拒绝——那种情况用 beat_next（插件自己问、自己落账）。choice 精确匹配选项 label；自定义内容必须同时给 changes。已拍板要改传 supersede:true 和 reason。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam,
          book: bookParam,
          chapter: chapterParam,
          id: { type: 'string', description: '决策点 id，如 b1-1' },
          choice: { type: 'string', description: '作者选的 label，或作者自己写的原话' },
          ...(!segmentLoop ? { optionDraft: { oneOf: [optionSchemaV3], description: '新决策的自定义/改写选项，必须包含完整六要素并通过同一证据闸门' } } : {}),
          changes: { type: 'array', items: changeSchema, minItems: 1, maxItems: 8, description: '自定义 choice 必填' },
          note: { type: 'string', description: '可选备注' },
          supersede: { type: 'boolean', description: '重拍已拍板决策时必须为 true' },
          reason: { type: 'string', description: '重拍原因（作者为什么改主意）' },
        },
        required: ['dir', 'book', 'chapter', 'id', 'choice'],
        additionalProperties: false,
      },
      output,
      execute: (args, exec) => executeDecide(args, exec, { askAvailable, segmentLoop }),
    },
    {
      name: 'beat_gate',
      description: '检查要写的这一段是不是已经拍板完。不给 ids 时按整章判；给 ids（本段涉及的决策点）时只对本段判。pass=false 时不许写正文。',
      parameters: {
        type: 'object',
        properties: {
          dir: dirParam,
          book: bookParam,
          chapter: chapterParam,
          ids: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 3,
            description: '本段涉及的决策点 id（可选）。不传=整章',
          },
          ...(!segmentLoop ? {
            path: { type: 'string', description: '校验零候选收据时使用的正文文件路径' },
            text: { type: 'string', description: '校验零候选收据时使用的正文全文' },
          } : {}),
        },
        required: ['dir', 'book', 'chapter'],
        additionalProperties: false,
      },
      output,
      execute: (args) => executeGate(args, { segmentLoop }),
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
      execute: (args) => executeVerify(args, { segmentLoop }),
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
      execute: (args) => executeAdjust(args, { segmentLoop }),
    },
    ...(segmentLoop ? [
      {
        name: 'beat_append',
        description: '【0.11候选实验】向 segment-loop 章节追加一个非空自然段。使用前需传当前 expectedRevision；文本不得含换行。同 operationId 同内容幂等重放；操作 ID 不同内容会被拒绝。仅写 beat 自有段落目录，不写章节文件。',
        parameters: {
          type: 'object',
          properties: {
            dir: dirParam,
            book: bookParam,
            chapter: chapterParam,
            text: { type: 'string', description: '单个非空自然段，不含 CR/LF/U+2028/U+2029' },
            operationId: { type: 'string', description: '调用方生成、全书唯一的稳定重试 ID' },
            expectedRevision: { type: 'number', description: '调用前读取到的账本 revision' },
          },
          required: ['dir', 'book', 'chapter', 'text', 'operationId', 'expectedRevision'],
          additionalProperties: false,
        },
        output,
        execute: (args) => executeAppend(args, { segmentLoop: true }),
      },
      {
        name: 'beat_finish',
        description: '【0.11候选实验】检查本章所有段落均有有效段后收据且无待拍板项后，按 seq 和两个 LF 确定性合并。返回文本与绑定段 ID、段 hash、章节 hash、字符数和 revision 的 merge receipt；artifact 留在 beat 自有目录，不写章节文件。',
        parameters: {
          type: 'object',
          properties: {
            dir: dirParam,
            book: bookParam,
            chapter: chapterParam,
            expectedRevision: { type: 'number', description: '调用前读取到的账本 revision' },
          },
          required: ['dir', 'book', 'chapter', 'expectedRevision'],
          additionalProperties: false,
        },
        output,
        execute: (args) => executeFinish(args, { segmentLoop: true }),
      },
    ] : []),
  ];
}
