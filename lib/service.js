// M2：进程内只读服务。不能调用会自动迁移落盘的 readBookData/readActiveBook。
import { createHash } from 'node:crypto'
import { readFile, readdir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { ROOT, bookDir, computeRevision, resolveWorkspaceRoot } from './store.js'
import { LEGACY_SCHEMA_VERSION, OPEN_DECISION_STATUSES, DECISION_STATUS, migrateBookV1ToV2, validateBook } from './schema.js'

/** 与 resolveBookFor/readActiveBook 相同的工作区锚定、最近 mtime 选书规则，但不迁移落盘。 */
async function readServiceBook(cwd, book) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return null
  try {
    const root = resolveWorkspaceRoot(cwd)
    let target = typeof book === 'string' && book ? book : null
    if (!target) {
      const ledger = join(root, ROOT)
      const candidates = []
      for (const entry of await readdir(ledger, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('_')) continue
        try {
          const info = await stat(join(ledger, entry.name, 'book.json'))
          if (info.isFile()) candidates.push({ book: entry.name, mtime: info.mtimeMs })
        } catch {
          // 没有 book.json 的目录不算候选。
        }
      }
      candidates.sort((a, b) => b.mtime - a.mtime)
      target = candidates[0]?.book
      if (!target) return null
    }
    const directory = bookDir(root, target)
    const raw = JSON.parse(await readFile(join(directory, 'book.json'), 'utf8'))
    // 旧账本仅在内存兼容；固定迁移时间，重复读取不会制造变化。
    const data = raw.schemaVersion === LEGACY_SCHEMA_VERSION
      ? migrateBookV1ToV2(raw, { now: raw.updatedAt ?? raw.createdAt ?? '1970-01-01T00:00:00.000Z' })
      : raw
    validateBook(data)
    return { book: target, directory, data }
  } catch {
    // 与 resolveBookFor 一致：无书、无账本或无法读取时不猜目标。
    return null
  }
}

function currentChapter(data, chapter) {
  return chapter ?? data.decisions.at(-1)?.chapter ?? data.segments.at(-1)?.chapter ?? null
}

function chapterDecisions(data, chapter) {
  return data.decisions.filter((decision) => decision.chapter === chapter)
}

function lastSegmentFor(data, chapter) {
  return data.segments.filter((segment) => segment.chapter === chapter && segment.status !== 'reverted').at(-1) ?? null
}

function atFor(record) {
  return record?.createdAt ?? record?.answeredAt ?? record?.verifiedAt ?? record?.committedAt ?? record?.updatedAt ?? null
}

