// Experimental 0.11 segment-loop source tools.
// This module stores immutable paragraph artifacts under the beat-owned book directory;
// it never writes chapter files and never changes legacy beat_segment semantics.
import { createHash } from 'node:crypto';
import {
  mkdir, readFile, realpath, rename, rm, stat, writeFile,
} from 'node:fs/promises';
import {
  dirname, isAbsolute, join, relative, resolve, sep,
} from 'node:path';
import {
  DECISION_STATUS,
  OPEN_DECISION_STATUSES,
  REVISION_KIND,
  SEGMENT_STATUS,
  assertBookName,
  assertChapter,
  fail,
  nextRevisionId,
  nextSegmentId,
  nowIso,
} from './schema.js';
import {
  bookDir,
  computeRevision,
  mutateBookData,
  noChange,
  resolveWorkspaceRoot,
} from './store.js';

const SEPARATOR = '\n\n';
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

function hashText(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

function chapterKey(chapter) {
  return String(assertChapter(chapter));
}

function failDisabled() {
  fail('feature-disabled', 'beat_append / beat_finish 属于未发布的 0.11 实验功能；当前 feature flag 未启用。');
}

function normalizeArgs(args) {
  if (typeof args?.dir !== 'string' || args.dir.trim() === '') fail('bad-dir', 'dir 不能为空');
  const book = assertBookName(args.book);
  const chapter = assertChapter(args.chapter);
  return { dir: args.dir, book, chapter, key: String(chapter) };
}

function requireExpectedRevision(data, expectedRevision) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    fail('bad-revision', 'expectedRevision 必须是非负整数。');
  }
  const actual = computeRevision(data);
  if (actual !== expectedRevision) {
    fail('revision-conflict', `账本 revision 已是 ${actual}，与预期 ${expectedRevision} 不一致；请刷新状态后重试。`, {
      expectedRevision,
      actualRevision: actual,
    });
  }
  return actual;
}

export function assertLoopRevision(data, expectedRevision) {
  return requireExpectedRevision(data, expectedRevision);
}

export function isSegmentLoop(data, chapter) {
  return data?.chapters?.[chapterKey(chapter)]?.writingMode === 'segment-loop';
}

export function activeLoopSegments(data, chapter) {
  const number = assertChapter(chapter);
  return (data?.segments ?? [])
    .filter((segment) => segment.chapter === number
      && segment.writingMode === 'segment-loop'
      && segment.status !== SEGMENT_STATUS.REVERTED)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

function assertLoopOnlyData(data, chapter) {
  const number = assertChapter(chapter);
  const legacySegments = (data?.segments ?? []).filter((segment) => (
    segment.chapter === number
      && segment.writingMode !== 'segment-loop'
  ));
  if (legacySegments.length > 0) {
    fail('chapter-mode-conflict', `第 ${number} 章已有 legacy beat_segment 段落，不能切换为 segment-loop。`);
  }
}

function assertNoPendingDecisions(data, chapter) {
  const pending = (data?.decisions ?? []).filter((decision) => (
    decision.chapter === chapter
      && OPEN_DECISION_STATUSES.includes(decision.status)
      && decision.status !== 'superseded'
  ));
  if (pending.length > 0) {
    fail('pending-decision', `第 ${chapter} 章还有待作者处理的决策：${pending.map((item) => item.id).join('、')}。`);
  }
}

function decisionFor(data, id, chapter) {
  return (data.decisions ?? []).find((decision) => decision.id === id && decision.chapter === chapter) ?? null;
}

function validateScan(data, chapter, segment, { requireOutput = false } = {}) {
  const scan = segment?.scanReceipt;
  if (!scan || scan.invalidatedAt || scan.segmentId !== segment.id || scan.segmentHash !== segment.textHash) {
    fail('segment-check-required', `第 ${segment?.id ?? '?'} 段缺少与当前 hash 匹配的有效段后检查收据。`, {
      segmentId: segment?.id ?? null,
    });
  }
  if (!Number.isInteger(segment.appendRevision)
    || !Number.isInteger(scan.baseRevision)
    || scan.baseRevision < segment.appendRevision) {
    fail('segment-check-required', `第 ${segment.id} 段的检查收据缺少有效 revision 绑定。`, { segmentId: segment.id });
  }
  if (scan.result === 'no-candidate') {
    if (typeof scan.reason !== 'string' || scan.reason.trim().length < 2 || scan.decisionId) {
      fail('segment-check-required', `第 ${segment.id} 段的 no-candidate 检查收据不完整。`, { segmentId: segment.id });
    }
    return scan;
  }
  if (scan.result !== 'decision' || typeof scan.decisionId !== 'string' || !scan.decisionId) {
    fail('segment-check-required', `第 ${segment.id} 段没有有效 decision/no-candidate 检查结果。`, { segmentId: segment.id });
  }
  const decision = decisionFor(data, scan.decisionId, chapter);
  if (!decision || decision.status === 'superseded' || decision.status === 'cancelled') {
    fail('segment-check-required', `第 ${segment.id} 段的检查决策 ${scan.decisionId} 已失效。`, { segmentId: segment.id });
  }
  if (decision.sourceSegmentId !== segment.id || decision.sourceSegmentHash !== segment.textHash) {
    fail('segment-check-required', `决策 ${decision.id} 未绑定到第 ${segment.id} 段的当前内容。`, { segmentId: segment.id });
  }
  if (requireOutput && decision.status !== DECISION_STATUS.COMMITTED) {
    fail('pending-decision', `决策 ${decision.id} 尚未由作者选择。`);
  }
  return scan;
}

function activePrefix(data, chapter) {
  const segments = activeLoopSegments(data, chapter);
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index].seq !== index + 1) {
      fail('segment-sequence-invalid', `第 ${chapter} 章段落 seq 不连续：期望 ${index + 1}，实际 ${segments[index].seq}。`);
    }
  }
  return segments;
}

