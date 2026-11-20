// M3a：章节体检读模型；只消费账本和正文，不修改输入或写盘。
import { titleFor } from './panel.js'
import { DECISION_STATUS, SEGMENT_STATUS } from './schema.js'
import { normalizeNewlines, sliceHash } from './segment.js'
import { computeRevision } from './store.js'

function decisionItem(decision, detail) {
  return { id: decision.id, title: decision.title ?? decision.id, detail }
}

function validRange(segment, length) {
  return Number.isInteger(segment.offsetStart) && Number.isInteger(segment.offsetEnd)
    && segment.offsetStart >= 0 && segment.offsetStart <= segment.offsetEnd
    && segment.offsetEnd <= length
}

function rangeDetail(start, end) {
  return `区间 ${start.toLocaleString('en-US')}–${end.toLocaleString('en-US')} · ${end - start} 字`
}

/** 未登记的正文区间；合并重叠覆盖，忽略区间之间的纯空白。 */
function uncoveredItems(body, segments, title) {
  const covered = segments.filter((segment) => validRange(segment, body.length))
    .map((segment) => [segment.offsetStart, segment.offsetEnd])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1])
  const items = []
  const addGap = (start, end) => {
    const gap = body.slice(start, end)
    const first = gap.search(/\S/)
    if (first < 0) return
    const last = gap.trimEnd().length
    const from = start + first
    const to = start + last
    items.push({ id: `range:${from}-${to}`, title, detail: rangeDetail(from, to) })
  }
  let end = 0
  for (const [start, nextEnd] of covered) {
    if (start > end) addGap(end, start)
    end = Math.max(end, nextEnd)
  }
  if (end < body.length) addGap(end, body.length)
  return items
}

export function buildHealth({ book, data, chapter, text = null, chapterTitles = null }) {
  const decisions = (data?.decisions ?? []).filter((decision) => decision.chapter === chapter)
  const segments = (data?.segments ?? []).filter((segment) => segment.chapter === chapter
    && segment.status !== SEGMENT_STATUS.REVERTED)
  const state = data?.chapters?.[String(chapter)] ?? {}
  const chapterTitle = chapter == null ? '正文' : titleFor(chapter, chapterTitles, data)
  const textAvailable = typeof text === 'string'
  const body = textAvailable ? normalizeNewlines(text) : null
  const issues = []
  const counts = { block: 0, warn: 0, info: 0 }
  const add = (code, severity, items, action) => {
    if (items.length === 0) return
    issues.push({ code, severity, count: items.length, items: items.slice(0, 5), action })
    counts[severity] += items.length
  }

  add('OPEN_DECISION', 'block', decisions
    .filter((decision) => decision.status === DECISION_STATUS.PROPOSED
      || decision.status === DECISION_STATUS.ASKED
      || (decision.status === DECISION_STATUS.ANSWERED && !decision.pendingChoice))
    .map((decision) => decisionItem(decision, decision.status === DECISION_STATUS.ANSWERED
      ? `作者写了自定义答案，等补结构化变化 · ${decision.id}`
      : `${decision.status === DECISION_STATUS.PROPOSED ? '尚未提问' : '等待作答'} · ${decision.id}`)), '去拍板')
  add('AWAITING_SEGMENT', 'block', decisions
    .filter((decision) => decision.status === DECISION_STATUS.COMMITTED && !decision.segmentId && decision.legacyReceipt !== true)
    .map((decision) => decisionItem(decision, `已拍板，尚未登记正文段落 · ${decision.id}`)), '去登记段落')
  add('PENDING_CONFIRM', 'block', decisions
    .filter((decision) => decision.status === DECISION_STATUS.ANSWERED && decision.pendingChoice)
    .map((decision) => decisionItem(decision, `待确认选择「${decision.pendingChoice.label ?? decision.answerText ?? '设定变更'}」 · ${decision.id}`)), '确认设定变更')
  add('NEEDS_CHECK', 'warn', state.continuationCheckRequired === true
    ? [{ id: `chapter:${chapter}`, title: chapterTitle, detail: `第 ${chapter} 章登记段落后需要续写检查` }]
    : [], '做续写检查')

  if (textAvailable) {
    add('DRIFT', 'warn', segments.flatMap((segment) => {
      const valid = validRange(segment, body.length)
      if (valid && sliceHash(body, segment.offsetStart, segment.offsetEnd) === segment.hash) return []
      return [{
        id: segment.id,
        title: `段落 ${segment.id}`,
        detail: valid ? `hash 对不上 · ${segment.id} · ${rangeDetail(segment.offsetStart, segment.offsetEnd)}`
          : `区间不合法 ${segment.offsetStart}–${segment.offsetEnd}（正文 ${body.length} 字） · ${segment.id}`,
      }]
    }), '重建段落/接受漂移')
    add('UNSEGMENTED', 'warn', uncoveredItems(body, segments, '正文'), '补登记')
  }

  add('OVERDUE_OBLIGATION', 'warn', (data?.obligations ?? [])
    .filter((obligation) => obligation.status !== 'paid' && obligation.status !== 'waived'
      && Number.isInteger(obligation.dueChapter) && obligation.dueChapter > 0 && obligation.dueChapter <= chapter)
    .map((obligation) => ({
      id: obligation.id, title: obligation.text ?? obligation.id,
      detail: `第 ${obligation.dueChapter} 章到期，尚未回收 · ${obligation.id}`,
    })), '处理到期义务')
  add('STALE', 'info', state.stale ? [{
    id: `chapter:${chapter}`, title: chapterTitle,
    detail: `第 ${chapter} 章待复核：${state.stale.reason ?? '前文已发生变化'}`,
  }] : [], '去复核')
  add('NO_ANCHOR', 'info', decisions
    .filter((decision) => decision.status === DECISION_STATUS.COMMITTED && !decision.segmentId && decision.legacyReceipt === true)
    .map((decision) => decisionItem(decision, `旧账只记录了选择，没有正文锚点 · ${decision.id}`)), '查看旧账说明')
  add('TEXT_UNAVAILABLE', 'info', textAvailable ? [] : [{
    id: `chapter:${chapter}`, title: chapterTitle, detail: '未找到或无法读取本章正文，已跳过正文漂移和未登记区间检查',
  }], '手动打开正文')

  return {
    ok: true, book, chapter, revision: computeRevision(data),
    level: counts.block > 0 ? 'block' : counts.warn > 0 ? 'warn' : 'ok',
    textAvailable, issues, counts,
  }
}
