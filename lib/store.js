// lib/store.js — 0.7.0 账本读写：工作区锚定、单文件原子写、per-book 串行、迁移、路径安全
// 只依赖 Node 内置；不 import 任何第三方包，也不 import novel-forge。

import { mkdir, readFile, writeFile, rename, copyFile, readdir, stat, realpath, rm } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, extname, sep } from 'node:path';
import {
  fail,
  assertBookName,
  emptyBook,
  validateBook,
  migrateLegacyChapter,
  migrateBookV1ToV2,
  migrateBookV2ToV3,
  computeLedgerHash,
  LEGACY_SCHEMA_VERSION,
  SCHEMA_VERSION,
  nowIso,
} from './schema.js';

export const ROOT = '.dsh-novel-beat';

/** 0.7.0 的默认开关：装上不主动占 schema，作者点按钮或 /beat on 才启用。 */
export const DEFAULT_MODE = 'off';

const locks = new Map();
const NO_CHANGE = Symbol('no-change');

export function noChange(result) {
  return { [NO_CHANGE]: true, result };
}

/**
 * 同一个 key 上的读-改-写串行执行。
 * tail 永不 reject：前一个任务失败不会毒化后面的队列。
 */
async function withLock(key, fn) {
  const lockKey = resolve(key);
  const previous = locks.get(lockKey) ?? Promise.resolve();
  let release;
  const current = new Promise((resolveCurrent) => {
    release = resolveCurrent;
  });
  const tail = previous.then(() => current);
  locks.set(lockKey, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(lockKey) === tail) locks.delete(lockKey);
  }
}

/** 复用同一把进程内 per-book 锁；事务层不可在回调里再次调用 mutateBookData。 */
export function withBookLock(dir, book, fn) {
  return withLock(bookFilePath(dir, book), fn);
}

function hasBookDirs(root) {
  try {
    return readdirSync(join(root, ROOT), { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && !entry.name.startsWith('_'),
    );
  } catch {
    return false;
  }
}

/**
 * 一本书一本账（v0.7 的铁律）：把任意工作目录锚定到"这本书真正的工作区根"。
 * 优先级：最近的、已有账本书籍目录的祖先 → 最近的 git 根 → 最近的有 `.dsh-novel-beat` 的祖先 → 传入目录本身。
 * 这样在 `正文/` 子目录里调工具，也不会再长出第二份 book.json。
 */
export function resolveWorkspaceRoot(dir) {
  const start = resolve(typeof dir === 'string' && dir ? dir : process.cwd());
  let current = start;
  let withBooks = null;
  let gitRoot = null;
  let anyLedger = null;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!anyLedger && existsSync(join(current, ROOT))) {
      anyLedger = current;
      if (!withBooks && hasBookDirs(current)) withBooks = current;
    }
    if (!gitRoot && existsSync(join(current, '.git'))) gitRoot = current;
    if (withBooks) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return withBooks ?? gitRoot ?? anyLedger ?? start;
}

export function bookDir(dir, book) {
  return join(resolveWorkspaceRoot(dir), ROOT, assertBookName(book));
}

export function bookFilePath(dir, book) {
  return join(bookDir(dir, book), 'book.json');
}

/**
 * 扫同一工作区树内是否已有同名账本（深度 ≤4）。返回所有副本的绝对路径，
 * 供 `beat_list { repair:true }` 与"新建前先探测"使用。永远不写盘。
 */
export async function findBookCopies(dir, book, { maxDepth = 4 } = {}) {
  const name = assertBookName(book);
  const root = resolveWorkspaceRoot(dir);
  const found = [];
  const skip = new Set(['node_modules', '.git', 'legacy', 'tmp']);

  async function walk(current, depth) {
    const candidate = join(current, ROOT, name, 'book.json');
    if (existsSync(candidate)) found.push(candidate);
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || skip.has(entry.name) || entry.name.startsWith('.')) continue;
      await walk(join(current, entry.name), depth + 1);
    }
  }

  await walk(root, 0);
  if (!found.some((file) => resolve(file) === resolve(bookFilePath(root, name)))) {
    const canonical = bookFilePath(root, name);
    if (existsSync(canonical)) found.push(canonical);
  }
  return found;
}

