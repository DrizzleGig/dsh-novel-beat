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
import { DESCRIPTORS } from './remote-contract.js'
import { getSessionMode } from './store.js'

let BeatRemote = (() => {
  let _classSuper = TypertRemoteService
  let _instanceExtraInitializers = []
  let _status_decorators
  let _setMode_decorators
  return class BeatRemote extends _classSuper {
    static {
      const _metadata = typeof Symbol === 'function' && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0
      _status_decorators = [Remote('status')]
      _setMode_decorators = [Remote('setMode')]
      __esDecorate(this, null, _status_decorators, { kind: 'method', name: 'status', static: false, private: false, access: { has: (obj) => 'status' in obj, get: (obj) => obj.status }, metadata: _metadata }, null, _instanceExtraInitializers)
      __esDecorate(this, null, _setMode_decorators, { kind: 'method', name: 'setMode', static: false, private: false, access: { has: (obj) => 'setMode' in obj, get: (obj) => obj.setMode }, metadata: _metadata }, null, _instanceExtraInitializers)
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
  }
})()

export default BeatRemote