function bookRoot(dir, book) {
  const root = resolveWorkspaceRoot(dir);
  const directory = bookDir(root, book);
  return { root, directory };
}

function ensureContained(root, target) {
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail('path-outside', `beat 段落循环 artifact 必须留在账本目录中：${target}`);
  }
  return target;
}

async function ensureArtifactDirectory(dir, book, area) {
  const { root, directory } = bookRoot(dir, book);
  const rootReal = await stat(root).then(() => realpath(root));
  await mkdir(directory, { recursive: true });
  const bookPath = ensureContained(rootReal, await realpath(directory));
  const path = ensureContained(rootReal, resolve(bookPath, area));
  await mkdir(path, { recursive: true });
  const bookReal = await realpath(bookPath);
  ensureContained(rootReal, bookReal);
  const realPath = await realpath(path);
  ensureContained(bookReal, realPath);
  return { rootReal, directoryReal: realPath, bookPath: bookReal };
}

async function writeImmutableArtifact(dir, book, relativePath, content) {
  const normalized = relativePath.replace(/\\/g, '/');
  if (!/^(segments|merges)\/[A-Za-z0-9._/-]+$/.test(normalized)
    || normalized.split('/').some((part) => part === '.' || part === '..')) {
    fail('bad-artifact-path', '内部 artifact 路径不合法。');
  }
  const area = normalized.split('/')[0];
  const rootInfo = await ensureArtifactDirectory(dir, book, area);
  const path = ensureContained(rootInfo.bookPath, resolve(rootInfo.bookPath, ...normalized.split('/')));
  const parent = dirname(path);
  await mkdir(parent, { recursive: true });
  const realParent = await realpath(parent);
  ensureContained(rootInfo.bookPath, realParent);
  const destination = join(realParent, normalized.split('/').at(-1));
  try {
    const realDestination = await realpath(destination);
    ensureContained(rootInfo.bookPath, realDestination);
    const existing = await readFile(realDestination, 'utf8');
    if (existing !== content) fail('artifact-conflict', `不可变 artifact 已存在但内容不同：${normalized}`);
    return normalized;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    if (error.code === 'EEXIST' || error.code === 'EPERM') {
      const existing = await readFile(destination, 'utf8').catch(() => null);
      if (existing === content) return normalized;
      fail('artifact-conflict', `不可变 artifact 写入冲突：${normalized}`, { cause: error.message });
    }
    throw error;
  }
  ensureContained(rootInfo.bookPath, await realpath(destination));
  return normalized;
}

