import { resolve } from 'node:path'

// False-fork feedback is intentionally ephemeral: rejected proposals never enter book.json.
const TTL_MS = 10 * 60 * 1000
const MAX_PER_CHAPTER = 4
const MAX_CHAPTER_KEYS = 512
const entries = new Map()

function keyOf(dir, book, chapter) {
  return `${dir ? resolve(dir) : ''}\u0000${String(book)}\u0000${Number(chapter)}`
}

function pruneExpired(now) {
  for (const [key, rows] of entries) {
    const current = rows.filter((item) => now - item.at < TTL_MS)
    if (current.length) entries.set(key, current)
    else entries.delete(key)
  }
  if (entries.size > MAX_CHAPTER_KEYS) {
    const oldest = [...entries.entries()]
      .sort((left, right) => (left[1].at(-1)?.at ?? 0) - (right[1].at(-1)?.at ?? 0))
    for (const [key] of oldest.slice(0, entries.size - MAX_CHAPTER_KEYS)) entries.delete(key)
  }
}

export function rememberRejectedCandidate({ dir, book, chapter, beat, error, now = Date.now() } = {}) {
  if (error?.code !== 'false-fork' || !book || !Number.isInteger(chapter) || !beat) return null
  pruneExpired(now)
  const key = keyOf(dir, book, chapter)
  const current = (entries.get(key) ?? []).filter((item) => now - item.at < TTL_MS)
  const record = {
    id: `reject-${now.toString(36)}-${current.length + 1}`,
    title: String(beat.title ?? '未命名候选').slice(0, 120),
    reason: String(error.message ?? '候选是假分叉，已拒收。').slice(0, 400),
    options: (beat.options ?? []).map((option) => ({
      label: String(option?.label ?? option?.action ?? '未命名选项').slice(0, 100),
      action: String(option?.action ?? '').slice(0, 240),
    })),
    at: now,
  }
  entries.set(key, [...current, record].slice(-MAX_PER_CHAPTER))
  return structuredClone(record)
}

export function readRejectedCandidates(dir, book, chapter, now = Date.now()) {
  pruneExpired(now)
  const key = keyOf(dir, book, chapter)
  const current = (entries.get(key) ?? []).filter((item) => now - item.at < TTL_MS)
  if (current.length) entries.set(key, current)
  else entries.delete(key)
  return structuredClone(current)
}

export function clearRejectedCandidates(dir, book, chapter) {
  entries.delete(keyOf(dir, book, chapter))
}
