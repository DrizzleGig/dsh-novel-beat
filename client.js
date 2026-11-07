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
      },
    }
  },
})