async function readArtifact(dir, book, reference, expectedArea) {
  if (typeof reference !== 'string' || !reference.startsWith(`${expectedArea}/`) || reference.includes('\\')
    || reference.split('/').some((part) => !part || part === '.' || part === '..')) {
    fail('artifact-missing', `账本 artifact 引用必须位于 ${expectedArea}/。`);
  }
  const { rootReal, bookPath } = await ensureArtifactDirectory(dir, book, expectedArea);
  const path = ensureContained(bookPath, resolve(bookPath, ...reference.split('/')));
  let real;
  try {
    real = await realpath(path);
  } catch (error) {
    fail('artifact-missing', `找不到 artifact：${reference}`, { cause: error.message });
  }
  ensureContained(bookPath, real);
  const info = await stat(real);
  if (!info.isFile() || info.size > MAX_ARTIFACT_BYTES) fail('artifact-invalid', `artifact 文件无效或超过 2MB：${reference}`);
  return await readFile(real, 'utf8');
}

function validateAppendText(text) {
  if (typeof text !== 'string' || text.trim() === '') fail('one-paragraph-only', 'text 必须是一个非空自然段。');
  if (/[\r\n\u2028\u2029]/u.test(text)) {
    fail('one-paragraph-only', '一次只能追加一个自然段；请移除 CR、LF、U+2028 或 U+2029 段落边界。');
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_ARTIFACT_BYTES) fail('too-large', '单段 artifact 超过 2 MiB。');
  return text;
}

function appendPayloadHash(chapter, text) {
  return hashText(JSON.stringify({ chapter, text }));
}

function operationSegment(data, operationId) {
  return (data.segments ?? []).find((segment) => segment.writingMode === 'segment-loop'
    && segment.operationId === operationId) ?? null;
}

function publicAppendReceipt(segment, revision) {
  const receipt = {
    segmentId: segment.id,
    seq: segment.seq,
    operationId: segment.operationId,
    textRef: segment.textRef,
    textHash: segment.textHash,
    charCount: segment.charCount,
    decisionIds: [...(segment.decisionIds ?? [])],
    revision: segment.appendRevision ?? revision,
  };
  return receipt;
}

