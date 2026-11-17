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
    const objectResultSchema = scalar((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('result must be an object')
    })
    const chapterSchema = scalar((value) => {
      if (!Number.isInteger(value) || value < 1 || value > 9999) throw new Error('chapter must be an integer from 1 to 9999')
    })
    const decisionIdSchema = scalar((value) => {
      if (typeof value !== 'string' || value.length === 0 || value.length > 64) throw new Error('decisionId must be a non-empty string, at most 64 characters')
    })
    const jsonObjectSchema = scalar((value) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a JSON object')
    })
    const resumeTextSchema = scalar((value) => {
      if (typeof value !== 'string' || value.length === 0 || value.length > 500) throw new Error('resume text must be a non-empty string, at most 500 characters')
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
        {
          id: 'dsh-novel-beat#beatMode/overview', namespace: 'beatMode', service: 'beatMode', method: 'overview',
          invocation: { kind: 'direct' }, parameters: [param('sessionId', sessionIdSchema)],
          result: codec('BeatPanel', objectResultSchema),
        },
        {
          id: 'dsh-novel-beat#beatMode/chapter', namespace: 'beatMode', service: 'beatMode', method: 'chapter',
          invocation: { kind: 'direct' }, parameters: [param('sessionId', sessionIdSchema), param('chapter', chapterSchema)],
          result: codec('BeatPanel', objectResultSchema),
        },
        {
          id: 'dsh-novel-beat#beatMode/impact', namespace: 'beatMode', service: 'beatMode', method: 'impact',
          invocation: { kind: 'direct' }, parameters: [param('sessionId', sessionIdSchema), param('decisionId', decisionIdSchema), param('options', jsonObjectSchema)],
          result: codec('BeatPanel', objectResultSchema),
        },
        {
          id: 'dsh-novel-beat#beatMode/rewind', namespace: 'beatMode', service: 'beatMode', method: 'rewind',
          invocation: { kind: 'direct' }, parameters: [param('sessionId', sessionIdSchema), param('decisionId', decisionIdSchema), param('options', jsonObjectSchema)],
          result: codec('BeatPanel', objectResultSchema),
        },
        {
          id: 'dsh-novel-beat#beatMode/resume', namespace: 'beatMode', service: 'beatMode', method: 'resume',
          invocation: { kind: 'direct' }, parameters: [param('sessionId', sessionIdSchema), param('text', resumeTextSchema)],
          result: codec('BeatPanel', objectResultSchema),
        },
        {
          id: 'dsh-novel-beat#beatMode/oldLine', namespace: 'beatMode', service: 'beatMode', method: 'oldLine',
          invocation: { kind: 'direct' }, parameters: [param('sessionId', sessionIdSchema), param('decisionId', decisionIdSchema)],
          result: codec('BeatPanel', objectResultSchema),
        },
      ],
    }

    function sessionIdOf(value) {
      if (typeof value === 'string') return value
      if (!value) return null
      return value.id ?? value.sessionId ?? String(value)
    }

    function unwrap(result) {
      if (result && result.ok === false) {
        throw new Error(result.error?.message ?? result.message ?? 'remote 调用失败')
      }
      return result && result.ok === true ? result.value : result
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
        border: '1px solid var(--beat-line)',
        background: state.on ? 'var(--beat-brand)' : 'transparent',
        color: state.on ? 'var(--beat-on-accent)' : 'var(--beat-muted)',
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
        border: '1px solid var(--beat-line)',
        background: 'transparent',
        color: 'var(--beat-muted)',
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
          color: 'var(--beat-muted)',
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
        state.error ? h('span', { key: 'error', style: { color: 'var(--beat-danger-ink)' } }, String(state.error).slice(0, 40)) : null,
        state.notice ? h('span', { key: 'notice', style: { color: 'var(--beat-brand-ink)' } }, String(state.notice).slice(0, 40)) : null,
      ])
    }

    const BEAT_PANEL_CSS = `
.beat-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--beat-text);font-size:13px;line-height:1.55;background:transparent;position:relative}
.beat-root *{box-sizing:border-box}
.beat-head{padding:10px 12px 8px;flex:none;border-bottom:1px solid var(--beat-line);position:relative}
.beat-head:before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:var(--beat-grad);opacity:.95}
.beat-top{display:flex;align-items:center;gap:6px;min-width:0}
.beat-tab{display:inline-flex;align-items:center;gap:5px;height:21px;padding:0 7px;border-radius:6px;border:1px solid var(--beat-brand-line);background:linear-gradient(135deg,rgba(125,149,251,.2),rgba(167,139,250,.12));color:var(--beat-brand-ink);font-size:11px;white-space:nowrap;box-shadow:0 0 0 1px rgba(167,139,250,.06) inset}
.beat-spacer{flex:1;min-width:0}
.beat-icon{width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--beat-faint);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0}
.beat-icon:hover{background:var(--beat-layer1);color:var(--beat-text)}
.beat-book{font-size:13.5px;font-weight:600;margin-top:7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.beat-sub{display:flex;align-items:center;gap:6px;margin-top:2px;color:var(--beat-faint);font-size:10.5px;white-space:nowrap;overflow:hidden}
.beat-mode{display:inline-flex;align-items:center;gap:4px;font-size:10px}
.beat-mode i{width:5px;height:5px;border-radius:50%;display:block;background:var(--beat-ok)}
.beat-mode[data-on="0"]{color:var(--beat-warn-ink)}
.beat-mode[data-on="0"] i{background:var(--beat-warn)}
.beat-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin-top:8px;border:1px solid var(--beat-line);border-radius:8px;overflow:hidden;background:var(--beat-line)}
.beat-stat{background:var(--beat-page);padding:4px 7px;min-width:0;box-shadow:inset 0 2px 0 var(--beat-tone,transparent)}
.beat-stat b{display:block;font-family:var(--beat-mono);font-size:13px;font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--beat-tone-text,var(--beat-text))}
.beat-stat span{display:block;color:var(--beat-faint);font-size:10px;margin-top:1px;white-space:nowrap}
.beat-filters{display:flex;align-items:center;gap:4px;padding:7px 12px;flex:none;border-bottom:1px solid var(--beat-line)}
.beat-chip{height:22px;padding:0 7px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--beat-muted);font-size:10.5px;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer}
.beat-chip:hover{background:var(--beat-layer1);color:var(--beat-text)}
.beat-chip[data-a="1"]{background:linear-gradient(135deg,rgba(125,149,251,.2),rgba(167,139,250,.1));border-color:var(--beat-brand-line);color:var(--beat-text);box-shadow:inset 0 -2px 0 var(--beat-brand)}
.beat-chip b{font-family:var(--beat-mono);font-weight:500;color:var(--beat-faint);font-size:9.5px}
.beat-banner{display:flex;align-items:center;gap:6px;margin:8px 12px 0;padding:6px 8px;border-radius:6px;border:1px solid var(--beat-warn-line);background:var(--beat-warn-soft);color:var(--beat-warn-ink);font-size:10px;line-height:1.4}
.beat-list{flex:1;min-height:0;overflow:auto;padding:2px 0 8px}
.beat-chap{display:flex;align-items:center;gap:8px;width:100%;min-height:46px;padding:6px 12px;border:0;border-bottom:1px solid var(--beat-line);background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit;position:relative}
.beat-chap:before{content:"";position:absolute;left:0;top:7px;bottom:7px;width:2px;border-radius:0 2px 2px 0;background:var(--beat-tone,transparent);opacity:.9}
.beat-chap[data-tone="done"]{--beat-tone:var(--beat-ok)}
.beat-chap[data-tone="open"]{--beat-tone:var(--beat-warn)}
.beat-chap[data-tone="stale"]{--beat-tone:var(--beat-danger)}
.beat-chap[data-tone="legacy"]{--beat-tone:var(--beat-brand-2)}
.beat-chap:hover{background:var(--beat-layer1)}
.beat-chap[data-open="1"]{background:linear-gradient(90deg,rgba(125,149,251,.1),rgba(167,139,250,.03));border-bottom-color:transparent}
.beat-chap-dot{width:5px;height:5px;border-radius:50%;flex:none;background:var(--beat-faint);opacity:.55}
.beat-chap[data-tone="done"] .beat-chap-dot{background:var(--beat-ok);opacity:.95}
.beat-chap[data-tone="open"] .beat-chap-dot{background:var(--beat-warn);opacity:1}
.beat-chap[data-tone="stale"] .beat-chap-dot{background:var(--beat-danger);opacity:1}
.beat-chap[data-tone="legacy"] .beat-chap-dot{background:var(--beat-brand-2);opacity:1}
.beat-chap[data-open="1"] .beat-chap-dot{background:var(--beat-brand);opacity:1;box-shadow:0 0 0 3px var(--beat-brand-soft)}
.beat-chap-grow{flex:1;min-width:0}
.beat-chap-line{display:flex;align-items:baseline;gap:6px;min-width:0}
.beat-chap-no{font-family:var(--beat-mono);font-size:10.5px;color:var(--beat-faint);white-space:nowrap}
.beat-chap-name{font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.beat-chap-meta{display:flex;align-items:center;gap:5px;margin-top:2px;color:var(--beat-faint);font-size:10.5px;white-space:nowrap;overflow:hidden}
.beat-chap-meta b{font-family:var(--beat-mono);font-weight:500;color:var(--beat-muted)}
.beat-chap-right{display:flex;align-items:center;gap:6px;flex:none}
.beat-badge{height:17px;padding:0 5px;border-radius:4px;display:inline-flex;align-items:center;font-size:9.5px;white-space:nowrap;border:1px solid transparent}
.beat-badge.ok{color:var(--beat-ok-ink);background:var(--beat-ok-soft);border-color:var(--beat-ok-line)}
.beat-badge.warn{color:var(--beat-warn-ink);background:var(--beat-warn-soft);border-color:var(--beat-warn-line)}
.beat-badge.muted{color:var(--beat-muted);background:var(--beat-layer1);border-color:var(--beat-line)}
.beat-chev{width:13px;height:13px;color:var(--beat-faint);flex:none;transition:transform .15s}
.beat-chap[data-open="1"] .beat-chev{transform:rotate(90deg);color:var(--beat-muted)}
.beat-decs{padding:0 6px 5px 22px;border-bottom:1px solid var(--beat-line);position:relative}
.beat-decs:before{content:"";position:absolute;left:17px;top:2px;bottom:9px;width:1px;background:var(--beat-line)}
.beat-dec{position:relative;display:flex;gap:8px;padding:6px 7px 6px 9px;border-radius:6px;min-height:48px}
.beat-dec:hover{background:var(--beat-layer1)}
.beat-dec:before{content:"";position:absolute;left:-5px;top:14px;width:6px;height:6px;border-radius:50%;background:var(--beat-faint);opacity:.55;box-shadow:0 0 0 3px var(--beat-page,#111214)}
.beat-dec[data-state="committed"]:before{background:var(--beat-ok);opacity:1}
.beat-dec[data-state="open"]:before{background:var(--beat-warn);opacity:1}
.beat-dec-grow{flex:1;min-width:0}
.beat-dec-title{font-size:12px;line-height:1.35;color:var(--beat-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.beat-dec-choice{font-size:11px;color:var(--beat-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.beat-dec-choice[data-empty="1"]{color:var(--beat-faint)}
.beat-dec-meta{display:flex;align-items:center;gap:5px;margin-top:3px;color:var(--beat-faint);font-size:9.5px;font-family:var(--beat-mono);white-space:nowrap;overflow:hidden}
.beat-dec-meta .sep{opacity:.45}
.beat-kind{height:16px;padding:0 4px;border-radius:3px;border:1px solid color-mix(in srgb,var(--beat-kind,var(--beat-brand)) 36%,transparent);background:color-mix(in srgb,var(--beat-kind,var(--beat-brand)) 12%,transparent);color:color-mix(in srgb,var(--beat-kind,var(--beat-brand)) 55%,var(--beat-text));font:8.5px/14px var(--beat-mono);white-space:nowrap}
.beat-dec-right{display:flex;align-items:flex-start;padding-top:2px;flex:none}
.beat-dec-badge{height:17px;padding:0 5px;border-radius:4px;display:inline-flex;align-items:center;font-size:9.5px;border:1px solid var(--beat-line);color:var(--beat-muted);background:var(--beat-layer1);white-space:nowrap}
.beat-dec[data-a="1"]{background:var(--beat-brand-soft);box-shadow:inset 0 0 0 1px var(--beat-brand-line)}
.beat-detail{margin:2px 7px 9px 9px;border:1px solid var(--beat-brand-line);border-left:3px solid var(--beat-kind,var(--beat-brand));border-radius:8px;background:linear-gradient(160deg,rgba(125,149,251,.12),rgba(167,139,250,.05) 52%,rgba(56,189,248,.04));padding:8px 9px 8px;box-shadow:0 8px 20px rgba(0,0,0,.16)}
.beat-detail-top{display:flex;align-items:center;gap:5px;color:var(--beat-faint);font-size:9.5px;font-family:var(--beat-mono)}
.beat-detail-top .beat-spacer{flex:1}
.beat-detail-close{width:18px;height:18px;border:0;border-radius:4px;background:transparent;color:var(--beat-faint);cursor:pointer;font:13px/1 var(--beat-mono);padding:0}
.beat-detail-close:hover{background:var(--beat-layer2);color:var(--beat-text)}
.beat-detail-title{font-size:12px;font-weight:600;margin-top:4px;line-height:1.35}
.beat-detail-change{font-size:10px;color:var(--beat-muted);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.beat-cur{margin-top:6px;border:1px solid var(--beat-brand-line);border-radius:6px;background:linear-gradient(135deg,rgba(125,149,251,.1),rgba(167,139,250,.04));padding:5px 7px;display:flex;align-items:center;gap:6px}
.beat-cur-mark{width:14px;height:14px;border-radius:50%;background:var(--beat-brand);color:var(--beat-on-accent);display:flex;align-items:center;justify-content:center;font-size:9px;flex:none}
.beat-cur-grow{flex:1;min-width:0}
.beat-cur-k{font-size:9px;color:var(--beat-faint)}
.beat-cur-v{font-size:10.5px;color:var(--beat-text);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.beat-cur-tag{font-size:8px;color:var(--beat-brand-ink);border:1px solid var(--beat-brand-line);background:var(--beat-brand-soft);padding:1px 4px;border-radius:3px;white-space:nowrap}
.beat-opts{margin-top:4px;display:flex;flex-direction:column;gap:1px}
.beat-opt{display:flex;align-items:flex-start;gap:6px;padding:2px 1px;border-radius:4px;color:var(--beat-muted);font-size:10px;line-height:1.4}
.beat-opt-radio{width:10px;height:10px;border-radius:50%;border:1px solid var(--beat-line);flex:none;margin-top:2px}
.beat-opt[data-cur="1"] .beat-opt-radio{border-color:var(--beat-brand);background:radial-gradient(circle at center,var(--beat-brand) 0 3px,transparent 3.5px)}
.beat-opt[data-cur="1"]{color:var(--beat-text)}
.beat-opt-label{flex:1;min-width:0}
.beat-opt-impact{color:var(--beat-faint);font-size:9.5px;margin-top:1px;line-height:1.4}
.beat-changes{display:flex;flex-wrap:wrap;gap:3px;margin-top:5px}
.beat-change{font:9px/1.45 var(--beat-mono);color:var(--beat-muted);border:1px solid var(--beat-line);background:var(--beat-layer1);border-radius:3px;padding:1px 4px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.beat-seg{margin-top:5px;color:var(--beat-faint);font-size:9.5px;font-family:var(--beat-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.beat-impact{display:flex;gap:5px;margin-top:6px;padding:5px 6px;border:1px solid var(--beat-warn-line);background:var(--beat-warn-soft);border-radius:5px;color:var(--beat-warn-ink);font-size:8.8px;line-height:1.45}
.beat-impact svg{flex:none;margin-top:1px}
.beat-blocked{margin-top:6px;padding:5px 6px;border:1px solid var(--beat-line);border-radius:5px;color:var(--beat-faint);font-size:9.5px;line-height:1.45}
.beat-detail-actions{display:flex;gap:5px;margin-top:6px}
.beat-btn{height:25px;border-radius:5px;border:1px solid var(--beat-line);background:transparent;color:var(--beat-muted);font:inherit;font-size:10px;padding:0 7px;white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:4px}
.beat-btn[data-p="1"]{flex:1;background:var(--beat-grad);border-color:transparent;color:#0c1022;font-weight:600}
.beat-btn:disabled{opacity:.5;cursor:default}
.beat-notice{display:flex;align-items:center;gap:6px;margin:8px 12px 0;padding:6px 8px;border-radius:6px;border:1px solid var(--beat-ok-line);background:var(--beat-ok-soft);color:var(--beat-ok-ink);font-size:9.5px;line-height:1.45;flex-wrap:wrap}
.beat-notice-err{width:100%;font-size:8.5px;color:var(--beat-warn-ink);line-height:1.4}
.beat-notice button{height:21px;padding:0 6px;border:1px solid var(--beat-ok-line);border-radius:4px;background:transparent;color:var(--beat-ok-ink);font:inherit;font-size:9px;cursor:pointer;white-space:nowrap}
.beat-notice .beat-spacer{flex:1}
.beat-scrim{position:absolute;inset:0;background:rgba(4,5,7,.62);z-index:5}
.beat-sheet{position:absolute;left:0;right:0;bottom:0;z-index:6;max-height:86%;overflow:auto;background:var(--beat-sheet-bg);border-top:1px solid var(--beat-line);border-radius:12px 12px 0 0;box-shadow:0 -16px 50px rgba(0,0,0,.45);padding:8px 12px 12px}
.beat-grab{width:28px;height:3px;border-radius:2px;background:var(--beat-line);margin:0 auto 9px}
.beat-sheet h2{font-size:12.5px;margin:0;font-weight:600;line-height:1.35}
.beat-sheet-sub{color:var(--beat-faint);font-size:9.5px;margin-top:2px;font-family:var(--beat-mono)}
.beat-sheet-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:9px}
.beat-sheet-stat{border:1px solid var(--beat-line);border-radius:6px;background:var(--beat-page);padding:6px 7px;box-shadow:inset 0 2px 0 var(--beat-tone,transparent)}
.beat-sheet-stat b{display:block;font-family:var(--beat-mono);font-size:14px;line-height:1.1;color:var(--beat-tone-text,var(--beat-text))}
.beat-sheet-stat b em{font-style:normal;font-size:9px;color:var(--beat-muted);margin-left:2px;font-weight:400}
.beat-sheet-stat span{display:block;color:var(--beat-faint);font-size:9.5px;margin-top:2px}
.beat-sheet-stat[data-tone="danger"] b{color:var(--beat-danger-ink)}
.beat-sheet-stat[data-tone="warn"] b{color:var(--beat-warn-ink)}
.beat-sheet-list{margin-top:8px;border-top:1px solid var(--beat-line)}
.beat-sheet-row{display:flex;gap:7px;padding:5px 0;border-bottom:1px solid var(--beat-line)}
.beat-sheet-row:last-child{border-bottom:0}
.beat-sheet-ico{width:15px;height:15px;border-radius:4px;flex:none;background:var(--beat-layer1);display:flex;align-items:center;justify-content:center;color:var(--beat-faint);margin-top:1px;font-size:8px}
.beat-sheet-grow{flex:1;min-width:0}
.beat-sheet-k{font-size:9px;color:var(--beat-faint)}
.beat-sheet-v{font-size:10px;color:var(--beat-muted);line-height:1.45;margin-top:1px}
.beat-sheet-v .mono{font-family:var(--beat-mono);font-size:8.5px;color:var(--beat-text)}
.beat-sheet-opts{display:flex;flex-direction:column;gap:3px;margin-top:7px}
.beat-sheet-opt{display:flex;align-items:flex-start;gap:6px;padding:5px 6px;border:1px solid var(--beat-line);border-radius:5px;background:transparent;color:var(--beat-muted);font:inherit;font-size:10px;text-align:left;cursor:pointer;line-height:1.4}
.beat-sheet-opt:hover{background:var(--beat-layer1)}
.beat-sheet-opt[data-a="1"]{border-color:var(--beat-brand-line);background:var(--beat-brand-soft);color:var(--beat-text)}
.beat-sheet-opt .beat-opt-radio{margin-top:1px}
.beat-sheet-opt .beat-sheet-grow{flex:1}
.beat-sheet-opt b{display:block;font-weight:500}
.beat-sheet-opt small{display:block;color:var(--beat-faint);font-size:9.5px;margin-top:1px}
.beat-sheet-save{display:flex;gap:7px;align-items:flex-start;margin-top:8px;padding:6px 7px;border:1px solid var(--beat-ok-line);background:var(--beat-ok-soft);border-radius:5px}
.beat-sheet-check{width:13px;height:13px;border-radius:3px;background:var(--beat-ok);color:#0b1511;display:flex;align-items:center;justify-content:center;font-size:8px;flex:none;margin-top:1px;cursor:pointer;border:0;padding:0}
.beat-sheet-check[data-on="0"]{background:transparent;border:1px solid var(--beat-line);color:transparent}
.beat-sheet-save .beat-sheet-grow{flex:1}
.beat-sheet-save-t{font-size:9.5px;color:var(--beat-ok-ink)}
.beat-sheet-save-s{font-size:9px;color:var(--beat-faint);line-height:1.4;margin-top:1px}
.beat-sheet-stale{display:flex;gap:7px;align-items:flex-start;margin-top:6px;padding:6px 7px;border:1px solid var(--beat-line);background:var(--beat-layer1);border-radius:5px}
.beat-sheet-stale .beat-sheet-check[data-on="1"]{background:var(--beat-warn);color:#1a1408}
.beat-sheet-stale .beat-sheet-grow{flex:1}
.beat-sheet-stale-t{font-size:10px;color:var(--beat-muted)}
.beat-sheet-stale-s{font-size:9px;color:var(--beat-faint);line-height:1.4;margin-top:1px}
.beat-sheet-warn{display:flex;gap:6px;margin-top:7px;color:var(--beat-warn-ink);font-size:8.5px;line-height:1.45}
.beat-sheet-warn svg{flex:none;margin-top:1px}
.beat-sheet-error{margin-top:7px;padding:5px 6px;border:1px solid var(--beat-danger-line);background:var(--beat-danger-soft);border-radius:5px;color:var(--beat-danger-ink);font-size:9px;line-height:1.45}
.beat-sheet-actions{display:flex;gap:6px;margin-top:10px}
.beat-sheet-actions .beat-btn{height:30px;font-size:10.5px}
.beat-sheet-actions .beat-btn[data-p="0"]{flex:0 0 82px;background:transparent}
.beat-sheet-actions .beat-btn[data-p="1"]{flex:1;background:var(--beat-brand);border-color:var(--beat-brand);color:var(--beat-on-accent);font-weight:600}
.beat-sheet-actions .beat-btn[data-p="1"][data-danger="1"]{background:var(--beat-danger);border-color:var(--beat-danger);color:var(--beat-on-accent)}
.beat-oldline-text{margin:9px 0 0;padding:8px 9px;border:1px solid var(--beat-brand-line);border-left:3px solid var(--beat-brand);border-radius:6px;background:linear-gradient(180deg,rgba(125,149,251,.08),var(--beat-layer1) 40%);color:var(--beat-text);font-size:10.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto}
.beat-empty{padding:28px 16px;text-align:center;color:var(--beat-muted);font-size:11.5px;line-height:1.7}
.beat-empty b{display:block;color:var(--beat-text);font-size:12.5px;margin-bottom:4px}
.beat-error{margin:10px 12px;padding:9px 10px;border:1px solid var(--beat-danger-line);border-radius:7px;background:var(--beat-danger-soft);color:var(--beat-danger-ink);font-size:10.5px;line-height:1.5}
.beat-error button{margin-top:6px;height:24px;padding:0 8px;border:1px solid var(--beat-danger-line);border-radius:5px;background:transparent;color:var(--beat-danger-ink);font:inherit;font-size:10px;cursor:pointer}
.beat-skel{height:48px;margin:6px 12px;border-radius:7px;background:linear-gradient(90deg,var(--beat-layer1),var(--beat-layer2),var(--beat-layer1));background-size:200% 100%;animation:beat-pulse 1.4s ease-in-out infinite}
@keyframes beat-pulse{0%{background-position:0% 0}100%{background-position:-200% 0}}
.beat-foot{flex:none;display:flex;align-items:center;gap:6px;height:29px;padding:0 12px;border-top:1px solid var(--beat-line);color:var(--beat-faint);font-size:9.5px;font-family:var(--beat-mono)}
.beat-foot .beat-spacer{flex:1}
`

    function formatNumber(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '0'
      return number.toLocaleString('en-US')
    }

    const KIND_TONE = {
      动作: '#f59e0b',
      知情: '#38bdf8',
      关系: '#f472b6',
      得失: '#a78bfa',
      状态: '#5fae8b',
      承诺: '#eab308',
      时序: '#22d3ee',
      分叉: '#7d95fb',
    }

    function kindTone(kind) {
      return KIND_TONE[kind] ?? '#7d95fb'
    }

    function formatTime(value) {
      if (!value) return '—'
      try {
        return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      } catch {
        return String(value)
      }
    }

    function FlagIcon({ size = 11 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
        h('path', { d: 'M5 3v18M5 4h9l-1.4 4L14 12H5' }))
    }

    function RefreshIcon({ size = 12 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
        h('path', { d: 'M20 11a8 8 0 1 0-2.3 6.7' }), h('path', { d: 'M20 5v6h-6' }))
    }

    function ChevronIcon() {
      return h('svg', { className: 'beat-chev', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
        h('path', { d: 'M9 6l6 6-6 6' }))
    }

    function WarningIcon({ size = 11 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
        h('path', { d: 'M12 3l10 18H2L12 3z' }), h('path', { d: 'M12 9v5M12 17.5v.5' }))
    }

    function BeatDecisionDetail({ decision, chapter, total, onClose, onRewrite, onChoose, busy, on }) {
      const chosenLabel = decision.chosen?.label ?? ''
      const changes = decision.chosen?.changes ?? []
      const revert = decision.revert
      const later = Math.max(0, (revert?.decisionIds?.length ?? 0) - 1)
      const blocked = decision.revertBlockedReason
      const readOnly = on === false
      return h('div', { className: 'beat-detail', style: { '--beat-kind': kindTone(decision.kind) } }, [
        h('div', { className: 'beat-detail-top', key: 'top' }, [
          h('span', { key: 'k' }, `第 ${chapter} 章 · 决策 ${decision.seq}/${total}`),
          h('span', { className: 'beat-spacer', key: 'sp' }),
          h('span', { key: 's' }, decision.status === 'committed' ? '已拍板' : '待拍板'),
          h('button', { key: 'x', type: 'button', className: 'beat-detail-close', onClick: onClose, title: '关闭详情' }, '×'),
        ]),
        h('div', { className: 'beat-detail-title', key: 'title' }, decision.title),
        h('div', { className: 'beat-detail-change', key: 'change' }, `这会改变：${decision.change || '—'}`),
        h('div', { className: 'beat-cur', key: 'cur' }, [
          h('span', { className: 'beat-cur-mark', key: 'm' }, decision.chosen ? '✓' : '·'),
          h('div', { className: 'beat-cur-grow', key: 'g' }, [
            h('div', { className: 'beat-cur-k', key: 'k' }, '当前选择'),
            h('div', { className: 'beat-cur-v', key: 'v' }, chosenLabel || '还没拍板'),
          ]),
          h('span', { className: 'beat-cur-tag', key: 't' }, decision.chosen ? '已落账' : '待问'),
        ]),
        h('div', { className: 'beat-opts', key: 'opts' }, (decision.options ?? []).map((option) => h('div', {
          className: 'beat-opt',
          key: option.label,
          'data-cur': option.label === chosenLabel ? '1' : '0',
        }, [
          h('span', { className: 'beat-opt-radio', key: 'r' }),
          h('span', { className: 'beat-opt-label', key: 'l' }, [
            h('div', { key: 'label' }, option.label),
            option.impact ? h('div', { className: 'beat-opt-impact', key: 'impact' }, option.impact) : null,
          ]),
        ]))),
        changes.length > 0 ? h('div', { className: 'beat-changes', key: 'changes' }, changes.map((change) => h('span', {
          className: 'beat-change',
          key: `${change.entity}.${change.key}`,
          title: `${change.entity}.${change.key} → ${change.to}`,
        }, `${change.entity}·${change.key} → ${change.to}`))) : null,
        h('div', { className: 'beat-seg', key: 'seg' }, decision.segment
          ? `${decision.segment.id} · ${formatNumber(decision.segment.chars)} 字 · 第 ${formatNumber(decision.segment.offsetStart)}–${formatNumber(decision.segment.offsetEnd)} 字`
          : '无正文锚点'),
        revert
          ? h('div', { className: 'beat-impact', key: 'impact' }, [
            h(WarningIcon, { key: 'icon' }),
            h('span', { key: 'text' }, `回到这里：作废 ${formatNumber(revert.segments)} 段（${formatNumber(revert.chars)} 字）· 撤回 ${formatNumber(revert.canonEntries)} 条设定 · 目标重落账 · 后续 ${formatNumber(later)} 个重开`),
          ])
          : h('div', { className: 'beat-blocked', key: 'blocked' }, blocked === 'legacy'
            ? '0.6 旧账只记了选择，没有正文锚点；要改请直接改正文。'
            : blocked === 'not-committed'
              ? '这条决策还没拍板，等模型问到它再定。'
              : '这条决策还没有登记正文段落，只能查看，不能回退正文。'),
        h('div', { className: 'beat-detail-actions', key: 'actions' }, [
          h('button', {
            key: 'rewind', type: 'button', className: 'beat-btn', 'data-p': '1',
            disabled: !decision.canRevert || busy || readOnly,
            title: readOnly ? '先开启拍板' : (decision.canRevert ? '保留当前选择，回到这一段重写' : '没有正文锚点，不能回退'),
            onClick: () => onRewrite?.(decision),
          }, busy ? '处理中…' : '回到这里重写'),
          h('button', {
            key: 'choose', type: 'button', className: 'beat-btn',
            disabled: !decision.canRevert || busy || readOnly,
            title: readOnly ? '先开启拍板' : (decision.canRevert ? '选另一个走向再重写' : '没有正文锚点，不能改选'),
            onClick: () => onChoose?.(decision),
          }, '改选另一个走向'),
        ]),
      ])
    }

    function BeatRewindSheet({ sheet, decision, onClose, onSelect, onConfirm, onToggleSnapshot, onToggleStale }) {
      if (!sheet) return null
      const plan = sheet.plan
      const isChoose = sheet.mode === 'choose'
      const options = decision?.options ?? []
      const canon = plan?.canon ?? []
      const later = plan?.laterChapters ?? []
      const reopened = plan?.reopened ?? []
      const removed = plan?.removedChars ?? 0
      const segmentCount = plan?.segments?.length ?? 0
      return h('div', { className: 'beat-sheet', role: 'dialog', 'aria-modal': 'true' }, [
        h('div', { className: 'beat-grab', key: 'grab' }),
        h('h2', { key: 'title' }, isChoose ? `改选「${decision?.title ?? ''}」并重写` : `回到「${decision?.title ?? ''}」`),
        h('div', { className: 'beat-sheet-sub', key: 'sub' }, `第 ${decision?.chapter ?? '—'} 章 · ${decision?.id ?? '—'} · 正文与账本一起退`),
        plan ? h('div', { className: 'beat-sheet-stats', key: 'stats' }, [
          h('div', { className: 'beat-sheet-stat', 'data-tone': 'danger', key: 'chars', style: { '--beat-tone': 'var(--beat-danger)' } }, [
            h('b', { key: 'b' }, [formatNumber(removed), h('em', { key: 'e' }, '字')]),
            h('span', { key: 's' }, '正文将删除'),
          ]),
          h('div', { className: 'beat-sheet-stat', 'data-tone': 'warn', key: 'seg', style: { '--beat-tone': 'var(--beat-warn)' } }, [
            h('b', { key: 'b' }, [formatNumber(segmentCount), h('em', { key: 'e' }, '段')]),
            h('span', { key: 's' }, '段落作废'),
          ]),
          h('div', { className: 'beat-sheet-stat', 'data-tone': 'warn', key: 'canon', style: { '--beat-tone': 'var(--beat-brand-2)' } }, [
            h('b', { key: 'b' }, [formatNumber(canon.length), h('em', { key: 'e' }, '条')]),
            h('span', { key: 's' }, '设定撤回'),
          ]),
        ]) : h('div', { className: 'beat-skel', key: 'loading', style: { marginTop: 9 } }),
        plan ? h('div', { className: 'beat-sheet-list', key: 'list' }, [
          h('div', { className: 'beat-sheet-row', key: 'text' }, [
            h('span', { className: 'beat-sheet-ico', key: 'i' }, '文'),
            h('div', { className: 'beat-sheet-grow', key: 'g' }, [
              h('div', { className: 'beat-sheet-k', key: 'k' }, '正文'),
              h('div', { className: 'beat-sheet-v', key: 'v' }, `第 ${decision.chapter} 章截断到第 ${formatNumber(plan.cutAt)} 字；这一段和它后面的已登记段落一起作废。`),
            ]),
          ]),
          h('div', { className: 'beat-sheet-row', key: 'segs' }, [
            h('span', { className: 'beat-sheet-ico', key: 'i' }, '段'),
            h('div', { className: 'beat-sheet-grow', key: 'g' }, [
              h('div', { className: 'beat-sheet-k', key: 'k' }, '作废段落'),
              h('div', { className: 'beat-sheet-v', key: 'v' }, plan.segments.map((segment) => `${segment.id}（${formatNumber(segment.chars)} 字）`).join('、')),
            ]),
          ]),
          canon.length > 0 ? h('div', { className: 'beat-sheet-row', key: 'canon' }, [
            h('span', { className: 'beat-sheet-ico', key: 'i' }, '设'),
            h('div', { className: 'beat-sheet-grow', key: 'g' }, [
              h('div', { className: 'beat-sheet-k', key: 'k' }, '撤回 / 重写设定'),
              h('div', { className: 'beat-sheet-v', key: 'v' }, canon.slice(0, 4).map((entry) => `${entry.entity}·${entry.key}`).join('；') + (canon.length > 4 ? `；还有 ${canon.length - 4} 条` : '')),
            ]),
          ]) : null,
          reopened.length > 0 ? h('div', { className: 'beat-sheet-row', key: 'reopen' }, [
            h('span', { className: 'beat-sheet-ico', key: 'i' }, '重'),
            h('div', { className: 'beat-sheet-grow', key: 'g' }, [
              h('div', { className: 'beat-sheet-k', key: 'k' }, '后续重开'),
              h('div', { className: 'beat-sheet-v', key: 'v' }, `${reopened.map((entry) => `${entry.id} ${entry.title}`).join('、')}。目标 ${decision.id} 保留/改选后重新落账。`),
            ]),
          ]) : null,
          h('div', { className: 'beat-sheet-row', key: 'later' }, [
            h('span', { className: 'beat-sheet-ico', key: 'i' }, '后'),
            h('div', { className: 'beat-sheet-grow', key: 'g' }, [
              h('div', { className: 'beat-sheet-k', key: 'k' }, later.length > 0 ? '不受影响' : '后续章节'),
              h('div', { className: 'beat-sheet-v', key: 'v' }, later.length > 0
                ? `第 ${later.join('、')} 章正文不动；它们仍基于旧走向，需要时再逐章处理。`
                : '这本书没有更晚的章节。'),
            ]),
          ]),
        ]) : null,
        isChoose && options.length > 0 ? h('div', { className: 'beat-sheet-opts', key: 'opts' }, options.map((option) => h('button', {
          key: option.label,
          type: 'button',
          className: 'beat-sheet-opt',
          'data-a': sheet.choice === option.label ? '1' : '0',
          disabled: sheet.busy,
          onClick: () => onSelect(option.label),
        }, [
          h('span', { className: 'beat-opt-radio', key: 'r' }),
          h('span', { className: 'beat-sheet-grow', key: 'g' }, [
            h('b', { key: 'b' }, option.label),
            option.impact ? h('small', { key: 's' }, option.impact) : null,
          ]),
        ]))) : null,
        h('div', { className: 'beat-sheet-save', key: 'save' }, [
          h('button', {
            key: 'check', type: 'button', className: 'beat-sheet-check', 'data-on': sheet.snapshot ? '1' : '0',
            onClick: () => onToggleSnapshot(!sheet.snapshot), title: sheet.snapshot ? '已勾选：回退前保存旧线快照' : '未勾选：不保存旧线快照',
          }, '✓'),
          h('div', { className: 'beat-sheet-grow', key: 'g' }, [
            h('div', { className: 'beat-sheet-save-t', key: 't' }, sheet.snapshot ? '回退前保存旧线快照（推荐）' : '不回退前保存旧线快照'),
            h('div', { className: 'beat-sheet-save-s', key: 's' }, sheet.snapshot
              ? '旧正文存进 rewinds/，旧账本同时留一份；确认后仍能找回。'
              : '不存快照：正文截断后只能从 .beat-bak 或编辑器历史里找。'),
          ]),
        ]),
        plan && plan.laterChapters?.length > 0 ? h('div', { className: 'beat-sheet-stale', key: 'stale' }, [
          h('button', {
            key: 'check', type: 'button', className: 'beat-sheet-check', 'data-on': sheet.markLaterStale ? '1' : '0',
            onClick: () => onToggleStale(!sheet.markLaterStale), title: sheet.markLaterStale ? '已勾选：后续章节标待复核' : '未勾选：后续章节不标',
          }, '✓'),
          h('div', { className: 'beat-sheet-grow', key: 'g' }, [
            h('div', { className: 'beat-sheet-stale-t', key: 't' }, sheet.markLaterStale ? '后续章节标记为待复核（已勾选）' : '把后续章节标记为待复核'),
            h('div', { className: 'beat-sheet-stale-s', key: 's' }, `第 ${plan.laterChapters.join('、')} 章只加标记，不动正文；侧栏会显示「待复核」。`),
          ]),
        ]) : null,
        plan && plan.warnings?.length > 0 ? h('div', { className: 'beat-sheet-warn', key: 'warn' }, [
          h(WarningIcon, { key: 'icon' }),
          h('span', { key: 't' }, plan.warnings.join(' ')),
        ]) : null,
        sheet.error ? h('div', { className: 'beat-sheet-error', key: 'error' }, sheet.error) : null,
        h('div', { className: 'beat-sheet-actions', key: 'actions' }, [
          h('button', { key: 'cancel', type: 'button', className: 'beat-btn', 'data-p': '0', onClick: onClose, disabled: sheet.busy }, '取消'),
          h('button', {
            key: 'ok', type: 'button', className: 'beat-btn', 'data-p': '1', 'data-danger': '1',
            disabled: sheet.busy || !plan,
            onClick: onConfirm,
          }, sheet.busy ? '正在回退…' : (isChoose ? '改选并重写' : '确认回退')),
        ]),
      ])
    }

    function BeatOldLineSheet({ oldLine, onClose }) {
      const data = oldLine?.data ?? null
      return h('div', { className: 'beat-sheet' }, [
        h('div', { className: 'beat-grab', key: 'grab' }),
        h('h2', { key: 'title' }, '旧线快照'),
        h('div', { className: 'beat-sheet-sub', key: 'sub' }, data
          ? `回退前正文 · ${formatNumber(data.chars)} 字 · ${data.revisionId}`
          : '回退前保存的正文全文'),
        oldLine?.phase === 'loading'
          ? h('div', { className: 'beat-skel', key: 'loading', style: { marginTop: 9 } })
          : oldLine?.phase === 'error'
            ? h('div', { className: 'beat-sheet-error', key: 'error', style: { marginTop: 9 } }, oldLine.error)
            : h('pre', { className: 'beat-oldline-text', key: 'text' }, data?.text ?? '没有旧线内容。'),
        h('div', { className: 'beat-sheet-actions', key: 'actions' }, [
          h('button', { key: 'close', type: 'button', className: 'beat-btn', 'data-p': '1', onClick: onClose }, '关闭'),
        ]),
      ])
    }

    function BeatPanel({ sessionId, remote }) {
      const sid = sessionIdOf(sessionId)
      const [view, setView] = React.useState({ phase: 'loading', data: null, error: null })
      const [open, setOpen] = React.useState(null)
      const [chapters, setChapters] = React.useState({})
      const [filter, setFilter] = React.useState('all')
      const [selected, setSelected] = React.useState(null)
      const [sheet, setSheet] = React.useState(null)
      const [notice, setNotice] = React.useState(null)
      const [oldLine, setOldLine] = React.useState(null)
      const seq = React.useRef(0)
      const chapterSeq = React.useRef(0)

      const loadChapter = async (chapter, force) => {
        if (!sid || !remote || typeof remote.chapter !== 'function') return
        if (!force && chapters[chapter] && chapters[chapter].phase !== 'error') return
        setChapters((prev) => ({ ...prev, [chapter]: { phase: 'loading', data: prev[chapter]?.data ?? null, error: null } }))
        const my = ++chapterSeq.current
        try {
          const value = unwrap(await remote.chapter(sid, chapter))
          if (my !== chapterSeq.current) return
          setChapters((prev) => ({ ...prev, [chapter]: { phase: 'ready', data: value, error: null } }))
        } catch (error) {
          if (my !== chapterSeq.current) return
          setChapters((prev) => ({ ...prev, [chapter]: { phase: 'error', data: prev[chapter]?.data ?? null, error: String(error?.message ?? error) } }))
        }
      }

      const load = async () => {
        if (!sid || !remote || typeof remote.overview !== 'function') {
          setView({ phase: 'error', data: null, error: 'remote 未就绪：请重载后端。' })
          return
        }
        const my = ++seq.current
        setView((prev) => ({ phase: prev.data ? 'ready' : 'loading', data: prev.data, error: null }))
        try {
          const data = unwrap(await remote.overview(sid))
          if (my !== seq.current) return
          setView({ phase: 'ready', data, error: null })
          setOpen((prev) => (prev == null ? (data.currentChapter ?? data.chapters?.[0]?.chapter ?? null) : prev))
        } catch (error) {
          if (my !== seq.current) return
          setView({ phase: 'error', data: null, error: String(error?.message ?? error) })
        }
      }

      React.useEffect(() => {
        setChapters({})
        setOpen(null)
        setSelected(null)
        setSheet(null)
        setNotice(null)
        setOldLine(null)
        load()
        return () => { seq.current += 1; chapterSeq.current += 1 }
      }, [sid])

      React.useEffect(() => {
        if (open == null) return
        loadChapter(open)
      }, [open, sid])

      const toggle = (chapter) => {
        setOpen((prev) => (prev === chapter ? null : chapter))
      }

      const openSheet = async (decision, mode, choice) => {
        if (!sid || !remote || typeof remote.impact !== 'function') {
          setNotice({ text: 'remote 未就绪：请重载后端。', error: true })
          return
        }
        if (view.data?.on !== true) {
          setNotice({ text: '先开启拍板，再回退或改选。', error: true })
          return
        }
        setSheet({ decision, mode, choice, plan: null, busy: true, error: null, snapshot: true, markLaterStale: false })
        try {
          const plan = unwrap(await remote.impact(sid, decision.id, { choice }))
          setSheet((prev) => (prev && prev.decision?.id === decision.id
            ? { ...prev, plan, busy: false, error: null }
            : prev))
        } catch (error) {
          setSheet((prev) => (prev ? { ...prev, plan: null, busy: false, error: String(error?.message ?? error) } : prev))
        }
      }

      const rewrite = (decision) => openSheet(decision, 'keep', 'keep')
      const choose = (decision) => openSheet(decision, 'choose', decision.chosen?.label ?? decision.options?.[0]?.label ?? 'keep')

      const selectChoice = async (choice) => {
        if (!sheet || sheet.busy) return
        setSheet((prev) => ({ ...prev, choice, busy: true, error: null }))
        try {
          const plan = unwrap(await remote.impact(sid, sheet.decision.id, { choice }))
          setSheet((prev) => (prev ? { ...prev, plan, busy: false } : prev))
        } catch (error) {
          setSheet((prev) => (prev ? { ...prev, plan: null, busy: false, error: String(error?.message ?? error) } : prev))
        }
      }

      const confirmSheet = async () => {
        if (!sheet || !sheet.plan || sheet.busy) return
        setSheet((prev) => ({ ...prev, busy: true, error: null }))
        try {
          const result = unwrap(await remote.rewind(sid, sheet.decision.id, {
            choice: sheet.choice,
            confirm: true,
            snapshot: sheet.snapshot !== false,
            markLaterStale: sheet.markLaterStale === true,
            expectedBookUpdatedAt: view.data?.bookUpdatedAt ?? null,
          }))
          setSheet(null)
          setSelected(null)
          setNotice({
            text: result.resume?.message ?? '已回退。',
            prompt: result.resume?.prompt ?? result.resume?.message ?? '继续写这一段。',
            chapter: result.resume?.chapter ?? sheet.decision.chapter,
            offset: result.resume?.offset ?? null,
            decisionId: result.decisionId,
            copied: false,
            resumeBusy: false,
            resumeSent: false,
            resumeError: null,
          })
          await load()
          const chapter = result.resume?.chapter ?? sheet.decision.chapter
          setOpen(chapter)
          await loadChapter(chapter, true)
        } catch (error) {
          setSheet((prev) => (prev ? { ...prev, busy: false, error: String(error?.message ?? error) } : prev))
        }
      }

      const copyResume = async () => {
        const text = notice?.prompt ?? notice?.text
        if (!text) return
        try {
          if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(text)
          setNotice((prev) => ({ ...prev, copied: true }))
        } catch {
          setNotice((prev) => ({ ...prev, error: true }))
        }
      }

      const resumeNotice = async () => {
        if (!notice || !sid || !remote || typeof remote.resume !== 'function') {
          setNotice((prev) => (prev ? { ...prev, resumeError: '当前宿主没有续写入口；请复制指令手动发送。' } : prev))
          return
        }
        if (notice.resumeBusy || notice.resumeSent) return
        setNotice((prev) => ({ ...prev, resumeBusy: true, resumeError: null }))
        try {
          const result = unwrap(await remote.resume(sid, notice.prompt ?? notice.text))
          if (result && result.ok === false) throw new Error(result.message ?? '自动续写失败')
          setNotice((prev) => (prev ? { ...prev, resumeBusy: false, resumeSent: true } : prev))
        } catch (error) {
          setNotice((prev) => (prev ? { ...prev, resumeBusy: false, resumeError: String(error?.message ?? error) } : prev))
        }
      }

      const openOldLine = async () => {
        if (!notice?.decisionId || !sid || !remote || typeof remote.oldLine !== 'function') {
          setOldLine({ phase: 'error', data: null, error: '当前宿主没有旧线读取入口。' })
          return
        }
        setOldLine({ phase: 'loading', data: null, error: null })
        try {
          const data = unwrap(await remote.oldLine(sid, notice.decisionId))
          if (data && data.ok === false) throw new Error(data.message ?? '读不到旧线快照')
          setOldLine({ phase: 'ready', data, error: null })
        } catch (error) {
          setOldLine({ phase: 'error', data: null, error: String(error?.message ?? error) })
        }
      }

      const data = view.data
      const stats = data?.stats ?? { chapters: 0, decisions: 0, committed: 0, open: 0, segments: 0, chars: 0 }
      const allChapters = Array.isArray(data?.chapters) ? data.chapters : []
      const filtered = allChapters.filter((chapter) => {
        if (filter === 'open') return chapter.open > 0
        if (filter === 'committed') return chapter.decisions > 0 && chapter.committed === chapter.decisions
        if (filter === 'legacy') return chapter.legacy
        return true
      })

      const header = h('div', { className: 'beat-head', key: 'head' }, [
        h('div', { className: 'beat-top', key: 'top' }, [
          h('span', { className: 'beat-tab', key: 'tab' }, [h(FlagIcon, { key: 'f' }), '拍板台']),
          h('span', { className: 'beat-spacer', key: 's' }),
          h('button', {
            key: 'refresh', type: 'button', className: 'beat-icon', title: '刷新账本',
            onClick: () => load(), 'aria-label': '刷新账本',
          }, h(RefreshIcon)),
        ]),
        h('div', { className: 'beat-book', key: 'book' }, data?.book ?? '还没有拍板账本'),
        h('div', { className: 'beat-sub', key: 'sub' }, [
          h('span', { className: 'beat-mode', 'data-on': data?.on ? '1' : '0', key: 'mode' }, [h('i', { key: 'dot' }), `拍板：${data?.on ? '开' : '关'}`]),
          h('span', { key: 'dot' }, '·'),
          h('span', { key: 'updated' }, data?.bookUpdatedAt ? `更新于 ${formatTime(data.bookUpdatedAt)}` : '本地账本'),
        ]),
        h('div', { className: 'beat-stats', key: 'stats' }, [
          h('div', { className: 'beat-stat', key: 'ch', style: { '--beat-tone': 'var(--beat-brand)' } }, [h('b', { key: 'b' }, formatNumber(stats.chapters)), h('span', { key: 's' }, '章')]),
          h('div', { className: 'beat-stat', key: 'de', style: { '--beat-tone': 'var(--beat-brand-2)' } }, [h('b', { key: 'b' }, formatNumber(stats.decisions)), h('span', { key: 's' }, '决策')]),
          h('div', { className: 'beat-stat', key: 'se', style: { '--beat-tone': 'var(--beat-ok)' } }, [h('b', { key: 'b' }, formatNumber(stats.segments)), h('span', { key: 's' }, '已落段落')]),
          h('div', { className: 'beat-stat', key: 'chars', style: { '--beat-tone': 'var(--beat-warn)' } }, [h('b', { key: 'b' }, formatNumber(stats.chars)), h('span', { key: 's' }, '正文字数')]),
        ]),
      ])

      let body
      if (view.phase === 'loading' && !data) {
        body = h('div', { className: 'beat-list', key: 'loading' }, [0, 1, 2].map((index) => h('div', { className: 'beat-skel', key: index })))
      } else if (view.phase === 'error' && !data) {
        body = h('div', { className: 'beat-error', key: 'error' }, [
          h('div', { key: 'm' }, `读取账本失败：${view.error}`),
          h('button', { key: 'r', type: 'button', onClick: () => load() }, '重试'),
        ])
      } else if (!data?.book) {
        body = h('div', { className: 'beat-empty', key: 'empty' }, [
          h('b', { key: 't' }, '这本书还没有拍板账本'),
          h('div', { key: 's' }, '开启拍板后，AI 遇到会改变走向的岔路会先来问你；决策会记在这里。'),
        ])
      } else if (filtered.length === 0) {
        body = h('div', { className: 'beat-empty', key: 'empty-filter' }, [
          h('b', { key: 't' }, '没有符合条件的章节'),
          h('div', { key: 's' }, '换一个筛选，或刷新账本。'),
        ])
      } else {
        const rows = []
        for (const chapter of filtered) {
          const isOpen = open === chapter.chapter
          const chapterState = chapters[chapter.chapter] ?? null
          const badge = chapter.stale
            ? { className: 'warn', text: '待复核' }
            : chapter.open > 0
              ? { className: 'warn', text: `待拍板 ${chapter.open}` }
              : chapter.legacy && chapter.noAnchor > 0
                ? { className: 'muted', text: `旧账 ${chapter.noAnchor}` }
                : { className: 'ok', text: '已拍板' }
          const tone = chapter.stale
            ? 'stale'
            : chapter.open > 0
              ? 'open'
              : chapter.legacy && chapter.noAnchor > 0
                ? 'legacy'
                : 'done'
          rows.push(h('button', {
            key: `ch-${chapter.chapter}`,
            type: 'button',
            className: 'beat-chap',
            'data-open': isOpen ? '1' : '0',
            'data-tone': tone,
            onClick: () => toggle(chapter.chapter),
            'aria-expanded': isOpen,
          }, [
            h('span', { className: 'beat-chap-dot', key: 'dot' }),
            h('span', { className: 'beat-chap-grow', key: 'grow' }, [
              h('span', { className: 'beat-chap-line', key: 'line' }, [
                h('span', { className: 'beat-chap-no', key: 'no' }, `第 ${chapter.chapter} 章`),
                h('span', { className: 'beat-chap-name', key: 'name' }, chapter.title ?? `第 ${chapter.chapter} 章`),
              ]),
              h('span', { className: 'beat-chap-meta', key: 'meta' }, [
                h('span', { key: 'd' }, [h('b', { key: 'b' }, formatNumber(chapter.decisions)), ' 决策']),
                h('span', { key: 'dot2' }, '·'),
                h('span', { key: 's' }, [h('b', { key: 'b2' }, formatNumber(chapter.segments)), ' 段']),
                h('span', { key: 'dot3' }, '·'),
                h('span', { key: 'c' }, [h('b', { key: 'b3' }, formatNumber(chapter.chars)), ' 字']),
                chapter.noAnchor > 0 ? h('span', { key: 'na', style: { color: 'var(--beat-warn)' } }, `· 无锚点 ${chapter.noAnchor}`) : null,
              ]),
            ]),
            h('span', { className: 'beat-chap-right', key: 'right' }, [
              h('span', { className: `beat-badge ${badge.className}`, key: 'badge' }, badge.text),
              h(ChevronIcon, { key: 'chev' }),
            ]),
          ]))

          if (!isOpen) continue
          if (!chapterState || chapterState.phase === 'loading') {
            rows.push(h('div', { className: 'beat-decs', key: `load-${chapter.chapter}` }, [
              h('div', { className: 'beat-skel', key: 'a', style: { margin: '4px 1px' } }),
              h('div', { className: 'beat-skel', key: 'b', style: { margin: '4px 1px' } }),
            ]))
            continue
          }
          if (chapterState.phase === 'error') {
            rows.push(h('div', { className: 'beat-decs', key: `err-${chapter.chapter}` }, [
              h('div', { className: 'beat-error', key: 'e', style: { margin: '4px 1px' } }, [
                h('div', { key: 'm' }, `第 ${chapter.chapter} 章没读出来：${chapterState.error}`),
                h('button', { key: 'r', type: 'button', onClick: () => loadChapter(chapter.chapter, true) }, '重试'),
              ]),
            ]))
            continue
          }
          const decisions = chapterState.data?.decisions ?? []
          rows.push(h('div', { className: 'beat-decs', key: `decs-${chapter.chapter}` }, decisions.length === 0
            ? [h('div', { className: 'beat-empty', key: 'empty', style: { padding: '14px 8px' } }, '这一章没有决策点')]
            : decisions.map((decision) => {
              const active = selected === decision.id
              return h('div', { className: 'beat-dec-block', key: decision.id }, [
                h('div', {
                  className: 'beat-dec',
                  key: 'row',
                  'data-a': active ? '1' : '0',
                  'data-state': decision.status === 'committed' ? 'committed' : (decision.canRevert || decision.status !== 'committed' ? 'open' : 'committed'),
                  role: 'button',
                  tabIndex: 0,
                  onClick: () => setSelected(active ? null : decision.id),
                  onKeyDown: (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    setSelected(active ? null : decision.id)
                  },
                }, [
                  h('div', { className: 'beat-dec-grow', key: 'grow' }, [
                    h('div', { className: 'beat-dec-title', key: 'title' }, decision.title),
                    h('div', {
                      className: 'beat-dec-choice',
                      key: 'choice',
                      'data-empty': decision.chosen ? '0' : '1',
                    }, decision.chosen?.label ?? '还没拍板'),
                    h('div', { className: 'beat-dec-meta', key: 'meta' }, [
                      h('span', {
                        key: 'kind',
                        className: 'beat-kind',
                        style: { '--beat-kind': kindTone(decision.kind) },
                      }, decision.kind),
                      h('span', { key: 'chg' }, `改 ${formatNumber(decision.chosen?.changes?.length ?? 0)} 条设定`),
                      h('span', { className: 'sep', key: 's1' }, '·'),
                      h('span', { key: 'chars' }, decision.segment ? `${formatNumber(decision.segment.chars)} 字` : '无正文锚点'),
                      h('span', { className: 'sep', key: 's2' }, '·'),
                      h('span', { key: 'id' }, decision.id),
                      decision.legacy ? h('span', { key: 'legacy', style: { color: 'var(--beat-warn)' } }, '· 旧账') : null,
                    ]),
                  ]),
                  h('div', { className: 'beat-dec-right', key: 'right' }, [
                    h('span', { className: 'beat-dec-badge', key: 'badge' }, decision.status === 'committed' ? '已拍板' : (decision.canRevert ? '待拍板' : '只能看')),
                  ]),
                ]),
                active ? h(BeatDecisionDetail, {
                  key: 'detail',
                  decision,
                  chapter: chapter.chapter,
                  total: decisions.length,
                  onClose: () => setSelected(null),
                  onRewrite: rewrite,
                  onChoose: choose,
                  busy: Boolean(sheet),
                  on: data?.on === true,
                }) : null,
              ])
            })))
        }
        body = h('div', { className: 'beat-list', key: 'list' }, rows)
      }

      return h('div', {
        className: 'beat-root',
        style: {
          // DSH 的主题只有 --dsw-alias-* 这一族真实存在（label / border-l* /
          // state-* / bg-*）。旧代码写的 --dsw-alias-text-primary 之类并不存在，
          // 于是浅色主题下全部落到深色写死的兜底值 → 白底浅灰字。
          '--beat-text': 'var(--dsw-alias-label-primary, inherit)',
          '--beat-muted': 'var(--dsw-alias-label-secondary, inherit)',
          '--beat-faint': 'var(--dsw-alias-label-tertiary, inherit)',
          // 分隔线跟随正文色，浅色主题是 13% 的黑，深色主题是 13% 的白。
          '--beat-line': 'color-mix(in srgb, var(--dsw-alias-label-primary, #808080) 13%, transparent)',
          // 品牌色是插件自己的蓝，深浅主题都亮；文字另算 ink 版，混回正文色。
          '--beat-brand': '#4c6ef5',
          '--beat-brand-ink': 'color-mix(in srgb, var(--beat-brand) 68%, var(--beat-text))',
          '--beat-brand-2': '#a78bfa',
          '--beat-brand-3': '#38bdf8',
          '--beat-pink': '#f472b6',
          '--beat-orange': '#f59e0b',
          '--beat-cyan': '#22d3ee',
          '--beat-grad': 'linear-gradient(135deg, #7d95fb 0%, #a78bfa 58%, #38bdf8 100%)',
          '--beat-on-accent': '#ffffff',
          '--beat-brand-soft': 'color-mix(in srgb, var(--beat-brand) 12%, transparent)',
          '--beat-brand-line': 'color-mix(in srgb, var(--beat-brand) 34%, transparent)',
          // 状态色用宿主的 state-*（浅深同值，中调）。填充/圆点直接用它，
          // 小字用 ink 版：浅色主题往正文色里压暗，深色主题往亮里提。
          '--beat-ok': 'var(--dsw-alias-state-success-primary, #22c55e)',
          '--beat-ok-ink': 'color-mix(in srgb, var(--beat-ok) 52%, var(--beat-text))',
          '--beat-ok-soft': 'color-mix(in srgb, var(--beat-ok) 12%, transparent)',
          '--beat-ok-line': 'color-mix(in srgb, var(--beat-ok) 38%, transparent)',
          '--beat-warn': 'var(--dsw-alias-state-warn-primary, #f59e0b)',
          '--beat-warn-ink': 'color-mix(in srgb, var(--beat-warn) 50%, var(--beat-text))',
          '--beat-warn-soft': 'color-mix(in srgb, var(--beat-warn) 14%, transparent)',
          '--beat-warn-line': 'color-mix(in srgb, var(--beat-warn) 40%, transparent)',
          '--beat-danger': 'var(--dsw-alias-state-error-primary, #ec1313)',
          '--beat-danger-ink': 'color-mix(in srgb, var(--beat-danger) 72%, var(--beat-text))',
          '--beat-danger-soft': 'color-mix(in srgb, var(--beat-danger) 10%, transparent)',
          '--beat-danger-line': 'color-mix(in srgb, var(--beat-danger) 32%, transparent)',
          // 抬升层不跟 bg-layer-* 走：浅色主题里 bg-layer-1 就是纯白，看起来没层次。
          '--beat-layer1': 'color-mix(in srgb, var(--dsw-alias-label-primary, #808080) 5%, transparent)',
          '--beat-layer2': 'color-mix(in srgb, var(--dsw-alias-label-primary, #808080) 9%, transparent)',
          '--beat-mono': 'ui-monospace, "Cascadia Code", Consolas, monospace',
          '--beat-page': 'var(--dsw-alias-bg-base, #111214)',
          '--beat-sheet-bg': 'var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-base, #141619))',
          '--beat-tone': 'var(--beat-brand)',
          '--beat-tone-text': 'color-mix(in srgb, var(--beat-tone) 58%, var(--beat-text))',
        },
      }, [
        h('style', { key: 'css' }, BEAT_PANEL_CSS),
        header,
        notice ? h('div', { className: 'beat-notice', key: 'notice' }, [
          h('span', { key: 't' }, notice.text),
          h('span', { className: 'beat-spacer', key: 'sp' }),
          h('button', {
            key: 'resume',
            type: 'button',
            onClick: resumeNotice,
            disabled: notice.resumeBusy || notice.resumeSent,
            title: notice.resumeError ?? '把续写指令作为用户消息发给模型',
          }, notice.resumeBusy ? '发送中…' : (notice.resumeSent ? '已发送' : '继续写')),
          notice.decisionId ? h('button', { key: 'old', type: 'button', onClick: openOldLine, title: '查看回退前的正文快照' }, '查看旧线') : null,
          h('button', { key: 'copy', type: 'button', onClick: copyResume }, notice.copied ? '已复制' : '复制续写指令'),
          h('button', { key: 'x', type: 'button', onClick: () => setNotice(null), title: '关闭' }, '×'),
          notice.resumeError ? h('div', { className: 'beat-notice-err', key: 'err' }, notice.resumeError) : null,
        ]) : null,
        data && !data.on ? h('div', { className: 'beat-banner', key: 'banner' }, '拍板：关 · 只能查看，不能回退或改选') : null,
        h('div', { className: 'beat-filters', key: 'filters' }, [
          ['all', '全部', stats.decisions],
          ['open', '待拍板', stats.open],
          ['committed', '已拍板', stats.committed],
          ['legacy', '旧账', allChapters.filter((chapter) => chapter.legacy).length],
        ].map(([id, label, count]) => h('button', {
          key: id,
          type: 'button',
          className: 'beat-chip',
          'data-a': filter === id ? '1' : '0',
          onClick: () => setFilter(id),
        }, [h('span', { key: 'l' }, label), h('b', { key: 'c' }, formatNumber(count))]))),
        body,
        h('div', { className: 'beat-foot', key: 'foot' }, [
          h('span', { key: 'l' }, data?.book ? 'book.json' : '未连接账本'),
          h('span', { className: 'beat-spacer', key: 's' }),
          h('span', { key: 'v' }, 'v0.8.0'),
        ]),
        sheet ? h('div', {
          className: 'beat-scrim',
          key: 'scrim',
          onClick: () => { if (!sheet.busy) setSheet(null) },
        }) : null,
        sheet ? h(BeatRewindSheet, {
          key: 'sheet',
          sheet,
          decision: sheet.decision,
          onClose: () => { if (!sheet.busy) setSheet(null) },
          onSelect: selectChoice,
          onConfirm: confirmSheet,
          onToggleSnapshot: (value) => setSheet((prev) => (prev ? { ...prev, snapshot: value } : prev)),
          onToggleStale: (value) => setSheet((prev) => (prev ? { ...prev, markLaterStale: value } : prev)),
        }) : null,
        oldLine ? h('div', {
          className: 'beat-scrim',
          key: 'old-scrim',
          onClick: () => setOldLine(null),
        }) : null,
        oldLine ? h(BeatOldLineSheet, {
          key: 'old-line',
          oldLine,
          onClose: () => setOldLine(null),
        }) : null,
      ])
    }

    function BeatOpenButton({ open }) {
      return h('button', {
        type: 'button',
        title: '打开拍板台（决策地图 / 回退 / 改选）',
        onClick: () => {
          try { open?.() } catch (error) { console.error('[novel-beat] openTab 失败', error) }
        },
        style: {
          height: 24,
          marginRight: 6,
          padding: '0 8px',
          borderRadius: 6,
          border: '1px solid var(--beat-line)',
          background: 'transparent',
          color: 'var(--beat-muted)',
          fontSize: 11.5,
          lineHeight: '22px',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
        },
      }, [h(FlagIcon, { key: 'icon', size: 11 }), '拍板台'])
    }

    const TAB_ID = 'dsh-novel-beat-panel'
    const TAB_KIND = 'novel-beat'
    const TAB_TITLE = '拍板台'

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

        // 右栏「拍板台」：官方 sidebarRight 槽位。没有这个宿主的 profile
        //（或旧版 Harness）只保留上面两个输入框入口，不报错。
        const seat = typeof ctx.inject === 'function'
          ? ctx.inject(['sidebarRightTabs', 'sidebarRight'], (scoped) => {
            const tabs = scoped.get('sidebarRightTabs')
            const right = scoped.get('sidebarRight')
            if (!tabs || !right) {
              console.warn('[novel-beat] 宿主右栏服务缺失，不注册拍板台页签。')
              return
            }
            scoped.effect(() => tabs.register({
              id: TAB_ID,
              kind: TAB_KIND,
              priority: 'extension',
              keepMounted: true,
              title: () => TAB_TITLE,
              guide: [{
                id: TAB_ID,
                order: 10,
                title: () => TAB_TITLE,
                description: () => '按章看决策点、回退与改选',
              }],
            }), 'novel-beat: tab type')
            scoped.effect(() => scoped.slots.inject('sidebar.right.pane.tab', () => scoped.slots.register(
              { name: 'sidebar.right.pane.tab', key: TAB_ID, inject: (sessionId) => ({ sessionId, remote }) },
              BeatPanel,
            )), 'novel-beat: tab body')
            scoped.effect(() => scoped.slots.inject('conversation.session.header.utilities', () => scoped.slots.register(
              {
                name: 'conversation.session.header.utilities',
                id: 'dsh-novel-beat-open',
                order: 35,
                inject: () => ({
                  open: () => {
                    try { right.openTab(TAB_KIND) } catch (error) { console.error('[novel-beat] openTab 失败', error) }
                  },
                }),
              },
              BeatOpenButton,
            )), 'novel-beat: header button')
          })
          : null
        if (typeof seat === 'function') {
          ctx.effect(() => () => {
            try { seat() } catch {}
          })
        }
      },
    }
  },
})

