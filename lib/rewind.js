// lib/rewind.js — v0.8.0 安全回退：影响预览（planRewind）与执行（executeRewind）共用同一份计划。
// 安全边界（与 ChatGPT 评审一致）：
// - 无锚点/未拍板：拒绝；
// - 正文 hash 不一致：拒绝，不自动重定位；
// - 正文写失败/账本写失败：整体恢复；
// - revision 追加式保存，旧选择/旧凭据全部保留。
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  fail,
  DECISION_STATUS,
  REVISION_KIND,
  SEGMENT_STATUS,
  nowIso,
  nextRevisionId,
} from './schema.js'
import { bookDir, readBookData, computeRevision } from './store.js'
import { resolveBodyFile, sha256 } from './segment.js'
import { commitAnswers } from './tools.js'
import { buildRewriteBrief } from './resume.js'
import { commitPairTransaction, hashRawBytes } from './transaction.js'
import { validateDecisionEvidence, validateSelectedOption } from './decision-gate.js'

const REWIND_DIR = 'rewinds'

function decisionById(data, id) {
  return (data?.decisions ?? []).find((decision) => decision.id === id) ?? null
}

function liveSegmentFor(data, decision) {
  if (typeof decision.segmentId === 'string' && decision.segmentId) {
    const owned = (data?.segments ?? []).find((segment) => segment.id === decision.segmentId)
    if (owned) return owned
  }
  return (data?.segments ?? []).find(
    (segment) => segment.status === SEGMENT_STATUS.COMMITTED
      && Array.isArray(segment.decisionIds)
      && segment.decisionIds.includes(decision.id),
  ) ?? null
}

function cascadeSegments(data, targetSegment) {
  const start = Number(targetSegment.offsetStart) || 0
  return (data?.segments ?? [])
    .filter((segment) => segment.status === SEGMENT_STATUS.COMMITTED
      && segment.file === targetSegment.file
      && Number.isInteger(segment.offsetStart)
      && segment.offsetStart >= start)
    .sort((left, right) => (left.offsetStart ?? 0) - (right.offsetStart ?? 0))
}

function laterChapters(data, chapter) {
  const numbers = new Set()
  for (const decision of data?.decisions ?? []) if (decision.chapter > chapter) numbers.add(decision.chapter)
  for (const segment of data?.segments ?? []) if (segment.chapter > chapter) numbers.add(segment.chapter)
  return [...numbers].sort((left, right) => left - right)
}

function previousSegment(data, file, cutAt) {
  let found = null
  for (const segment of data?.segments ?? []) {
    if (segment.file !== file || segment.status !== SEGMENT_STATUS.COMMITTED) continue
    const end = Number(segment.offsetEnd)
    if (!Number.isInteger(end) || end > cutAt) continue
    if (!found || end > found.offsetEnd) found = segment
  }
  return found
}

function blocked(reason, message, extra = {}) {
  return { ok: false, blockedReason: reason, message, warnings: [], ...extra }
}

function normalizeChoice(decision, choice) {
  if (choice === 'keep') {
    if (!decision.chosen) return null
    return (decision.options ?? []).find((option) => option.label === decision.chosen.label)
      ?? decision.chosen
  }
  const label = typeof choice === 'string' ? choice.trim() : ''
  if (!label) return null
  return (decision.options ?? []).find((option) => option.label === label) ?? null
}

/**
 * 纯计划：不写盘、不截断，只回答「回到这里会发生什么」。
 * bodyText / fileLength 可选；传了才能校验 hash 和算精确的删字数。
 */
