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
      if (typeof value !== 'string' || value.length === 0 || value.length > 1200) throw new Error('resume text must be a non-empty string, at most 1200 characters')
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
        {
          id: 'dsh-novel-beat#beatMode/timeline', namespace: 'beatMode', service: 'beatMode', method: 'timeline',
          invocation: { kind: 'direct' }, parameters: [param('sessionId', sessionIdSchema), param('options', jsonObjectSchema)],
          result: codec('BeatPanel', objectResultSchema),
        },
        {
          id: 'dsh-novel-beat#beatMode/health', namespace: 'beatMode', service: 'beatMode', method: 'health',
          invocation: { kind: 'direct' }, parameters: [param('sessionId', sessionIdSchema), param('options', jsonObjectSchema)],
          result: codec('BeatPanel', objectResultSchema),
        },
        {
          id: 'dsh-novel-beat#beatMode/search', namespace: 'beatMode', service: 'beatMode', method: 'search',
          invocation: { kind: 'direct' }, parameters: [param('sessionId', sessionIdSchema), param('options', jsonObjectSchema)],
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
        const error = new Error(result.error?.message ?? result.message ?? 'remote 调用失败')
        error.code = result.error?.code ?? result.code ?? null
        error.details = result.error?.details ?? result.details ?? null
        throw error
      }
      return result && result.ok === true ? result.value : result
    }

    function requireBusinessOk(value) {
      if (value?.ok === false) {
        const error = new Error(value.message ?? value.code ?? '操作失败')
        error.code = value.code ?? null
        error.details = value
        throw error
      }
      return value
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
        border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
        background: state.on ? 'var(--beat-brand, #c2452d)' : 'transparent',
        color: state.on ? '#ffffff' : 'inherit',
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
.beat-gate{margin-top:6px;padding:6px;border:1px solid var(--beat-brand-line);border-radius:5px;background:var(--beat-brand-soft);font-size:9.5px;line-height:1.45;overflow-wrap:anywhere}
.beat-gate-title{font-weight:600;color:var(--beat-text)}
.beat-gate-delta{margin-top:2px;color:var(--beat-text);font-family:var(--beat-mono)}
.beat-gate-reason{margin-top:3px;color:var(--beat-muted)}
.beat-evidence-list{margin-top:4px}
.beat-evidence-status{font-size:8.5px;color:var(--beat-ok-ink);margin:3px 0}
.beat-evidence-status[data-invalid="1"]{color:var(--beat-danger-ink);font-weight:600}
.beat-evidence{margin-top:2px;border:1px solid var(--beat-line);border-radius:4px;padding:3px 5px;background:var(--beat-layer1);font-size:8.5px;overflow-wrap:anywhere}
.beat-evidence summary{cursor:pointer;color:var(--beat-muted)}
.beat-evidence blockquote{margin:4px 0;color:var(--beat-text);line-height:1.5;white-space:pre-wrap}
.beat-evidence code{font-size:7.5px;color:var(--beat-faint);overflow-wrap:anywhere}
.beat-opt-heading{display:flex;justify-content:space-between;gap:4px;align-items:flex-start;flex-wrap:wrap}
.beat-opt-heading b{font-weight:600;color:var(--beat-text)}
.beat-style-fit{font-size:7.5px;padding:1px 4px;border-radius:4px;color:var(--beat-brand-ink);background:var(--beat-brand-soft);border:1px solid var(--beat-brand-line);white-space:nowrap}
.beat-opt-field{margin-top:2px;color:var(--beat-muted);white-space:normal;overflow-wrap:anywhere}
.beat-opt-delta{font-family:var(--beat-mono);font-size:8.5px;color:var(--beat-text)}
.beat-style-why{margin-top:3px;color:var(--beat-faint);font-size:8px;line-height:1.4}
.beat-voice-status{margin:5px 1px;padding:5px 6px;border:1px solid var(--beat-line);border-radius:5px;background:var(--beat-layer1);font-size:8.5px;line-height:1.45;color:var(--beat-faint);overflow-wrap:anywhere}
.beat-voice-status b{display:block;color:var(--beat-muted);font-weight:600}
.beat-voice-status[data-available="1"]{border-color:var(--beat-brand-line)}
.beat-rejected{margin:6px 2px;padding:7px;border:1px dashed var(--beat-line-2);border-radius:6px;background:var(--beat-layer1);opacity:.72;font-size:9px;line-height:1.45;overflow-wrap:anywhere}
.beat-rejected-title{color:var(--beat-muted);font-weight:600}
.beat-rejected-options{margin-top:2px;color:var(--beat-faint);text-decoration:line-through}
.beat-rejected-reason{margin-top:3px;color:var(--beat-warn-ink)}
.beat-rejected-note{margin-top:2px;color:var(--beat-faint);font-size:8px}
.beat-quarantine{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:7px 12px;padding:7px;border:1px solid var(--beat-danger-line);border-radius:6px;background:var(--beat-danger-soft);color:var(--beat-danger-ink);font-size:9px;line-height:1.45;overflow-wrap:anywhere}
.beat-quarantine b{font-weight:700}
.beat-quarantine span{flex:1;min-width:140px}
.beat-quarantine button,.beat-sheet-error-actions button{min-height:24px;padding:2px 7px;border:1px solid var(--beat-danger-line);border-radius:4px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.beat-sheet-error b{display:block;margin-bottom:2px}
.beat-sheet-error-actions{display:flex;gap:5px;margin-top:4px}
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

.beat-root{
  --beat-paper:#fbf9f4;--beat-paper-2:#f5f1e8;--beat-card:#fffdf8;
  --beat-ink:#1c1b18;--beat-ink-2:#6e675c;--beat-ink-3:#797266;
  --beat-line:rgba(28,27,24,.10);--beat-line-2:rgba(28,27,24,.18);
  --beat-red:#c2452d;--beat-red-soft:rgba(194,69,45,.09);--beat-red-line:rgba(194,69,45,.30);
  --beat-jade:#2e7d6b;--beat-jade-soft:rgba(46,125,107,.09);--beat-jade-line:rgba(46,125,107,.28);
  --beat-amber:#8f5d12;--beat-amber-soft:rgba(143,93,18,.10);--beat-amber-line:rgba(143,93,18,.30);
  --beat-text:var(--beat-ink);--beat-muted:var(--beat-ink-2);--beat-faint:var(--beat-ink-3);
  --beat-brand:var(--beat-red);--beat-brand-ink:var(--beat-red);--beat-brand-2:var(--beat-amber);
  --beat-brand-3:var(--beat-jade);--beat-pink:var(--beat-red);--beat-orange:var(--beat-amber);
  --beat-cyan:var(--beat-jade);--beat-grad:var(--beat-ink);--beat-on-accent:var(--beat-paper);
  --beat-brand-soft:var(--beat-red-soft);--beat-brand-line:var(--beat-red-line);
  --beat-ok:var(--beat-jade);--beat-ok-ink:var(--beat-jade);--beat-ok-soft:var(--beat-jade-soft);--beat-ok-line:var(--beat-jade-line);
  --beat-warn:var(--beat-amber);--beat-warn-ink:var(--beat-amber);--beat-warn-soft:var(--beat-amber-soft);--beat-warn-line:var(--beat-amber-line);
  --beat-danger:var(--beat-red);--beat-danger-ink:var(--beat-red);--beat-danger-soft:var(--beat-red-soft);--beat-danger-line:var(--beat-red-line);
  --beat-layer1:var(--beat-paper-2);--beat-layer2:color-mix(in srgb,var(--beat-paper-2) 70%,var(--beat-ink) 5%);
  --beat-mono:"Cascadia Code","Cascadia Mono",Consolas,ui-monospace,monospace;
  --beat-page:var(--beat-paper);--beat-sheet-bg:var(--beat-card);--beat-tone:var(--beat-ink);--beat-tone-text:var(--beat-ink);
  width:100%;min-width:0;overflow:hidden;background:var(--beat-paper);color:var(--beat-ink);
  font-family:"Microsoft YaHei UI","Microsoft YaHei",system-ui,"Segoe UI",sans-serif;font-size:12.5px;line-height:1.55
}
body[data-ds-dark-theme] .beat-root{
  --beat-paper:#141416;--beat-paper-2:#19191c;--beat-card:#1d1d21;
  --beat-ink:#f1ede4;--beat-ink-2:#b7b0a4;--beat-ink-3:#847d71;
  --beat-line:rgba(241,237,228,.10);--beat-line-2:rgba(241,237,228,.18);
  --beat-red:#e2603f;--beat-jade:#58b49d;--beat-amber:#d3a24a;
  --beat-red-soft:color-mix(in srgb,var(--beat-red) 12%,transparent);--beat-red-line:color-mix(in srgb,var(--beat-red) 34%,transparent);
  --beat-jade-soft:color-mix(in srgb,var(--beat-jade) 12%,transparent);--beat-jade-line:color-mix(in srgb,var(--beat-jade) 30%,transparent);
  --beat-amber-soft:color-mix(in srgb,var(--beat-amber) 12%,transparent);--beat-amber-line:color-mix(in srgb,var(--beat-amber) 32%,transparent)
}
.beat-root{height:100%;min-height:0;display:flex;flex-direction:column;position:relative}
.beat-root *{box-sizing:border-box;font-variant-numeric:tabular-nums}
.beat-head{flex:none;padding:9px 16px 0;border:0;background:var(--beat-paper);z-index:1}
.beat-head:before{display:none}
.beat-top{display:flex;align-items:center;gap:7px;min-width:0}
.beat-eyebrow{height:14px;color:var(--beat-ink-3);font-size:9.5px;letter-spacing:.14em}
.beat-eyebrow:before{content:"";width:14px;height:1px;background:var(--beat-red);opacity:.9;flex:none}
.beat-eyebrow .beat-spacer{flex:1}
.beat-icon{opacity:.55;transition:opacity .12s,color .12s,background .12s}
.beat-top:hover .beat-icon,.beat-icon:focus-visible{opacity:1}
.beat-eyes{display:flex;align-items:flex-start;gap:12px;margin-top:6px;min-width:0}
.beat-eyes .beat-chap-grow{flex:1;min-width:0}
.beat-book{font-size:15.5px;font-weight:600;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.beat-sub{display:flex;align-items:center;gap:6px;margin-top:3px;color:var(--beat-ink-2);font-size:10px;white-space:nowrap;overflow:hidden}
.beat-sub b{font-family:var(--beat-mono);font-weight:500;color:var(--beat-ink)}
.beat-sub .beat-dotsep{width:2px;height:2px;border-radius:50%;background:var(--beat-ink-3);opacity:.6;flex:none}
.beat-mode{display:inline-flex;align-items:center;gap:4px;color:var(--beat-jade);font-size:9.5px}
.beat-mode i{width:5px;height:5px;border-radius:50%;display:block;background:var(--beat-jade);box-shadow:0 0 0 3px var(--beat-jade-soft)}
.beat-mode[data-on="0"]{color:var(--beat-amber)}.beat-mode[data-on="0"] i{background:var(--beat-amber);box-shadow:0 0 0 3px var(--beat-amber-soft)}
.beat-ring{flex:none;width:44px;height:44px;position:relative}
.beat-ring svg{display:block;width:44px;height:44px;transform:rotate(-90deg)}
.beat-ring .track{fill:none;stroke:var(--beat-line-2);stroke-width:3}
.beat-ring .val{fill:none;stroke:var(--beat-red);stroke-width:3;stroke-linecap:round;transition:stroke-dashoffset .15s}
.beat-ring[data-empty="1"] .val{stroke:var(--beat-ink-3)}
.beat-ring .ctr{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}
.beat-ring .ctr b{font-family:var(--beat-mono);font-size:12px;font-weight:600}
.beat-ring .ctr span{font-size:7px;color:var(--beat-ink-3);margin-top:2px}
.beat-stats{height:34px;display:flex;align-items:center;gap:0;margin-top:11px;border:0;border-top:1px solid var(--beat-line);border-bottom:1px solid var(--beat-line);border-radius:0;background:transparent;overflow:hidden}
.beat-stat{flex:1;min-width:0;display:flex;align-items:baseline;gap:4px;padding:0 8px;background:transparent;border:0;border-left:1px solid var(--beat-line);box-shadow:none}
.beat-stat:first-child{border-left:0;padding-left:0}
.beat-stat b{font-family:var(--beat-mono);font-size:13px;font-weight:600;line-height:1.2;color:var(--beat-ink);white-space:nowrap}
.beat-stat.t-jade b{color:var(--beat-jade)}.beat-stat.t-amber b{color:var(--beat-amber)}
.beat-stat span{font-size:9px;color:var(--beat-ink-3);margin:0;white-space:nowrap}
.beat-tabs{display:flex;align-items:center;gap:2px;margin-top:8px;border-bottom:1px solid var(--beat-line)}
.beat-tab{position:relative;height:34px;display:inline-flex;align-items:center;gap:5px;padding:0 10px 1px;border:0;border-radius:0;background:transparent;box-shadow:none;color:var(--beat-ink-3);font:inherit;font-size:11.5px;white-space:nowrap;cursor:pointer}
.beat-tab svg{width:12px;height:12px;opacity:.8}
.beat-tab b{font-family:var(--beat-mono);font-size:9px;font-weight:500;color:var(--beat-ink-3);background:var(--beat-paper-2);border:1px solid var(--beat-line);border-radius:9px;padding:0 5px;line-height:14px}
.beat-tab[data-a="1"]{color:var(--beat-ink);font-weight:600}
.beat-tab[data-a="1"]:after{content:"";position:absolute;left:10px;right:10px;bottom:-1px;height:2px;background:var(--beat-red)}
.beat-tab[data-a="1"] b{color:var(--beat-red);border-color:var(--beat-red-line);background:var(--beat-red-soft)}
.beat-tab:disabled{opacity:.45;cursor:default}
.beat-filters{flex:none;display:flex;align-items:center;gap:6px;padding:9px 16px 8px;border:0;background:var(--beat-paper)}
.beat-search{flex:none;display:flex;align-items:center;gap:7px;height:36px;padding:0 16px;border-bottom:1px solid var(--beat-line);background:var(--beat-paper);transition:box-shadow .12s}
.beat-search:focus-within{box-shadow:inset 0 -1px 0 var(--beat-red)}
.beat-search-ico{width:13px;height:13px;color:var(--beat-ink-3);flex:none}
.beat-search-input{flex:1;min-width:0;height:100%;padding:0;border:0;outline:0;background:transparent;color:var(--beat-ink);font:11.5px "Microsoft YaHei UI","Microsoft YaHei",sans-serif}
.beat-search-input::placeholder{color:var(--beat-ink-3)}
.beat-search-input::-webkit-search-cancel-button{display:none}
.beat-search-clear{width:20px;height:20px;flex:none;border:0;border-radius:50%;background:var(--beat-paper-2);color:var(--beat-ink-3);font:13px/20px var(--beat-mono);padding:0;cursor:pointer}
.beat-search-clear:hover{color:var(--beat-ink)}
.beat-search-results{flex:1;min-height:0;overflow:auto;padding:0 16px 10px}
.beat-search-head{padding:10px 0 7px;border-bottom:1px solid var(--beat-line);color:var(--beat-ink-3);font:9px var(--beat-mono);letter-spacing:.02em}
.beat-sr{padding:9px 0;border-bottom:1px dashed var(--beat-line);cursor:pointer;border-radius:2px}
.beat-sr:hover{background:color-mix(in srgb,var(--beat-paper-2) 60%,transparent)}
.beat-sr-top{display:flex;align-items:center;gap:6px;color:var(--beat-ink-3);font:9px var(--beat-mono);min-width:0}
.beat-sr-kind{font:8.5px "Microsoft YaHei UI",sans-serif;padding:0 4px;border:1px solid var(--beat-line-2);border-radius:3px;background:var(--beat-paper-2);color:var(--beat-ink-2)}
.beat-sr[data-kind="obligation"] .beat-sr-kind{color:var(--beat-amber);border-color:var(--beat-amber-line);background:var(--beat-amber-soft)}
.beat-sr-id{margin-left:auto;color:var(--beat-ink-3);font:8.5px var(--beat-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.beat-sr-title{font-size:11.5px;color:var(--beat-ink);margin-top:3px;line-height:1.45}
.beat-sr-choice{font-size:10px;color:var(--beat-ink-2);margin-top:2px}
.beat-sr-snippet{font:9px var(--beat-mono);color:var(--beat-ink-3);margin-top:3px;line-height:1.5;word-break:break-word}
.beat-chip{height:23px;padding:0 9px;border:1px solid var(--beat-line);border-radius:12px;background:transparent;color:var(--beat-ink-2);font:inherit;font-size:10px;display:inline-flex;align-items:center;gap:5px;white-space:nowrap;cursor:pointer;transition:background .12s,color .12s,border-color .12s}
.beat-chip:hover{background:var(--beat-paper-2);color:var(--beat-ink)}
.beat-chip[data-a="1"]{background:var(--beat-ink);border-color:var(--beat-ink);color:var(--beat-paper);box-shadow:none}
.beat-chip b{font-family:var(--beat-mono);font-size:9px;color:var(--beat-ink-3);font-weight:500}
.beat-chip[data-a="1"] b{color:color-mix(in srgb,var(--beat-paper) 72%,var(--beat-ink))}
.beat-sort{margin-left:auto;color:var(--beat-ink-3);font:9.5px var(--beat-mono);white-space:nowrap}
.beat-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;padding:0 0 6px}
.beat-chap{display:flex;align-items:center;gap:10px;width:100%;min-height:66px;padding:8px 16px;border:0;border-bottom:1px solid var(--beat-line);background:transparent;color:inherit;text-align:left;cursor:pointer;font:inherit;position:relative;transition:background .12s}
.beat-chap:before{content:"";position:absolute;left:0;top:0;bottom:0;width:0;background:var(--beat-red);opacity:1;transition:width .12s}
.beat-chap:hover{background:color-mix(in srgb,var(--beat-paper-2) 55%,transparent)}
.beat-chap[data-open="1"]{background:linear-gradient(90deg,var(--beat-paper-2),transparent 72%);border-bottom-color:transparent}
.beat-chap[data-open="1"]:before{width:2px}
.beat-chap[data-tone="done"]{--beat-state:var(--beat-jade)}.beat-chap[data-tone="open"],.beat-chap[data-tone="stale"]{--beat-state:var(--beat-amber)}.beat-chap[data-tone="legacy"]{--beat-state:var(--beat-ink-3)}
.beat-chap-dot{display:none}
.beat-chap-no{width:30px;flex:none;text-align:right;font-family:var(--beat-mono);font-size:18px;font-weight:300;color:var(--beat-ink-3);white-space:nowrap}
.beat-chap[data-current="1"] .beat-chap-no{color:var(--beat-red);font-weight:500}
.beat-chap[data-open="1"] .beat-chap-no{color:var(--beat-red);font-weight:500}
.beat-chap-grow{display:block;flex:1;min-width:0}
.beat-chap-line{display:block;min-width:0}
.beat-chap-name{display:block;font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.beat-chap[data-current="1"] .beat-chap-name{font-size:13px}
.beat-chap-meta{display:flex;align-items:center;gap:5px;margin-top:2px;color:var(--beat-ink-3);font-size:9.5px;white-space:nowrap;overflow:hidden}
.beat-chap-meta b{font-family:var(--beat-mono);font-weight:500;color:var(--beat-ink-2)}
.beat-segbar{display:flex;gap:2px;margin-top:5px}
.beat-segbar i{display:block;height:3px;flex:1;max-width:16px;border-radius:2px;background:var(--beat-line-2)}
.beat-segbar i.done{background:var(--beat-jade)}.beat-segbar i.open{background:var(--beat-amber)}.beat-segbar i.legacy{background:var(--beat-ink-3);opacity:.65}
.beat-chap-right{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:none}
.beat-chap-state{height:auto;padding:0;border:0;background:transparent;font-size:9.5px;color:var(--beat-state,var(--beat-ink-3));letter-spacing:.02em}
.beat-chap-state.ok,.beat-chap-state.warn,.beat-chap-state.muted{color:var(--beat-state,var(--beat-ink-3));background:transparent;border:0}
.beat-chev{width:12px;height:12px;color:var(--beat-ink-3);transition:transform .15s}
.beat-chap[data-open="1"] .beat-chev{transform:rotate(90deg);color:var(--beat-ink-2)}
.beat-decs{padding:2px 16px 4px 56px;border-bottom:1px solid var(--beat-line);background:linear-gradient(180deg,color-mix(in srgb,var(--beat-ink) 2%,transparent),transparent);position:relative}
.beat-decs:before{left:16px;top:3px;bottom:9px;width:2px;background:var(--beat-red);opacity:.5}
.beat-dec{display:flex;align-items:flex-start;gap:9px;padding:8px 8px 8px 0;border-bottom:1px dashed var(--beat-line);border-radius:0;position:relative;min-height:0;transition:background .12s,box-shadow .12s}
.beat-dec:last-child{border-bottom:0}
.beat-dec:before{display:none}
.beat-dec:hover{background:color-mix(in srgb,var(--beat-paper-2) 65%,transparent)}
.beat-seal{width:19px;height:19px;flex:none;margin-top:1px;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:var(--beat-jade);border:1px solid var(--beat-jade-line);background:var(--beat-jade-soft);transform:rotate(-3deg)}
.beat-seal[data-state="open"]{color:var(--beat-amber);border-color:var(--beat-amber-line);background:var(--beat-amber-soft);border-style:dashed}
.beat-seal[data-state="legacy"]{color:var(--beat-ink-3);border-color:var(--beat-line-2);background:transparent}
.beat-dec-grow{flex:1;min-width:0}
.beat-dec-title{font-size:12px;line-height:1.4;color:var(--beat-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.beat-dec-choice{font-size:10.5px;color:var(--beat-ink-2);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.beat-dec-choice[data-empty="1"]{color:var(--beat-ink-3)}
.beat-dec-meta{display:flex;align-items:center;gap:5px;margin-top:4px;color:var(--beat-ink-3);font-size:9px;font-family:var(--beat-mono);white-space:nowrap;overflow:hidden}
.beat-kind{height:16px;padding:0 4px;border-radius:3px;border:1px solid var(--beat-line-2);background:var(--beat-paper-2);color:var(--beat-ink-2);font:8.5px/14px var(--beat-mono);white-space:nowrap}
.beat-dec-right{display:flex;align-items:flex-start;padding-top:2px;flex:none}
.beat-dec-badge{height:auto;padding:0;border:0;background:transparent;color:var(--beat-ink-3);font-size:9px;white-space:nowrap}
.beat-dec[data-state="committed"] .beat-dec-badge{color:var(--beat-jade)}.beat-dec[data-state="open"] .beat-dec-badge{color:var(--beat-amber)}.beat-dec[data-state="legacy"] .beat-dec-badge{color:var(--beat-ink-3)}
.beat-dec[data-a="1"]{background:var(--beat-card);border:1px solid var(--beat-line-2);border-radius:7px;padding:8px 8px 8px 9px;margin:5px 0;box-shadow:0 1px 0 color-mix(in srgb,var(--beat-ink) 3%,transparent),0 6px 15px color-mix(in srgb,var(--beat-ink) 6%,transparent)}
.beat-dec[data-a="1"]:after{content:"";position:absolute;left:-1px;top:8px;bottom:8px;width:2px;background:var(--beat-red);border-radius:2px}
.beat-detail{margin:8px 0 10px;border:1px solid var(--beat-line-2);border-radius:10px;background:var(--beat-card);padding:0;box-shadow:0 8px 22px color-mix(in srgb,var(--beat-ink) 9%,transparent);position:relative;overflow:hidden}
.beat-detail:before{content:"";position:absolute;left:0;right:0;top:0;height:2px;background:linear-gradient(90deg,var(--beat-red),color-mix(in srgb,var(--beat-red) 35%,transparent) 55%,transparent)}
.beat-detail-inner{padding:12px 13px}
.beat-detail-stamp{position:absolute;right:12px;top:12px;width:34px;height:34px;border:1.5px solid var(--beat-red);border-radius:4px;color:var(--beat-red);font-size:9px;line-height:1.15;display:flex;flex-direction:column;align-items:center;justify-content:center;transform:rotate(7deg);opacity:.9;letter-spacing:.06em}
.beat-detail-top{display:flex;align-items:center;gap:5px;color:var(--beat-ink-3);font-size:9px;font-family:var(--beat-mono);padding-right:38px}
.beat-detail-top .beat-spacer{flex:1}
.beat-detail-close{width:19px;height:19px;border:0;border-radius:4px;background:transparent;color:var(--beat-ink-3);cursor:pointer;font:13px/1 var(--beat-mono);padding:0;flex:none}
.beat-detail-close:hover{background:var(--beat-paper-2);color:var(--beat-ink)}
.beat-detail-title{font-size:13.5px;font-weight:600;margin:5px 32px 2px 0;line-height:1.35}
.beat-detail-change{font-size:10px;color:var(--beat-ink-2);margin-top:1px;line-height:1.5;white-space:normal}
.beat-detail :focus-visible,.beat-sheet :focus-visible,.beat-dec:focus-visible{outline:2px solid var(--beat-red);outline-offset:2px}
.beat-cur{margin-top:9px;border:1px solid var(--beat-jade-line);border-radius:7px;background:var(--beat-jade-soft);padding:7px 9px;display:flex;align-items:center;gap:8px}
.beat-cur-mark{width:16px;height:16px;border-radius:50%;background:var(--beat-jade);color:var(--beat-paper);display:flex;align-items:center;justify-content:center;font-size:9px;flex:none}
.beat-cur-grow{flex:1;min-width:0}.beat-cur-k{font-size:8.5px;color:var(--beat-ink-3)}
.beat-cur-v{font-size:11.5px;color:var(--beat-ink);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.beat-cur-tag{font-size:8.5px;color:var(--beat-jade);border:1px solid var(--beat-jade-line);background:transparent;padding:1px 4px;border-radius:3px;white-space:nowrap}
.beat-opts{margin-top:7px;display:flex;flex-direction:column;gap:2px}
.beat-opt{display:flex;align-items:flex-start;gap:7px;padding:4px 2px;border-radius:4px;color:var(--beat-ink-2);font-size:10.5px;line-height:1.45}
.beat-opt-letter{width:13px;flex:none;font-family:var(--beat-mono);font-size:9px;color:var(--beat-ink-3);margin-top:1px}
.beat-opt[data-cur="1"] .beat-opt-letter{color:var(--beat-red);font-weight:600}.beat-opt[data-cur="1"] .beat-opt-label{color:var(--beat-ink)}
.beat-opt-label{flex:1;min-width:0}.beat-opt-impact{font-size:9.5px;color:var(--beat-ink-3);margin-top:1px;line-height:1.45}
.beat-changes{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
.beat-change{font:8.5px/1.4 var(--beat-mono);color:var(--beat-ink-2);border:1px solid var(--beat-line);background:var(--beat-paper);border-radius:3px;padding:1px 4px;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis}
.beat-seg{margin-top:6px;color:var(--beat-ink-3);font-size:9px;font-family:var(--beat-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.beat-impact{display:flex;gap:6px;margin-top:8px;padding:7px 8px;border:0;border-top:1px dashed var(--beat-amber-line);background:var(--beat-amber-soft);border-radius:0 0 5px 5px;color:color-mix(in srgb,var(--beat-amber) 70%,var(--beat-ink));font-size:9px;line-height:1.5}
.beat-impact svg{flex:none;margin-top:1px}.beat-blocked{margin-top:8px;padding:6px 8px;border:1px dashed var(--beat-line-2);border-radius:5px;color:var(--beat-ink-2);font-size:9.5px;line-height:1.45}
.beat-detail-actions{display:flex;gap:6px;margin-top:9px}
.beat-btn{height:30px;border-radius:6px;border:1px solid var(--beat-line-2);background:transparent;color:var(--beat-ink-2);font:inherit;font-size:10.5px;padding:0 8px;white-space:nowrap;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:5px}
.beat-btn[data-p="1"]{flex:1;background:var(--beat-ink);border-color:var(--beat-ink);color:var(--beat-paper);font-weight:600}
.beat-btn:hover:not(:disabled){filter:brightness(.96)}.beat-btn:disabled{opacity:.5;cursor:default}
.beat-notice{margin:8px 16px 0;border-color:var(--beat-jade-line);background:var(--beat-jade-soft);color:var(--beat-jade)}
.beat-banner{margin:8px 16px 0;border-color:var(--beat-amber-line);background:var(--beat-amber-soft);color:var(--beat-amber)}
.beat-foot{height:30px;padding:0 16px;background:linear-gradient(180deg,transparent,var(--beat-paper-2));border-top:1px solid var(--beat-line);color:var(--beat-ink-3);font-size:9px}
.beat-tab-empty{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;color:var(--beat-ink-2);text-align:center;font-size:11px}
.beat-tab-empty b{color:var(--beat-ink);font-size:12px;font-weight:600;margin-bottom:4px}
.beat-skel{background:linear-gradient(90deg,var(--beat-paper-2),var(--beat-card),var(--beat-paper-2));background-size:200% 100%}
.beat-tab-warn{color:var(--beat-red)!important;border-color:var(--beat-red-line)!important;background:var(--beat-red-soft)!important}
/* timeline */
.beat-tl{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.beat-tl-filters{padding:9px 16px 8px;border-bottom:1px solid var(--beat-line);overflow:auto;scrollbar-width:none}
.beat-tl-filters::-webkit-scrollbar{display:none}
.beat-tl-list{flex:1;min-height:0;overflow:auto;padding:2px 16px 10px;position:relative}
.beat-tl-day-title{font:9px var(--beat-mono);color:var(--beat-ink-3);letter-spacing:.08em;margin:10px 0 2px 20px}
.beat-tl-entry{position:relative;display:flex;gap:9px;padding:7px 0 9px 20px;cursor:default}
.beat-tl-entry[role="button"]{cursor:pointer}
.beat-tl-entry[role="button"]:hover .beat-tl-body{background:color-mix(in srgb,var(--beat-paper-2) 60%,transparent)}
.beat-tl-entry:before{content:"";position:absolute;left:4px;top:0;bottom:0;width:1px;background:color-mix(in srgb,var(--beat-ink) 12%,transparent)}
.beat-tl-day:first-child .beat-tl-entry:first-child:before{top:14px}
.beat-tl-day:last-child .beat-tl-entry:last-child:before{bottom:calc(100% - 15px)}
.beat-tl-node{position:absolute;left:1px;top:14px;width:7px;height:7px;border-radius:50%;background:var(--beat-ink-2);box-shadow:0 0 0 3px var(--beat-paper);z-index:1}
.beat-tl-entry[data-type="commit"] .beat-tl-node{background:var(--beat-jade)}
.beat-tl-entry[data-type="revert"] .beat-tl-node{background:var(--beat-red)}
.beat-tl-entry[data-type="segment"] .beat-tl-node{background:color-mix(in srgb,var(--beat-ink) 45%,var(--beat-paper))}
.beat-tl-entry[data-type="verify"] .beat-tl-node,.beat-tl-entry[data-type="waive"] .beat-tl-node{background:var(--beat-amber)}
.beat-tl-entry[data-type="stale"] .beat-tl-node{background:var(--beat-paper);border:1.5px solid var(--beat-red)}
.beat-tl-entry[data-type="check"] .beat-tl-node{background:var(--beat-ink-3)}
.beat-tl-body{flex:1;min-width:0;padding:0 2px 8px;border-bottom:1px dashed var(--beat-line);border-radius:4px;transition:background .12s}
.beat-tl-top{display:flex;align-items:center;gap:6px;color:var(--beat-ink-3);font-size:9px;font-family:var(--beat-mono)}
.beat-tl-time{color:var(--beat-ink-3)}
.beat-tl-ch{color:var(--beat-ink-3)}
.beat-tl-kind{font-family:var(--beat-sans,var(--beat-mono));font-size:8.5px;border-color:var(--beat-line-2);background:var(--beat-paper-2);color:var(--beat-ink-2)}
.beat-tl-entry[data-type="commit"] .beat-tl-kind{color:var(--beat-jade);border-color:var(--beat-jade-line);background:var(--beat-jade-soft)}
.beat-tl-entry[data-type="revert"] .beat-tl-kind{color:var(--beat-red);border-color:var(--beat-red-line);background:var(--beat-red-soft)}
.beat-tl-entry[data-type="verify"] .beat-tl-kind,.beat-tl-entry[data-type="waive"] .beat-tl-kind{color:var(--beat-amber);border-color:var(--beat-amber-line);background:var(--beat-amber-soft)}
.beat-tl-summary{font-size:11.5px;line-height:1.5;color:var(--beat-ink);margin-top:2px}
.beat-tl-meta{font:9px var(--beat-mono);color:var(--beat-ink-3);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.beat-tl-link{height:21px;margin-top:5px;padding:0 7px;border:1px solid var(--beat-red-line);border-radius:5px;background:var(--beat-red-soft);color:var(--beat-red);font:9.5px var(--beat-sans,sans-serif);cursor:pointer}
.beat-tl-foot{flex:none;height:29px;display:flex;align-items:center;padding:0 16px;border-top:1px solid var(--beat-line);color:var(--beat-ink-3);font:9px var(--beat-mono);background:linear-gradient(180deg,transparent,var(--beat-paper-2))}
/* health */
.beat-hl{flex:1;min-height:0;overflow:auto;padding:10px 16px 16px}
.beat-hl-head{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}
.beat-hl-title{font-size:13px;font-weight:600}
.beat-hl-chapter{font:9px var(--beat-mono);color:var(--beat-ink-3)}
.beat-hl-select{height:24px;max-width:150px;border:1px solid var(--beat-line-2);border-radius:6px;background:var(--beat-paper);color:var(--beat-ink);font:10px var(--beat-sans,sans-serif);padding:0 6px}
.beat-hl-summary{display:flex;align-items:center;gap:18px;margin-top:10px;padding:10px 12px;border:1px solid var(--beat-line);border-left:3px solid var(--beat-jade);border-radius:10px;background:var(--beat-card)}
.beat-hl-summary[data-level="block"]{border-left-color:var(--beat-red)}
.beat-hl-summary[data-level="warn"]{border-left-color:var(--beat-amber)}
.beat-hl-stat b{display:block;font:18px/1 var(--beat-mono);color:var(--beat-ink)}
.beat-hl-stat span{display:block;font-size:9px;color:var(--beat-ink-3);margin-top:3px}
.beat-hl-summary[data-level="block"] .beat-hl-stat:first-child b{color:var(--beat-red)}
.beat-hl-summary[data-level="warn"] .beat-hl-stat:nth-child(2) b{color:var(--beat-amber)}
.beat-hl-level{margin-left:auto;font-size:10px;color:var(--beat-ink-2);text-align:right}
.beat-hl-checks{display:grid;grid-template-columns:1fr 1fr;gap:1px 14px;margin-top:10px;padding:7px 0;border-top:1px solid var(--beat-line);border-bottom:1px solid var(--beat-line)}
.beat-hl-check{display:flex;align-items:center;gap:6px;height:24px;min-width:0}
.beat-hl-check-dot{width:5px;height:5px;border-radius:50%;flex:none;background:var(--beat-jade)}
.beat-hl-check[data-sev="warn"] .beat-hl-check-dot{background:var(--beat-amber)}
.beat-hl-check[data-sev="block"] .beat-hl-check-dot{background:var(--beat-red)}
.beat-hl-check[data-sev="info"] .beat-hl-check-dot{background:var(--beat-ink-3)}
.beat-hl-check-l{font-size:9.5px;color:var(--beat-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.beat-hl-check-n{margin-left:auto;font:8.5px var(--beat-mono);color:var(--beat-ink-3)}
.beat-hl-check[data-sev="block"] .beat-hl-check-n{color:var(--beat-red)}
.beat-hl-check[data-sev="warn"] .beat-hl-check-n{color:var(--beat-amber)}
.beat-hl-issues{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.beat-hl-issue{border:1px solid var(--beat-line);border-left:2px solid var(--beat-amber);border-radius:8px;background:var(--beat-card);padding:9px 10px}
.beat-hl-issue[data-sev="block"]{border-left-color:var(--beat-red)}
.beat-hl-issue[data-sev="info"]{border-left-color:var(--beat-ink-3)}
.beat-hl-issue-top{display:flex;align-items:center;gap:6px}
.beat-hl-code{font:9px var(--beat-mono);color:var(--beat-amber);letter-spacing:.02em}
.beat-hl-issue[data-sev="block"] .beat-hl-code{color:var(--beat-red)}
.beat-hl-issue[data-sev="info"] .beat-hl-code{color:var(--beat-ink-3)}
.beat-hl-count{margin-left:auto;font:9px var(--beat-mono);color:var(--beat-ink-3)}
.beat-hl-item{margin-top:6px}
.beat-hl-item-t{font-size:11px;color:var(--beat-ink)}
.beat-hl-item-d{font:9.5px var(--beat-mono);color:var(--beat-ink-3);line-height:1.5;margin-top:1px;word-break:break-word}
.beat-hl-action{height:23px;margin-top:7px;padding:0 8px;border:1px solid var(--beat-line-2);border-radius:5px;background:transparent;color:var(--beat-ink-2);font:9.5px var(--beat-sans,sans-serif);cursor:pointer}
.beat-hl-action:hover{background:var(--beat-paper-2);color:var(--beat-ink)}
.beat-hl-ok{display:flex;gap:10px;align-items:center;margin-top:12px;padding:12px;border:1px solid var(--beat-jade-line);border-radius:9px;background:var(--beat-jade-soft)}
.beat-hl-ok-mark{width:22px;height:22px;border-radius:50%;background:var(--beat-jade);color:var(--beat-paper);display:flex;align-items:center;justify-content:center;font-size:11px;flex:none}
.beat-hl-ok b{display:block;font-size:11.5px;color:var(--beat-ink)}
.beat-hl-ok span{display:block;font-size:9.5px;color:var(--beat-ink-2);margin-top:2px}
.beat-hl-note{margin-top:10px;padding:7px 8px;border:1px dashed var(--beat-line-2);border-radius:6px;color:var(--beat-ink-2);font-size:9.5px}
.beat-hl-foot{margin-top:12px;color:var(--beat-ink-3);font:9px var(--beat-mono);text-align:center}
/* compact editorial ledger */
.beat-root{
  --beat-amber:#797266;--beat-amber-soft:rgba(121,114,102,.08);--beat-amber-line:rgba(121,114,102,.22);
  --beat-grad:var(--beat-red);--beat-brand-2:var(--beat-ink-3);
  max-width:100%;min-width:0;overflow:hidden
}
body[data-ds-dark-theme] .beat-root{
  --beat-amber:#918a7f;--beat-amber-soft:rgba(145,138,127,.10);--beat-amber-line:rgba(145,138,127,.24);
  --beat-on-accent:#fbf9f4
}
.beat-head{padding:7px 12px 0}
.beat-eyes{margin-top:4px;gap:9px}
.beat-book{font-family:"Songti SC","STSong","SimSun",serif;font-size:14px;font-weight:600}
.beat-sub{margin-top:2px;font-size:9.5px}
.beat-ring{width:auto;height:auto;align-self:flex-end;padding:0 0 2px}
.beat-ring svg{display:none}
.beat-ring .ctr{position:static;display:flex;flex-direction:row;align-items:baseline;gap:2px;line-height:1}
.beat-ring .ctr b{font-size:10px;color:var(--beat-ink-2);font-weight:500}
.beat-ring .ctr span{font-size:9px;color:var(--beat-ink-3);margin:0}
.beat-stats{height:26px;margin-top:7px;border-top:1px solid var(--beat-line);border-bottom:1px solid var(--beat-line)}
.beat-stat{justify-content:center;padding:0 5px}
.beat-stat b,.beat-stat.t-jade b,.beat-stat.t-amber b{font-size:10.5px;font-weight:500;color:var(--beat-ink-2)}
.beat-stat span{font-size:9px}
.beat-tabs{margin-top:5px}
.beat-tab{height:31px}
.beat-filters{gap:5px;padding:7px 12px 6px}
.beat-list{padding:0 10px 6px}
.beat-chap{gap:8px;width:100%;min-height:55px;margin:5px 0;padding:7px 8px;border:1px solid var(--beat-line);border-radius:6px;background:var(--beat-card)}
.beat-chap:hover{background:var(--beat-paper-2)}
.beat-chap[data-open="1"]{background:var(--beat-paper-2);border-color:var(--beat-line-2)}
.beat-chap[data-open="1"]:before{display:none}
.beat-chap-no{width:24px;text-align:center;font-size:10.5px;font-weight:500;color:var(--beat-ink-3)}
.beat-chap[data-current="1"] .beat-chap-no,.beat-chap[data-open="1"] .beat-chap-no{color:var(--beat-red)}
.beat-chap-name,.beat-chap[data-current="1"] .beat-chap-name{font-size:12px;font-weight:600}
.beat-chap-meta{margin-top:2px;font-size:9px}
.beat-segbar{display:none}
.beat-chap-right{flex-direction:row;align-items:center;gap:5px}
.beat-chap-state{padding:1px 5px;border:1px solid var(--beat-line);border-radius:4px;background:var(--beat-paper-2);color:var(--beat-ink-3);font-size:8.5px;line-height:1.35}
.beat-chap-state.ok{color:var(--beat-jade);border-color:var(--beat-jade-line);background:var(--beat-jade-soft)}
.beat-chap-state.warn,.beat-chap-state.muted{color:var(--beat-ink-3);border-color:var(--beat-line);background:transparent}
.beat-chap[data-tone="stale"] .beat-chap-state{color:var(--beat-red);border-color:var(--beat-red-line);background:var(--beat-red-soft)}
.beat-decs{padding:0 2px 3px;border:0;background:transparent}
.beat-decs:before{display:none}
.beat-dec{align-items:flex-start;gap:7px;margin:4px 0;padding:7px;border:1px solid var(--beat-line);border-radius:5px;background:var(--beat-card)}
.beat-dec:hover{background:var(--beat-paper-2)}
.beat-dec[data-a="1"]{padding:7px;border-color:var(--beat-red-line);background:var(--beat-card);box-shadow:none}
.beat-dec[data-a="1"]:after{left:-1px;top:6px;bottom:6px;width:2px;background:var(--beat-red)}
.beat-seal{width:17px;height:17px;margin-top:0;border-radius:3px;transform:none;font-size:9px}
.beat-seal[data-state="open"]{color:var(--beat-ink-3);border-color:var(--beat-line);background:transparent;border-style:solid}
.beat-dec-title{font-family:"Songti SC","STSong","SimSun",serif;font-size:12px;line-height:1.4;font-weight:600}
.beat-dec-choice{font-size:10px}
.beat-dec-meta{gap:4px;margin-top:3px;font-size:8.5px}
.beat-kind{height:auto;padding:1px 4px;border-color:var(--beat-line);border-radius:3px;background:transparent;color:var(--beat-ink-3);font:8px/1.3 var(--beat-sans,sans-serif)}
.beat-dec-right{align-items:center;gap:4px;padding-top:0}
.beat-dec-badge{height:auto;padding:1px 5px;border:1px solid var(--beat-line);border-radius:4px;background:transparent;color:var(--beat-ink-3);font-size:8.5px;line-height:1.35}
.beat-dec[data-state="committed"] .beat-dec-badge{color:var(--beat-jade);border-color:var(--beat-jade-line);background:var(--beat-jade-soft)}
.beat-dec[data-state="open"] .beat-dec-badge,.beat-dec[data-state="legacy"] .beat-dec-badge{color:var(--beat-ink-3)}
.beat-detail{margin:5px 0 8px;border:1px solid var(--beat-line-2);border-radius:6px;background:var(--beat-card);box-shadow:none}
.beat-detail:before{display:none}
.beat-detail-inner{padding:9px 10px}
.beat-detail-stamp{display:none}
.beat-detail-top{padding-right:0}
.beat-detail-title{margin:4px 0 2px;font-family:"Songti SC","STSong","SimSun",serif;font-size:14px;line-height:1.45}
.beat-detail-change{font-size:9.5px;color:var(--beat-ink-2)}
.beat-gate{display:flex;flex-direction:column;gap:2px;margin-top:7px;padding:5px 0;border:0;border-top:1px solid var(--beat-line);border-bottom:1px solid var(--beat-line);border-radius:0;background:transparent;font-size:9px}
.beat-gate-title{font-size:8.5px;font-weight:500;color:var(--beat-ink-3)}
.beat-gate-delta{margin-top:0;color:var(--beat-ink);font:11px/1.5 "Songti SC","STSong","SimSun",serif}
.beat-gate-reason{margin-top:0;color:var(--beat-ink-3);font-size:8.5px}
.beat-evidence-list{margin-top:3px}
.beat-evidence-status{margin:2px 0;font-size:8px}
.beat-evidence{margin-top:0;padding:3px 1px;border:0;border-bottom:1px dotted var(--beat-line);border-radius:0;background:transparent;font-size:8px}
.beat-evidence summary{font-size:8px}
.beat-evidence blockquote{font-family:"Songti SC","STSong","SimSun",serif;font-size:10px}
.beat-cur{margin-top:7px;padding:6px 8px;border-color:var(--beat-line);border-radius:5px;background:transparent}
.beat-cur-mark{border:1px solid var(--beat-line);background:transparent;color:var(--beat-ink-3)}
.beat-cur[data-state="committed"]{border-color:var(--beat-jade-line);background:var(--beat-jade-soft)}
.beat-cur[data-state="committed"] .beat-cur-mark{border-color:var(--beat-jade);background:var(--beat-jade);color:var(--beat-paper)}
.beat-cur-v{font-size:10.5px}
.beat-cur-tag{border-color:var(--beat-line);color:var(--beat-ink-3);background:transparent}
.beat-cur[data-state="committed"] .beat-cur-tag{border-color:var(--beat-jade-line);color:var(--beat-jade)}
.beat-opts{gap:0;margin-top:5px}
.beat-opt{gap:7px;padding:6px 0;border-bottom:1px solid var(--beat-line);border-radius:0;font-size:10px;line-height:1.45}
.beat-opt:last-child{border-bottom:0}
.beat-opt-letter{width:18px;height:17px;margin-top:0;border:1px solid var(--beat-line);border-radius:3px;text-align:center;font-size:8.5px;line-height:15px;color:var(--beat-ink-3)}
.beat-opt[data-cur="1"] .beat-opt-letter{border-color:var(--beat-red-line);background:var(--beat-red-soft);color:var(--beat-red)}
.beat-opt-heading b{font-family:"Songti SC","STSong","SimSun",serif;font-size:11px}
.beat-opt[data-cur="1"] .beat-opt-heading b{color:var(--beat-red)}
.beat-style-fit{border-color:var(--beat-line);background:transparent;color:var(--beat-ink-3)}
.beat-opt-field{margin-top:2px;font-size:9.5px;line-height:1.45;color:var(--beat-ink-2)}
.beat-opt-delta{font-family:var(--beat-sans,sans-serif);font-size:8.5px;color:var(--beat-ink-3)}
.beat-style-why{color:var(--beat-ink-3)}
.beat-changes{gap:3px;margin-top:5px}
.beat-change{border-color:var(--beat-line);background:transparent;color:var(--beat-ink-3)}
.beat-seg{font-size:8.5px}
.beat-impact{margin-top:6px;padding:5px 7px;border:0;border-left:2px solid var(--beat-red);border-radius:0;background:var(--beat-red-soft);color:var(--beat-red);font-size:8.8px}
.beat-blocked{margin-top:6px;padding:5px 0;border:0;border-top:1px solid var(--beat-line);border-radius:0;color:var(--beat-ink-3);font-size:9px}
.beat-detail-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px;margin-top:7px}
.beat-btn{min-width:0;height:auto;min-height:30px;padding:5px 6px;white-space:normal;line-height:1.3;text-align:center;font-size:9.5px}
.beat-btn[data-p="1"]{background:var(--beat-red);border-color:var(--beat-red);color:var(--beat-on-accent)}
.beat-btn:focus-visible,.beat-sheet button:focus-visible,.beat-tab:focus-visible,.beat-chip:focus-visible,.beat-chap:focus-visible{outline:2px solid var(--beat-red);outline-offset:2px}
.beat-rejected{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:baseline;gap:5px;margin:4px 1px;padding:4px 2px;border:0;border-bottom:1px dashed var(--beat-line);border-radius:0;background:transparent;opacity:1;font-size:8.5px}
.beat-rejected-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--beat-ink-3);font-size:8.5px;font-weight:500}
.beat-rejected-options,.beat-rejected-note{display:none}
.beat-rejected-reason{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--beat-ink-3);font-size:8.5px}
.beat-notice{margin-right:12px;margin-left:12px}
.beat-banner{margin-right:12px;margin-left:12px}
.beat-sheet{max-width:100%;max-height:88%;overflow-x:hidden;overflow-y:auto;padding:8px 12px calc(12px + env(safe-area-inset-bottom,0px));border-radius:8px 8px 0 0;box-shadow:0 -8px 24px color-mix(in srgb,var(--beat-ink) 14%,transparent);overflow-wrap:anywhere}
.beat-sheet-stats{gap:0;margin-top:7px;border-top:1px solid var(--beat-line);border-bottom:1px solid var(--beat-line)}
.beat-sheet-stat{min-width:0;padding:5px 6px;border:0;border-left:1px solid var(--beat-line);border-radius:0;background:transparent;box-shadow:none}
.beat-sheet-stat:first-child{border-left:0;padding-left:0}
.beat-sheet-stat b{display:inline;font-size:11px;font-weight:500}
.beat-sheet-stat b em{font-size:8.5px}
.beat-sheet-stat span{display:inline;margin-left:4px;font-size:8.5px}
.beat-sheet-stat[data-tone="warn"] b{color:var(--beat-ink-2)}
.beat-sheet-list{margin-top:5px}
.beat-sheet-row{gap:6px;padding:5px 0;border-bottom:1px solid var(--beat-line)}
.beat-sheet-ico{width:14px;height:14px;border-radius:0;background:transparent;color:var(--beat-ink-3)}
.beat-sheet-k{font-size:8.5px;color:var(--beat-ink-3)}
.beat-sheet-v{font-size:9px;line-height:1.45;color:var(--beat-ink-2);overflow-wrap:anywhere}
.beat-sheet-save,.beat-sheet-stale{margin-top:6px;padding:5px 0;border:0;border-top:1px solid var(--beat-line);border-radius:0;background:transparent}
.beat-sheet-check{border-radius:2px;background:var(--beat-ink-2);color:var(--beat-paper)}
.beat-sheet-save-t,.beat-sheet-stale-t{font-size:9px;color:var(--beat-ink-2)}
.beat-sheet-save-s,.beat-sheet-stale-s{font-size:8.5px;color:var(--beat-ink-3)}
.beat-sheet-stale .beat-sheet-check[data-on="1"]{background:var(--beat-ink-2);color:var(--beat-paper)}
.beat-sheet-actions{gap:6px;margin-top:8px}
.beat-sheet-actions .beat-btn{min-height:34px;font-size:10px}
.beat-sheet-actions .beat-btn[data-p="0"]{flex:0 0 72px}
.beat-sheet-actions .beat-btn[data-p="1"],.beat-sheet-actions .beat-btn[data-p="1"][data-danger="1"]{background:var(--beat-red);border-color:var(--beat-red);color:var(--beat-on-accent)}
@media (prefers-reduced-motion:reduce){.beat-root *, .beat-root *:before, .beat-root *:after{transition-duration:0s!important;animation-duration:.01ms!important}}
`

    function formatNumber(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '0'
      return number.toLocaleString('en-US')
    }

    const KIND_TONE = {
      动作: '#a9701b', 知情: '#2e7d6b', 关系: '#c2452d', 得失: '#6e675c',
      状态: '#2e7d6b', 承诺: '#a9701b', 时序: '#6e675c', 分叉: '#c2452d',
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

    function formatDay(value) {
      if (!value) return '未知时间'
      try {
        return new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
      } catch {
        return '未知时间'
      }
    }

    function formatClock(value) {
      if (!value) return '—'
      try {
        return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      } catch {
        return '—'
      }
    }

    const TIMELINE_LABELS = {
      plan: '登记岔路', fork: '插旗', commit: '拍板', segment: '登记',
      revert: '回退', verify: '体检', waive: '豁免', override: '覆盖',
      stale: '待复核', check: '续写检查',
    }

    const HEALTH_CHECKS = [
      ['OPEN_DECISION', '未答决策'],
      ['AWAITING_SEGMENT', '未登记段落'],
      ['PENDING_CONFIRM', '待确认设定'],
      ['NEEDS_CHECK', '续写检查'],
      ['DRIFT', '段落漂移'],
      ['UNSEGMENTED', '未登记区间'],
      ['OVERDUE_OBLIGATION', '到期义务'],
      ['STALE', '待复核'],
      ['NO_ANCHOR', '旧账锚点'],
    ]

    function timelineFilterMatch(entry, filter) {
      if (filter === 'all') return true
      if (filter === 'commit') return entry.type === 'commit'
      if (filter === 'revert') return entry.type === 'revert'
      if (filter === 'segment') return entry.type === 'segment'
      if (filter === 'check') return ['verify', 'stale', 'check', 'waive', 'override'].includes(entry.type)
      if (filter === 'plan') return ['plan', 'fork'].includes(entry.type)
      return true
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

    function TabIcon({ name }) {
      const common = { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 }
      if (name === 'timeline') return h('svg', common, h('circle', { cx: 12, cy: 12, r: 9 }), h('path', { d: 'M12 7v5l3 2' }))
      if (name === 'health') return h('svg', common, h('path', { d: 'M4 13h4l2 5 4-12 2 7h4' }))
      return h('svg', common, h('path', { d: 'M4 6h16M4 12h16M4 18h10' }))
    }

    function Ring({ done = 0, total = 0 }) {
      const circumference = 2 * Math.PI * 18
      const complete = Math.max(0, Math.min(Number(done) || 0, Number(total) || 0))
      const ratio = total > 0 ? complete / total : 0
      return h('div', { className: 'beat-ring', 'data-empty': total > 0 ? '0' : '1', role: 'img', 'aria-label': `${formatNumber(complete)} / ${formatNumber(total)} 个决策已拍板` }, [
        h('svg', { key: 'svg', viewBox: '0 0 44 44', 'aria-hidden': 'true' }, [
          h('circle', { key: 'track', className: 'track', cx: 22, cy: 22, r: 18 }),
          h('circle', { key: 'val', className: 'val', cx: 22, cy: 22, r: 18, strokeDasharray: circumference, strokeDashoffset: circumference * (1 - ratio) }),
        ]),
        h('div', { className: 'ctr', key: 'ctr' }, [h('b', { key: 'done' }, formatNumber(complete)), h('span', { key: 'total' }, `/${formatNumber(total)}`)]),
      ])
    }

    function SegBar({ chapter, decisions = null }) {
      let states
      if (Array.isArray(decisions) && decisions.length > 0) {
        states = decisions.slice(0, 5).map((decision) => decision.legacy
          ? 'legacy'
          : (decision.status === 'committed' ? 'done' : 'open'))
      } else {
        const total = Math.max(0, Math.floor(Number(chapter.decisions) || 0))
        const legacy = chapter.legacy ? Math.min(total, Math.max(1, Number(chapter.noAnchor) || 0)) : 0
        const done = Math.max(0, (Number(chapter.committed) || 0) - legacy)
        const open = Math.max(0, Number(chapter.open) || 0)
        states = []
        const append = (state, count) => {
          for (let index = 0; index < count && states.length < 5; index += 1) states.push(state)
        }
        append('done', done)
        append('open', open)
        append('legacy', legacy)
        while (states.length < Math.min(total, 5)) states.push('done')
      }
      return h('span', { className: 'beat-segbar', 'aria-hidden': 'true' }, states.slice(0, 5).map((state, index) => h('i', { key: index, className: state })))
    }

    function Seal({ state }) {
      const legacy = state === 'legacy'
      const open = state === 'open'
      return h('span', { className: 'beat-seal', 'data-state': legacy ? 'legacy' : (open ? 'open' : 'committed'), 'aria-hidden': 'true' }, legacy ? '旧' : (open ? '待' : '定'))
    }

    function WarningIcon({ size = 11 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
        h('path', { d: 'M12 3l10 18H2L12 3z' }), h('path', { d: 'M12 9v5M12 17.5v.5' }))
    }

    function BeatDecisionDetail({ decision, chapter, total, onClose, returnFocusRef, onRewrite, onChoose, busy, on, transactionBlocked = false }) {
      const dialogRef = React.useRef(null)
      React.useEffect(() => {
        dialogRef.current?.focus?.()
      }, [decision?.id])
      const close = () => {
        onClose?.()
        returnFocusRef?.current?.focus?.()
      }
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation?.()
          close()
          return
        }
        if (event.key !== 'Tab') return
        const focusable = [...(event.currentTarget?.querySelectorAll?.('button:not([disabled]), summary, a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]
        if (!focusable.length) {
          event.preventDefault()
          dialogRef.current?.focus?.()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.target === event.currentTarget) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        } else if (event.shiftKey && event.target === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && event.target === last) {
          event.preventDefault()
          first.focus()
        }
      }
      const chosenLabel = decision.chosen?.label ?? ''
      const changes = decision.chosen?.changes ?? []
      const revert = decision.revert
      const later = Math.max(0, (revert?.decisionIds?.length ?? 0) - 1)
      const blocked = decision.revertBlockedReason
      const readOnly = on === false
      const evidenceInvalid = decision.evidenceStatus?.valid === false || decision.canCommit === false
      const stateName = (value, label) => label ? `${label} (${value || '未知'})` : (value || '未知')
      const refView = (ref, index, key) => {
        const location = ref.file
          ? `${ref.file}${Number.isInteger(ref.offsetStart) ? ` · ${ref.offsetStart}–${ref.offsetEnd}` : ''}`
          : ref.segmentId ? `段落 ${ref.segmentId}` : ref.sourceId ? `来源 ${ref.sourceId}` : ref.kind
        return h('details', { className: 'beat-evidence', key: `${key}-${index}` }, [
          h('summary', { key: 'summary' }, `证据 ${index + 1} · ${location}`),
          h('blockquote', { key: 'quote' }, `“${ref.quote || '（没有引文）'}”`),
          ref.hash ? h('code', { key: 'hash', title: ref.hash }, `SHA-256 ${ref.hash.slice(0, 12)}…${ref.hash.slice(-8)}`) : null,
        ])
      }
      const claimText = (claims) => Array.isArray(claims) ? claims.map((claim) => claim.text).filter(Boolean).join('；') : ''
      const evidenceValid = decision.evidenceStatus?.valid !== false
      const canRewind = decision.canRevert && !busy && !readOnly && !transactionBlocked && !evidenceInvalid
      return h('div', {
        ref: dialogRef,
        className: 'beat-detail',
        style: { '--beat-kind': kindTone(decision.kind) },
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'beat-detail-title',
        tabIndex: -1,
        onKeyDown,
      }, [
        h('span', { className: 'beat-detail-stamp', key: 'stamp', 'aria-hidden': 'true' }, [h('span', { key: 'zhu' }, '朱'), h('span', { key: 'pi' }, '批')]),
        h('div', { className: 'beat-detail-inner', key: 'inner' }, [
          h('div', { className: 'beat-detail-top', key: 'top' }, [
            h('span', { key: 'k' }, `第 ${chapter} 章 · 决策 ${decision.seq}/${total} · ${decision.id}`),
            h('span', { className: 'beat-spacer', key: 's' }),
            h('button', { key: 'x', type: 'button', className: 'beat-detail-close', onClick: close, title: '关闭详情', 'aria-label': '关闭详情' }, '×'),
          ]),
          h('div', { className: 'beat-detail-title', id: 'beat-detail-title', key: 'title' }, decision.title),
          h('div', { className: 'beat-detail-change', key: 'change' }, `这会改变：${decision.change || '—'}`),
          decision.gate ? h('div', { className: 'beat-gate', key: 'gate' }, [
            h('div', { className: 'beat-gate-title', key: 'title' }, `命中：${decision.gate.entityLabel || decision.gate.entity} / ${decision.gate.key}${decision.gate.keyLabel ? ` · ${decision.gate.keyLabel}` : ''}`),
            h('div', { className: 'beat-gate-delta', key: 'delta' }, `${stateName(decision.gate.from, decision.gate.fromLabel)} → ${stateName(decision.gate.to, decision.gate.toLabel)}`),
            h('div', { className: 'beat-gate-reason', key: 'reason' }, `打断理由：${decision.gate.reason || decision.change || '—'}`),
          ]) : null,
          decision.gate?.evidence?.length ? h('div', { className: 'beat-evidence-list', key: 'evidence' }, [
            h('div', { className: 'beat-evidence-status', 'data-invalid': evidenceValid ? '0' : '1', key: 'status' }, evidenceValid
              ? (decision.evidenceStatus?.valid === true ? '正文 hash 与引用已校验 · 点开引文可回查' : '证据状态待核验')
              : `证据已失效，禁止拍板：${decision.evidenceStatus?.message ?? decision.evidenceStatus?.code ?? '来源无法核验'}`),
            ...decision.gate.evidence.map((ref, index) => refView(ref, index, 'gate')),
          ]) : null,
          h('div', { className: 'beat-cur', 'data-state': decision.chosen ? 'committed' : 'open', key: 'cur' }, [
            h('span', { className: 'beat-cur-mark', key: 'm' }, decision.chosen ? '✓' : '·'),
            h('div', { className: 'beat-cur-grow', key: 'g' }, [
              h('div', { className: 'beat-cur-k', key: 'k' }, '当前选择'),
              h('div', { className: 'beat-cur-v', key: 'v' }, chosenLabel || '还没拍板'),
            ]),
            h('span', { className: 'beat-cur-tag', key: 't' }, decision.chosen ? '已落账' : '待问'),
          ]),
          h('div', { className: 'beat-opts', key: 'opts' }, (decision.options ?? []).map((option, index) => h('div', {
            className: 'beat-opt',
            key: option.label,
            'data-cur': option.label === chosenLabel ? '1' : '0',
            tabIndex: 0,
          }, [
            h('span', { className: 'beat-opt-letter', key: 'letter' }, String.fromCharCode(65 + index)),
            h('span', { className: 'beat-opt-label', key: 'l' }, [
              h('div', { className: 'beat-opt-heading', key: 'label' }, [
                h('b', { key: 'name' }, option.label),
                option.styleFit ? h('span', { className: 'beat-style-fit', title: option.styleFit.explanation, key: 'fit' }, `贴合 ${option.styleFit.score}/100 · 仅建议`) : null,
              ]),
              h('div', { className: 'beat-opt-field', key: 'action' }, `动作：${option.action || option.impact || '—'}`),
              h('div', { className: 'beat-opt-field', key: 'costs' }, `代价：${option.costs?.join('；') || '—'}`),
              h('div', { className: 'beat-opt-field', key: 'outcomes' }, `预期后果：${claimText(option.outcomes) || '—'}`),
              h('div', { className: 'beat-opt-field', key: 'gain' }, `信息增量：${claimText(option.informationGain) || '—'}`),
              h('div', { className: 'beat-opt-field', key: 'risks' }, `风险：${claimText(option.risks) || '—'}`),
              h('div', { className: 'beat-opt-field beat-opt-delta', key: 'delta' }, `状态差分：${(option.changes ?? []).map((change) => `${change.entity}.${change.key}: ${stateName(change.from, change.fromLabel)} → ${stateName(change.to, change.toLabel)}`).join('；') || '—'}`),
              option.styleFit?.explanation ? h('div', { className: 'beat-style-why', key: 'why' }, option.styleFit.explanation) : null,
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
              : blocked === 'stale-evidence'
                ? `证据已失效，禁止回退或改选：${decision.evidenceStatus?.message ?? decision.evidenceStatus?.code ?? '请重新登记有效证据。'}`
              : blocked === 'not-committed'
                ? '这条决策还没拍板，等模型问到它再定。'
                : '这条决策还没有登记正文段落，只能查看，不能回退正文。'),
          h('div', { className: 'beat-detail-actions', key: 'actions' }, [
            h('button', {
              key: 'rewind', type: 'button', className: 'beat-btn', 'data-p': '1',
              disabled: !canRewind,
              title: evidenceInvalid ? '证据已失效，禁止回退或改选' : (transactionBlocked ? '书处于事务隔离/恢复状态，禁止回退' : (readOnly ? '先开启拍板' : (decision.canRevert ? '保留当前选择，回到这一段重写' : '没有正文锚点，不能回退'))),
              onClick: () => onRewrite?.(decision),
            }, busy ? '处理中…' : '回到这里重写'),
            h('button', {
              key: 'choose', type: 'button', className: 'beat-btn',
              disabled: !canRewind,
              title: evidenceInvalid ? '证据已失效，禁止回退或改选' : (transactionBlocked ? '书处于事务隔离/恢复状态，禁止回退' : (readOnly ? '先开启拍板' : (decision.canRevert ? '选另一个走向再重写' : '没有正文锚点，不能改选'))),
              onClick: () => onChoose?.(decision),
            }, '改选另一个走向'),
          ]),
        ]),
      ])
    }

    function BeatRewindSheet({ sheet, decision, onClose, onSelect, onConfirm, onRefreshPlan, onRefreshStatus, onToggleSnapshot }) {
      const dialogRef = React.useRef(null)
      React.useEffect(() => {
        if (sheet) dialogRef.current?.focus?.()
      }, [sheet?.decision?.id])
      if (!sheet) return null
      const plan = sheet.plan
      const isChoose = sheet.mode === 'choose'
      const options = decision?.options ?? []
      const canon = plan?.canon ?? []
      const later = plan?.laterChapters ?? []
      const reopened = plan?.reopened ?? []
      const removed = plan?.removedChars ?? 0
      const segmentCount = plan?.segments?.length ?? 0
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
          return
        }
        if (event.key !== 'Tab') return
        const focusable = [...(event.currentTarget?.querySelectorAll?.('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]
        if (!focusable.length) {
          event.preventDefault()
          dialogRef.current?.focus?.()
          return
        }
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.target === event.currentTarget) {
          event.preventDefault()
          ;(event.shiftKey ? last : first).focus()
        } else if (event.shiftKey && event.target === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && event.target === last) {
          event.preventDefault()
          first.focus()
        }
      }
      const tx = sheet.transactionStatus?.latest
      return h('div', { ref: dialogRef, className: 'beat-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'beat-sheet-title', tabIndex: -1, onKeyDown }, [
        h('div', { className: 'beat-grab', key: 'grab' }),
        h('h2', { id: 'beat-sheet-title', key: 'title' }, isChoose ? `改选「${decision?.title ?? ''}」并重写` : `回到「${decision?.title ?? ''}」`),
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
          h('div', { className: 'beat-sheet-row', key: 'tx' }, [
            h('span', { className: 'beat-sheet-ico', key: 'i' }, 'ID'),
            h('div', { className: 'beat-sheet-grow', key: 'g' }, [
              h('div', { className: 'beat-sheet-k', key: 'k' }, '事务与版本'),
              h('div', { className: 'beat-sheet-v', key: 'v' }, [
                `事务 ID：${tx?.txId ?? '确认时生成'} · 账本 revision：${plan.expectedRevision ?? '—'} → ${Number.isInteger(plan.expectedRevision) ? plan.expectedRevision + 1 : '提交后确定'} · 正文 revision：${decision.segment?.revisionId ?? '—'}`,
                h('br', { key: 'br' }),
                `正文 SHA-256：${plan.expectedBodyHash ? `${plan.expectedBodyHash.slice(0, 12)}…${plan.expectedBodyHash.slice(-8)}` : '待核验'} · 账本 SHA-256：${plan.expectedLedgerHash ? `${plan.expectedLedgerHash.slice(0, 12)}…${plan.expectedLedgerHash.slice(-8)}` : '待核验'}`,
              ]),
            ]),
          ]),
          h('div', { className: 'beat-sheet-row', key: 'pair' }, [
            h('span', { className: 'beat-sheet-ico', key: 'i' }, '快'),
            h('div', { className: 'beat-sheet-grow', key: 'g' }, [
              h('div', { className: 'beat-sheet-k', key: 'k' }, '成对快照'),
              h('div', { className: 'beat-sheet-v', key: 'v' }, tx?.snapshots
                ? `正文 ${tx.snapshots.body.verified ? 'hash 已校验' : '快照待核验'} · 账本 ${tx.snapshots.ledger.verified ? 'hash 已校验' : '快照待核验'}`
                : '确认前尚未创建；提交事务时会先保存正文与账本 before 快照。'),
            ]),
          ]),
          tx ? h('div', { className: 'beat-sheet-row', key: 'stage' }, [
            h('span', { className: 'beat-sheet-ico', key: 'i' }, '态'),
            h('div', { className: 'beat-sheet-grow', key: 'g' }, [
              h('div', { className: 'beat-sheet-k', key: 'k' }, '最近一次事务'),
              h('div', { className: 'beat-sheet-v', key: 'v' }, `${tx.txId} · ${tx.stage} · 后续复核 ${tx.staleStatus ?? '—'}${tx.staleChapters?.length ? `（第 ${tx.staleChapters.join('、')} 章）` : ''} · 简报 ${tx.briefStatus ?? '—'}`),
            ]),
          ]) : null,
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
          h('div', { key: 'check', className: 'beat-sheet-check', 'data-on': '1', title: '回退提交后会标记为待复核' }, '✓'),
          h('div', { className: 'beat-sheet-grow', key: 'g' }, [
            h('div', { className: 'beat-sheet-stale-t', key: 't' }, '后续章节提交后标记为待复核'),
            h('div', { className: 'beat-sheet-stale-s', key: 's' }, `第 ${plan.laterChapters.join('、')} 章只加标记，不动正文；侧栏会显示「待复核」。`),
          ]),
        ]) : null,
        plan && plan.warnings?.length > 0 ? h('div', { className: 'beat-sheet-warn', key: 'warn' }, [
          h(WarningIcon, { key: 'icon' }),
          h('span', { key: 't' }, plan.warnings.join(' ')),
        ]) : null,
        sheet.error ? h('div', { className: 'beat-sheet-error', key: 'error', role: 'alert' }, [
          h('b', { key: 'title' }, sheet.errorCode === 'stale-evidence'
            ? '证据已失效，不能回退或改选。'
            : sheet.errorCode === 'body-hash-conflict' || sheet.errorCode === 'revision-conflict' || sheet.errorCode === 'stale'
            ? '正文或账本已变化，不能按旧预览回退。'
            : sheet.errorCode === 'tx-recovery-failed' || sheet.errorCode === 'book-quarantined'
              ? '事务恢复失败，书已进入只读隔离。'
              : sheet.errorCode === 'transaction-recovery-pending' ? '事务恢复尚未完成。' : '操作失败。'),
          h('div', { key: 'message' }, sheet.error),
          h('div', { className: 'beat-sheet-error-actions', key: 'actions' }, [
            sheet.errorCode === 'body-hash-conflict' || sheet.errorCode === 'revision-conflict' || sheet.errorCode === 'stale'
              ? h('button', { key: 'refresh', type: 'button', onClick: onRefreshPlan }, '刷新影响预览') : null,
            sheet.errorCode === 'tx-recovery-failed' || sheet.errorCode === 'book-quarantined' || sheet.errorCode === 'transaction-recovery-pending'
              ? h('button', { key: 'status', type: 'button', onClick: onRefreshStatus }, '刷新事务状态') : null,
          ]),
        ]) : null,
        h('div', { className: 'beat-sheet-actions', key: 'actions' }, [
          h('button', { key: 'cancel', type: 'button', className: 'beat-btn', 'data-p': '0', onClick: onClose, disabled: sheet.busy }, '取消'),
          h('button', {
            key: 'ok', type: 'button', className: 'beat-btn', 'data-p': '1', 'data-danger': '1',
            disabled: sheet.busy || !plan || sheet.blocked || sheet.transactionStatus?.blocked,
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
      const [activeTab, setActiveTab] = React.useState('map')
      const [timeline, setTimeline] = React.useState({ phase: 'idle', data: null, error: null })
      const [health, setHealth] = React.useState({ phase: 'idle', data: null, error: null })
      const [tlFilter, setTlFilter] = React.useState('all')
      const [healthChapter, setHealthChapter] = React.useState(null)
      const [search, setSearch] = React.useState({ phase: 'idle', q: '', data: null, error: null })
      const [searchQ, setSearchQ] = React.useState('')
      const searchTimer = React.useRef(null)
      const searchSeq = React.useRef(0)
      const seq = React.useRef(0)
      const chapterSeq = React.useRef(0)
      const decisionReturnFocusRef = React.useRef(null)

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

      const loadTimeline = async (force = false) => {
        if (!sid || !remote || typeof remote.timeline !== 'function') {
          setTimeline({ phase: 'error', data: null, error: 'remote 未就绪：请重载后端。' })
          return
        }
        if (!force && timeline.phase !== 'idle' && timeline.phase !== 'error') return
        setTimeline((prev) => ({ phase: 'loading', data: prev.data, error: null }))
        try {
          const value = unwrap(await remote.timeline(sid, { limit: 60 }))
          if (value?.ok === false) throw new Error(value.message ?? value.code ?? '时间线读取失败')
          setTimeline({ phase: 'ready', data: value, error: null })
        } catch (error) {
          setTimeline({ phase: 'error', data: null, error: String(error?.message ?? error) })
        }
      }

      const loadHealth = async (chapter, force = false) => {
        if (!sid || !remote || typeof remote.health !== 'function') {
          setHealth({ phase: 'error', data: null, error: 'remote 未就绪：请重载后端。' })
          return
        }
        const target = Number.isInteger(chapter) ? chapter : (healthChapter ?? open ?? view.data?.currentChapter ?? null)
        if (target == null) {
          setHealth({ phase: 'ready', data: { ok: true, book: view.data?.book ?? null, chapter: null, level: 'ok', issues: [], counts: { block: 0, warn: 0, info: 0 }, textAvailable: false }, error: null })
          return
        }
        if (!force && health.phase === 'ready' && health.data?.chapter === target) return
        setHealth((prev) => ({ phase: 'loading', data: prev.data, error: null }))
        try {
          const value = unwrap(await remote.health(sid, { chapter: target }))
          if (value?.ok === false) throw new Error(value.message ?? value.code ?? '体检读取失败')
          setHealthChapter(target)
          setHealth({ phase: 'ready', data: value, error: null })
        } catch (error) {
          setHealth({ phase: 'error', data: null, error: String(error?.message ?? error) })
        }
      }

      const runSearch = async (value, immediate = false) => {
        const q = String(value ?? '')
        setSearchQ(q)
        if (searchTimer.current) clearTimeout(searchTimer.current)
        const query = q.trim()
        if (!query) {
          setSearch({ phase: 'idle', q: '', data: null, error: null })
          return
        }
        const fire = async () => {
          if (!sid || !remote || typeof remote.search !== 'function') {
            setSearch({ phase: 'error', q: query, data: null, error: 'remote 未就绪：请重载后端。' })
            return
          }
          const my = ++searchSeq.current
          setSearch({ phase: 'loading', q: query, data: null, error: null })
          try {
            const data = unwrap(await remote.search(sid, { q: query, limit: 20 }))
            if (my !== searchSeq.current) return
            if (data?.ok === false) throw new Error(data.message ?? data.code ?? '搜索失败')
            setSearch({ phase: 'ready', q: query, data, error: null })
          } catch (error) {
            if (my !== searchSeq.current) return
            setSearch({ phase: 'error', q: query, data: null, error: String(error?.message ?? error) })
          }
        }
        if (immediate) {
          await fire()
        } else {
          searchTimer.current = setTimeout(fire, 250)
        }
      }

      const clearSearch = () => {
        if (searchTimer.current) clearTimeout(searchTimer.current)
        searchSeq.current += 1
        setSearchQ('')
        setSearch({ phase: 'idle', q: '', data: null, error: null })
      }

      const switchTab = (tab) => {
        setActiveTab(tab)
        if (tab === 'timeline') loadTimeline()
        if (tab === 'health') loadHealth(open ?? view.data?.currentChapter ?? null)
      }

      const refreshAll = async () => {
        setTimeline({ phase: 'idle', data: null, error: null })
        setHealth({ phase: 'idle', data: null, error: null })
        clearSearch()
        await load()
        if (activeTab === 'timeline') loadTimeline(true)
        if (activeTab === 'health') loadHealth(healthChapter ?? open ?? view.data?.currentChapter ?? null, true)
      }

      React.useEffect(() => {
        setChapters({})
        setOpen(null)
        setSelected(null)
        setSheet(null)
        setNotice(null)
        setOldLine(null)
        setTimeline({ phase: 'idle', data: null, error: null })
        setHealth({ phase: 'idle', data: null, error: null })
        setTlFilter('all')
        setHealthChapter(null)
        setSearch({ phase: 'idle', q: '', data: null, error: null })
        setSearchQ('')
        if (searchTimer.current) clearTimeout(searchTimer.current)
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
        if (view.data?.transactionStatus?.blocked) {
          setNotice({ text: '本书事务处于隔离或恢复状态，回退已暂停。请先刷新事务状态。', error: true })
          return
        }
        const returnFocus = typeof document !== 'undefined' ? document.activeElement : null
        const transactionStatus = view.data?.transactionStatus ?? null
        setSheet({ decision, mode, choice, plan: null, busy: true, error: null, errorCode: null, snapshot: true, returnFocus, transactionStatus, blocked: Boolean(transactionStatus?.blocked) })
        try {
          const plan = requireBusinessOk(unwrap(await remote.impact(sid, decision.id, { choice })))
          setSheet((prev) => (prev && prev.decision?.id === decision.id
            ? { ...prev, plan, busy: false, error: null, errorCode: null }
            : prev))
        } catch (error) {
          setSheet((prev) => (prev ? { ...prev, plan: null, busy: false, error: String(error?.message ?? error), errorCode: error?.code ?? null, blocked: ['book-quarantined', 'transaction-recovery-pending'].includes(error?.code) } : prev))
        }
      }

      const closeSheet = () => {
        const target = sheet?.returnFocus
        setSheet(null)
        if (target?.isConnected && typeof target.focus === 'function') queueMicrotask(() => target.focus())
      }

      const refreshImpact = async () => {
        if (!sheet || sheet.busy) return
        setSheet((prev) => prev ? { ...prev, busy: true, plan: null, error: null, errorCode: null } : prev)
        try {
          const plan = requireBusinessOk(unwrap(await remote.impact(sid, sheet.decision.id, { choice: sheet.choice })))
          setSheet((prev) => prev ? { ...prev, plan, busy: false, error: null, errorCode: null } : prev)
        } catch (error) {
          setSheet((prev) => prev ? { ...prev, plan: null, busy: false, error: String(error?.message ?? error), errorCode: error?.code ?? null } : prev)
        }
      }

      const refreshTransactionStatus = async () => {
        if (!sid || !remote || typeof remote.overview !== 'function') return
        try {
          const data = unwrap(await remote.overview(sid))
          setView({ phase: 'ready', data, error: null })
          setSheet((prev) => prev ? {
            ...prev,
            transactionStatus: data?.transactionStatus ?? null,
            blocked: Boolean(data?.transactionStatus?.blocked),
            error: null,
            errorCode: null,
          } : prev)
          if (!data?.transactionStatus?.blocked) await refreshImpact()
        } catch (error) {
          setSheet((prev) => prev ? { ...prev, error: String(error?.message ?? error), errorCode: error?.code ?? null } : prev)
        }
      }

      const rewrite = (decision) => openSheet(decision, 'keep', 'keep')
      const choose = (decision) => openSheet(decision, 'choose', decision.chosen?.label ?? decision.options?.[0]?.label ?? 'keep')

      const selectChoice = async (choice) => {
        if (!sheet || sheet.busy) return
        setSheet((prev) => ({ ...prev, choice, busy: true, error: null }))
        try {
          const plan = requireBusinessOk(unwrap(await remote.impact(sid, sheet.decision.id, { choice })))
          setSheet((prev) => (prev ? { ...prev, plan, busy: false, errorCode: null } : prev))
        } catch (error) {
          setSheet((prev) => (prev ? { ...prev, plan: null, busy: false, error: String(error?.message ?? error), errorCode: error?.code ?? null } : prev))
        }
      }

      const confirmSheet = async () => {
        if (!sheet || !sheet.plan || sheet.busy) return
        setSheet((prev) => ({ ...prev, busy: true, error: null }))
        try {
          const result = requireBusinessOk(unwrap(await remote.rewind(sid, sheet.decision.id, {
            choice: sheet.choice,
            confirm: true,
            snapshot: sheet.snapshot !== false,
            expectedBookUpdatedAt: sheet.plan.expectedBookUpdatedAt ?? view.data?.bookUpdatedAt ?? null,
            expectedRevision: sheet.plan.expectedRevision ?? view.data?.revision ?? null,
            expectedBodyHash: sheet.plan.expectedBodyHash ?? null,
            expectedLedgerHash: sheet.plan.expectedLedgerHash ?? null,
          })))
          setSheet(null)
          setSelected(null)
          setNotice({
            text: `${result.resume?.message ?? '已回退。'} 事务 ${result.txId ?? '—'} · revision ${result.transactionRevision ?? '—'}`,
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
          setSheet((prev) => (prev ? { ...prev, busy: false, error: String(error?.message ?? error), errorCode: error?.code ?? null, blocked: ['book-quarantined', 'transaction-recovery-pending', 'tx-recovery-failed'].includes(error?.code) } : prev))
          if (['book-quarantined', 'transaction-recovery-pending', 'tx-recovery-failed'].includes(error?.code)) await refreshTransactionStatus()
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
        h('div', { className: 'beat-top beat-eyebrow', key: 'top' }, [
          h('span', { key: 'label' }, '拍板台 · DECISION LEDGER'),
          h('span', { className: 'beat-spacer', key: 's' }),
          h('button', {
            key: 'refresh', type: 'button', className: 'beat-icon', title: '刷新账本',
            onClick: () => refreshAll(), 'aria-label': '刷新账本',
          }, h(RefreshIcon)),
        ]),
        h('div', { className: 'beat-eyes', key: 'eyes' }, [
          h('div', { className: 'beat-chap-grow', key: 'grow' }, [
            h('div', { className: 'beat-book', key: 'book' }, data?.book ?? '还没有拍板账本'),
            h('div', { className: 'beat-sub', key: 'sub' }, [
              h('span', { className: 'beat-mode', 'data-on': data?.on ? '1' : '0', key: 'mode' }, [h('i', { key: 'dot' }), `拍板：${data?.on ? '开' : '关'}`]),
              h('span', { className: 'beat-dotsep', key: 'dot1' }),
              h('span', { key: 'updated' }, data?.bookUpdatedAt ? `更新 ${formatTime(data.bookUpdatedAt)}` : '本地账本'),
              h('span', { className: 'beat-dotsep', key: 'dot2' }),
              data?.currentChapter
                ? h('span', { key: 'current' }, ['第 ', h('b', { key: 'num' }, formatNumber(data.currentChapter)), ' 章在写'])
                : h('span', { key: 'current' }, '暂无在写章节'),
            ]),
          ]),
          h(Ring, { key: 'ring', done: stats.committed, total: stats.decisions }),
        ]),
        h('div', { className: 'beat-stats', key: 'stats' }, [
          h('div', { className: 'beat-stat', key: 'ch' }, [h('b', { key: 'b' }, formatNumber(stats.chapters)), h('span', { key: 's' }, '章')]),
          h('div', { className: 'beat-stat', key: 'de' }, [h('b', { key: 'b' }, formatNumber(stats.decisions)), h('span', { key: 's' }, '决策')]),
          h('div', { className: 'beat-stat t-jade', key: 'se' }, [h('b', { key: 'b' }, formatNumber(stats.segments)), h('span', { key: 's' }, '段落')]),
          h('div', { className: 'beat-stat t-amber', key: 'chars' }, [h('b', { key: 'b' }, formatNumber(stats.chars)), h('span', { key: 's' }, '字')]),
        ]),
        h('div', { className: 'beat-tabs', key: 'tabs', role: 'tablist', 'aria-label': '账本视图' }, [
          h('button', { key: 'map', type: 'button', className: 'beat-tab', 'data-a': activeTab === 'map' ? '1' : '0', role: 'tab', 'aria-selected': activeTab === 'map', onClick: () => switchTab('map') }, [h(TabIcon, { key: 'icon', name: 'map' }), '决策地图']),
          h('button', { key: 'timeline', type: 'button', className: 'beat-tab', 'data-a': activeTab === 'timeline' ? '1' : '0', role: 'tab', 'aria-selected': activeTab === 'timeline', onClick: () => switchTab('timeline') }, [h(TabIcon, { key: 'icon', name: 'timeline' }), '时间线', h('b', { key: 'count' }, formatNumber(timeline.data?.total ?? stats.decisions))]),
          h('button', { key: 'health', type: 'button', className: 'beat-tab', 'data-a': activeTab === 'health' ? '1' : '0', role: 'tab', 'aria-selected': activeTab === 'health', onClick: () => switchTab('health') }, [h(TabIcon, { key: 'icon', name: 'health' }), '体检', health.phase === 'ready' && health.data?.counts ? (health.data.counts.block + health.data.counts.warn > 0 ? h('b', { key: 'count', className: 'beat-tab-warn' }, `${health.data.counts.block + health.data.counts.warn}`) : null) : null]),
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
      } else if (searchQ.trim()) {
        const result = search.data
        const hits = result?.hits ?? []
        const jumpTo = (hit) => {
          if (!Number.isInteger(hit.chapter)) return
          setActiveTab('map')
          setOpen(hit.chapter)
          setSelected(hit.kind === 'decision' ? hit.id : null)
          clearSearch()
        }
        if (search.phase === 'loading' || (!result && search.phase !== 'error')) {
          body = h('div', { className: 'beat-list', key: 'search-loading' }, [0, 1, 2].map((index) => h('div', { className: 'beat-skel', key: index })))
        } else if (search.phase === 'error') {
          body = h('div', { className: 'beat-error', key: 'search-error' }, [
            h('div', { key: 'm' }, `搜索失败：${search.error}`),
            h('button', { key: 'r', type: 'button', onClick: () => runSearch(searchQ, true) }, '重试'),
          ])
        } else if (hits.length === 0) {
          body = h('div', { className: 'beat-empty', key: 'search-empty' }, [
            h('b', { key: 't' }, `没有找到「${result?.q ?? searchQ}」`),
            h('div', { key: 's' }, '试试人物名（陈凡）或设定名（对东宫的态度）。'),
          ])
        } else {
          body = h('div', { className: 'beat-search-results', key: 'search-results' }, [
            h('div', { className: 'beat-search-head', key: 'head' }, `找到 ${formatNumber(result?.total ?? hits.length)} 条 · ${result?.q ?? searchQ}`),
            ...hits.map((hit) => h('div', {
              className: 'beat-sr', key: `${hit.kind}:${hit.id}`, 'data-kind': hit.kind,
              role: 'button', tabIndex: 0,
              onClick: () => jumpTo(hit),
              onKeyDown: (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                jumpTo(hit)
              },
            }, [
              h('div', { className: 'beat-sr-top', key: 'top' }, [
                h('span', { className: 'beat-sr-kind', key: 'kind' }, hit.kind === 'decision' ? '决策' : (hit.kind === 'canon' ? '设定' : '义务')),
                hit.chapter ? h('span', { key: 'ch' }, `第 ${hit.chapter} 章`) : null,
                h('span', { className: 'beat-sr-id', key: 'id' }, hit.id),
              ]),
              h('div', { className: 'beat-sr-title', key: 'title' }, hit.title ?? hit.id),
              hit.choice ? h('div', { className: 'beat-sr-choice', key: 'choice' }, `→ ${hit.choice}`) : null,
              h('div', { className: 'beat-sr-snippet', key: 'snippet' }, hit.snippet ?? ''),
            ])),
          ])
        }
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
          const chapterDecisions = chapterState?.phase === 'ready' ? chapterState.data?.decisions : null
          rows.push(h('button', {
            key: `ch-${chapter.chapter}`,
            type: 'button',
            className: 'beat-chap',
            'data-open': isOpen ? '1' : '0',
            'data-tone': tone,
            'data-current': chapter.chapter === data?.currentChapter ? '1' : '0',
            onClick: () => toggle(chapter.chapter),
            'aria-expanded': isOpen,
          }, [
            h('span', { className: 'beat-chap-no', key: 'no' }, String(chapter.chapter).padStart(2, '0')),
            h('span', { className: 'beat-chap-grow', key: 'grow' }, [
              h('span', { className: 'beat-chap-line', key: 'line' }, [
                h('span', { className: 'beat-chap-name', key: 'name' }, chapter.title ?? `第 ${chapter.chapter} 章`),
              ]),
              h('span', { className: 'beat-chap-meta', key: 'meta' }, [
                h('span', { key: 'd' }, [h('b', { key: 'b' }, formatNumber(chapter.decisions)), ' 决策']),
                h('span', { key: 'dot2' }, '·'),
                h('span', { key: 's' }, [h('b', { key: 'b2' }, formatNumber(chapter.segments)), ' 段']),
                h('span', { key: 'dot3' }, '·'),
                h('span', { key: 'c' }, [h('b', { key: 'b3' }, formatNumber(chapter.chars)), ' 字']),
              ]),
              h(SegBar, { key: 'segments', chapter, decisions: chapterDecisions }),
            ]),
            h('span', { className: 'beat-chap-right', key: 'right' }, [
              h('span', { className: `beat-badge beat-chap-state ${badge.className}`, key: 'badge' }, badge.text),
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
          const rejected = chapterState.data?.rejectedCandidates ?? []
          const voiceFit = chapterState.data?.voiceFit
          rows.push(h('div', { className: 'beat-decs', key: `decs-${chapter.chapter}` }, [
            voiceFit ? h('div', { className: 'beat-voice-status', 'data-available': voiceFit.available ? '1' : '0', key: 'voice-status' }, [
              h('b', { key: 'label' }, voiceFit.available ? `voice ${voiceFit.label} · v${voiceFit.profileVersion ?? '—'}` : '仅建议/未接入'),
              h('span', { key: 'message' }, voiceFit.message ?? voiceFit.reason ?? '使用默认顺序，voice 不影响拍板数据。'),
            ]) : null,
            decisions.length === 0
              ? h('div', { className: 'beat-empty', key: 'empty', style: { padding: '14px 8px' } }, '这一章没有决策点')
              : decisions.map((decision) => {
              const active = selected === decision.id
              const decisionState = decision.legacy ? 'legacy' : (decision.status === 'committed' ? 'committed' : 'open')
              const decisionStatus = decision.legacy ? '旧账' : (decision.status === 'committed' ? '已拍板' : '待拍板')
              return h('div', { className: 'beat-dec-block', key: decision.id }, [
                h('div', {
                  className: 'beat-dec',
                  key: 'row',
                  'data-a': active ? '1' : '0',
                  'data-state': decisionState,
                  role: 'button',
                  tabIndex: 0,
                  onClick: (event) => {
                    decisionReturnFocusRef.current = event.currentTarget
                    setSelected(active ? null : decision.id)
                  },
                  onKeyDown: (event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    decisionReturnFocusRef.current = event.currentTarget
                    setSelected(active ? null : decision.id)
                  },
                }, [
                  h(Seal, { key: 'seal', state: decisionState }),
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
                    h('span', { className: 'beat-dec-badge', key: 'badge' }, decisionStatus),
                    h(ChevronIcon, { key: 'chev' }),
                  ]),
                ]),
                active ? h(BeatDecisionDetail, {
                  key: 'detail',
                  decision,
                  chapter: chapter.chapter,
                  total: decisions.length,
                  onClose: () => setSelected(null),
                  returnFocusRef: decisionReturnFocusRef,
                  onRewrite: rewrite,
                  onChoose: choose,
                  busy: Boolean(sheet),
                  on: data?.on === true,
                  transactionBlocked: Boolean(data?.transactionStatus?.blocked),
                }) : null,
              ])
            }),
            rejected.map((entry) => h('div', { className: 'beat-rejected', key: entry.id, 'aria-disabled': 'true' }, [
              h('div', { className: 'beat-rejected-title', key: 'title' }, `${entry.title || '候选'} · 已拒收的假分叉`),
              h('div', { className: 'beat-rejected-options', key: 'options' }, entry.options.map((option) => option.label).join(' / ')),
              h('div', { className: 'beat-rejected-reason', key: 'reason' }, entry.reason),
              h('div', { className: 'beat-rejected-note', key: 'note' }, '仅本会话临时显示，不进入账本，也不能选择。'),
            ])),
          ]))
        }
        body = h('div', { className: 'beat-list', key: 'list' }, rows)
      }
      if (activeTab === 'timeline') {
        const tl = timeline.data
        if (timeline.phase === 'loading' && !tl) {
          body = h('div', { className: 'beat-list', key: 'tl-loading' }, [0, 1, 2, 3].map((index) => h('div', { className: 'beat-skel', key: index })))
        } else if (timeline.phase === 'error') {
          body = h('div', { className: 'beat-error', key: 'tl-error' }, [
            h('div', { key: 'm' }, `时间线读取失败：${timeline.error}`),
            h('button', { key: 'r', type: 'button', onClick: () => loadTimeline(true) }, '重试'),
          ])
        } else if (!tl || tl.ok === false) {
          body = h('div', { className: 'beat-empty', key: 'tl-empty' }, [
            h('b', { key: 't' }, '时间线'),
            h('div', { key: 's' }, tl?.message ?? '还没有可回看的历史。'),
          ])
        } else {
          const shown = (tl.entries ?? []).filter((entry) => timelineFilterMatch(entry, tlFilter))
          const days = new Map()
          for (const entry of shown) {
            const key = formatDay(entry.at)
            if (!days.has(key)) days.set(key, [])
            days.get(key).push(entry)
          }
          const chips = [
            ['all', '全部', tl.total],
            ['commit', '拍板', tl.counts?.commit ?? 0],
            ['revert', '回退', tl.counts?.revert ?? 0],
            ['segment', '登记', tl.counts?.segment ?? 0],
            ['plan', '岔路', (tl.counts?.plan ?? 0) + (tl.counts?.fork ?? 0)],
            ['check', '体检', (tl.counts?.verify ?? 0) + (tl.counts?.stale ?? 0) + (tl.counts?.check ?? 0) + (tl.counts?.waive ?? 0) + (tl.counts?.override ?? 0)],
          ]
          body = h('div', { className: 'beat-tl', key: 'timeline', role: 'tabpanel' }, [
            h('div', { className: 'beat-filters beat-tl-filters', key: 'filters' }, chips.map(([id, label, count]) => h('button', {
              key: id, type: 'button', className: 'beat-chip', 'data-a': tlFilter === id ? '1' : '0',
              onClick: () => setTlFilter(id),
            }, [h('span', { key: 'l' }, label), h('b', { key: 'c' }, formatNumber(count))]))),
            shown.length === 0
              ? h('div', { className: 'beat-empty', key: 'empty' }, [
                h('b', { key: 't' }, '这个筛选下没有记录'),
                h('div', { key: 's' }, '换一个筛选，或回到决策地图。'),
              ])
              : h('div', { className: 'beat-tl-list', key: 'list' }, [...days.entries()].map(([day, list]) => h('div', { className: 'beat-tl-day', key: day }, [
                h('div', { className: 'beat-tl-day-title', key: 'title' }, day),
                ...list.map((entry) => {
                  const jumpable = Number.isInteger(entry.chapter)
                  const onJump = () => {
                    if (!jumpable) return
                    setActiveTab('map')
                    setOpen(entry.chapter)
                    setSelected(entry.decisionId ?? null)
                  }
                  const meta = []
                  if (entry.chapter) meta.push(`第 ${entry.chapter} 章`)
                  if (entry.decisionId) meta.push(entry.decisionId)
                  if (entry.chars) meta.push(`${formatNumber(entry.chars)} 字`)
                  if (entry.revisionId) meta.push(entry.revisionId)
                  return h('div', {
                    className: 'beat-tl-entry', key: entry.eventId, 'data-type': entry.type,
                    role: jumpable ? 'button' : undefined,
                    tabIndex: jumpable ? 0 : undefined,
                    onClick: onJump,
                    onKeyDown: jumpable ? (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      onJump()
                    } : undefined,
                  }, [
                    h('span', { className: 'beat-tl-node', key: 'node' }),
                    h('div', { className: 'beat-tl-body', key: 'body' }, [
                      h('div', { className: 'beat-tl-top', key: 'top' }, [
                        h('span', { className: 'beat-tl-time', key: 'time' }, formatClock(entry.at)),
                        h('span', { className: 'beat-kind beat-tl-kind', key: 'kind' }, TIMELINE_LABELS[entry.type] ?? entry.type),
                        entry.chapter ? h('span', { className: 'beat-tl-ch', key: 'ch' }, `第 ${entry.chapter} 章`) : null,
                      ]),
                      h('div', { className: 'beat-tl-summary', key: 'summary' }, entry.summary ?? ''),
                      meta.length > 0 ? h('div', { className: 'beat-tl-meta', key: 'meta' }, meta.join(' · ')) : null,
                      entry.type === 'revert' && entry.canOpenOldLine && entry.oldLineDecisionId
                        ? h('button', {
                          className: 'beat-tl-link', key: 'old', type: 'button',
                          onClick: (event) => { event.stopPropagation(); openOldLine(entry.oldLineDecisionId) },
                        }, '查看旧线')
                        : null,
                    ]),
                  ])
                }),
              ]))),
            h('div', { className: 'beat-tl-foot', key: 'foot' }, `共 ${formatNumber(tl.total ?? shown.length)} 条 · 当前 ${formatNumber(shown.length)} 条`),
          ])
        }
      }

      if (activeTab === 'health') {
        const hl = health.data
        const chapter = hl?.chapter ?? healthChapter ?? open ?? data?.currentChapter ?? null
        const counts = hl?.counts ?? { block: 0, warn: 0, info: 0 }
        const level = hl?.level ?? 'ok'
        if (health.phase === 'loading' && !hl) {
          body = h('div', { className: 'beat-list', key: 'hl-loading' }, [0, 1, 2].map((index) => h('div', { className: 'beat-skel', key: index })))
        } else if (health.phase === 'error') {
          body = h('div', { className: 'beat-error', key: 'hl-error' }, [
            h('div', { key: 'm' }, `体检读取失败：${health.error}`),
            h('button', { key: 'r', type: 'button', onClick: () => loadHealth(chapter, true) }, '重试'),
          ])
        } else if (!hl) {
          body = h('div', { className: 'beat-empty', key: 'hl-empty' }, [
            h('b', { key: 't' }, '体检'),
            h('div', { key: 's' }, '还没有可体检的章节。'),
          ])
        } else {
          const chapterOptions = allChapters.map((entry) => h('option', { key: entry.chapter, value: String(entry.chapter) }, `第 ${entry.chapter} 章${entry.title ? ` ${entry.title}` : ''}`))
          body = h('div', { className: 'beat-hl', key: 'health', role: 'tabpanel' }, [
            h('div', { className: 'beat-hl-head', key: 'head' }, [
              h('div', { className: 'beat-hl-title', key: 'title' }, chapter ? `第 ${chapter} 章` : '全书体检'),
              h('div', { className: 'beat-hl-chapter', key: 'chapter' }, hl.textAvailable === false ? '正文不可读' : '只读检查 · 不改账本'),
              h('span', { className: 'beat-spacer', key: 'sp' }),
              chapterOptions.length > 0 ? h('select', {
                className: 'beat-hl-select', key: 'select', value: String(chapter ?? ''),
                onChange: (event) => { const next = Number(event.target.value); if (Number.isInteger(next)) loadHealth(next, true) },
                'aria-label': '选择要体检的章节',
              }, chapterOptions) : null,
            ]),
            h('div', { className: 'beat-hl-summary', key: 'summary', 'data-level': level }, [
              h('div', { className: 'beat-hl-stat', key: 'b' }, [h('b', { key: 'n' }, formatNumber(counts.block)), h('span', { key: 's' }, '阻断')]),
              h('div', { className: 'beat-hl-stat', key: 'w' }, [h('b', { key: 'n' }, formatNumber(counts.warn)), h('span', { key: 's' }, '提醒')]),
              h('div', { className: 'beat-hl-stat', key: 'i' }, [h('b', { key: 'n' }, formatNumber(counts.info)), h('span', { key: 's' }, '提示')]),
              h('div', { className: 'beat-hl-level', key: 'l' }, level === 'block' ? '需要处理' : level === 'warn' ? '建议看一眼' : '这一章很干净'),
            ]),
            h('div', { className: 'beat-hl-checks', key: 'checks' }, HEALTH_CHECKS.map(([code, label]) => {
              const issue = (hl.issues ?? []).find((entry) => entry.code === code)
              return h('div', { className: 'beat-hl-check', key: code, 'data-sev': issue?.severity ?? 'ok' }, [
                h('span', { className: 'beat-hl-check-dot', key: 'dot' }),
                h('span', { className: 'beat-hl-check-l', key: 'l' }, label),
                h('span', { className: 'beat-hl-check-n', key: 'n' }, issue ? formatNumber(issue.count) : '通过'),
              ])
            })),
            chapterOptions.length === 0 ? h('div', { className: 'beat-empty', key: 'empty' }, '还没有章节可以体检。') : null,
            (hl.issues ?? []).length === 0
              ? h('div', { className: 'beat-hl-ok', key: 'ok' }, [h('span', { className: 'beat-hl-ok-mark', key: 'm' }, '✓'), h('div', { key: 't' }, [h('b', { key: 'b' }, '没有发现结构问题'), h('span', { key: 's' }, '这一章可以继续往下写。')])])
              : h('div', { className: 'beat-hl-issues', key: 'issues' }, (hl.issues ?? []).map((issue) => h('div', { className: 'beat-hl-issue', key: issue.code, 'data-sev': issue.severity }, [
                h('div', { className: 'beat-hl-issue-top', key: 'top' }, [
                  h('span', { className: 'beat-hl-code', key: 'code' }, issue.code),
                  h('span', { className: 'beat-hl-count', key: 'count' }, `${formatNumber(issue.count)} 条`),
                ]),
                ...(issue.items ?? []).slice(0, 3).map((item) => h('div', { className: 'beat-hl-item', key: item.id }, [
                  h('div', { className: 'beat-hl-item-t', key: 't' }, item.title ?? item.id),
                  h('div', { className: 'beat-hl-item-d', key: 'd' }, item.detail ?? ''),
                ])),
                h('button', {
                  className: 'beat-hl-action', key: 'action', type: 'button',
                  onClick: () => {
                    setActiveTab('map')
                    if (chapter) setOpen(chapter)
                    const first = (issue.items ?? [])[0]?.id
                    if (typeof first === 'string' && first.startsWith('b')) setSelected(first)
                  },
                }, `${issue.action ?? '去处理'} →`),
              ]))),
            hl.textAvailable === false ? h('div', { className: 'beat-hl-note', key: 'note' }, '本章正文不可读，已跳过漂移与未登记区间检查。') : null,
            h('div', { className: 'beat-hl-foot', key: 'foot' }, '体检只读：不写账本、不改正文。'),
          ])
        }
      }


      return h('div', {
        className: 'beat-root',
      }, [
        h('style', { key: 'css' }, BEAT_PANEL_CSS),
        header,
        data?.transactionStatus?.blocked ? h('div', { className: 'beat-quarantine', key: 'quarantine', role: 'alert' }, [
          h('b', { key: 'title' }, data.transactionStatus.quarantined ? '本书已进入只读隔离' : '事务恢复尚未完成'),
          h('span', { key: 'message' }, data.transactionStatus.quarantine?.reason ?? data.transactionStatus.error ?? `事务 ${data.transactionStatus.latest?.txId ?? '未知'} · ${data.transactionStatus.latest?.stage ?? '状态待核验'}。写入与重复回退已暂停。`),
          h('button', { key: 'refresh', type: 'button', onClick: refreshAll }, '刷新状态'),
        ]) : null,
        activeTab === 'map' ? h('div', { className: 'beat-search', key: 'search' }, [
          h('svg', { className: 'beat-search-ico', key: 'icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': 'true' },
            h('circle', { cx: 11, cy: 11, r: 6 }), h('path', { d: 'M16 16l4 4' })),
          h('input', {
            className: 'beat-search-input', key: 'input', type: 'search', value: searchQ,
            placeholder: '搜决策、设定、义务…', spellCheck: false,
            'aria-label': '搜索决策、设定、义务',
            onChange: (event) => runSearch(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') { event.preventDefault(); runSearch(searchQ, true) }
              if (event.key === 'Escape') { event.preventDefault(); clearSearch() }
            },
          }),
          searchQ ? h('button', { className: 'beat-search-clear', key: 'clear', type: 'button', onClick: clearSearch, 'aria-label': '清除搜索' }, '×') : null,
        ]) : null,
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
        activeTab === 'map' && !searchQ.trim() ? h('div', { className: 'beat-filters', key: 'filters' }, [
          ...[
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
          }, [h('span', { key: 'l' }, label), h('b', { key: 'c' }, formatNumber(count))])),
          h('span', { className: 'beat-sort', key: 'sort' }, '按章倒序'),
        ]) : null,
        body,
        h('div', { className: 'beat-foot', key: 'foot' }, [
          h('span', { key: 'l' }, data?.book ? 'book.json' : '未连接账本'),
          h('span', { className: 'beat-spacer', key: 's' }),
          h('span', { key: 'v' }, 'v0.10.2'),
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
          onClose: closeSheet,
          onSelect: selectChoice,
          onConfirm: confirmSheet,
          onRefreshPlan: refreshImpact,
          onRefreshStatus: refreshTransactionStatus,
          onToggleSnapshot: (value) => setSheet((prev) => (prev ? { ...prev, snapshot: value } : prev)),
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
          border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
          background: 'transparent',
          color: 'inherit',
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
      __test: typeof globalThis !== 'undefined' && globalThis.__NOVEL_BEAT_TEST__ === true
        ? { BeatDecisionDetail, BeatRewindSheet }
        : undefined,
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

