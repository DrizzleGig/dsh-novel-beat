import test from 'node:test'
import assert from 'node:assert/strict'

// client.js is a browser module: it immediately calls window.__ModuleLoader__.load.
// Capture the factory once, then exercise apply() with a fake Client context.
let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(module) {
      captured = module
    },
  },
}
globalThis.__NOVEL_BEAT_TEST__ = true
await import('../client.js')

const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
}

function makeModule({ onEffect } = {}) {
  const react = onEffect ? { ...fakeReact, useEffect: (effect) => onEffect(effect) } : fakeReact
  return captured.factory((name) => {
    if (name === 'react') return react
    throw new Error(`unexpected require: ${name}`)
  })
}

function makeContext({ mount } = {}) {
  const events = []
  let contract = null
  const service = {
    status: async () => ({ ok: true, value: { on: false } }),
    setMode: async (_id, on) => ({ ok: true, value: { on } }),
    panel: async () => ({ ok: true, value: { on: false, text: '' } }),
    revertLast: async () => ({ ok: true, text: '' }),
    overview: async () => ({ ok: true, value: { ok: true, on: false, book: null, stats: {} } }),
    chapter: async () => ({ ok: true, value: { ok: true, book: null, chapter: 1, decisions: [] } }),
    impact: async () => ({ ok: true, value: { ok: true, blockedReason: null } }),
    rewind: async () => ({ ok: true, value: { ok: true } }),
    resume: async () => ({ ok: true, value: { ok: true } }),
    oldLine: async () => ({ ok: true, value: { ok: true, text: '' } }),
  }
  const cleanups = []
  const registrations = []
  const ctx = {
    remote: {
      $mount: async (mounted) => {
        contract = mounted
        events.push('mount')
        if (mount) return mount(mounted)
        return () => events.push('dispose')
      },
    },
    get(name) {
      events.push(`get:${name}`)
      return name === 'remote.beatMode' ? service : undefined
    },
    effect(fn) {
      const cleanup = fn()
      cleanups.push(cleanup)
      return cleanup
    },
    slots: {
      inject(owner, fn) {
        events.push(`inject:${owner}`)
        return fn()
      },
      register(options, component) {
        events.push(`register:${options.id}`)
        const entry = { options, component }
        registrations.push(entry)
        return entry
      },
    },
  }
  return {
    ctx,
    events,
    service,
    cleanups,
    get contract() { return contract },
    get registration() { return registrations[0] ?? null },
    get registrations() { return registrations },
  }
}

test('client mounts the remote, reads remote.beatMode and registers the button', async () => {
  const handle = makeContext()
  const { ctx, events, cleanups } = handle
  const mod = makeModule()
  await mod.apply(ctx)

  assert.deepEqual(events.slice(0, 3), ['mount', 'get:remote.beatMode', 'inject:conversation.input.left'])
  assert.deepEqual(
    handle.contract.descriptors.map((descriptor) => descriptor.method),
    ['status', 'setMode', 'panel', 'revertLast', 'overview', 'chapter', 'impact', 'rewind', 'resume', 'oldLine', 'timeline', 'health', 'search'],
  )
  assert.equal(handle.registration.options.id, 'dsh-novel-beat-mode')
  assert.equal(handle.registration.options.name, 'conversation.input.left')
  assert.equal(typeof handle.registration.component, 'function')

  const bar = handle.registrations[1]
  assert.ok(bar, '拍板台没注册')
  assert.equal(bar.options.id, 'dsh-novel-beat-segments')
  assert.equal(bar.options.name, 'conversation.input.dock')
  assert.equal(typeof bar.component, 'function')

  assert.equal(typeof cleanups[0], 'function')
  cleanups[0]()
  assert.ok(events.includes('dispose'))
})

test('client waits for the async mount before reading the service', async () => {
  const order = []
  const ctx = {
    remote: {
      $mount: async () => {
        order.push('mount:start')
        await new Promise((resolve) => setTimeout(resolve, 5))
        order.push('mount:done')
        return () => {}
      },
    },
    get(name) {
      order.push(`get:${name}`)
      return { status: async () => ({ ok: true, value: { on: false } }) }
    },
    effect: (fn) => fn(),
    slots: {
      inject: (_owner, fn) => fn(),
      register: () => ({}),
    },
  }
  await makeModule().apply(ctx)
  assert.deepEqual(order, ['mount:start', 'mount:done', 'get:remote.beatMode'])
})