export async function executeAppend(args, { segmentLoop = false } = {}) {
  if (!segmentLoop) failDisabled();
  const { dir, book, chapter, key } = normalizeArgs(args);
  const text = validateAppendText(args.text);
  const operationId = typeof args.operationId === 'string' ? args.operationId.trim() : '';
  if (!operationId || operationId.length > 200) fail('bad-operation-id', 'operationId 必须是 1–200 字符的稳定字符串。');
  const payloadHash = appendPayloadHash(chapter, text);
  const { result, revision } = await mutateBookData(dir, book, async (data) => {
    const repeated = operationSegment(data, operationId);
    if (repeated) {
      if (repeated.payloadHash !== payloadHash) {
        fail('idempotency-conflict', `operationId ${operationId} 已用于不同内容。`);
      }
      return noChange({
        segment: repeated,
        idempotent: true,
        reverted: repeated.status === SEGMENT_STATUS.REVERTED,
      });
    }
    requireExpectedRevision(data, args.expectedRevision);
    const chapterState = data.chapters?.[key];
    const loop = chapterState?.writingMode === 'segment-loop';
    if (!loop) {
      if (chapterState || (data.decisions ?? []).some((decision) => decision.chapter === chapter)
        || (data.segments ?? []).some((segment) => segment.chapter === chapter)) {
        fail('chapter-mode-conflict', `第 ${chapter} 章已有 legacy 章节、决策或段落记录，不能切换为 segment-loop。`);
      }
    }
    if (chapterState?.mergeReceipt) fail('chapter-already-merged', `第 ${chapter} 章已经合并；须先回退段落才能继续追加。`);
    assertLoopOnlyData(data, chapter);
    const segments = activePrefix(data, chapter);
    const latest = segments.at(-1) ?? null;
    assertNoPendingDecisions(data, chapter);

    if (latest) {
      const scan = validateScan(data, chapter, latest, { requireOutput: true });
      if (scan.result === 'decision') {
        const selected = decisionFor(data, scan.decisionId, chapter);
        if (selected.segmentId) {
          fail('segment-required', `决策 ${selected.id} 已关联输出段 ${selected.segmentId}；请先检查该段是否仍有效。`);
        }
      }
    } else if (loop) {
      fail('segment-check-required', `第 ${chapter} 章段落循环账本缺少有效段落前缀。`);
    }

    const bindable = (data.decisions ?? []).filter((decision) => (
      decision.chapter === chapter
        && decision.status === DECISION_STATUS.COMMITTED
        && !decision.segmentId
        && !decision.legacyReceipt
    ));
    if (latest) {
      const latestScan = latest.scanReceipt;
      if (latestScan?.result === 'decision') {
        if (bindable.length !== 1 || bindable[0].id !== latestScan.decisionId) {
          fail('segment-required', '段后检查决策与待登记的已拍板决策不一致。');
        }
        if (bindable[0].sourceSegmentId !== latest.id || bindable[0].sourceSegmentHash !== latest.textHash) {
          fail('segment-check-required', `待写入决策 ${bindable[0].id} 未绑定最新来源段的当前 hash。`);
        }
      } else if (bindable.length > 0) {
        fail('segment-check-required', '最新段的 no-candidate 收据与未登记输出段的已拍板决策冲突。');
      }
    } else if (bindable.length > 0 || (data.decisions ?? []).some((decision) => decision.chapter === chapter)) {
      fail('chapter-mode-conflict', `第 ${chapter} 章含既有决策，不能把它当作段落循环的新章。`);
    }

    const id = nextSegmentId(data.segments ?? []);
    const seq = segments.length + 1;
    const textHash = hashText(text);
    const textRef = `segments/${id}.txt`;
    const segmentText = text;
    const newSegment = {
      id,
      chapter,
      seq,
      operationId,
      payloadHash,
      appendRevision: args.expectedRevision + 1,
      textRef,
      textHash,
      charCount: Array.from(text).length,
      decisionIds: bindable.map((decision) => decision.id),
      status: SEGMENT_STATUS.COMMITTED,
      writingMode: 'segment-loop',
      scanReceipt: null,
      createdAt: nowIso(),
    };
    const revisionId = nextRevisionId(data.revisions ?? []);
    await writeImmutableArtifact(dir, book, textRef, segmentText);
    data.chapters = data.chapters ?? {};
    data.chapters[key] = {
      ...(chapterState ?? {}),
      writingMode: 'segment-loop',
      status: 'writing',
      continuationCheckRequired: true,
      lastSegmentId: id,
      lastScan: null,
      mergeReceipt: null,
      verifiedAt: null,
    };
    data.segments.push(newSegment);
    for (const decision of bindable) {
      decision.segmentId = id;
      decision.committedAt = decision.committedAt ?? nowIso();
    }
    const at = nowIso();
    data.revisions.push({
      id: revisionId,
      kind: REVISION_KIND.SEGMENT,
      segmentId: id,
      chapter,
      mode: 'segment-loop',
      textRef,
      hash: textHash,
      chars: newSegment.charCount,
      operationId,
      createdAt: at,
    });
    data.audit.push({
      at,
      action: 'segment-loop-append',
      chapter,
      segmentId: id,
      seq,
      operationId,
      textRef,
      textHash,
      charCount: newSegment.charCount,
      decisionIds: newSegment.decisionIds,
    });
    return { segment: newSegment, idempotent: false, revisionId };
  }, { create: true, meta: { title: book } });
  return {
    ok: true,
    book,
    chapter,
    revision,
    segmentId: result.segment.id,
    segment: result.segment,
    receipt: publicAppendReceipt(result.segment, revision),
    ...(result.idempotent ? { idempotent: true } : {}),
    ...(result.reverted ? { reverted: true } : {}),
  };
}

