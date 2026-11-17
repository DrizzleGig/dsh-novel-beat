/**
 * Host half of the composer "拍板" button.
 *
 * The Client half cannot call a Host command directly with a session id; it
 * mounts this Typert remote instead. The remote resolves the real Agent from
 * the session id, reads the persisted mode for status, and delegates the
 * toggle to the existing /beat command so the command and the button share
 * exactly one implementation.
 */
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
  var useValue = arguments.length > 2
  for (var i = 0; i < initializers.length; i++) {
    value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg)
  }
  return useValue ? value : void 0
}
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
  function accept(f) { if (f !== void 0 && typeof f !== 'function') throw new TypeError('Function expected'); return f }
  var kind = contextIn.kind, key = kind === 'getter' ? 'get' : kind === 'setter' ? 'set' : 'value'
  var target = !descriptorIn && ctor ? contextIn['static'] ? ctor : ctor.prototype : null
  var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {})
  var _, done = false
  for (var i = decorators.length - 1; i >= 0; i--) {
    var context = {}
    for (var p in contextIn) context[p] = p === 'access' ? {} : contextIn[p]
    for (var p in contextIn.access) context.access[p] = contextIn.access[p]
    context.addInitializer = function (f) { if (done) throw new TypeError('Cannot add initializers after decoration has completed'); extraInitializers.push(accept(f || null)) }
    var result = (0, decorators[i])(kind === 'accessor' ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context)
    if (kind === 'accessor') {
      if (result === void 0) continue
      if (result === null || typeof result !== 'object') throw new TypeError('Object expected')
      if (_ = accept(result.get)) descriptor.get = _
      if (_ = accept(result.set)) descriptor.set = _
      if (_ = accept(result.init)) initializers.unshift(_)
    } else if (_ = accept(result)) {
      if (kind === 'field') initializers.unshift(_)
      else descriptor[key] = _
    }
  }
  if (target) Object.defineProperty(target, contextIn.name, descriptor)
  done = true
}

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { SessionId } from '@deepseek-ai/dsh-session'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DESCRIPTORS } from './remote-contract.js'
import { bookDir, getSessionMode, readActiveBook } from './store.js'
import { listSegments } from './tools.js'
import { buildChapter, buildOverview, latestReopenRevision, readChapterTitles } from './panel.js'
import { planRewind, executeRewind } from './rewind.js'
import { resolveBodyFile } from './segment.js'
import { buildResumeRequest, promptSession } from './resume.js'