export function planRewind({ data, decisionId, choice = 'keep', bodyText = null, fileLength = null, now = nowIso() }) {
  const decision = decisionById(data, decisionId)
  if (!decision) return blocked('no-decision', `账本里找不到决策点 ${decisionId}。`)
  if (decision.status !== DECISION_STATUS.COMMITTED) {
    return blocked('not-committed', `决策点 ${decisionId} 还没拍板（${decision.status}），不能回退。`)
  }
  if (decision.legacy === true || decision.legacyReceipt === true) {
    return blocked('legacy', '0.6 旧账只记了选择，没有正文锚点；只能查看。')
  }
  const targetSegment = liveSegmentFor(data, decision)
  if (!targetSegment) {
    return blocked('no-segment', '这条决策还没有登记正文段落，只能查看，不能回退正文。')
  }
  if (targetSegment.status !== SEGMENT_STATUS.COMMITTED) {
    return blocked('segment-not-committed', '目标段落不是“已登记未回退”状态，不能回退。')
  }
  const newOption = normalizeChoice(decision, choice)
  if (!newOption) {
    return blocked('no-option', choice === 'keep'
      ? '这条决策没有可保留的选择。'
      : `账本里找不到选项「${choice}」。`)
  }

  const segments = cascadeSegments(data, targetSegment)
  const decisionIds = new Set()
  for (const segment of segments) {
    for (const id of segment.decisionIds ?? []) decisionIds.add(id)
  }
  decisionIds.add(decision.id)
  const affectedDecisions = [...decisionIds]
    .map((id) => decisionById(data, id))
    .filter(Boolean)
    .sort((left, right) => String(left.id).localeCompare(String(right.id), 'en', { numeric: true }))
  const reopened = affectedDecisions.filter((entry) => entry.id !== decision.id)

  const cutAt = Number(targetSegment.offsetStart) || 0
  const beforeChars = Number.isInteger(fileLength) ? fileLength : (Number(segments.at(-1)?.offsetEnd) || cutAt)
  const removedChars = Math.max(0, beforeChars - cutAt)

  let hashOk = null
  if (typeof bodyText === 'string' && typeof targetSegment.hash === 'string' && targetSegment.hash) {
    const slice = bodyText.slice(targetSegment.offsetStart, targetSegment.offsetEnd)
    hashOk = sha256(slice) === targetSegment.hash
    if (!hashOk) {
      return blocked('cannot-locate', '正文 hash 与登记时不一致：侧栏不自动重定位，一个字都不动。', {
        target: publicTarget(decision, targetSegment),
        cutAt,
        hashOk: false,
      })
    }
  }

  const previous = previousSegment(data, targetSegment.file, cutAt)
  const gateOffset = previous ? Number(previous.offsetEnd) || 0 : 0
  const gate = {
    file: targetSegment.file,
    offset: gateOffset,
    prefixHash: typeof bodyText === 'string' ? sha256(bodyText.slice(0, gateOffset)) : null,
    at: now,
    decisionIds: [],
  }

  // 预览：先把 cascade 涉及的 canon 倒序还原，再叠加 target 的新选择。
  const values = new Map()
  const current = new Map()
  for (const entry of data?.canon ?? []) {
    const key = `${entry.entity}\u0000${entry.key}`
    current.set(key, entry)
    values.set(key, entry.value)
  }
  for (const entry of [...affectedDecisions].reverse()) {
    for (const change of entry.chosen?.changes ?? []) {
      values.set(`${change.entity}\u0000${change.key}`, change.from ?? null)
    }
  }
  for (const change of newOption.changes ?? []) {
    values.set(`${change.entity}\u0000${change.key}`, change.to)
  }
  const affectedKeys = new Set()
  for (const entry of data?.canon ?? []) {
    if (decisionIds.has(entry.decisionId)) affectedKeys.add(`${entry.entity}\u0000${entry.key}`)
  }
  for (const change of newOption.changes ?? []) affectedKeys.add(`${change.entity}\u0000${change.key}`)
  const canon = [...affectedKeys].map((key) => {
    const [entity, field] = key.split('\u0000')
    return {
      entity,
      key: field,
      before: current.get(key)?.value ?? null,
      after: values.get(key) ?? null,
    }
  }).sort((left, right) => `${left.entity}.${left.key}`.localeCompare(`${right.entity}.${right.key}`, 'zh'))

  const obligations = (data?.obligations ?? [])
    .filter((entry) => decisionIds.has(entry.sourceDecision))
    .map((entry) => ({ id: entry.id, text: entry.text, dueChapter: entry.dueChapter ?? null }))

  const later = laterChapters(data, decision.chapter)
  const warnings = []
  if (later.length > 0) warnings.push(`第 ${later.join('、')} 章不在这次回退范围内，仍基于旧走向。`)

  return {
    ok: true,
    choice: choice === 'keep' ? 'keep' : newOption.label,
    target: publicTarget(decision, targetSegment),
    cutAt,
    beforeChars,
    removedChars,
    hashOk,
    segments: segments.map((segment) => ({
      id: segment.id,
      chars: segment.chars,
      offsetStart: segment.offsetStart,
      offsetEnd: segment.offsetEnd,
      decisionIds: segment.decisionIds ?? [],
    })),
    decisions: affectedDecisions.map((entry) => ({
      id: entry.id,
      title: entry.title,
      role: entry.id === decision.id ? 'target' : 'reopen',
    })),
    reopened: reopened.map((entry) => ({ id: entry.id, title: entry.title })),
    newChoice: {
      label: newOption.label,
      impact: newOption.impact ?? '',
      changes: newOption.changes ?? [],
      obligations: newOption.obligations ?? [],
      forbidden: newOption.forbidden ?? [],
    },
    canon,
    obligations,
    laterChapters: later,
    gate,
    warnings,
  }
}

