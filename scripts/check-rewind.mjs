// 对真实账本的副本跑一次 executeRewind（只读源书，写临时副本）。
// 用法：node scripts/check-rewind.mjs [sourceRoot] [book]
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { executeRewind } from '../lib/rewind.js'
import { readBookData } from '../lib/store.js'
import { latestReopenRevision } from '../lib/panel.js'

const sourceRoot = process.argv[2] ?? 'D:/斗罗大陆'
const book = process.argv[3] ?? '斗罗：开局炸毁冰火两仪眼'
const root = await mkdtemp(join(tmpdir(), 'novel-beat-rewind-real-'))
try {
  await cp(join(sourceRoot, '正文', '第10章_太子雪清河.md'), join(root, '正文', '第10章_太子雪清河.md'))
  await mkdir(join(root, '.dsh-novel-beat', book), { recursive: true })
  await cp(join(sourceRoot, '.dsh-novel-beat', book, 'book.json'), join(root, '.dsh-novel-beat', book, 'book.json'))
  const result = await executeRewind({
    dir: root,
    book,
    decisionId: 'b10-2',
    choice: 'keep',
    confirm: true,
    snapshot: true,
    agentId: 'check-rewind',
  })
  assert.equal(result.ok, true)
  assert.equal(result.reverted.chars, 1222)
  assert.equal(result.reverted.segments.length, 2)
  assert.equal(result.reopened[0].id, 'b10-3')
  const body = await readFile(join(root, '正文', '第10章_太子雪清河.md'), 'utf8')
  assert.equal(body.length, 833)
  const { data } = await readBookData(root, book)
  assert.equal(data.segments.find((s) => s.id === 's-0002').status, 'reverted')
  assert.equal(data.segments.find((s) => s.id === 's-0003').status, 'reverted')
  assert.equal(data.decisions.find((d) => d.id === 'b10-2').chosen.label, '装傻，只给太子想看的')
  assert.equal(data.decisions.find((d) => d.id === 'b10-3').status, 'proposed')
  assert.equal(data.canon.filter((entry) => entry.decisionId === 'b10-2').length, 2)
  assert.equal(data.canon.filter((entry) => entry.decisionId === 'b10-3').length, 0)
  assert.equal(data.canon.length, 65)
  assert.equal(data.chapters['10'].gate.offset, 830)
  const revision = latestReopenRevision(data, 'b10-2')
  assert.equal(revision.id, data.revisions.at(-1).id)
  const snapshot = await readFile(join(root, '.dsh-novel-beat', book, revision.snapshot), 'utf8')
  assert.equal(snapshot.length, 2055)
  console.log('PASS rewind real copy:', JSON.stringify({
    root,
    reverted: result.reverted,
    recommitted: result.recommitted,
    reopened: result.reopened,
    bodyChars: body.length,
    canon: data.canon.length,
    targetCanon: data.canon.filter((entry) => entry.decisionId === 'b10-2').length,
    revision: revision.id,
    oldLineChars: snapshot.length,
  }))
} finally {
  await rm(root, { recursive: true, force: true })
}