export async function loopScanTarget(dir, book, data, args) {
  const number = assertChapter(args?.chapter);
  const revision = assertLoopRevision(data, args?.expectedRevision);
  if (!isSegmentLoop(data, number)) fail('chapter-mode-conflict', `第 ${number} 章没有启用 segment-loop。`);
  assertLoopOnlyData(data, number);
  const state = data.chapters[String(number)];
  if (state.mergeReceipt) fail('chapter-already-merged', `第 ${number} 章已合并，不能继续扫描。`);
  const segments = activePrefix(data, number);
  const latest = segments.at(-1);
  if (!latest) fail('no-segment', `第 ${number} 章还没有段落可检查。`);
  if (typeof args?.segmentId !== 'string' || args.segmentId !== latest.id) {
    fail('revision-conflict', '扫描目标不是最新段；请刷新段落清单。', { expectedSegmentId: latest.id });
  }
  const suppliedHash = args?.segmentHash ?? args?.hash;
  if (typeof suppliedHash !== 'string' || suppliedHash !== latest.textHash) {
    fail('revision-conflict', '扫描目标 hash 已变化；请刷新段落内容。', { expectedHash: latest.textHash });
  }
  if (latest.scanReceipt && !latest.scanReceipt.invalidatedAt) {
    fail('segment-already-checked', `第 ${latest.id} 段已经有检查收据。`);
  }
  assertNoPendingDecisions(data, number);
  const text = await readArtifact(dir, book, latest.textRef, 'segments');
  if (hashText(text) !== latest.textHash || Array.from(text).length !== latest.charCount) {
    fail('segment-hash-mismatch', `第 ${latest.id} 段 artifact 与账本 hash/字符数不一致。`);
  }
  if (computeRevision(data) !== revision) fail('revision-conflict', '扫描目标读取期间账本 revision 发生变化。');
  return latest;
}

export function recordLoopScan(data, chapter, segment, { decisionId = null, reason = null, baseRevision } = {}) {
  const number = assertChapter(chapter);
  const key = String(number);
  if (!isSegmentLoop(data, number)) fail('chapter-mode-conflict', `第 ${number} 章没有启用 segment-loop。`);
  if (!segment || segment.chapter !== number || segment.writingMode !== 'segment-loop'
    || segment.status !== SEGMENT_STATUS.COMMITTED) {
    fail('no-segment', '段后检查必须绑定本章有效的 segment-loop 段落。');
  }
  const latest = activePrefix(data, number).at(-1);
  if (!latest || latest.id !== segment.id || latest.textHash !== segment.textHash) {
    fail('revision-conflict', '检查收据只能绑定本章最新段及其当前 hash。');
  }
  if (latest.scanReceipt && !latest.scanReceipt.invalidatedAt) {
    fail('segment-already-checked', `第 ${latest.id} 段已经有检查收据。`);
  }
  let receipt;
  if (decisionId !== null) {
    if (typeof decisionId !== 'string' || !decisionId) fail('bad-id', 'decisionId 必须是非空字符串。');
    const decision = decisionFor(data, decisionId, number);
    if (!decision || !OPEN_DECISION_STATUSES.includes(decision.status)) {
      fail('no-decision', `第 ${number} 章没有待处理决策 ${decisionId}。`);
    }
    receipt = {
      segmentId: latest.id,
      segmentHash: latest.textHash,
      result: 'decision',
      decisionId,
      reason: null,
      baseRevision: Number.isInteger(baseRevision) ? baseRevision : computeRevision(data),
      createdAt: nowIso(),
    };
  } else {
    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    if (cleanReason.length < 2) fail('no-reason', 'no-candidate 检查必须说明为什么没有剧情分岔。');
    receipt = {
      segmentId: latest.id,
      segmentHash: latest.textHash,
      result: 'no-candidate',
      decisionId: null,
      reason: cleanReason,
      baseRevision: Number.isInteger(baseRevision) ? baseRevision : computeRevision(data),
      createdAt: nowIso(),
    };
  }
  latest.scanReceipt = receipt;
  const state = data.chapters[key] ?? {};
  data.chapters[key] = {
    ...state,
    writingMode: 'segment-loop',
    continuationCheckRequired: false,
    lastScan: receipt,
    lastScanId: latest.id,
    revision: computeRevision(data) + 1,
  };
  data.audit.push({
    at: receipt.createdAt,
    action: 'segment-loop-scan',
    chapter: number,
    segmentId: latest.id,
    segmentHash: latest.textHash,
    result: receipt.result,
    decisionId: receipt.decisionId,
    reason: receipt.reason,
  });
  return receipt;
}

