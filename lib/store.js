// lib/store.js — 0.6.0 账本读写：单文件、原子写、per-book 串行、迁移、路径安全
// 只依赖 Node 内置；不 import 任何第三方包，也不 import novel-forge。

import { mkdir, readFile, writeFile, rename, copyFile, readdir, stat, realpath, rm } from 'node:fs/promises';
import { dirname, join, resolve, relative, isAbsolute, extname, sep } from 'node:path';
import {
  fail,
  assertBookName,
  emptyBook,
  validateBook,
  migrateLegacyChapter,
  nowIso,
} from './schema.js';

export const ROOT = '.dsh-novel-beat';

/** 0.6.0 的默认开关：装上不主动占 schema，作者点按钮或 /beat on 才启用。 */
export const DEFAULT_MODE = 'off';

const locks = new Map();

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

export function bookDir(dir, book) {
  return join(dir, ROOT, assertBookName(book));
}

export function bookFilePath(dir, book) {
  return join(bookDir(dir, book), 'book.json');
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
  await writeJsonAtomic(bookFilePath(dir, book), data);

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
  return { data, migrated: true, warnings };
}

async function readBookDataUnlocked(dir, book) {
  const file = bookFilePath(dir, book);
  const raw = await readJson(file);
  if (raw) {
    validateBook(raw);
    return { data: raw, migrated: false, warnings: [] };
  }
  const migration = await migrateLegacyUnlocked(dir, book);
  if (migration) return migration;
  return { data: null, migrated: false, warnings: [] };
}

/** 只读；首次访问若有 0.5 的 chNNN.json，会自动迁移成 book.json（并备份旧文件）。 */
export async function readBookData(dir, book) {
  const file = bookFilePath(dir, book);
  return withLock(file, () => readBookDataUnlocked(dir, book));
}

/** 读-改-写。mutator 抛错时不写盘；成功时统一更新 updatedAt 并原子落盘。 */
export async function mutateBookData(dir, book, mutator, { create = false, meta } = {}) {
  const file = bookFilePath(dir, book);
  return withLock(file, async () => {
    const { data: existing, warnings } = await readBookDataUnlocked(dir, book);
    let data = existing;
    let created = false;
    if (!data) {
      if (!create) fail('no-book', `书「${book}」还没有账本，请先 beat_plan`);
      data = emptyBook({ book, meta, now: nowIso() });
      created = true;
    }
    const result = await mutator(data);
    data.updatedAt = nowIso();
    await writeJsonAtomic(file, data);
    return { data, result, created, warnings };
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
      modes[sessionId] = { mode: value.mode, updatedAt: value.updatedAt ?? null };
    }
  }
  return { modes, warning: null };
}

export async function getSessionMode(dir, sessionId) {
  const { modes, warning } = await readSessionModes(dir);
  return { mode: modes[sessionId]?.mode ?? DEFAULT_MODE, warning };
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