test('client still registers the button when the mount fails', async () => {
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args.join(' '))
  try {
    const { ctx, events } = makeContext({
      mount: () => {
        throw new Error('remote unavailable')
      },
    })
    await makeModule().apply(ctx)
    assert.ok(events.includes('register:dsh-novel-beat-mode'))
    assert.ok(errors.some((line) => line.includes('remote mount 失败')))
  } finally {
    console.error = original
  }
})

test('client registers the right sidebar tab, body and header entry when the seat exists', async () => {
  const handle = makeContext()
  const tabTypes = []
  const scopedSlots = []
  const events = []
  const scoped = {
    get(name) {
      if (name === 'sidebarRightTabs') {
        return {
          register(definition) {
            tabTypes.push(definition)
            return () => events.push('tab-dispose')
          },
        }
      }
      if (name === 'sidebarRight') {
        return { openTab(kind) { events.push(`openTab:${kind}`) } }
      }
      return undefined
    },
    effect(fn) { return fn() },
    slots: {
      inject(owner, fn) {
        events.push(`scoped-inject:${owner}`)
        return fn()
      },
      register(options, component) {
        scopedSlots.push({ options, component })
        return {}
      },
    },
  }
  handle.ctx.inject = (names, fn) => {
    events.push(`inject:${names.join(',')}`)
    return fn(scoped)
  }
  await makeModule().apply(handle.ctx)

  assert.deepEqual(tabTypes.map((entry) => [entry.id, entry.kind]), [
    ['dsh-novel-beat-panel', 'novel-beat'],
  ])
  const body = scopedSlots.find((entry) => entry.options.name === 'sidebar.right.pane.tab')
  assert.ok(body, '右栏 tab body 未注册')
  assert.equal(body.options.key, 'dsh-novel-beat-panel')
  const injected = body.options.inject('session-1')
  assert.equal(injected.sessionId, 'session-1')
  assert.equal(typeof injected.remote.overview, 'function')

  const tree = body.component({ sessionId: 'session-1', remote: handle.service })
  assert.equal(tree.type, 'div')
  assert.equal(tree.props.className, 'beat-root')

  const header = scopedSlots.find((entry) => entry.options.id === 'dsh-novel-beat-open')
  assert.ok(header, '会话头入口未注册')
  header.options.inject().open()
  assert.ok(events.includes('openTab:novel-beat'))
  const button = header.component({ open: () => events.push('header-click') })
  assert.equal(button.type, 'button')
  button.props.onClick()
  assert.ok(events.includes('header-click'))
})

function virtualText(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(virtualText).join(' ')
  return virtualText(node.children)
}

function virtualNodes(node, predicate = () => true, found = []) {
  if (node === null || node === undefined) return found
  if (Array.isArray(node)) {
    for (const child of node) virtualNodes(child, predicate, found)
    return found
  }
  if (typeof node !== 'object') return found
  if (predicate(node)) found.push(node)
  virtualNodes(node.children, predicate, found)
  return found
}

