// 用真实 React 服务端渲染 client.js 里的 BeatPanel（不发请求、不碰 DSH），
// 生成可截图的实际实现 HTML，用于视觉验收。
// 用法：node scripts/render-panel.mjs [fixtureBookDir] [outDir]
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { buildChapter, buildOverview, readChapterTitles } from '../lib/panel.js'
import { planRewind } from '../lib/rewind.js'

const fixture = process.argv[2] ?? 'D:/插件/tmp/beat-v08-ui/.dsh-novel-beat/斗罗：开局炸毁冰火两仪眼'
const outDir = process.argv[3] ?? 'D:/Novel-gate/docs'
const require = createRequire('D:/Novel-gate/.tmp/harness/package.json')
const React = require('react')
const ReactDOMServer = require('react-dom/server')

const book = JSON.parse(await readFile(join(fixture, 'book.json'), 'utf8'))
const body = await readFile(join(fixture, '..', '..', '正文', '第10章_太子雪清河.md'), 'utf8').catch(() => null)
const chapterTitles = await readChapterTitles(fixture).catch(() => new Map())
const overview = buildOverview({ book: book.book, data: book, on: true, chapterTitles })
const chapter = buildChapter({ book: book.book, data: book, chapter: 10, chapterTitles })
const decision = chapter.decisions.find((entry) => entry.id === 'b10-2')
const plan = body
  ? planRewind({ data: book, decisionId: 'b10-2', choice: 'keep', bodyText: body, fileLength: body.length })
  : null

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(module) { captured = module },
  },
}
await import('../client.js')

function fakeReactFactory(states) {
  let index = 0
  return {
    createElement: React.createElement,
    useState() {
      const value = states[index]
      index += 1
      return [value, () => {}]
    },
    useRef() { return { current: 0 } },
    useEffect() {},
  }
}

function makeContext() {
  const scopedSlots = []
  const service = {
    status: async () => ({ ok: true, value: { on: true } }),
    setMode: async () => ({ ok: true, value: { on: true } }),
    panel: async () => ({ ok: true, value: { on: true, text: '' } }),
    revertLast: async () => ({ ok: true, text: '' }),
    overview: async () => ({ ok: true, value: overview }),
    chapter: async () => ({ ok: true, value: chapter }),
    impact: async () => ({ ok: true, value: plan }),
    rewind: async () => ({ ok: true, value: { ok: true } }),
    resume: async () => ({ ok: true, value: { ok: true } }),
  }
  const scoped = {
    get(name) {
      if (name === 'sidebarRightTabs') return { register() { return () => {} } }
      if (name === 'sidebarRight') return { openTab() {} }
      return undefined
    },
    effect(fn) { return fn() },
    slots: {
      inject(_owner, fn) { return fn() },
      register(options, component) {
        scopedSlots.push({ options, component })
        return {}
      },
    },
  }
  const ctx = {
    remote: { $mount: async () => () => {} },
    get(name) { return name === 'remote.beatMode' ? service : undefined },
    effect(fn) { return fn() },
    slots: {
      inject(_owner, fn) { return fn() },
      register() { return {} },
    },
    inject(_names, fn) { return fn(scoped) },
  }
  return { ctx, scopedSlots, service }
}