async function readJson(file) {
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch (error) {
    fail('book-corrupt', `JSON 解析失败：${file}`, { cause: error.message });
  }
}

async function writeJsonAtomic(file, data) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const body = `${JSON.stringify(data, null, 2)}\n`;
  try {
    await writeFile(tmp, body, 'utf8');
    try {
      await copyFile(file, `${file}.bak`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await rename(tmp, file);
  } catch (error) {
    try {
      await rm(tmp, { force: true });
    } catch {
      /* tmp 清理失败不掩盖原始错误 */
    }
    throw error;
  }
}

async function migrateLegacyUnlocked(dir, book) {
  const directory = bookDir(dir, book);
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }

  const files = names
    .filter((name) => /^ch\d+\.json$/.test(name))
    .sort((a, b) => Number(/\d+/.exec(a)[0]) - Number(/\d+/.exec(b)[0]));
  if (files.length === 0) return null;

  const now = nowIso();
  const data = emptyBook({ book, meta: { title: book }, now });
  const warnings = [];

  for (const name of files) {
    const chapter = Number(/\d+/.exec(name)[0]);
    if (!Number.isInteger(chapter) || chapter < 1) {
      warnings.push(`legacy-bad-chapter:${name}`);
      continue;
    }
    let raw;
    try {
      raw = await readJson(join(directory, name));
    } catch {
      warnings.push(`legacy-corrupt:${name}`);
      continue;
    }
    if (!raw || !Array.isArray(raw.beats) || raw.beats.length === 0) {
      warnings.push(`legacy-empty:${name}`);
      continue;
    }
    let decisions;
    try {
      decisions = migrateLegacyChapter(chapter, raw, now);
    } catch {
      warnings.push(`legacy-invalid:${name}`);
      continue;
    }
    data.decisions.push(...decisions);
    data.chapters[String(chapter)] = {
      status: decisions.every((decision) => decision.status === 'decided') ? 'decided' : 'pending',
      decisionIds: decisions.map((decision) => decision.id),
      verifiedAt: null,
    };
  }

  if (data.decisions.length === 0) return null;

  data.audit.push({ at: now, action: 'migrate', detail: `从 ${files.length} 个 chNNN.json 迁移` });
  const upgraded = migrateBookV2ToV3(migrateBookV1ToV2(data, { now }), { now });
  upgraded.integrity.ledgerHash = computeLedgerHash(upgraded);
  validateBook(upgraded);
  await writeJsonAtomic(bookFilePath(dir, book), upgraded);

  const legacyDirectory = join(directory, 'legacy');
  try {
    await mkdir(legacyDirectory, { recursive: true });
    for (const name of files) {
      try {
        await rename(join(directory, name), join(legacyDirectory, name));
      } catch {
        warnings.push(`legacy-move-failed:${name}`);
      }
    }
    await writeFile(
      join(legacyDirectory, 'MIGRATION.md'),
      [
        '# 0.5 → 0.6 迁移说明',
        '',
        `- 时间：${now}`,
        `- 旧文件：${files.length} 个`,
        '- 旧决策已标记 legacy：只有拍板文本，没有结构化 changes/canon。',
        '- beat_verify 对 legacy 只做弱校验；建议对旧章重新 beat_plan/beat_decide。',
        '',
      ].join('\n'),
      'utf8',
    );
  } catch {
    warnings.push('legacy-backup-failed');
  }

  warnings.unshift(`旧数据已迁移：${files.length} 个章节文件；旧决策标记 legacy，verify 只能弱校验`);
  return { data: upgraded, migrated: true, warnings };
}