function publicTarget(decision, segment) {
  return {
    decisionId: decision.id,
    chapter: decision.chapter,
    title: decision.title,
    segmentId: segment.id,
    file: segment.file,
    offsetStart: segment.offsetStart,
    offsetEnd: segment.offsetEnd,
    hash: segment.hash ?? null,
  }
}

function rewindsDir(dir, book) {
  return join(bookDir(dir, book), REWIND_DIR)
}

async function saveSnapshots(dir, book, id, bodyText, data) {
  const directory = rewindsDir(dir, book)
  await mkdir(directory, { recursive: true })
  const text = join(directory, `${id}.md`)
  const ledger = join(directory, `${id}.json`)
  await writeFile(text, bodyText, 'utf8')
  await writeFile(ledger, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  return {
    id,
    text: `${REWIND_DIR}/${id}.md`,
    ledger: `${REWIND_DIR}/${id}.json`,
  }
}

function nextRewindId() {
  return `rw-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`
}

/**
 * 执行回退：截断正文 + 倒序撤 canon/义务 + 重开后续决策 + 目标重落账（keep/改选）。
 * 失败时把正文写回原样；快照保留。
 */
export async function executeRewind({
  dir,
  book,
  decisionId,
  choice = 'keep',
  confirm = false,
  snapshot = true,
  expectedBookUpdatedAt = null,
  expectedRevision = null,
  expectedBodyHash = null,
  expectedLedgerHash = null,
  agentId = null,
  onAfterText = null,
}) {
  if (!confirm) fail('needs-confirm', '回退需要确认：先看影响预览，再传 confirm:true。')
  const { data, warnings: readWarnings } = await readBookData(dir, book)
  if (!data) fail('no-book', `书「${book}」还没有账本。`)
  if (expectedBookUpdatedAt && data.updatedAt !== expectedBookUpdatedAt) {
    fail('stale', '账本在面板加载后被改过；刷新后再试，未执行任何操作。')
  }
  if (expectedRevision != null && computeRevision(data) !== expectedRevision) {
    fail('revision-conflict', `账本已到版本 ${computeRevision(data)}，与面板的 ${expectedRevision} 不一致；刷新后再试。`)
  }
  const decision = decisionById(data, decisionId)
  if (!decision) fail('no-decision', `账本里找不到决策点 ${decisionId}。`)
  await validateDecisionEvidence(dir, data, decision)
  const targetSegment = liveSegmentFor(data, decision)
  if (!targetSegment) fail('no-segment', '这条决策没有正文锚点，不能回退。')
  const body = await resolveBodyFile(dir, targetSegment.file)
  const plan = planRewind({ data, decisionId, choice, bodyText: body.text, fileLength: body.text.length })
  if (!plan.ok) fail(plan.blockedReason, plan.message, plan)
  const beforeBody = await readFile(body.real)
  const expectedBody = expectedBodyHash ?? hashRawBytes(beforeBody)
  const expectedBookRevision = expectedRevision ?? computeRevision(data)
  const expectedBookHash = expectedLedgerHash ?? data.integrity?.ledgerHash ?? null
  if (expectedBookUpdatedAt && data.updatedAt !== expectedBookUpdatedAt) {
    fail('stale', '账本在面板加载后被改过；刷新后再试，未执行任何操作。')
  }
  const staleChapters = laterChapters(data, decision.chapter)
  const briefPlan = {
    ...plan,
    cutAt: plan.cutAt,
    newChoice: plan.newChoice,
  }
  const committed = await commitPairTransaction({
    dir,
    book,
    bodyFile: body.real,
    expectedRevision: expectedBookRevision,
    expectedBodyHash: expectedBody,
    expectedLedgerHash: expectedBookHash,
    kind: 'panel-rewind',
    chapter: decision.chapter,
    decisionId,
    staleChapters,
    briefInput: { decisionId, chapter: decision.chapter, plan: briefPlan, tail: body.text.slice(0, plan.cutAt).slice(-80) },
    mutate: async ({ data: state, bodyText }) => {
      if (expectedBookUpdatedAt && state.updatedAt !== expectedBookUpdatedAt) {
        fail('revision-conflict', '账本在面板预览后被改过；未产生事务副作用，请刷新预览。')
      }
      const currentPlan = planRewind({
        data: state,
        decisionId,
        choice,
        bodyText,
        fileLength: bodyText.length,
      })
      if (!currentPlan.ok) fail(currentPlan.blockedReason, currentPlan.message, currentPlan)
      const currentDecision = decisionById(state, decisionId)
      await validateDecisionEvidence(dir, state, currentDecision)
      const selectedOption = normalizeChoice(currentDecision, currentPlan.choice)
      if (!selectedOption) fail('no-option', `账本里找不到回退选项「${currentPlan.choice}」。`)
      const snapshots = snapshot ? await saveSnapshots(dir, book, nextRewindId(), bodyText, state) : null
      const truncated = bodyText.slice(0, currentPlan.cutAt)
      const result = await applyPlan(state, currentPlan, { dir, agentId, snapshots, selectedOption })
      return { body: Buffer.from(truncated, 'utf8'), result, snapshots, plan: currentPlan }
    },
    onPhase: async (phase, context) => {
      if (phase === 'body-replaced' && typeof onAfterText === 'function') {
        await onAfterText({ dir, book, body, plan, truncated: body.text.slice(0, plan.cutAt), transaction: context.journal })
      }
    },
  })
  const { data: nextData } = await readBookData(dir, book)
  const targetDecision = (nextData?.decisions ?? []).find((entry) => entry.id === decisionId) ?? decision
  const prompt = committed.prompt ?? buildRewriteBrief({
    data: nextData ?? data,
    chapter: targetDecision.chapter ?? decision.chapter,
    decision: targetDecision,
    plan: committed.plan ?? plan,
    tail: committed.body?.toString('utf8').slice(-80) ?? '',
    maxChars: 1200,
  })
  return {
    ok: true,
    book,
    decisionId,
    choice: (committed.plan ?? plan).choice,
    reverted: committed.result.reverted,
    recommitted: committed.result.recommitted,
    reopened: committed.result.reopened,
    snapshot: committed.snapshots,
    txId: committed.txId,
    transactionRevision: committed.transactionRevision,
    postCommit: committed.postCommit,
    resume: {
      chapter: targetDecision.chapter ?? decision.chapter,
      offset: (committed.plan ?? plan).cutAt,
      message: `从第 ${(committed.plan ?? plan).cutAt} 字继续写这一段。`,
      prompt,
    },
    warnings: [...readWarnings, ...committed.warnings, ...(committed.plan ?? plan).warnings, ...committed.result.warnings],
  }
}

async function applyPlan(state, plan, { dir, agentId, snapshots, selectedOption }) {
  const at = nowIso()
  const chapter = plan.target.chapter
  const target = decisionById(state, plan.target.decisionId)
  if (!target) fail('no-decision', '回退目标在账本写入时消失了。')
  // newChoice 是给预览/UI 的精简投影；这里仅接收事务内从当前决策取出并校验过的完整选项。
  if (!selectedOption) fail('no-option', `账本里找不到回退选项「${plan.choice}」。`)
  const customSelection = target.chosen?.source === 'author-custom'
    ? {
      source: 'author-custom',
      basedOnOptionId: null,
      editedFields: structuredClone(target.chosen.editedFields ?? []),
      custom: target.chosen.custom,
    }
    : null
  const cascadeIds = new Set(plan.segments.map((segment) => segment.id))
  const decisionIds = new Set(plan.decisions.map((entry) => entry.id))

  // 1) 倒序撤 canon：后发生的先退，避免同一 entity.key 停在中间态。
  let canon = state.canon.map((entry) => ({ ...entry }))
  for (const entry of [...plan.decisions].reverse()) {
    const decision = decisionById(state, entry.id)
    if (!decision) continue
    const owned = canon.filter((item) => item.decisionId === decision.id)
    for (const item of owned) {
      const change = (decision.chosen?.changes ?? []).find(
        (candidate) => candidate.entity === item.entity && candidate.key === item.key,
      )
      if (change && change.from !== undefined && change.from !== null) {
        item.value = change.from
        item.decisionId = null
        item.updatedAt = at
      } else {
        canon = canon.filter((candidate) => candidate !== item)
      }
    }
  }
  state.canon = canon

  // 2) 撤本段带来的义务。
  state.obligations = (state.obligations ?? []).filter((entry) => !decisionIds.has(entry.sourceDecision))

  // 3) 段落作废 + 决策清锚点。
  for (const segment of state.segments ?? []) {
    if (cascadeIds.has(segment.id)) segment.status = SEGMENT_STATUS.REVERTED
  }
  for (const segment of state.segments ?? []) {
    if (segment.status !== SEGMENT_STATUS.REVERTED) continue
    for (const id of segment.decisionIds ?? []) {
      const decision = decisionById(state, id)
      if (decision && cascadeIds.has(segment.id)) decision.segmentId = null
    }
  }

  // 4) 目标与后续决策回到待拍板；旧选择进 previousChoice，旧 request 仍留在 requests[]。
  for (const entry of plan.decisions) {
    const decision = decisionById(state, entry.id)
    if (!decision) continue
    if (decision.chosen) {
      decision.previousChoice = {
        label: decision.chosen.label,
        impact: decision.chosen.impact ?? '',
        at: decision.decidedAt ?? decision.answeredAt ?? at,
        requestId: decision.requestId ?? null,
      }
    }
    decision.status = DECISION_STATUS.PROPOSED
    decision.chosen = null
    decision.requestId = null
    decision.answeredAt = null
    decision.segmentId = null
    decision.reopenCount = (Number(decision.reopenCount) || 0) + 1
    decision.reopenedAt = at
    delete decision.pendingChoice
    delete decision.answerText
  }

  // 5) 清掉本章的旧闸门/续写检查/核对章。
  const key = String(chapter)
  state.chapters = state.chapters ?? {}
  state.chapters[key] = {
    ...(state.chapters[key] ?? {}),
    gate: null,
    continuationCheckRequired: false,
    verifiedAt: null,
  }

  // 6) 目标按 keep/新选项重新落账；后续决策保持 proposed，等 beat_next 重新问。
  // 验证必须在本次回退先还原受影响 canon 后进行，避免把目标决策自己的旧值误判为已知冲突。
  const validatedOption = target.gate
    ? await validateSelectedOption(dir, state, target, selectedOption, { allowAppend: true })
    : selectedOption
  const committed = commitAnswers(state, chapter, [{
    id: target.id,
    choice: plan.newChoice.label,
    option: validatedOption,
  }], {
    agentId,
    askedAt: at,
    via: 'sidebar',
    gate: plan.gate,
  })
  if (committed.conflictPending.length > 0) {
    fail('conflict', '这个选择和当前 canon 冲突；未落账，正文已回退到操作前。')
  }
  if (!committed.committed.some((entry) => entry.id === target.id)) {
    fail('not-committed', '目标决策没有重新落账；已撤销回退。')
  }
  if (customSelection) Object.assign(target.chosen, customSelection)

  // 7) 追加 revision + audit；不覆盖任何旧记录。
  const revision = {
    id: nextRevisionId(state.revisions),
    kind: REVISION_KIND.REVERT,
    chapter,
    segmentId: plan.target.segmentId,
    file: plan.target.file,
    mode: 'both',
    reopen: true,
    revertedSegments: plan.segments.map((segment) => segment.id),
    revertedDecisions: plan.decisions.map((entry) => entry.id),
    reopenedDecisions: plan.reopened.map((entry) => entry.id),
    recommitted: [target.id],
    choice: plan.choice,
    charsBefore: plan.beforeChars,
    charsRemoved: plan.removedChars,
    hashBefore: plan.target.hash,
    snapshot: snapshots?.text ?? null,
    bookSnapshot: snapshots?.ledger ?? null,
    createdAt: at,
  }
  state.revisions.push(revision)
  state.audit.push({
    at,
    action: 'rewind',
    chapter,
    decisionId: target.id,
    choice: plan.choice,
    revertedSegments: revision.revertedSegments,
    reopenedDecisions: revision.reopenedDecisions,
    recommitted: revision.recommitted,
    snapshot: snapshots?.text ?? null,
    agentId,
  })

  return {
    reverted: {
      segments: revision.revertedSegments,
      chars: plan.removedChars,
      canonEntries: plan.canon.length,
      affectedDecisions: revision.revertedDecisions,
    },
    recommitted: [{ id: target.id, title: target.title, choice: plan.newChoice.label }],
    reopened: plan.reopened,
    revision: revision.id,
    warnings: [],
  }
}
