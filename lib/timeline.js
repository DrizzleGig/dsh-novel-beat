// 时间线只投影账本已有事件，不补造历史提交或写回账本。
import { computeRevision } from './store.js'
import { titleFor } from './panel.js'

const TYPES = ['plan', 'fork', 'commit', 'segment', 'revert', 'verify', 'waive', 'override', 'stale', 'check']

function timestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

function count(value) {
  return Array.isArray(value) ? value.length : (Number.isFinite(value) && value >= 0 ? value : 0)
}

function chapterNumber(value) {
  return Number.isInteger(value) && value > 0 ? value : null
}

/** 纯函数：把回执、revision、audit 和章节待复核状态合成一条时间线。 */
export function buildTimeline({ book, data, chapter = null, limit = 30, offset = 0, chapterTitles = null }) {
  const decisions = new Map((data?.decisions ?? []).map((entry) => [entry.id, entry]))
  const segments = new Map((data?.segments ?? []).map((entry) => [entry.id, entry]))
  const forks = new Map((data?.forks ?? []).map((entry) => [entry.id, entry]))
  const requests = data?.requests ?? []
  const entries = new Map()

  function add(eventId, type, source, fields) {
    if (entries.has(eventId)) return
    const decisionId = fields.decisionId ?? source.decisionId ?? null
    const decision = decisions.get(decisionId)
    const selectedChapter = chapterNumber(fields.chapter ?? source.chapter ?? decision?.chapter)
    entries.set(eventId, {
      eventId,
      type,
      at: timestamp(source.at ?? source.createdAt),
      chapter: selectedChapter,
      decisionId,
      title: decision?.title ?? (selectedChapter === null ? null : titleFor(selectedChapter, chapterTitles, data)),
      choice: null,
      chars: null,
      segmentId: source.segmentId ?? null,
      ...(source.revisionId == null ? {} : { revisionId: source.revisionId }),
      oldLineDecisionId: null,
      canOpenOldLine: false,
      ...fields,
    })
  }

  requests.forEach((request, index) => {
    const decision = decisions.get(request.decisionId)
      ?? (data?.decisions ?? []).find((entry) => entry.requestId === request.id)
    const choice = request.answer?.selected?.[0] ?? decision?.chosen?.label ?? decision?.answerText ?? null
    const customAnswer = typeof request.answer?.custom === 'string' && request.answer.custom.trim() !== ''
      ? request.answer.custom.trim()
      : (decision?.chosen?.source === 'author-custom' ? String(decision.chosen.label ?? '') : null)
    const title = decision?.title ?? null
    add(`request:${request.id ?? index}`, 'commit', request, {
      at: timestamp(request.answeredAt ?? request.askedAt),
      decisionId: request.decisionId ?? decision?.id ?? null,
      chapter: chapterNumber(request.chapter ?? decision?.chapter),
      title,
      choice,
      custom: customAnswer || null,
      summary: `「${title ?? '未命名决策'}」→「${choice ?? '未记录选择'}」${customAnswer ? '（作者自定）' : ''}${request.origin === 'model-relayed' ? '（模型转述）' : ''}`,
    })
  })

  ;(data?.revisions ?? []).forEach((revision, index) => {
    if (revision.kind !== 'segment' && revision.kind !== 'revert') return
    const segment = segments.get(revision.segmentId)
    const decisionId = revision.decisionId ?? revision.recommitted?.[0]
      ?? revision.revertedDecisions?.[0] ?? segment?.decisionIds?.[0] ?? null
    const decision = decisions.get(decisionId)
    const fields = {
      decisionId,
      chapter: chapterNumber(revision.chapter ?? segment?.chapter ?? decision?.chapter),
      ...(revision.id == null ? {} : { revisionId: revision.id }),
    }
    if (revision.kind === 'segment') {
      const chars = revision.chars ?? segment?.chars ?? 0
      add(`revision:${revision.id ?? index}`, 'segment', revision, {
        ...fields, chars, summary: `正文 ${chars} 字已登记`,
      })
      return
    }
    // keep 是操作指令；优先从这次回退的重新拍板回执取实际选择。
    const receipt = requests.find((request) => request.decisionId === decisionId
      && request.askedAt != null && request.askedAt === revision.createdAt)
    const choice = revision.choice === 'keep'
      ? (receipt?.answer?.selected?.[0] ?? '保留原选择')
      : (revision.choice ?? receipt?.answer?.selected?.[0] ?? null)
    const title = decision?.title ?? null
    const chars = count(revision.charsRemoved)
    const reopened = count(revision.reopenedDecisions ?? revision.revertedDecisions)
    add(`revision:${revision.id ?? index}`, 'revert', revision, {
      ...fields,
      title,
      choice,
      chars,
      oldLineDecisionId: decisionId,
      canOpenOldLine: Boolean(revision.snapshot),
      summary: `「${title ?? '未命名决策'}」改成「${choice ?? '未记录选择'}」· 删 ${chars} 字 · 重开 ${reopened} 个`,
    })
  })

  // 同一个 fork 的发现与登记是同一件事，优先保留原始 fork 记录。
  const forkAudit = new Map()
  ;(data?.audit ?? []).forEach((audit, index) => {
    if (audit.action !== 'fork' && audit.action !== 'fork-planned') return
    const key = audit.forkId ?? `audit:${index}`
    const previous = forkAudit.get(key)
    if (!previous || (audit.action === 'fork' && previous.audit.action !== 'fork')) {
      forkAudit.set(key, { audit, index })
    }
  })

  ;(data?.audit ?? []).forEach((audit, index) => {
    let type
    let summary
    let fields = {}
    switch (audit.action) {
      case 'plan':
        type = 'plan'
        summary = `登记 ${count(audit.count)} 个岔路`
        break
      case 'fork':
      case 'fork-planned': {
        if (forkAudit.get(audit.forkId ?? `audit:${index}`)?.index !== index) return
        const fork = forks.get(audit.forkId)
        type = 'fork'
        summary = `发现岔路：${audit.text ?? fork?.text ?? decisions.get(audit.decisionId)?.title ?? audit.forkId ?? '未记录详情'}`
        fields = { chapter: chapterNumber(audit.chapter ?? fork?.chapter) }
        break
      }
      case 'verify': {
        type = 'verify'
        // paid 是已回收义务，不能当成警告；没有持久化 warnings 时只展示通过。
        const warnings = count(audit.warnings)
        summary = warnings > 0 ? `有 ${warnings} 个提醒` : '结构核对通过'
        break
      }
      case 'waive': {
        type = 'waive'
        const obligation = (data?.obligations ?? []).find((entry) => entry.id === audit.obligationId)
        const decision = decisions.get(obligation?.sourceDecision)
        fields = {
          chapter: chapterNumber(audit.chapter ?? decision?.chapter),
          decisionId: audit.decisionId ?? decision?.id ?? null,
        }
        summary = `豁免义务 ${audit.obligationId ?? '未记录 ID'}`
        break
      }
      case 'canon-override':
        type = 'override'
        summary = `覆盖设定 ${[audit.entity, audit.key].filter((value) => value != null).join('.') || '未记录字段'}`
        break
      case 'continuation-check':
        type = 'check'
        summary = `续写检查：${audit.reason ?? (audit.verdict === 'fork' ? '有岔路，等待拍板' : '未记录原因')}`
        break
      default:
        return
    }
    add(`audit:${index}`, type, audit, { ...fields, summary })
  })

  for (const [key, state] of Object.entries(data?.chapters ?? {})) {
    const selectedChapter = chapterNumber(Number(key))
    if (!state?.stale || selectedChapter === null) continue
    add(`stale:${selectedChapter}`, 'stale', state.stale, {
      chapter: selectedChapter,
      at: timestamp(state.stale.since),
      decisionId: state.stale.sourceDecisionId ?? null,
      summary: `第 ${selectedChapter} 章待复核：${state.stale.reason ?? '未记录原因'}`,
    })
  }

  const filtered = [...entries.values()].filter((entry) => chapter == null || entry.chapter === chapter)
  filtered.sort((left, right) => {
    if (left.at !== right.at) {
      if (left.at === null) return 1
      if (right.at === null) return -1
      return left.at < right.at ? 1 : -1
    }
    return left.eventId < right.eventId ? 1 : left.eventId > right.eventId ? -1 : 0
  })
  const counts = Object.fromEntries(TYPES.map((type) => [type, 0]))
  for (const entry of filtered) counts[entry.type] += 1
  const pageLimit = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 30
  const pageOffset = Number.isFinite(offset) ? Math.max(0, Math.floor(offset)) : 0
  const page = filtered.slice(pageOffset, pageOffset + pageLimit)
  return {
    ok: true,
    book,
    revision: computeRevision(data),
    entries: page,
    counts,
    total: filtered.length,
    limit: pageLimit,
    offset: pageOffset,
    hasMore: pageOffset + page.length < filtered.length,
  }
}