/** 只允许 rewinds/ 下的单个 JSON 文件，包括解析符号链接后的路径。 */
async function readRewind(directory, artifactId) {
  if (/[\\/:\0<>"|?*]/.test(artifactId) || artifactId.includes('..')) return null
  try {
    const base = await realpath(directory)
    const file = await realpath(join(directory, 'rewinds', `${artifactId}.json`))
    const inside = relative(base, file)
    if (!inside.startsWith(`rewinds${sep}`) || isAbsolute(inside)) return null
    const [contents, info] = await Promise.all([readFile(file), stat(file)])
    JSON.parse(contents.toString('utf8'))
    return { hash: createHash('sha1').update(contents).digest('hex'), at: info.mtime.toISOString() }
  } catch {
    return null
  }
}

export function createReadOnlyService({ version, gateFromBook }) {
  return {
    identity() {
      return {
        plugin: 'dsh-novel-beat',
        version,
        service_version: 1,
        capabilities: ['beat.status', 'beat.revision', 'beat.canon', 'beat.artifact', 'beat.commit.events'],
        dir: ROOT,
        readOnly: true,
      }
    },

    async getRevision({ cwd, book } = {}) {
      const found = await readServiceBook(cwd, book)
      if (!found) return null
      const { data } = found
      return {
        revision: computeRevision(data),
        updatedAt: data.updatedAt ?? null,
        latestRevisionId: data.revisions.at(-1)?.id ?? null,
      }
    },

    async getStatus({ cwd, book, chapter } = {}) {
      const found = await readServiceBook(cwd, book)
      if (!found) return null
      const { data } = found
      const selected = currentChapter(data, chapter)
      const decisions = chapterDecisions(data, selected)
      const gateChapter = gateFromBook(data).chapters[String(selected)] ?? {}
      // gateFromBook 已先判 answered+pendingChoice（0.9 M4a 修正）；这里仍按决策
      // 补算一次，保证旧账本/旧调用方拿到的 pendingConfirm 与当前语义一致。
      const pendingConfirm = decisions.filter((decision) => (
        decision.status === DECISION_STATUS.ANSWERED && decision.pendingChoice
      )).length
      const stateDetail = {
        total: 0, open: 0, awaitingSegment: 0, pendingConfirm: 0, needsCheck: false,
        ...gateChapter,
        pendingConfirm,
      }
      const chapterMeta = data.chapters[String(selected)] ?? null
      const lastSegment = lastSegmentFor(data, selected)
      const chapterState = stateDetail.pendingConfirm > 0 ? 'pending_confirm'
        : stateDetail.open > 0 ? 'open'
          : stateDetail.awaitingSegment > 0 ? 'awaiting_segment'
            : stateDetail.needsCheck ? 'needs_check'
              : chapterMeta?.verifiedAt ? 'verified'
                : decisions.length > 0 || data.segments.some((segment) => segment.chapter === selected) ? 'writing'
                  : 'empty'
      return {
        book: found.book,
        chapter: selected,
        pending: decisions.filter((decision) => OPEN_DECISION_STATUSES.includes(decision.status))
          .map(({ id, status, title }) => ({ id, status, title })),
        openDecisions: stateDetail.open,
        chapterState,
        stateDetail,
        chapterMeta,
        lastSegment: lastSegment ? {
          id: lastSegment.id,
          chapter: lastSegment.chapter,
          offsetStart: lastSegment.offsetStart,
          offsetEnd: lastSegment.offsetEnd,
          chars: lastSegment.chars,
          decisionIds: lastSegment.decisionIds ?? [],
        } : null,
        revision: computeRevision(data),
      }
    },

    async getCanon({ cwd, book, chapter } = {}) {
      const found = await readServiceBook(cwd, book)
      if (!found) return null
      const { data } = found
      const selected = currentChapter(data, chapter)
      return {
        schemaVersion: data.schemaVersion,
        revision: computeRevision(data),
        canon: data.canon.map((entry) => ({
          entity: entry.entity, key: entry.key, value: entry.value, chapter: entry.chapter ?? null,
        })),
        obligations: data.obligations.filter((entry) => entry.status !== 'paid' && entry.status !== 'waived')
          .map((entry) => ({
            id: entry.id, text: entry.text, status: entry.status,
            dueChapter: entry.dueChapter ?? null, sourceDecision: entry.sourceDecision ?? null,
          })),
        decisions: chapterDecisions(data, selected).map((decision) => ({
          id: decision.id, chapter: decision.chapter, status: decision.status, title: decision.title,
          choice: decision.chosen?.label ?? decision.answerText ?? null,
          segmentId: decision.segmentId ?? null,
        })),
      }
    },

    async getArtifact({ cwd, book, artifactId } = {}) {
      const missing = { found: false, artifactId }
      if (typeof artifactId !== 'string' || !artifactId) return missing
      const found = await readServiceBook(cwd, book)
      if (!found) return missing
      const { data, directory } = found
      const base = { found: true, artifactId, revision: computeRevision(data) }
      const segment = data.segments.find((entry) => entry.id === artifactId)
      if (segment) return {
        ...base, kind: 'segment', revisionId: segment.revisionId ?? null,
        hash: segment.hash ?? null, at: atFor(segment), segment,
      }
      const decision = data.decisions.find((entry) => entry.id === artifactId)
      if (decision) {
        const bound = data.segments.find((entry) => entry.id === decision.segmentId)
        return {
          ...base, kind: 'decision', revisionId: bound?.revisionId ?? null,
          hash: bound?.hash ?? null, at: atFor(decision), decision,
        }
      }
      const revisionRecord = data.revisions.find((entry) => entry.id === artifactId)
      if (revisionRecord) return {
        ...base, kind: 'revision', revisionId: revisionRecord.id,
        hash: revisionRecord.hash ?? null, at: atFor(revisionRecord), revisionRecord,
      }
      const rewind = await readRewind(directory, artifactId)
      if (!rewind) return missing
      const record = data.revisions.find((entry) => entry.bookSnapshot === `rewinds/${artifactId}.json`)
      return {
        ...base, kind: 'rewind', ...rewind,
        ...(record ? { revisionId: record.id, revisionRecord: record } : {}),
      }
    },
  }
}
