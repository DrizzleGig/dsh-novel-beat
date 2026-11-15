window.__ModuleLoader__.load({
  id: 'dsh-novel-beat',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // Keep this contract in sync with lib/remote-contract.js. It is duplicated
    // because this browser factory cannot import a relative Host module.
    function scalar(validate) {
      return {
        parse(value) {
          validate(value)
          return value
        },
        safeParse(value) {
          try {
            validate(value)
            return { success: true, data: value }
          } catch (error) {
            return { success: false, error }
          }
        },
      }
    }
    const sessionIdSchema = scalar((value) => {
      if (typeof value !== 'string' || value.length === 0) throw new Error('sessionId must be a non-empty string')
    })
    const booleanSchema = scalar((value) => {
      if (typeof value !== 'boolean') throw new Error('on must be a boolean')
    })
    const modeResultSchema = scalar((value) => {
      if (!value || typeof value.on !== 'boolean') throw new Error('result must be { on: boolean }')
    })
    const panelResultSchema = scalar((value) => {
      if (!value || typeof value.on !== 'boolean' || typeof value.text !== 'string') throw new Error('result must be { on, text }')
    })
    const actionResultSchema = scalar((value) => {
      if (!value || typeof value.ok !== 'boolean' || typeof value.text !== 'string') throw new Error('result must be { ok, text }')
    })
    const codec = (typeSymbol, schema) => ({ mode: 'strict', typeSymbol, create: () => schema })
    const param = (name, schema) => ({ name, wire: name, source: 'json', codec: codec(name, schema) })
    const TYPERT_REMOTE = {
      package: 'dsh-novel-beat',
      descriptors: [
        {
          id: 'dsh-novel-beat#beatMode/status', namespace: 'beatMode', service: 'beatMode', method: 'status',
          invocation: { kind: 'direct' }, parameters: [param('sessionId', sessionIdSchema)],
          result: codec('BeatMode', modeResultSchema),
        },
        {
          id: 'dsh-novel-beat#beatMode/setMode', namespace: 'beatMode', service: 'beatMode', method: 'setMode',
          invocation: { kind: 'direct' }, parameters: [param('sessionId', sessionIdSchema), param('on', booleanSchema)],
          result: codec('BeatMode', modeResultSchema),
        },
        {
          id: 'dsh-novel-beat#beatMode/panel', namespace: 'beatMode', service: 'beatMode', method: 'panel',
          invocation: { kind: 'direct' }, parameters: [param('sessionId', sessionIdSchema)],
          result: codec('BeatPanel', panelResultSchema),
        },
        {
          id: 'dsh-novel-beat#beatMode/revertLast', namespace: 'beatMode', service: 'beatMode', method: 'revertLast',
          invocation: { kind: 'direct' }, parameters: [param('sessionId', sessionIdSchema)],
          result: codec('BeatAction', actionResultSchema),
        },
      ],
    }

    function sessionIdOf(value) {
      if (typeof value === 'string') return value
      if (!value) return null
      return value.id ?? value.sessionId ?? String(value)
    }

    function BeatModeButton({ sessionId, remote }) {
      const sid = sessionIdOf(sessionId)
      const [state, setState] = React.useState({ on: null, busy: false, error: null })
      const busyRef = React.useRef(false)
      const seq = React.useRef(0)
      const lastSid = React.useRef(null)

      const call = async (action) => {
        if (!sid) throw new Error('拿不到当前会话')
        if (!remote || typeof remote[action === 'status' ? 'status' : 'setMode'] !== 'function') {
          throw new Error('remote 未就绪')
        }
        const result = action === 'status'
          ? await remote.status(sid)
          : await remote.setMode(sid, action === 'on')
        if (result && result.ok === false) {
          throw new Error(result.error?.message ?? 'remote 调用失败')
        }
        const value = result && result.ok === true ? result.value : result
        if (!value || typeof value.on !== 'boolean') throw new Error('remote 回执缺 on')
        return value.on
      }

      const run = async (action, silent) => {
        if (busyRef.current) return
        const my = ++seq.current
        if (!silent) {
          busyRef.current = true
          setState((prev) => ({ ...prev, busy: true, error: null }))
        }
        const reset = setTimeout(() => {
          if (my !== seq.current) return
          busyRef.current = false
          setState((prev) => silent
            ? { ...prev, busy: false }
            : { ...prev, busy: false, error: prev.error ?? '命令超时' })
        }, 2500)
        try {
          const on = await call(action)
          if (my !== seq.current) return
          busyRef.current = false
          setState({ on, busy: false, error: null })
        } catch (error) {
          if (my !== seq.current) return
          busyRef.current = false
          const message = String(error?.message ?? error)
          if (!silent) console.error('[novel-beat] 切换失败', message)
          setState((prev) => silent
            ? { ...prev, busy: false, error: null }
            : { ...prev, busy: false, error: message })
        } finally {
          clearTimeout(reset)
        }
      }

      React.useEffect(() => {
        if (!sid || lastSid.current === sid) return
        lastSid.current = sid
        run('status', true)
      }, [sid])

      const short = state.error ? String(state.error).slice(0, 6) : ''
      const label = state.on === true
        ? '拍板：开'
        : state.on === false
          ? '拍板：关'
          : state.error
            ? `拍板！${short}`
            : '拍板'
      const style = {
        height: 24,
        marginRight: 6,
        padding: '0 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.35))',
        background: state.on ? 'var(--dsw-alias-bg-accent, #2563eb)' : 'transparent',
        color: state.on ? 'var(--dsw-alias-text-on-accent, #fff)' : 'var(--dsw-alias-text-secondary, inherit)',
        fontSize: 12,
        lineHeight: '22px',
        cursor: 'pointer',
        opacity: state.busy ? 0.65 : 1,
      }

      return h('button', {
        type: 'button',
        style,
        title: state.error ?? '切换拍板模式（/beat on | /beat off）',
        'aria-pressed': state.on === true,
        'aria-busy': state.busy,
        'aria-label': state.error ? `${label}：${state.error}` : label,
        onClick: () => {
          if (busyRef.current) return
          run(state.on ? 'off' : 'on', false)
        },
      }, state.busy ? '…' : label)
    }

    function BeatSegmentBar({ sessionId, remote }) {
      const sid = sessionIdOf(sessionId)
      const [state, setState] = React.useState({ on: false, text: '', busy: false, error: null, notice: null })
      const seq = React.useRef(0)

      const load = async () => {
        if (!sid || !remote) return
        const my = ++seq.current
        try {
          const result = await remote.panel(sid)
          if (my !== seq.current) return
          const value = result && result.ok === true ? result.value : result
          if (!value || typeof value.on !== 'boolean') return
          setState((prev) => ({
            on: value.on === true,
            text: String(value.text ?? ''),
            busy: false,
            error: null,
            notice: prev.notice,
          }))
        } catch (error) {
          if (my !== seq.current) return
          setState((prev) => ({ ...prev, busy: false, error: String(error?.message ?? error) }))
        }
      }

      React.useEffect(() => {
        load()
      }, [sid])

      const revert = async () => {
        if (!sid || !remote || state.busy) return
        setState((prev) => ({ ...prev, busy: true, error: null, notice: null }))
        try {
          const result = await remote.revertLast(sid)
          const value = result && result.ok === true ? result.value : result
          const text = String(value?.text ?? '')
          setState((prev) => ({
            ...prev,
            busy: false,
            notice: value && value.ok === true ? text : null,
            error: value && value.ok === true ? null : text || '回退失败',
          }))
          await load()
        } catch (error) {
          setState((prev) => ({ ...prev, busy: false, error: String(error?.message ?? error) }))
        }
      }

      if (!state.on || !state.text) return null

      const base = {
        height: 22,
        padding: '0 8px',
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-secondary, rgba(127,127,127,.35))',
        background: 'transparent',
        color: 'var(--dsw-alias-text-secondary, inherit)',
        fontSize: 12,
        lineHeight: '20px',
        cursor: 'pointer',
      }
      return h('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 2px 6px',
          fontSize: 12,
          color: 'var(--dsw-alias-text-secondary, inherit)',
        },
      }, [
        h('span', { key: 'text', style: { flex: '1 1 auto' } }, state.text),
        h('button', {
          key: 'revert',
          type: 'button',
          style: { ...base, opacity: state.busy ? 0.65 : 1 },
          title: '把最后一段正文退掉重写（等同 /beat revert）',
          onClick: revert,
        }, state.busy ? '…' : '重写这一段'),
        h('button', {
          key: 'refresh',
          type: 'button',
          style: base,
          title: '刷新段落状态',
          onClick: () => load(),
        }, '刷新'),
        state.error ? h('span', { key: 'error', style: { color: 'var(--dsw-alias-text-danger, #dc2626)' } }, String(state.error).slice(0, 40)) : null,
        state.notice ? h('span', { key: 'notice', style: { color: 'var(--dsw-alias-text-accent, #2563eb)' } }, String(state.notice).slice(0, 40)) : null,
      ])
    }

    return {
      inject: ['slots', 'remote'],
      async apply(ctx) {
        let remote = null
        let dispose = null
        try {
          // $mount() is async and returns a disposer; the callable service is
          // ctx.get('remote.<service>'), exactly like PUA's remote.puaConfig.
          dispose = await ctx.remote.$mount(TYPERT_REMOTE)
          remote = ctx.get('remote.beatMode') ?? null
          if (!remote) console.error('[novel-beat] remote.beatMode 未注册')
        } catch (error) {
          console.error('[novel-beat] remote mount 失败', error)
        }
        if (typeof dispose === 'function') {
          ctx.effect(() => () => {
            try { dispose() } catch {}
          })
        }
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
          { name: 'conversation.input.left', id: 'dsh-novel-beat-mode', order: 20, label: '拍板' },
          (props) => h(BeatModeButton, {
            sessionId: props?.sessionId ?? props?.session?.sessionId,
            remote,
          }),
        ))
        ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
          { name: 'conversation.input.dock', id: 'dsh-novel-beat-segments', order: 40, label: '拍板台' },
          (props) => h(BeatSegmentBar, {
            sessionId: props?.sessionId ?? props?.session?.sessionId,
            remote,
          }),
        ))
      },
    }
  },
})