async function loadAndValidateMergeInputs(dir, book, data, chapter) {
  const segments = activePrefix(data, chapter);
  if (segments.length === 0) fail('no-segment', `第 ${chapter} 章没有可合并段落。`);
  assertNoPendingDecisions(data, chapter);
  const texts = [];
  for (const segment of segments) {
    validateScan(data, chapter, segment, { requireOutput: false });
    const text = await readArtifact(dir, book, segment.textRef, 'segments');
    if (hashText(text) !== segment.textHash || Array.from(text).length !== segment.charCount) {
      fail('segment-hash-mismatch', `第 ${segment.id} 段 artifact 与账本 hash/字符数不一致。`, { segmentId: segment.id });
    }
    texts.push(text);
  }
  const segmentPosition = new Map(segments.map((segment, index) => [segment.id, index]));
  for (const segment of segments) {
    const scan = segment.scanReceipt;
    if (scan.result !== 'decision') continue;
    const decision = decisionFor(data, scan.decisionId, chapter);
    if (decision.status !== DECISION_STATUS.COMMITTED) fail('pending-decision', `决策 ${decision.id} 尚未由作者选择。`);
    if (!decision.segmentId || !segmentPosition.has(decision.segmentId)
      || segmentPosition.get(decision.segmentId) <= segmentPosition.get(segment.id)) {
      fail('segment-required', `决策 ${decision.id} 没有有效的后续输出段。`);
    }
  }
  for (const decision of (data.decisions ?? []).filter((entry) => entry.chapter === chapter && entry.status === DECISION_STATUS.COMMITTED && !entry.legacyReceipt)) {
    if (!decision.segmentId || !segmentPosition.has(decision.segmentId)) {
      fail('segment-required', `已拍板决策 ${decision.id} 尚未登记到有效段落。`);
    }
  }
  return { segments, texts };
}

function makeMergeText(texts) {
  return texts.join(SEPARATOR);
}

function mergePayload(segments, text, sourceRevision) {
  const chapterHash = hashText(text);
  return {
    orderedSegmentIds: segments.map((segment) => segment.id),
    separator: SEPARATOR,
    sourceRevision,
    segmentHashes: segments.map((segment) => ({ segmentId: segment.id, hash: segment.textHash })),
    chapterHash,
    charCount: Array.from(text).length,
    status: 'merged',
  };
}

export async function executeFinish(args, { segmentLoop = false } = {}) {
  if (!segmentLoop) failDisabled();
  const { dir, book, chapter, key } = normalizeArgs(args);
  let mergedText = null;
  const { result, revision } = await mutateBookData(dir, book, async (data) => {
    if (!isSegmentLoop(data, chapter)) fail('chapter-mode-conflict', `第 ${chapter} 章没有启用 segment-loop。`);
    assertLoopOnlyData(data, chapter);
    const current = computeRevision(data);
    const existing = data.chapters[key]?.mergeReceipt;
    if (existing) {
      if (args.expectedRevision !== existing.sourceRevision
        && args.expectedRevision !== existing.committedRevision
        && args.expectedRevision !== current) {
        fail('revision-conflict', `expectedRevision ${args.expectedRevision} 不是本次合并来源或当前 revision ${current}。`);
      }
      const verified = await verifyLoopMerge(dir, book, data, chapter, null);
      mergedText = verified.text;
      return noChange({ receipt: existing, text: mergedText, idempotent: true });
    }
    requireExpectedRevision(data, args.expectedRevision);
    if (data.chapters[key]?.mergeReceipt) fail('chapter-already-merged', `第 ${chapter} 章已经合并。`);
    const { segments, texts } = await loadAndValidateMergeInputs(dir, book, data, chapter);
    const text = makeMergeText(texts);
    if (Buffer.byteLength(text, 'utf8') > MAX_ARTIFACT_BYTES) fail('too-large', '合并后的 artifact 超过 2 MiB。');
    const receipt = mergePayload(segments, text, current);
    const reference = `merges/ch${chapter}-${receipt.chapterHash}.txt`;
    await writeImmutableArtifact(dir, book, reference, text);
    mergedText = text;
    receipt.textRef = reference;
    receipt.id = `m-${chapter}-${receipt.chapterHash.slice(0, 16)}`;
    receipt.committedRevision = current + 1;
    receipt.createdAt = nowIso();
    const state = data.chapters[key];
    data.chapters[key] = {
      ...state,
      status: 'merged',
      continuationCheckRequired: false,
      mergeReceipt: receipt,
      verifiedAt: null,
    };
    data.audit.push({
      at: receipt.createdAt,
      action: 'segment-loop-finish',
      chapter,
      mergeId: receipt.id,
      sourceRevision: current,
      orderedSegmentIds: receipt.orderedSegmentIds,
      segmentHashes: receipt.segmentHashes,
      chapterHash: receipt.chapterHash,
      charCount: receipt.charCount,
      textRef: reference,
    });
    return { receipt, text, idempotent: false };
  });
  return {
    ok: true,
    book,
    chapter,
    revision,
    text: result.text,
    receipt: result.receipt,
    ...(result.idempotent ? { idempotent: true } : {}),
  };
}

