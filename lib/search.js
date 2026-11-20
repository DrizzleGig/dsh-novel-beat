// 决策搜索只投影现有账本，不修改输入或写回磁盘。
import { computeRevision } from './store.js'

const normalize = (value) => String(value).normalize('NFKC').toLowerCase()
const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' })
const KIND_ORDER = { decision: 0, canon: 1, obligation: 2 }

function snippet(value, query) {
  const text = String(value)
  const position = normalize(text).indexOf(query)
  const chars = Array.from(segmenter.segment(text), ({ segment }) => segment)
  if (position < 0) return chars.slice(0, 40).join('') + (chars.length > 40 ? '…' : '')

  // 匹配在归一化文本中完成，摘要保留原文；兼容字符展开后仍映射到原字。
  let offset = 0
  let first = 0
  let last = chars.length
  for (let index = 0; index < chars.length; index += 1) {
    const end = offset + normalize(chars[index]).length
    if (offset <= position && position < end) first = index
    if (offset < position + query.length && position + query.length <= end) {
      last = index + 1
      break
    }
    offset = end
  }
  const start = Math.max(0, first - 20)
  const end = Math.min(chars.length, last + 20)
  return (start > 0 ? '…' : '') + chars.slice(start, end).join('') + (end < chars.length ? '…' : '')
}

function findMatch(fields, query) {
  for (const [matchedIn, value] of fields) {
    if (value == null || !normalize(value).includes(query)) continue
    return { matchedIn, snippet: snippet(value, query) }
  }
  return null
}

/** 纯函数：按字段、实体、状态和章节检索决策、设定及义务。 */
export function buildSearch({ book, data, q = '', entity = '', status = '', chapter = null, limit = 20 }) {
  const queryText = String(q).trim()
  const query = normalize(queryText)
  const selectedEntity = normalize(entity)
  const selectedStatus = normalize(status)
  const pageLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 20
  const groups = { decision: 0, canon: 0, obligation: 0 }
  const hits = []
  const seen = { decision: new Set(), canon: new Set(), obligation: new Set() }
  const inChapter = (value) => chapter == null || chapter === '' || value === chapter
  const add = (hit) => {
    if (seen[hit.kind].has(hit.id)) return
    seen[hit.kind].add(hit.id)
    groups[hit.kind] += 1
    hits.push(hit)
  }

  if (query) {
    for (const decision of data?.decisions ?? []) {
      if (!inChapter(decision.chapter)) continue
      if (selectedStatus && normalize(decision.status) !== selectedStatus) continue
      const changes = decision.chosen?.changes ?? []
      if (selectedEntity && !changes.some((change) => normalize(change.entity) === selectedEntity)) continue
      const match = findMatch([
        ['title', decision.title], ['choice', decision.chosen?.label], ['choice', decision.answerText],
        ...changes.flatMap((change) => [['change', change.entity], ['change', change.key], ['change', change.to]]),
      ], query)
      if (!match) continue
      add({
        kind: 'decision', id: decision.id, chapter: decision.chapter ?? null,
        title: decision.title, status: decision.status,
        choice: decision.chosen?.label ?? decision.answerText,
        ...match,
        ...(decision.segmentId == null ? {} : { segmentId: decision.segmentId }),
      })
    }

    for (const entry of data?.canon ?? []) {
      if (!inChapter(entry.chapter)) continue
      if (selectedEntity && normalize(entry.entity) !== selectedEntity) continue
      const match = findMatch([['canon', entry.entity], ['canon', entry.key], ['canon', entry.value]], query)
      if (!match) continue
      const title = `${entry.entity}.${entry.key}`
      add({ kind: 'canon', id: title, chapter: entry.chapter ?? null, title, ...match })
    }

    if (!selectedEntity) {
      for (const obligation of data?.obligations ?? []) {
        if (!inChapter(obligation.dueChapter)) continue
        const match = findMatch([['obligation', obligation.text], ['obligation', obligation.id]], query)
        if (!match) continue
        add({
          kind: 'obligation', id: obligation.id, chapter: obligation.dueChapter ?? null,
          title: obligation.text, ...match,
        })
      }
    }
  }

  hits.sort((left, right) => KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
    || (right.chapter ?? -Infinity) - (left.chapter ?? -Infinity)
    || String(left.title).localeCompare(String(right.title)))
  return {
    ok: true, book, revision: computeRevision(data), q: queryText,
    total: hits.length, limit: pageLimit, groups, hits: hits.slice(0, pageLimit),
  }
}
