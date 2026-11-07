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
  const service = {
    status: async () => ({ ok: true, value: { on: false } }),
    setMode: async (_id, on) => ({ ok: true, value: { on } }),
  }
  const cleanups = []
  let registration = null
  const ctx = {
    remote: {
      $mount: async (contract) => {
        events.push('mount')
        if (mount) return mount(contract)
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
        registration = { options, component }
        return registration
      },
    },
  }
  return { ctx, events, service, cleanups, get registration() { return registration } }
}

test('client mounts the remote, reads remote.beatMode and registers the button', async () => {
  const handle = makeContext()
  const { ctx, events, cleanups } = handle
  const mod = makeModule()
  await mod.apply(ctx)

  assert.deepEqual(events.slice(0, 3), ['mount', 'get:remote.beatMode', 'inject:conversation.input.left'])
  assert.equal(handle.registration.options.id, 'dsh-novel-beat-mode')
  assert.equal(handle.registration.options.name, 'conversation.input.left')
  assert.equal(typeof handle.registration.component, 'function')

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