// DSH 主题 token 的真实取值（design-platform.css 的 body / body[data-ds-dark-theme]）。
// 静态渲染时必须把它们喂进去，否则组件的 color-mix(var(--dsw-alias-label-primary)) 会失效，
// 截图也就无法反映浅色主题下的真实对比度。
const THEME = {
  light: {
    base: '#ffffff',
    vars: {
      '--dsw-alias-bg-base': 'rgb(255,255,255)',
      '--dsw-alias-bg-layer-1': 'rgb(255,255,255)',
      '--dsw-alias-bg-layer-2': 'rgb(255,255,255)',
      '--dsw-alias-bg-overlay': 'rgb(233,236,242)',
      '--dsw-alias-border-l1': 'rgba(0,0,0,0.04)',
      '--dsw-alias-border-l2': 'rgba(0,0,0,0.1)',
      '--dsw-alias-label-primary': 'rgb(15,17,21)',
      '--dsw-alias-label-secondary': 'rgb(97,102,107)',
      '--dsw-alias-label-tertiary': 'rgb(129,133,140)',
      '--dsw-alias-brand-primary': 'rgb(15,17,21)',
      '--dsw-alias-state-success-primary': 'rgb(34,197,94)',
      '--dsw-alias-state-warn-primary': 'rgb(245,158,11)',
      '--dsw-alias-state-error-primary': 'rgb(236,19,19)',
    },
  },
  dark: {
    base: '#151517',
    vars: {
      '--dsw-alias-bg-base': 'rgb(21,21,23)',
      '--dsw-alias-bg-layer-1': 'rgb(35,35,36)',
      '--dsw-alias-bg-layer-2': 'rgb(44,44,46)',
      '--dsw-alias-bg-overlay': 'rgb(44,44,46)',
      '--dsw-alias-border-l1': 'rgba(255,255,255,0.06)',
      '--dsw-alias-border-l2': 'rgba(255,255,255,0.12)',
      '--dsw-alias-label-primary': 'rgb(249,250,251)',
      '--dsw-alias-label-secondary': 'rgb(207,211,214)',
      '--dsw-alias-label-tertiary': 'rgb(173,178,184)',
      '--dsw-alias-brand-primary': 'rgb(249,250,251)',
      '--dsw-alias-state-success-primary': 'rgb(34,197,94)',
      '--dsw-alias-state-warn-primary': 'rgb(245,158,11)',
      '--dsw-alias-state-error-primary': 'rgb(236,19,19)',
    },
  },
}

function page(markup, title, scheme) {
  // React server rendering escapes quotes inside <style>; a browser's raw-text
  // style element does not. Decode only the style block so the static capture
  // matches what the live client renders.
  const style = /<style>([\s\S]*?)<\/style>/.exec(markup)
  if (style) {
    const decoded = style[1]
      .replaceAll('&quot;', '"')
      .replaceAll('&#x27;', "'")
      .replaceAll('&amp;', '&')
    markup = markup.replace(style[0], `<style>${decoded}</style>`)
  }
  const theme = THEME[scheme]
  const tokenCss = Object.entries(theme.vars).map(([k, v]) => `${k}:${v};`).join('')
  return `<!doctype html>
<html lang="zh-CN" data-scheme="${scheme}"><head><meta charset="utf-8"><title>${title}</title>
<style>
html,body{margin:0;width:420px;height:900px;overflow:hidden;background:${theme.base}}
body{${tokenCss}}
.frame{width:420px;height:900px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:"Microsoft YaHei UI","Microsoft YaHei",system-ui,sans-serif}
</style></head><body><div class="frame">${markup}</div></body></html>`
}

async function render(name, states, scheme = 'dark') {
  const { ctx, scopedSlots } = makeContext()
  const module = captured.factory((id) => {
    if (id === 'react') return fakeReactFactory(states)
    throw new Error(`unexpected require ${id}`)
  })
  await module.apply(ctx)
  const bodyRegistration = scopedSlots.find((entry) => entry.options.name === 'sidebar.right.pane.tab')
  if (!bodyRegistration) throw new Error('sidebar.right.pane.tab 未注册')
  const markup = ReactDOMServer.renderToStaticMarkup(
    React.createElement(bodyRegistration.component, { sessionId: 'render-session', remote: {} }),
  )
  await mkdir(join(outDir, 'mockups', 'impl-v08'), { recursive: true })
  const htmlPath = join(outDir, 'mockups', 'impl-v08', `${name}-${scheme}.html`)
  await writeFile(htmlPath, page(markup, name, scheme), 'utf8')
  console.log('WROTE', htmlPath, markup.length)
}

const base = [
  { phase: 'ready', data: overview, error: null },
  10,
  { 10: { phase: 'ready', data: chapter, error: null } },
  'all',
  'b10-2',
  null,
  null,
  null,
]
await render('map', base, 'light')
await render('map', base, 'dark')
await render('rewind', [
  { phase: 'ready', data: overview, error: null },
  10,
  { 10: { phase: 'ready', data: chapter, error: null } },
  'all',
  'b10-2',
  { decision, mode: 'keep', choice: 'keep', plan, busy: false, error: null, snapshot: true, markLaterStale: false },
  null,
  null,
], 'light')
await render('oldline', [
  { phase: 'ready', data: overview, error: null },
  10,
  { 10: { phase: 'ready', data: chapter, error: null } },
  'all',
  null,
  null,
  null,
  { phase: 'ready', data: { chars: body?.length ?? 0, revisionId: 'r-0006', text: body ?? '' }, error: null },
], 'light')