async function validateMergeReceipt(dir, book, data, chapter) {
  const state = data?.chapters?.[String(chapter)];
  const receipt = state?.mergeReceipt;
  if (!receipt || state.writingMode !== 'segment-loop') fail('not-merged', `第 ${chapter} 章还没有有效的段落循环合并收据。`);
  if (receipt.status !== 'merged' || !Array.isArray(receipt.orderedSegmentIds)
    || !Array.isArray(receipt.segmentHashes)) {
    fail('merge-mismatch', `第 ${chapter} 章合并收据结构无效。`);
  }
  const { segments, texts } = await loadAndValidateMergeInputs(dir, book, data, chapter);
  if (JSON.stringify(segments.map((segment) => segment.id)) !== JSON.stringify(receipt.orderedSegmentIds)
    || JSON.stringify(segments.map((segment) => ({ segmentId: segment.id, hash: segment.textHash })))
      !== JSON.stringify(receipt.segmentHashes)) {
    fail('merge-mismatch', `第 ${chapter} 章段落顺序或 hash 与合并收据不一致。`);
  }
  if (receipt.sourceRevision > computeRevision(data)) fail('merge-mismatch', '合并收据绑定了不存在的未来 revision。');
  const text = makeMergeText(texts);
  if (hashText(text) !== receipt.chapterHash || Array.from(text).length !== receipt.charCount) {
    fail('merge-mismatch', `第 ${chapter} 章重新拼接的 hash/字符数与合并收据不一致。`);
  }
  const artifact = await readArtifact(dir, book, receipt.textRef, 'merges');
  if (artifact !== text || hashText(artifact) !== receipt.chapterHash) {
    fail('chapter-drift', `第 ${chapter} 章合并 artifact 与当前有序段落不一致。`);
  }
  return { receipt, text, segments };
}

export async function verifyLoopMerge(dir, book, data, chapter, text) {
  const cleanBook = assertBookName(book);
  const number = assertChapter(chapter);
  if (!isSegmentLoop(data, number)) fail('chapter-mode-conflict', `第 ${number} 章没有启用 segment-loop。`);
  assertLoopOnlyData(data, number);
  const verified = await validateMergeReceipt(dir, cleanBook, data, number);
  if (text !== null && text !== undefined) {
    if (typeof text !== 'string' || normalizeLf(text) !== verified.text
      || hashText(normalizeLf(text)) !== verified.receipt.chapterHash) {
      fail('merge-mismatch', `提交给 verify 的章节文本与段落循环合并产物不一致。`);
    }
  }
  return verified;
}

