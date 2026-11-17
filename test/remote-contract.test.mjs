import test from 'node:test'
import assert from 'node:assert/strict'
import { DESCRIPTORS, TYPERT_REMOTE } from '../lib/remote-contract.js'

test('remote contract 暴露 v0.8 的 overview / chapter，并保留 v0.7 方法', () => {
  const methods = DESCRIPTORS.map((descriptor) => descriptor.method)
  assert.deepEqual(methods, ['status', 'setMode', 'panel', 'revertLast', 'overview', 'chapter', 'impact', 'rewind', 'resume', 'oldLine'])
  assert.equal(TYPERT_REMOTE.package, 'dsh-novel-beat')
  for (const descriptor of DESCRIPTORS) {
    assert.equal(descriptor.namespace, 'beatMode')
    assert.equal(descriptor.service, 'beatMode')
    assert.equal(descriptor.invocation.kind, 'direct')
  }
})

test('overview / chapter 的参数与结果 codec 可校验', () => {
  const byMethod = new Map(DESCRIPTORS.map((descriptor) => [descriptor.method, descriptor]))
  const overview = byMethod.get('overview')
  assert.deepEqual(overview.parameters.map((parameter) => parameter.name), ['sessionId'])
  const objectSchema = overview.result.create()
  assert.deepEqual(objectSchema.parse({ ok: true, book: null }), { ok: true, book: null })
  assert.throws(() => objectSchema.parse(null))

  const chapter = byMethod.get('chapter')
  assert.deepEqual(chapter.parameters.map((parameter) => parameter.name), ['sessionId', 'chapter'])
  const chapterSchema = chapter.parameters[1].codec.create()
  assert.equal(chapterSchema.parse(10), 10)
  assert.throws(() => chapterSchema.parse(0))
  assert.throws(() => chapterSchema.parse('10'))
  assert.throws(() => chapterSchema.parse(1.5))

  const impact = byMethod.get('impact')
  assert.deepEqual(impact.parameters.map((parameter) => parameter.name), ['sessionId', 'decisionId', 'options'])
  const decisionIdSchema = impact.parameters[1].codec.create()
  assert.equal(decisionIdSchema.parse('b10-2'), 'b10-2')
  assert.throws(() => decisionIdSchema.parse(''))
  const optionsSchema = impact.parameters[2].codec.create()
  assert.deepEqual(optionsSchema.parse({ choice: 'keep' }), { choice: 'keep' })
  assert.throws(() => optionsSchema.parse(null))

  const rewind = byMethod.get('rewind')
  assert.deepEqual(rewind.parameters.map((parameter) => parameter.name), ['sessionId', 'decisionId', 'options'])

  const resume = byMethod.get('resume')
  assert.deepEqual(resume.parameters.map((parameter) => parameter.name), ['sessionId', 'text'])
  const resumeSchema = resume.parameters[1].codec.create()
  assert.equal(resumeSchema.parse('继续写'), '继续写')
  assert.throws(() => resumeSchema.parse(''))
  assert.throws(() => resumeSchema.parse('x'.repeat(501)))

  const oldLine = byMethod.get('oldLine')
  assert.deepEqual(oldLine.parameters.map((parameter) => parameter.name), ['sessionId', 'decisionId'])
})
