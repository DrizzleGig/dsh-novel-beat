import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRewriteBrief } from '../lib/resume.js'

const data = {
  canon: [
    { entity: '陈凡', key: '对东宫的态度', value: '硬顶' },
    { entity: '唐三', key: '立场', value: '观望' },
  ],
}

function decision(extra = {}) {
  return {
    id: 'b10-2',
    chapter: 10,
    title: '陈凡怎么应对',
    chosen: {
      label: '硬顶，逼太子先亮底牌',
      impact: '陈凡当面顶撞太子；太子第一次动用武魂压制',
      forbidden: ['陈凡主动交出本体武魂', '雪清河提前识破'],
      changes: [{ entity: '陈凡', key: '对东宫的态度', to: '硬顶' }],
    },
    ...extra,
  }
}

test('buildRewriteBrief 生成四类语义与末尾衔接', () => {
  const brief = buildRewriteBrief({
    data,
    chapter: 10,
    decision: decision(),
    plan: { cutAt: 830 },
    tail: '他抬起眼，声音很轻。',
  })
  assert.match(brief, /【重写工单】第10章 · 从第830字之后继续/)
  assert.match(brief, /已改选：「陈凡怎么应对」→「硬顶，逼太子先亮底牌」/)
  assert.match(brief, /必须发生：陈凡当面顶撞太子/)
  assert.match(brief, /不得出现：陈凡主动交出本体武魂；雪清河提前识破/)
  assert.match(brief, /必须保持：唐三\.立场=观望/)
  assert.match(brief, /相关设定：陈凡\.对东宫的态度=硬顶/)
  assert.match(brief, /上一段末尾：「…他抬起眼，声音很轻。」/)
  assert.match(brief, /写完调 beat_segment/)
})

test('没有 forbidden 时省略整行；没有 canon 时省略必须保持', () => {
  const brief = buildRewriteBrief({
    data: { canon: [] },
    chapter: 3,
    decision: decision({ chosen: { label: '走', impact: '', forbidden: [], changes: [] } }),
    plan: { cutAt: 100 },
  })
  assert.doesNotMatch(brief, /不得出现/)
  assert.doesNotMatch(brief, /必须保持/)
  assert.match(brief, /必须发生：按新选择推进这一段/)
})

test('超限时先删软信息，不得出现/必须发生保留', () => {
  const brief = buildRewriteBrief({
    data,
    chapter: 10,
    decision: decision(),
    plan: { cutAt: 830 },
    tail: '很长的上一段末尾'.repeat(20),
    maxChars: 180,
  })
  assert.ok(brief.length <= 180, `brief too long: ${brief.length}`)
  assert.match(brief, /不得出现/)
  assert.match(brief, /必须发生/)
  assert.doesNotMatch(brief, /必须保持/)
})

test('没有 decision 时给出最小工单', () => {
  const brief = buildRewriteBrief({ data, chapter: 4, plan: { cutAt: 12 } })
  assert.match(brief, /【重写工单】第4章 · 从第12字之后继续/)
  assert.match(brief, /只写这一段/)
  assert.doesNotMatch(brief, /已改选/)
})

test('buildRewriteBrief 不修改输入对象', () => {
  const input = { data, chapter: 10, decision: decision(), plan: { cutAt: 830 }, tail: '尾' }
  const before = JSON.stringify(input)
  buildRewriteBrief(input)
  assert.equal(JSON.stringify(input), before)
})