test('决策详情显示 gate 前后值、打断理由、失效证据和六要素，隔离时禁回退', () => {
  const components = makeModule().__test
  assert.ok(components, '测试组件未暴露')
  const detail = components.BeatDecisionDetail({
    decision: {
      id: 'b12-1', seq: 1, title: '秘密由谁知道', change: '决定秘密是否公开', kind: '知情', status: 'proposed',
      gate: {
        entity: 'person:hero', entityLabel: '主角', key: 'identity.exposure', keyLabel: '身份暴露',
        from: 'unknown', fromLabel: '无人知晓', to: 'disclose', toLabel: '公开',
        reason: '此处不问就会替作者决定秘密由谁知晓。', evidence: [{ kind: 'body', file: '正文/第12章.md', offsetStart: 10, offsetEnd: 18, quote: '第二武魂', hash: 'a'.repeat(64) }],
      },
      evidenceStatus: { valid: false, status: 'invalid', code: 'stale-evidence', message: '正文 hash 已改变' },
      chosen: null,
      options: [{
        label: '暂缓', action: '先不说明', costs: ['独自承担压力'], outcomes: [{ text: '保持秘密' }],
        informationGain: [{ text: '观察室友是否守约' }], risks: [{ text: '疑心可能累积' }],
        changes: [{ entity: 'person:hero', key: 'identity.exposure', from: 'unknown', fromLabel: '无人知晓', to: 'private', toLabel: '继续保密' }],
        styleFit: { score: 80, explanation: '贴近克制表达；仅建议。' },
      }],
      canRevert: true, revert: null, segment: { id: 's-12-1', chars: 80, offsetStart: 1, offsetEnd: 81 },
    },
    chapter: 12, total: 1, on: true, transactionBlocked: true,
  })
  const text = virtualText(detail)
  for (const expected of ['命中：主角 / identity.exposure', '无人知晓 (unknown) → 公开 (disclose)', '打断理由：此处不问', '证据已失效，禁止拍板', '动作：先不说明', '代价：独自承担压力', '预期后果：保持秘密', '信息增量：观察室友是否守约', '风险：疑心可能累积', '状态差分：person:hero.identity.exposure', '贴合 80/100']) {
    assert.ok(text.includes(expected), `missing UI text: ${expected}`)
  }
  const buttons = virtualNodes(detail, (node) => node.type === 'button')
  assert.equal(buttons.find((node) => node.children.includes('回到这里重写'))?.props.disabled, true)
  const stale = components.BeatDecisionDetail({
    decision: { id: 'b12-stale', seq: 1, title: '失效证据', change: '', status: 'committed',
      evidenceStatus: { valid: false, status: 'invalid', code: 'stale-evidence', message: '正文已变' },
      canRevert: true, revert: {}, options: [], chosen: {} },
    chapter: 12, total: 1, on: true, transactionBlocked: false,
  })
  assert.ok(virtualNodes(stale, (node) => node.type === 'button'
    && ['回到这里重写', '改选另一个走向'].includes(node.children[0]))
    .every((node) => node.props.disabled), '失效证据必须同时禁用回退和改选')
})