export async function readBookDataUnlocked(dir, book) {
  const file = bookFilePath(dir, book);
  const raw = await readJson(file);
  if (raw) {
    if (raw.schemaVersion === LEGACY_SCHEMA_VERSION || raw.schemaVersion === 2) {
      // 逐版迁移并只写一次；原 book.json 会由 writeJsonAtomic 备份为 .bak。
      let upgraded = raw.schemaVersion === LEGACY_SCHEMA_VERSION
        ? migrateBookV1ToV2(raw, { now: nowIso() })
        : raw;
      upgraded = migrateBookV2ToV3(upgraded, { now: nowIso() });
      if (!Number.isInteger(upgraded.revision)) upgraded.revision = computeRevision(upgraded);
      upgraded.integrity.ledgerHash = computeLedgerHash(upgraded);
      validateBook(upgraded);
      await writeJsonAtomic(file, upgraded);
      const warnings = raw.schemaVersion === LEGACY_SCHEMA_VERSION
        ? ['账本已从 schemaVersion 1 经 2 升级到 3；原文件备份为 book.json.bak']
        : ['账本已从 schemaVersion 2 升级到 3；原文件备份为 book.json.bak'];
      return { data: upgraded, migrated: true, warnings };
    }
    validateBook(raw);
    if (raw.integrity?.ledgerHash && computeLedgerHash(raw) !== raw.integrity.ledgerHash) {
      fail('ledger-hash-mismatch', `账本 ${book} 的 integrity.ledgerHash 与文件内容不一致`);
    }
    return { data: raw, migrated: false, warnings: [] };
  }
  const migration = await migrateLegacyUnlocked(dir, book);
  if (migration) return migration;
  return { data: null, migrated: false, warnings: [] };
}

/** 只读；首次访问若有 0.5 的 chNNN.json，会自动迁移成 book.json（并备份旧文件）。 */
export async function readBookData(dir, book) {
  return withBookLock(dir, book, async () => {
    const recovery = await import('./transaction.js');
    await recovery.recoverBookTransactionsUnlocked(dir, book);
    await recovery.retryPendingBookTasksUnlocked(dir, book);
    return readBookDataUnlocked(dir, book);
  });
}

export function computeRevision(data) {
  return typeof data?.revision === 'number' && Number.isFinite(data.revision)
    ? data.revision
    : (data?.revisions?.length ?? 0) + (data?.audit?.length ?? 0);
}

/** 读-改-写。mutator 抛错时不写盘；成功时统一更新 updatedAt 并原子落盘。 */
export async function mutateBookData(dir, book, mutator, { create = false, meta } = {}) {
  const file = bookFilePath(dir, book);
  return withBookLock(dir, book, async () => {
    const recovery = await import('./transaction.js');
    await recovery.recoverBookTransactionsUnlocked(dir, book);
    await recovery.assertBookWritableUnlocked(dir, book);
    await recovery.retryPendingBookTasksUnlocked(dir, book);
    const { data: existing, warnings } = await readBookDataUnlocked(dir, book);
    let data = existing;
    let created = false;
    if (!data) {
      if (!create) fail('no-book', `书「${book}」还没有账本，请先 beat_plan`);
      data = emptyBook({ book, meta, now: nowIso() });
      created = true;
    }
    // 旧账本没有 revision：基线必须在 mutator 之前算，否则这次写新增的
    // revisions[]/audit[] 会被算进"旧值"，第一次写就会多跳。
    const baseRevision = computeRevision(data);
    const mutation = await mutator(data);
    if (!created && mutation?.[NO_CHANGE] === true) {
      return {
        data,
        result: mutation.result,
        revision: baseRevision,
        created,
        warnings,
      };
    }
    const result = mutation;
    const revision = baseRevision + 1;
    data.revision = revision;
    data.updatedAt = nowIso();
    data.integrity ??= { algorithm: 'sha256', ledgerHash: null, bodyBindings: [] };
    data.integrity.algorithm = 'sha256';
    data.integrity.bodyBindings = Array.isArray(data.integrity.bodyBindings) ? data.integrity.bodyBindings : [];
    data.integrity.ledgerHash = computeLedgerHash(data);
    validateBook(data);
    await writeJsonAtomic(file, data);
    return { data, result, revision, created, warnings };
  });
}

/** 读正文：只允许工作区内的 .md/.txt，≤2MB；不做任何“猜章节”的事。 */
export async function readChapterText(dir, path) {
  if (typeof path !== 'string' || path.trim() === '') fail('no-text', 'path 不能为空');
  const root = await realpath(dir);
  const absolute = resolve(dir, path);
  let real;
  try {
    real = await realpath(absolute);
  } catch (error) {
    fail('unreadable', `读不到文件：${path}`, { cause: error.message });
  }
  const rel = relative(root, real);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail('path-outside', `path 必须在工作区内：${path}`);
  }
  const extension = extname(real).toLowerCase();
  if (extension !== '.md' && extension !== '.txt') fail('unreadable', '只支持 .md / .txt');
  const info = await stat(real);
  if (!info.isFile()) fail('unreadable', `不是文件：${path}`);
  if (info.size > 2 * 1024 * 1024) fail('too-large', '文件超过 2MB');
  return { text: await readFile(real, 'utf8'), path: real };
}

