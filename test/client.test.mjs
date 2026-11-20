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
await import('../client.js')

const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useEffect: () => {},
}

function makeModule() {
  return captured.factory((name) => {
    if (name === 'react') return fakeReact
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