test('决策详情支持 Escape、Tab 环绕、Shift+Tab 和关闭后回到触发卡片', () => {
  const effects = []
  const { BeatDecisionDetail } = makeModule({ onEffect: (effect) => effects.push(effect) }).__test
  let closed = 0
  let focused = null
  let prevented = false
  let stopped = false
  let actionCount = 0
  const trigger = { focus: () => { focused = 'trigger' } }
  const returnFocusRef = { current: trigger }
  const decision = {
    id: 'b12-1', seq: 1, title: '秘密由谁知道', change: '决定秘密是否公开', kind: '知情', status: 'committed',
    gate: { evidence: [{ file: '正文/第12章.md', offsetStart: 10, offsetEnd: 18, quote: '第二武魂', hash: 'a'.repeat(64) }] },
    chosen: null, canRevert: true, revert: { segments: 1, chars: 80, canonEntries: 0, decisionIds: ['b12-1'] },
    segment: { id: 's-12-1', chars: 80, offsetStart: 1, offsetEnd: 81 },
    options: [{ label: '暂缓', action: '先不说明', costs: [], outcomes: [], informationGain: [], risks: [], changes: [] }],
  }
  const tree = BeatDecisionDetail({
    decision, chapter: 12, total: 1, returnFocusRef, onClose: () => { closed += 1 },
    onRewrite: () => { actionCount += 1 }, onChoose: () => { actionCount += 1 }, on: true,
  })
  const [dialog] = virtualNodes(tree, (node) => node.props?.role === 'dialog')
  assert.equal(dialog.props['aria-modal'], 'true')
  assert.equal(dialog.props['aria-labelledby'], 'beat-detail-title')
  const order = virtualNodes(dialog, (node) => node.type === 'button' || node.type === 'summary' || node.props?.tabIndex === 0)
  assert.deepEqual(order.map((node) => node.type), ['button', 'summary', 'div', 'button', 'button'])
  assert.ok(order.filter((node) => node.type === 'button').every((node) => node.props.type === 'button'))
  assert.equal(order[2].props.tabIndex, 0, '详情选项应可通过 Tab 到达')

  const focusables = ['close', 'summary', 'option', 'rewrite', 'choose'].map((name) => ({
    name,
    focus: () => { focused = name },
  }))
  const dialogElement = { focus: () => { focused = 'dialog' }, querySelectorAll: () => focusables }
  dialog.props.ref.current = dialogElement
  effects[0]()
  assert.equal(focused, 'dialog', '打开详情后焦点进入对话框')
  dialog.props.onKeyDown({
    key: 'Tab', shiftKey: false, target: dialogElement, currentTarget: dialogElement,
    preventDefault: () => { prevented = true },
  })
  assert.equal(prevented, true)
  assert.equal(focused, 'close', '从对话框开始 Tab 进入第一个控件')
  prevented = false
  dialog.props.onKeyDown({
    key: 'Tab', shiftKey: true, target: focusables[0], currentTarget: dialogElement,
    preventDefault: () => { prevented = true },
  })
  assert.equal(prevented, true)
  assert.equal(focused, 'choose', 'Shift+Tab 从第一个控件环绕到最后一个')
  prevented = false
  dialog.props.onKeyDown({
    key: 'Tab', shiftKey: false, target: focusables[4], currentTarget: dialogElement,
    preventDefault: () => { prevented = true },
  })
  assert.equal(prevented, true)
  assert.equal(focused, 'close', 'Tab 从最后一个控件环绕到第一个')
  dialog.props.onKeyDown({
    key: 'Escape', target: focusables[1], currentTarget: dialogElement,
    preventDefault: () => { prevented = true }, stopPropagation: () => { stopped = true },
  })
  assert.equal(closed, 1)
  assert.equal(focused, 'trigger', 'Escape 关闭后焦点回到打开详情的决策卡')
  assert.equal(stopped, true)
  assert.equal(actionCount, 0, 'Escape 只关闭展示层，不触发回退或改选')
})