function sessionFilePath(dir) {
  return join(dir, ROOT, '_sessions.json');
}

/** 读会话开关；文件损坏不阻断插件，按默认 off 处理并给 warning。 */
export async function readSessionModes(dir) {
  let raw;
  try {
    raw = await readJson(sessionFilePath(dir));
  } catch {
    return { modes: {}, warning: 'sessions-corrupt' };
  }
  if (!raw) return { modes: {}, warning: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { modes: {}, warning: 'sessions-corrupt' };
  const modes = {};
  for (const [sessionId, value] of Object.entries(raw)) {
    if (value && (value.mode === 'on' || value.mode === 'off')) {
      modes[sessionId] = {
        mode: value.mode,
        updatedAt: value.updatedAt ?? null,
        ...(Array.isArray(value.bodyRoots) ? { bodyRoots: value.bodyRoots } : {}),
      };
    }
  }
  return { modes, warning: null };
}

export async function getSessionMode(dir, sessionId) {
  const { modes, warning } = await readSessionModes(dir);
  return { mode: modes[sessionId]?.mode ?? DEFAULT_MODE, warning };
}

/**
 * 会话级设置（模式 + 受保护正文目录）。没写过 bodyRoots 时返回 null，
 * 由调用方套用 DEFAULT_BODY_ROOTS —— 这样以后改默认值能影响老会话。
 */
export async function getSessionState(dir, sessionId) {
  const { modes, warning } = await readSessionModes(dir);
  const entry = modes[sessionId];
  return {
    mode: entry?.mode ?? DEFAULT_MODE,
    bodyRoots: Array.isArray(entry?.bodyRoots) ? entry.bodyRoots : null,
    warning,
  };
}

export async function setSessionBodyRoots(dir, sessionId, bodyRoots) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') fail('bad-session', 'sessionId 不能为空');
  if (!Array.isArray(bodyRoots)) fail('bad-body-roots', 'bodyRoots 必须是数组');
  const cleaned = bodyRoots
    .map((entry) => (typeof entry === 'string' ? entry.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : ''))
    .filter((entry) => entry !== '');
  const file = sessionFilePath(dir);
  return withLock(file, async () => {
    const { modes } = await readSessionModes(dir);
    const previous = modes[sessionId] ?? { mode: DEFAULT_MODE };
    modes[sessionId] = { ...previous, bodyRoots: cleaned, updatedAt: nowIso() };
    await writeJsonAtomic(file, modes);
    return { sessionId, bodyRoots: cleaned };
  });
}

/**
 * 工作区里"当前在写的那本书"：`<root>/.dsh-novel-beat/` 下最近改动过 book.json 的一本。
 * 只读；没有账本就返回 null（guard 据此判 NO_TASK）。
 */
export async function readActiveBook(dir) {
  const ledger = join(resolveWorkspaceRoot(dir), ROOT);
  let entries;
  try {
    entries = await readdir(ledger, { withFileTypes: true });
  } catch {
    return null;
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const file = join(ledger, entry.name, 'book.json');
    try {
      const info = await stat(file);
      if (info.isFile()) candidates.push({ book: entry.name, mtime: info.mtimeMs });
    } catch {
      /* 没有 book.json 的书目录不算候选 */
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  try {
    const { data } = await readBookData(dir, candidates[0].book);
    return data ? { book: candidates[0].book, data } : null;
  } catch {
    return null;
  }
}

export async function setSessionMode(dir, sessionId, mode) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') fail('bad-session', 'sessionId 不能为空');
  if (mode !== 'on' && mode !== 'off') fail('bad-mode', 'mode 只能是 on/off');
  const file = sessionFilePath(dir);
  return withLock(file, async () => {
    const { modes } = await readSessionModes(dir);
    modes[sessionId] = { mode, updatedAt: nowIso() };
    await writeJsonAtomic(file, modes);
    return { sessionId, mode };
  });
}