let BeatRemote = (() => {
  let _classSuper = TypertRemoteService
  let _instanceExtraInitializers = []
  let _status_decorators
  let _setMode_decorators
  let _panel_decorators
  let _revertLast_decorators
  let _overview_decorators
  let _chapter_decorators
  let _impact_decorators
  let _rewind_decorators
  let _resume_decorators
  let _oldLine_decorators
  return class BeatRemote extends _classSuper {
    static {
      const _metadata = typeof Symbol === 'function' && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0
      _status_decorators = [Remote('status')]
      _setMode_decorators = [Remote('setMode')]
      _panel_decorators = [Remote('panel')]
      _revertLast_decorators = [Remote('revertLast')]
      _overview_decorators = [Remote('overview')]
      _chapter_decorators = [Remote('chapter')]
      _impact_decorators = [Remote('impact')]
      _rewind_decorators = [Remote('rewind')]
      _resume_decorators = [Remote('resume')]
      _oldLine_decorators = [Remote('oldLine')]
      __esDecorate(this, null, _status_decorators, { kind: 'method', name: 'status', static: false, private: false, access: { has: (obj) => 'status' in obj, get: (obj) => obj.status }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _setMode_decorators, { kind: 'method', name: 'setMode', static: false, private: false, access: { has: (obj) => 'setMode' in obj, get: (obj) => obj.setMode }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _panel_decorators, { kind: 'method', name: 'panel', static: false, private: false, access: { has: (obj) => 'panel' in obj, get: (obj) => obj.panel }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _revertLast_decorators, { kind: 'method', name: 'revertLast', static: false, private: false, access: { has: (obj) => 'revertLast' in obj, get: (obj) => obj.revertLast }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _overview_decorators, { kind: 'method', name: 'overview', static: false, private: false, access: { has: (obj) => 'overview' in obj, get: (obj) => obj.overview }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _chapter_decorators, { kind: 'method', name: 'chapter', static: false, private: false, access: { has: (obj) => 'chapter' in obj, get: (obj) => obj.chapter }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _impact_decorators, { kind: 'method', name: 'impact', static: false, private: false, access: { has: (obj) => 'impact' in obj, get: (obj) => obj.impact }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _rewind_decorators, { kind: 'method', name: 'rewind', static: false, private: false, access: { has: (obj) => 'rewind' in obj, get: (obj) => obj.rewind }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _resume_decorators, { kind: 'method', name: 'resume', static: false, private: false, access: { has: (obj) => 'resume' in obj, get: (obj) => obj.resume }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _oldLine_decorators, { kind: 'method', name: 'oldLine', static: false, private: false, access: { has: (obj) => 'oldLine' in obj, get: (obj) => obj.oldLine }, metadata: _metadata }, null, _instanceExtraInitializers)
      if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata })
    }

    static inject = ['agents', 'commands', 'workingDirectory', 'typert']

    constructor(ctx) {
      super(ctx, 'beatMode')
      __runInitializers(this, _instanceExtraInitializers)
      ctx.typert.register({
        package: 'dsh-novel-beat',
        face: 'host',
        schemas: [],
        model: { services: [], events: [], objects: [] },
        invocations: DESCRIPTORS,
      })
    }

    agent(id) {
      const agent = this.ctx.agents.get(SessionId(id))
      if (!agent) throw new Error('会话尚未加载或已关闭，请重新打开会话后重试。')
      return agent
    }

    async status(id) {
      const agent = this.agent(id)
      const dir = await this.ctx.workingDirectory.ensure(agent)
      const { mode } = await getSessionMode(dir, agent.id)
      return { on: mode === 'on' }
    }

    async setMode(id, on) {
      if (typeof on !== 'boolean') throw new Error('on 必须是布尔值。')
      const agent = this.agent(id)
      const result = await this.ctx.commands.execute(agent, on ? '/beat on' : '/beat off', [], new AbortController().signal)
      if (!result) throw new Error('/beat 命令未注册，请重载后端。')
      if (result.result.kind !== 'success') throw new Error(result.result.text || '/beat 命令执行失败。')
      return { on: String(result.result.text ?? '').includes('已开启') }
    }

    async panel(id) {
      const agent = this.agent(id)
      const dir = await this.ctx.workingDirectory.ensure(agent)
      const { mode } = await getSessionMode(dir, agent.id)
      const on = mode === 'on'
      if (!on) return { on: false, text: '', chapter: null, segments: 0, chars: 0, lastId: null }
      const active = await readActiveBook(dir).catch(() => null)
      if (!active || !active.data) {
        return { on: true, text: '这本书还没有账本：先 beat_plan 登记第一个岔路。', chapter: null, segments: 0, chars: 0, lastId: null }
      }
      const chapters = [...new Set((active.data.decisions ?? []).map((item) => item.chapter))].sort((a, b) => a - b)
      const chapter = chapters.length > 0 ? chapters[chapters.length - 1] : null
      const rows = chapter === null ? [] : await listSegments({ dir, book: active.book, chapter })
      const live = rows.filter((row) => row.status === 'committed')
      const last = live.length > 0 ? live[live.length - 1] : null
      const head = chapter === null ? '还没有任何章节' : `第 ${chapter} 章`
      const text = last
        ? `${head} · ${live.length} 段 · 最后一段 ${last.chars} 字（第 ${last.offsetStart}–${last.offsetEnd} 字）`
        : `${head} · 还没有登记段落`
      return { on: true, text, chapter, segments: live.length, chars: last?.chars ?? 0, lastId: last?.id ?? null }
    }

    async overview(id) {
      const agent = this.agent(id)
      const dir = await this.ctx.workingDirectory.ensure(agent)
      const { mode } = await getSessionMode(dir, agent.id)
      const active = await readActiveBook(dir).catch(() => null)
      if (!active?.data) return buildOverview({ book: null, data: null, on: mode === 'on' })
      const chapterTitles = await readChapterTitles(dir).catch(() => new Map())
      return buildOverview({
        book: active.book,
        data: active.data,
        on: mode === 'on',
        chapterTitles,
      })
    }

    async chapter(id, chapter) {
      const value = Number(chapter)
      if (!Number.isInteger(value) || value < 1 || value > 9999) {
        throw new Error('chapter 必须是 1–9999 的整数。')
      }
      const agent = this.agent(id)
      const dir = await this.ctx.workingDirectory.ensure(agent)
      const active = await readActiveBook(dir).catch(() => null)
      if (!active?.data) return buildChapter({ book: null, data: null, chapter: value })
      const chapterTitles = await readChapterTitles(dir).catch(() => new Map())
      return buildChapter({
        book: active.book,
        data: active.data,
        chapter: value,
        chapterTitles,
      })
    }

    async impact(id, decisionId, options = {}) {
      const agent = this.agent(id)
      const dir = await this.ctx.workingDirectory.ensure(agent)
      const active = await readActiveBook(dir).catch(() => null)
      if (!active?.data) return { ok: false, code: 'no-book', message: '这本书还没有账本。' }
      const data = active.data
      const decision = (data.decisions ?? []).find((entry) => entry.id === decisionId)
      if (!decision) return { ok: false, code: 'no-decision', message: `账本里找不到决策点 ${decisionId}。` }
      if (decision.legacy === true || decision.legacyReceipt === true) {
        return { ok: false, code: 'legacy', message: '0.6 旧账只记了选择，没有正文锚点；只能查看。' }
      }
      const segment = (data.segments ?? []).find((entry) => entry.id === decision.segmentId)
        ?? (data.segments ?? []).find((entry) => entry.status === 'committed' && (entry.decisionIds ?? []).includes(decisionId))
      if (!segment) return { ok: false, code: 'no-segment', message: '这条决策没有正文锚点，不能回退。' }
      let body
      try {
        body = await resolveBodyFile(dir, segment.file)
      } catch (error) {
        return { ok: false, code: 'cannot-locate', message: `读不到正文：${error?.message ?? error}` }
      }
      return planRewind({
        data,
        decisionId,
        choice: typeof options?.choice === 'string' && options.choice ? options.choice : 'keep',
        bodyText: body.text,
        fileLength: body.text.length,
      })
    }

    async rewind(id, decisionId, options = {}) {
      const agent = this.agent(id)
      const dir = await this.ctx.workingDirectory.ensure(agent)
      const { mode } = await getSessionMode(dir, agent.id)
      if (mode !== 'on') return { ok: false, code: 'mode-off', message: '先开启拍板，再回退或改选。' }
      const active = await readActiveBook(dir).catch(() => null)
      if (!active?.data) return { ok: false, code: 'no-book', message: '这本书还没有账本。' }
      const choice = typeof options?.choice === 'string' && options.choice ? options.choice : 'keep'
      return executeRewind({
        dir,
        book: active.book,
        decisionId,
        choice,
        confirm: options?.confirm === true,
        snapshot: options?.snapshot !== false,
        markLaterStale: options?.markLaterStale === true,
        expectedBookUpdatedAt: typeof options?.expectedBookUpdatedAt === 'string' ? options.expectedBookUpdatedAt : null,
        agentId: agent.id,
      })
    }

    async resume(id, text) {
      const agent = this.agent(id)
      const controller = this.ctx.get('sessionController')
      let request
      try {
        request = buildResumeRequest({
          sessionId: agent.id,
          requestId: `beat-resume-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
          text,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
      } catch (error) {
        return { ok: false, code: error?.code ?? 'bad-text', message: String(error?.message ?? error) }
      }
      return promptSession(controller, request, new AbortController().signal)
    }

    async oldLine(id, decisionId) {
      const agent = this.agent(id)
      const dir = await this.ctx.workingDirectory.ensure(agent)
      const active = await readActiveBook(dir).catch(() => null)
      if (!active?.data) return { ok: false, code: 'no-book', message: '这本书还没有账本。' }
      const revision = latestReopenRevision(active.data, decisionId)
      if (!revision) return { ok: false, code: 'no-rewind', message: '这条决策还没有回退记录。' }
      if (!revision.snapshot.startsWith('rewinds/') || revision.snapshot.includes('..')) {
        return { ok: false, code: 'bad-snapshot', message: '旧线快照路径不合法。' }
      }
      try {
        const text = await readFile(join(bookDir(dir, active.book), revision.snapshot), 'utf8')
        return {
          ok: true,
          decisionId,
          revisionId: revision.id,
          createdAt: revision.createdAt ?? null,
          chars: text.length,
          text,
        }
      } catch (error) {
        return { ok: false, code: 'snapshot-missing', message: `读不到旧线快照：${error?.message ?? error}` }
      }
    }

    async revertLast(id) {
      const agent = this.agent(id)
      const result = await this.ctx.commands.execute(agent, '/beat revert', [], new AbortController().signal)
      if (!result) return { ok: false, text: '/beat 命令未注册，请重载后端。' }
      const text = String(result.result.text ?? '')
      return { ok: result.result.kind === 'success', text: text || '没有拿到命令回执。' }
    }
  }
})()

export default BeatRemote
