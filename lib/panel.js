// lib/panel.js — v0.8.0 右栏「拍板台」的只读读模型。
// 纯函数优先：buildOverview / buildChapter 不写盘、不读正文，只消费 book.json；
// readChapterTitles 只读目录名，用来给章节补标题。
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { DECISION_STATUS, OPEN_DECISION_STATUSES, SEGMENT_STATUS } from './schema.js'
import { resolveWorkspaceRoot } from './store.js'

const CHAPTER_FILE = /^第\s*(\d+)\s*章[\s_:-]*(.*?)\.(?:md|txt)$/i

/** `第10章_太子雪清河.md` → { chapter: 10, title: '太子雪清河' }；不匹配返回 null。 */
export function parseChapterFileName(name) {
  if (typeof name !== 'string') return null
  const match = CHAPTER_FILE.exec(name)
  if (!match) return null
  const chapter = Number(match[1])
  if (!Number.isInteger(chapter) || chapter < 1) return null
  const title = match[2]
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!title) return null
  return { chapter, title }
}

/** 从书名目录下的 `正文/` 和根目录扫「第N章_标题.md」，只读目录名。 */
export async function readChapterTitles(dir) {
  const root = resolveWorkspaceRoot(dir)
  const titles = new Map()
  for (const folder of ['正文', '']) {
    let entries
    try {
      entries = await readdir(join(root, folder), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const parsed = parseChapterFileName(entry.name)
      if (!parsed || !parsed.title) continue
      if (!titles.has(parsed.chapter)) titles.set(parsed.chapter, parsed.title)
    }
  }
  return titles
}

function titleFor(chapter, chapterTitles, data) {
  if (chapterTitles instanceof Map && chapterTitles.has(chapter)) return chapterTitles.get(chapter)
  if (chapterTitles && typeof chapterTitles === 'object' && chapterTitles[chapter]) return chapterTitles[chapter]
  for (const segment of data?.segments ?? []) {
    if (segment.chapter !== chapter || typeof segment.file !== 'string') continue
    const parsed = parseChapterFileName(basename(segment.file))
    if (parsed?.title) return parsed.title
  }
  return `第 ${chapter} 章`
}

function allChapterNumbers(data) {
  const numbers = new Set()
  for (const decision of data?.decisions ?? []) {
    if (Number.isInteger(decision.chapter)) numbers.add(decision.chapter)
  }
  for (const segment of data?.segments ?? []) {
    if (Number.isInteger(segment.chapter)) numbers.add(segment.chapter)
  }
  for (const key of Object.keys(data?.chapters ?? {})) {
    const value = Number(key)
    if (Number.isInteger(value) && value > 0) numbers.add(value)
  }
  return [...numbers].sort((left, right) => right - left)
}

function liveSegmentFor(data, decision) {
  if (typeof decision.segmentId === 'string' && decision.segmentId) {
    const owned = (data?.segments ?? []).find((segment) => segment.id === decision.segmentId)
    if (owned) return owned
  }
  return (data?.segments ?? []).find(
    (segment) => segment.status !== SEGMENT_STATUS.REVERTED
      && Array.isArray(segment.decisionIds)
      && segment.decisionIds.includes(decision.id),
  ) ?? null
}

function isLegacy(decision) {
  return decision?.legacy === true || decision?.legacyReceipt === true
}

function isOpen(decision) {
  return OPEN_DECISION_STATUSES.includes(decision.status)
}

function byDecisionOrder(left, right) {
  return String(left.id).localeCompare(String(right.id), 'en', { numeric: true })
}

function cascadeFor(data, segment) {
  if (!segment) return []
  const start = Number.isInteger(segment.offsetStart) ? segment.offsetStart : 0
  return (data?.segments ?? [])
    .filter((entry) => entry.status === SEGMENT_STATUS.COMMITTED
      && entry.file === segment.file
      && Number.isInteger(entry.offsetStart)
      && entry.offsetStart >= start)
    .sort((left, right) => (left.offsetStart ?? 0) - (right.offsetStart ?? 0))
}

function laterChapters(data, chapter) {
  return allChapterNumbers(data)
    .filter((value) => value > chapter)
    .sort((left, right) => left - right)
}

/** 轻量影响：卡片上的「作废 N 段 / M 字」，不读正文、不重定位。 */
function previewRevert(data, decision, segment) {
  const cascade = cascadeFor(data, segment)
  if (cascade.length === 0) return null
  const decisionIds = new Set()
  for (const entry of cascade) {
    for (const id of entry.decisionIds ?? []) decisionIds.add(id)
  }
  const charsBySegment = cascade.reduce((sum, entry) => sum + (Number(entry.chars) || 0), 0)
  const lastEnd = cascade.reduce((max, entry) => Math.max(max, Number(entry.offsetEnd) || 0), 0)
  const start = Number(segment.offsetStart) || 0
  // 预览优先用「最后一段终点 − 目标起点」：与 executeRevert 的截断长度一致，
  // 也把段间空白算进去（b10-2 真实删 1,222 字，两段 chars 相加只有 1,220）。
  const chars = lastEnd > start ? lastEnd - start : charsBySegment
  const canonEntries = (data?.canon ?? []).filter((entry) => decisionIds.has(entry.decisionId)).length
  return {
    segments: cascade.length,
    chars,
    canonEntries,
    decisionIds: [...decisionIds].sort((left, right) => String(left).localeCompare(String(right), 'en', { numeric: true })),
    laterChapters: laterChapters(data, decision.chapter),
  }
}

function minimalChanges(changes) {
  if (!Array.isArray(changes)) return []
  return changes.map((change) => ({
    entity: String(change?.entity ?? ''),
    key: String(change?.key ?? ''),
    ...(change?.from === undefined || change?.from === null ? {} : { from: String(change.from) }),
    to: String(change?.to ?? ''),
  })).filter((change) => change.entity && change.key && change.to)
}

/** 只读快照：书名 / 模式 / 统计 / 按章摘要。 */
export function buildOverview({ book, data, on = false, chapterTitles = null, now = new Date().toISOString() }) {
  const decisions = data?.decisions ?? []
  const segments = data?.segments ?? []
  const chapters = allChapterNumbers(data).map((chapter) => {
    const chapterDecisions = decisions.filter((decision) => decision.chapter === chapter)
    const chapterSegments = segments.filter(
      (segment) => segment.chapter === chapter && segment.status !== SEGMENT_STATUS.REVERTED,
    )
    const committed = chapterDecisions.filter((decision) => decision.status === DECISION_STATUS.COMMITTED).length
    const open = chapterDecisions.filter(isOpen).length
    const noAnchor = chapterDecisions.filter((decision) => !liveSegmentFor(data, decision)).length
    const chars = chapterSegments.reduce((sum, segment) => sum + (Number(segment.chars) || 0), 0)
    const state = data?.chapters?.[String(chapter)] ?? {}
    return {
      chapter,
      title: titleFor(chapter, chapterTitles, data),
      decisions: chapterDecisions.length,
      committed,
      open,
      segments: chapterSegments.length,
      chars,
      noAnchor,
      legacy: chapterDecisions.some(isLegacy),
      stale: state.stale ?? null,
      verifiedAt: state.verifiedAt ?? null,
      continuationCheckRequired: state.continuationCheckRequired === true,
    }
  })

  const currentChapter = chapters.find((chapter) => chapter.open > 0)?.chapter
    ?? chapters[0]?.chapter
    ?? null
  const liveSegments = segments.filter((segment) => segment.status !== SEGMENT_STATUS.REVERTED)
  return {
    ok: true,
    on: on === true,
    book: book ?? null,
    meta: data?.meta ?? null,
    stats: {
      chapters: chapters.length,
      decisions: decisions.length,
      committed: decisions.filter((decision) => decision.status === DECISION_STATUS.COMMITTED).length,
      open: decisions.filter(isOpen).length,
      segments: liveSegments.length,
      chars: liveSegments.reduce((sum, segment) => sum + (Number(segment.chars) || 0), 0),
    },
    chapters,
    currentChapter,
    bookUpdatedAt: data?.updatedAt ?? null,
    generatedAt: now,
    warnings: [],
  }
}

/** 单章读模型：决策、选项、段落、canon、义务、轻量回退影响。 */
export function buildChapter({ book, data, chapter, chapterTitles = null, now = new Date().toISOString() }) {
  const decisions = (data?.decisions ?? [])
    .filter((decision) => decision.chapter === chapter)
    .sort(byDecisionOrder)
  const segments = (data?.segments ?? [])
    .filter((segment) => segment.chapter === chapter)
    .sort((left, right) => (left.offsetStart ?? 0) - (right.offsetStart ?? 0))
  const decisionIds = new Set(decisions.map((decision) => decision.id))

  const mapped = decisions.map((decision, index) => {
    const segment = liveSegmentFor(data, decision)
    const chosen = decision.chosen ?? null
    const receipt = (data?.requests ?? []).find((request) => request.id === decision.requestId) ?? null
    const attempts = (data?.requests ?? []).filter((request) => request.decisionId === decision.id).length
    const canRevert = decision.status === DECISION_STATUS.COMMITTED
      && segment?.status === SEGMENT_STATUS.COMMITTED
      && !isLegacy(decision)
    const revert = canRevert ? previewRevert(data, decision, segment) : null
    return {
      id: decision.id,
      chapter: decision.chapter,
      seq: index + 1,
      title: decision.title,
      kind: decision.kind,
      change: decision.change,
      status: decision.status,
      legacy: isLegacy(decision),
      previousChoice: decision.previousChoice ?? null,
      reopenCount: Number(decision.reopenCount) || 0,
      chosen: chosen ? {
        label: String(chosen.label ?? ''),
        impact: String(chosen.impact ?? ''),
        changes: minimalChanges(chosen.changes),
        forbidden: Array.isArray(chosen.forbidden) ? chosen.forbidden.map(String) : [],
      } : null,
      options: (decision.options ?? []).map((option) => ({
        label: String(option?.label ?? ''),
        impact: String(option?.impact ?? ''),
        changes: minimalChanges(option?.changes),
        forbidden: Array.isArray(option?.forbidden) ? option.forbidden.map(String) : [],
        obligations: Array.isArray(option?.obligations) ? option.obligations.map((item) => ({
          text: String(item?.text ?? ''),
          dueChapter: item?.dueChapter ?? null,
        })) : [],
      })).filter((option) => option.label),
      segment: segment ? {
        id: segment.id,
        file: segment.file,
        offsetStart: segment.offsetStart,
        offsetEnd: segment.offsetEnd,
        chars: segment.chars,
        status: segment.status,
        hasSnapshot: Boolean(segment.revisionId),
      } : null,
      receipt: receipt ? {
        id: receipt.id,
        origin: receipt.origin ?? null,
        askedAt: receipt.askedAt ?? null,
        answeredAt: receipt.answeredAt ?? null,
      } : null,
      attempts,
      canRevert,
      revert,
      revertBlockedReason: canRevert
        ? null
        : (decision.status !== DECISION_STATUS.COMMITTED
          ? 'not-committed'
          : (isLegacy(decision) ? 'legacy' : 'no-segment')),
    }
  })

  return {
    ok: true,
    book: book ?? null,
    chapter,
    title: titleFor(chapter, chapterTitles, data),
    decisions: mapped,
    segments: segments.map((segment) => ({
      id: segment.id,
      file: segment.file,
      offsetStart: segment.offsetStart,
      offsetEnd: segment.offsetEnd,
      chars: segment.chars,
      status: segment.status,
      decisionIds: segment.decisionIds ?? [],
      revisionId: segment.revisionId ?? null,
    })),
    canon: (data?.canon ?? [])
      .filter((entry) => entry.chapter === chapter || decisionIds.has(entry.decisionId))
      .map((entry) => ({
        entity: entry.entity,
        key: entry.key,
        value: entry.value,
        chapter: entry.chapter ?? null,
        decisionId: entry.decisionId ?? null,
      })),
    obligations: (data?.obligations ?? [])
      .filter((entry) => decisionIds.has(entry.sourceDecision) || entry.dueChapter === chapter)
      .map((entry) => ({
        id: entry.id,
        text: entry.text,
        status: entry.status,
        dueChapter: entry.dueChapter ?? null,
        sourceDecision: entry.sourceDecision ?? null,
      })),
    generatedAt: now,
    warnings: [],
  }
}

export { titleFor, allChapterNumbers, liveSegmentFor, cascadeFor, laterChapters, isLegacy }

/** 最近一次把这条决策作为 target 的回退 revision（旧线快照的索引）。 */
export function latestReopenRevision(data, decisionId) {
  if (typeof decisionId !== 'string' || !decisionId) return null
  return [...(data?.revisions ?? [])].reverse().find((entry) => entry.kind === 'revert'
    && entry.reopen === true
    && Array.isArray(entry.recommitted)
    && entry.recommitted.includes(decisionId)
    && typeof entry.snapshot === 'string') ?? null
}