function normalizeLf(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export async function revertLoop(data, args) {
  const chapter = assertChapter(args?.chapter);
  const key = String(chapter);
  if (!isSegmentLoop(data, chapter)) fail('chapter-mode-conflict', `第 ${chapter} 章没有启用 segment-loop。`);
  requireExpectedRevision(data, args.expectedRevision);
  const targetId = args.segmentId ?? args.segment;
  if (typeof targetId !== 'string' || !targetId) fail('bad-id', '回退必须指定 segmentId。');
  const segments = activePrefix(data, chapter);
  const index = segments.findIndex((segment) => segment.id === targetId);
  if (index < 0) fail('no-segment', `第 ${chapter} 章没有有效段落 ${targetId}。`);
  const target = segments[index];
  const removed = segments.slice(index);
  const removedIds = new Set(removed.map((segment) => segment.id));
  const sourceDecisionIds = new Set(removed.flatMap((segment) => (
    segment.scanReceipt?.result === 'decision' && segment.scanReceipt.decisionId
      ? [segment.scanReceipt.decisionId]
      : []
  )));
  for (const decision of data.decisions ?? []) {
    if (decision.chapter === chapter && removedIds.has(decision.sourceSegmentId)) sourceDecisionIds.add(decision.id);
  }

  const sourceOrder = new Map(removed.map((segment) => [segment.id, segment.seq]));
  const affected = [...sourceDecisionIds]
    .map((id) => decisionFor(data, id, chapter))
    .filter(Boolean)
    .sort((a, b) => (sourceOrder.get(b.sourceSegmentId) ?? 0) - (sourceOrder.get(a.sourceSegmentId) ?? 0));
  let canon = (data.canon ?? []).map((entry) => ({ ...entry }));
  for (const decision of affected) {
    if (decision.status !== DECISION_STATUS.COMMITTED) continue;
    const changes = decision.chosen?.changes ?? [];
    for (const item of canon.filter((entry) => entry.decisionId === decision.id)) {
      const change = changes.find((entry) => entry.entity === item.entity && entry.key === item.key);
      if (change && change.from !== undefined && change.from !== null) {
        item.value = change.from;
        item.decisionId = null;
        item.updatedAt = nowIso();
      } else {
        canon = canon.filter((entry) => entry !== item);
      }
    }
  }
  data.canon = canon;
  data.obligations = (data.obligations ?? []).filter((item) => !sourceDecisionIds.has(item.sourceDecision));

  const at = nowIso();
  for (const segment of removed) {
    segment.status = SEGMENT_STATUS.REVERTED;
    if (segment.scanReceipt && !segment.scanReceipt.invalidatedAt) {
      segment.scanReceipt.invalidatedAt = at;
      segment.scanReceipt.invalidatedReason = 'segment-revert';
    }
  }
  for (const decision of data.decisions ?? []) {
    if (decision.chapter !== chapter) continue;
    if (removedIds.has(decision.segmentId)) decision.segmentId = null;
    if (!sourceDecisionIds.has(decision.id)) continue;
    if (decision.chosen) {
      decision.previousChoice = {
        label: decision.chosen.label,
        impact: decision.chosen.impact ?? '',
        at: decision.decidedAt ?? decision.committedAt ?? at,
        requestId: decision.requestId ?? null,
      };
    }
    decision.status = DECISION_STATUS.PROPOSED;
    decision.chosen = null;
    decision.requestId = null;
    decision.askedAt = null;
    decision.answeredAt = null;
    decision.committedAt = null;
    decision.decidedAt = null;
    decision.segmentId = null;
    decision.sourceSegmentId = null;
    decision.sourceSegmentHash = null;
    delete decision.pendingChoice;
    delete decision.answerText;
    decision.reopenCount = (Number(decision.reopenCount) || 0) + 1;
    decision.reopenedAt = at;
  }

  const prefix = segments.slice(0, index);
  const latestPrefix = prefix.at(-1) ?? null;
  const revisionId = nextRevisionId(data.revisions ?? []);
  data.revisions.push({
    id: revisionId,
    kind: REVISION_KIND.REVERT,
    chapter,
    mode: 'segment-loop',
    segmentId: target.id,
    revertedSegments: removed.map((segment) => segment.id),
    revertedDecisions: affected.map((decision) => decision.id),
    createdAt: at,
  });
  const state = data.chapters[key];
  data.chapters[key] = {
    ...state,
    status: 'writing',
    continuationCheckRequired: latestPrefix ? !latestPrefix.scanReceipt || Boolean(latestPrefix.scanReceipt.invalidatedAt) : false,
    lastSegmentId: latestPrefix?.id ?? null,
    lastScan: latestPrefix?.scanReceipt ?? null,
    lastScanId: latestPrefix?.scanReceipt && !latestPrefix.scanReceipt.invalidatedAt ? latestPrefix.id : null,
    mergeReceipt: null,
    verifiedAt: null,
  };
  data.audit.push({
    at,
    action: 'segment-loop-revert',
    chapter,
    targetSegmentId: target.id,
    revertedSegments: removed.map((segment) => segment.id),
    revertedDecisions: affected.map((decision) => decision.id),
    revisionId,
  });
  return {
    ok: true,
    chapter,
    targetSegmentId: target.id,
    revertedSegments: removed.map((segment) => segment.id),
    revertedDecisions: affected.map((decision) => decision.id),
    preservedPrefixSegmentIds: prefix.map((segment) => segment.id),
    revisionId,
  };
}
