// lib/enforce.js — 0.7.0 执行层：写盘保护的纯函数（无 I/O，便于直接单测）
//
// guard 必须是同步的（dsh-tools 的 checkGuards 同步调用），所以这里只做判定，
// 账本状态由调用方（index.js，异步）预先算好放进 state 里递进来。

import { isAbsolute as nodeIsAbsolute, resolve as nodeResolve } from 'node:path'

/** 能真正往磁盘写正文的工具。guard 只看这四个。 */
export const WRITE_TOOL_NAMES = ['write', 'edit', 'apply_patch', 'str_replace_editor']

/** 默认受保护的正文目录（相对工作区根）。由 /beat body 增删。 */
export const DEFAULT_BODY_ROOTS = ['正文']

/** 拒绝原因码：报错文案里带码，作者和模型都能一眼认出是哪一闸。 */
export const DENY = {
  NO_TASK: 'NO_TASK',
  PENDING_DECISIONS: 'PENDING_DECISIONS',
  CONTINUATION_CHECK: 'CONTINUATION_CHECK',
  BOOK_QUARANTINED: 'BOOK_QUARANTINED',
}

function asString(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * 从一次工具调用里取出它要写的目标路径（保持调用方给的相对/绝对形态）。
 * 取不到就返回空数组——宁可放行，也不猜。
 */
export function targetPaths(toolName, args) {
  const a = args ?? {}
  if (toolName === 'write' || toolName === 'edit') {
    return asString(a.file_path) ? [asString(a.file_path)] : []
  }
  if (toolName === 'str_replace_editor') {
    return asString(a.path) ? [asString(a.path)] : []
  }
  if (toolName === 'apply_patch') {
    const patch = asString(a.patch) || asString(a.input) || asString(a.diff)
    // apply_patch 的补丁头：*** Update File: 正文/第001章.md
    const found = []
    for (const line of patch.split(/\r?\n/)) {
      const match = /^\*\*\*\s+(?:Update|Add|Delete|Move to)\s+File:\s*(.+?)\s*$/.exec(line)
      if (match) found.push(match[1])
    }
    return found
  }
  return []
}

function normalizeForCompare(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path
}

/**
 * path 是否落在 cwd 下的某个 bodyRoot 里。
 * 绝对路径、`..` 逃逸、以及 bodyRoot 自身都按字符串比较，不做 realpath（guard 必须同步）。
 */
export function isProtectedPath(path, cwd, bodyRoots = DEFAULT_BODY_ROOTS) {
  if (!path) return false
  const target = normalizeForCompare(path.replace(/\\/g, '/'))
  const root = normalizeForCompare(String(cwd ?? '').replace(/\\/g, '/')).replace(/\/+$/, '')
  if (!root) return false
  for (const entry of bodyRoots ?? []) {
    const sub = asString(entry).trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    if (!sub) continue
    const prefix = `${root}/${normalizeForCompare(sub)}`
    if (target === prefix || target.startsWith(`${prefix}/`)) return true
  }
  return false
}

/**
 * 从目标文件名里认出"这是第几章"。认得出来就按文件名判，认不出来才退回账本的进度。
 * 只认阿拉伯数字（第8章 / 第 008 章）；汉字章号（第八章）认不出，属于已知边界。
 */
export function chapterFromPath(path) {
  const text = asString(path).replace(/\\/g, '/')
  const match = /第\s*([0-9]{1,3})\s*章/.exec(text)
  if (!match) return null
  const chapter = Number(match[1])
  return Number.isInteger(chapter) && chapter > 0 ? chapter : null
}

/**
 * guard 的判定主体。state 由调用方预先算好：
 *   { on, chapter, open, chapters?: Record<string, {total, open, awaitingSegment}> }
 * chapters 按章汇总决策：total=登记过几条，open=还没拍板的，awaitingSegment=已拍板但还没登记段落的。
 * 目标文件名里有章号时按章号判。
 *
 * 0.7 的节奏是"先写 → 遇到岔路 → 问一次 → 按答案接着写 → 登记这一段"：
 *   - 一条决策都没登记：允许（正在写开场）
 *   - 有还没问的岔路（open>0）且不在"等登记"状态：拦，让他先问
 *   - 刚拍完板、还没登记段落（awaitingSegment>0）：放行，正在写那一段
 * 返回 { blocked: boolean, reason?: string, detail?: object }
 */
export function evaluateWrite({ toolName, args, cwd, bodyRoots, state }) {
  if (!state?.on && !state?.quarantined && !state?.writePaused) return { blocked: false, reason: 'mode-off' }
  if (!WRITE_TOOL_NAMES.includes(toolName)) return { blocked: false }

  const paths = targetPaths(toolName, args)
  if (paths.length === 0) return { blocked: false, reason: 'no-target' }

  const protectedPaths = []
  for (const path of paths) {
    const absolute = nodeIsAbsolute(path) ? path : nodeResolve(String(cwd ?? ''), path)
    if (!isProtectedPath(absolute, cwd, bodyRoots)) continue
    protectedPaths.push({ path, absolute, chapter: chapterFromPath(absolute) })
  }
  if (protectedPaths.length === 0) return { blocked: false, reason: 'not-body' }

  if (state?.quarantined || state?.writePaused) {
    return {
      blocked: true,
      reason: `[${DENY.BOOK_QUARANTINED}] 本书处于事务恢复隔离状态，或当前无法确认恢复状态；正文写入已暂停。检查事务日志与 quarantine.json 后再继续。`,
      detail: { code: DENY.BOOK_QUARANTINED, paths: protectedPaths.map((entry) => entry.path) },
    }
  }
  if (!state?.on) return { blocked: false, reason: 'mode-off' }

  for (const target of protectedPaths) {
    // 认得出章号：就按"这一章"判。
    if (target.chapter !== null) {
      const stats = state.chapters?.[String(target.chapter)] ?? { total: 0, open: 0, awaitingSegment: 0 }
      // 刚登记完一段：下一步必须先回答"后面还有没有真岔路"，不然正文会一口气写完、
      // 段落边界变成事后补的。检查完（beat_plan 登记 / beats:[] 声明没有）就放行。
      if (stats.needsCheck) {
        return {
          blocked: true,
          reason: `[${DENY.CONTINUATION_CHECK}] 第 ${target.chapter} 章刚登记完一段正文。写下一段之前先做一次续写检查：后面有真岔路就 beat_plan 登记这一个（一次一个）；确实没有就 beat_plan(beats: [], reason: '…') 说明为什么不用作者拍板。`,
          detail: {
            code: DENY.CONTINUATION_CHECK,
            chapter: target.chapter,
            paths: protectedPaths.map((entry) => entry.path),
          },
        }
      }
      if (stats.pendingConfirm > 0) {
        return {
          blocked: true,
          reason: `[${DENY.PENDING_DECISIONS}] 第 ${target.chapter} 章作者刚选了一个会改设定的选项，正等你问他要不要改（beat_next 返回的是"待确认"）。先确认：作者同意就 beat_next(confirmCanon: true)，不同意就 beat_plan(reset: true) 重新给选项——确认之前别往下写。`,
          detail: {
            code: DENY.PENDING_DECISIONS,
            chapter: target.chapter,
            pendingConfirm: stats.pendingConfirm,
            paths: protectedPaths.map((entry) => entry.path),
          },
        }
      }
      if (stats.open > 0 && !(stats.awaitingSegment > 0)) {
        return {
          blocked: true,
          reason: `[${DENY.PENDING_DECISIONS}] 第 ${target.chapter} 章还有 ${stats.open} 个岔路没问。先 beat_next 问下一个（一次只问一个），按作者的选择写完这一段、beat_segment 登记，再问下一个。`,
          detail: {
            code: DENY.PENDING_DECISIONS,
            chapter: target.chapter,
            open: stats.open,
            paths: protectedPaths.map((entry) => entry.path),
          },
        }
      }
      continue
    }

    // 认不出章号：退回账本进度（已知边界：文件名不带"第N章"时判断会粗一些）。
    if (state.open > 0) {
      return {
        blocked: true,
        reason: `[${DENY.PENDING_DECISIONS}] 第 ${state.chapter} 章还有 ${state.open} 个岔路没问。先 beat_next 问下一个（一次只问一个），写完这一段、beat_segment 登记，再问下一个。`,
        detail: {
          code: DENY.PENDING_DECISIONS,
          chapter: state.chapter,
          open: state.open,
          paths: protectedPaths.map((entry) => entry.path),
        },
      }
    }
  }

  return { blocked: false, reason: 'ok' }
}