test('回退 sheet 显示版本/hash/成对快照；Enter/Space 原生按钮可达，冲突可刷新，隔离禁重复回退', () => {
  const effects = []
  const { BeatRewindSheet } = makeModule({ onEffect: (effect) => effects.push(effect) }).__test
  let closed = false
  let refreshed = false
  let confirmed = 0
  const decision = { id: 'b12-1', chapter: 12, title: '秘密', segment: { revisionId: 'r-18' }, options: [] }
  const base = {
    decision, mode: 'keep', choice: 'keep', busy: false,
    plan: {
      expectedRevision: 48, expectedBodyHash: 'b'.repeat(64), expectedLedgerHash: 'c'.repeat(64),
      removedChars: 123, segments: [{ id: 's-12-1', chars: 123 }], canon: [], laterChapters: [13], reopened: [],
      cutAt: 80, warnings: [],
    },
    transactionStatus: { blocked: false, latest: { txId: 'tx-preview', stage: 'committed', staleStatus: 'pending', staleChapters: [13], briefStatus: 'complete', snapshots: { body: { verified: true }, ledger: { verified: true } } } },
  }
  const tree = BeatRewindSheet({
    sheet: base, decision, onClose: () => { closed = true }, onSelect() {}, onConfirm: () => { confirmed += 1 }, onToggleSnapshot() {},
    onRefreshPlan: () => { refreshed = true }, onRefreshStatus() {},
  })
  const text = virtualText(tree)
  for (const expected of ['事务 ID：tx-preview', '账本 revision：48 → 49', 'SHA-256', '正文 hash 已校验', '账本 hash 已校验', '第 13 章只加标记']) {
    assert.ok(text.includes(expected), `missing sheet text: ${expected}`)
  }
  const [confirm] = virtualNodes(tree, (node) => node.type === 'button' && node.children.includes('确认回退'))
  assert.equal(confirm.props.disabled, false)
  assert.equal(confirm.props.type, 'button', '原生按钮可由浏览器通过 Enter/Space 激活')
  assert.equal(typeof confirm.props.onClick, 'function')
  const [dialog] = virtualNodes(tree, (node) => node.props?.role === 'dialog')
  assert.equal(dialog.props['aria-modal'], 'true')
  assert.equal(dialog.props['aria-labelledby'], 'beat-sheet-title')
  let focused = null
  let prevented = false
  const first = { focus: () => { focused = 'first' } }
  const last = { focus: () => { focused = 'last' } }
  const dialogElement = { focus: () => { focused = 'dialog' }, querySelectorAll: () => [] }
  dialog.props.ref.current = dialogElement
  effects[0]()
  assert.equal(focused, 'dialog', '弹层打开时焦点先进入对话框，即使取消按钮还禁用')
  focused = null
  dialog.props.onKeyDown({
    key: 'Tab', shiftKey: false, target: dialogElement, currentTarget: dialogElement,
    preventDefault: () => { prevented = true },
  })
  assert.equal(prevented, true)
  assert.equal(focused, 'dialog', '加载中没有可用按钮时焦点仍留在弹层')
  prevented = false
  dialog.props.onKeyDown({
    key: 'Tab', shiftKey: false, target: last, currentTarget: { querySelectorAll: () => [first, last] },
    preventDefault: () => { prevented = true },
  })
  assert.equal(prevented, true)
  assert.equal(focused, 'first')
  prevented = false
  dialog.props.onKeyDown({
    key: 'Tab', shiftKey: true, target: first, currentTarget: { querySelectorAll: () => [first, last] },
    preventDefault: () => { prevented = true },
  })
  assert.equal(prevented, true)
  assert.equal(focused, 'last')
  dialog.props.onKeyDown({ key: 'Escape', preventDefault() {} })
  assert.equal(closed, true)
  confirm.props.onClick()
  assert.equal(confirmed, 1, '确认按钮触发组件回调')

  let closedWhileLoading = false
  const pending = BeatRewindSheet({
    sheet: { ...base, busy: true, plan: null }, decision,
    onClose: () => { closedWhileLoading = true }, onSelect() {}, onConfirm() {}, onToggleSnapshot() {},
    onRefreshPlan() {}, onRefreshStatus() {},
  })
  const [pendingDialog] = virtualNodes(pending, (node) => node.props?.role === 'dialog')
  pendingDialog.props.onKeyDown({ key: 'Escape', preventDefault() {} })
  assert.equal(closedWhileLoading, true, '加载中 Escape 仍只关闭 sheet')

  const conflicted = BeatRewindSheet({
    sheet: { ...base, plan: null, errorCode: 'body-hash-conflict', error: '正文已变化' },
    decision, onClose() {}, onSelect() {}, onConfirm() {}, onToggleSnapshot() {},
    onRefreshPlan: () => { refreshed = true }, onRefreshStatus() {},
  })
  const retry = virtualNodes(conflicted, (node) => node.type === 'button' && node.children.includes('刷新影响预览'))[0]
  retry.props.onClick()
  assert.equal(refreshed, true)
  const invalidEvidence = BeatRewindSheet({
    sheet: { ...base, errorCode: 'stale-evidence', error: 'EvidenceRef hash 不匹配' },
    decision, onClose() {}, onSelect() {}, onConfirm() {}, onToggleSnapshot() {}, onRefreshPlan() {}, onRefreshStatus() {},
  })
  assert.ok(virtualText(invalidEvidence).includes('证据已失效，不能回退或改选。'))
  const quarantined = BeatRewindSheet({
    sheet: { ...base, transactionStatus: { blocked: true }, blocked: true },
    decision, onClose() {}, onSelect() {}, onConfirm() {}, onToggleSnapshot() {}, onRefreshPlan() {}, onRefreshStatus() {},
  })
  const [blockedConfirm] = virtualNodes(quarantined, (node) => node.type === 'button' && node.props?.['data-danger'] === '1')
  assert.equal(blockedConfirm.props.disabled, true)
  assert.equal(refreshed, true)
})
