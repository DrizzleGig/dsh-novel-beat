// v0.8.0 读模型对真实账本的只读检查。
// 用法：node scripts/check-panel.mjs [fixtureBookDir]
// 默认读 D:\插件\tmp\beat-v08-fixture 的副本，不碰 D:\斗罗大陆 原书。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { buildChapter, buildOverview } from '../lib/panel.js'

const dir = process.argv[2]
  ?? 'D:/插件/tmp/beat-v08-fixture/斗罗：开局炸毁冰火两仪眼'
const book = JSON.parse(await readFile(join(dir, 'book.json'), 'utf8'))
const overview = buildOverview({ book: book.book, data: book, on: true })
const chapter10 = buildChapter({ book: book.book, data: book, chapter: 10 })
const chapter9 = buildChapter({ book: book.book, data: book, chapter: 9 })
const b102 = chapter10.decisions.find((decision) => decision.id === 'b10-2')

assert.equal(overview.stats.chapters, 12)
assert.equal(overview.stats.decisions, 35)
assert.equal(overview.stats.committed, 35)
assert.equal(overview.stats.open, 0)
assert.equal(overview.stats.segments, 5)
assert.equal(overview.stats.chars, 6759)
assert.equal(overview.currentChapter, 12)
assert.equal(chapter10.title, '太子雪清河')
assert.equal(chapter10.decisions.length, 3)
assert.equal(b102.segment.id, 's-0002')
assert.equal(b102.chosen.label, '装傻，只给太子想看的')
assert.deepEqual(b102.revert, {
  segments: 2,
  chars: 1222,
  canonEntries: 4,
  decisionIds: ['b10-2', 'b10-3'],
  laterChapters: [11, 12],
})
assert.equal(chapter9.decisions[0].canRevert, false)
assert.equal(chapter9.decisions[0].revertBlockedReason, 'no-segment')
const noAnchor = overview.chapters.reduce((sum, chapter) => sum + chapter.noAnchor, 0)
assert.equal(noAnchor, 30)

console.log('PASS overview:', JSON.stringify(overview.stats))
console.log('PASS chapter 10:', chapter10.title, chapter10.decisions.map((decision) => decision.id).join(','))
console.log('PASS b10-2 revert:', JSON.stringify(b102.revert))
console.log('PASS no-anchor total:', noAnchor)
