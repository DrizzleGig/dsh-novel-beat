// 0.7.0 M4：段落映射与回退的底层工具（正文读写、快照、hash、区间）。
// 原则：只认工作区内的 .md/.txt；所有写入走"临时文件 + rename"；快照单独放 revisions/，不塞进 book.json。
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';
import { fail } from './schema.js';
import { bookDir, resolveWorkspaceRoot } from './store.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** 统一换行，避免 CRLF 让 hash 与区间漂移。 */
export function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function sha256(text) {
  return createHash('sha256').update(normalizeNewlines(text), 'utf8').digest('hex');
}

/** 取正文里的一段并算 hash；区间越界直接报错，不静默截断。 */
export function sliceHash(text, start, end) {
  const body = normalizeNewlines(text);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > body.length || start > end) {
    fail('bad-range', `段落区间不合法：${start}–${end}（正文 ${body.length} 字）`);
  }
  return sha256(body.slice(start, end));
}

/** 工作区内的正文文件：必须存在、.md/.txt、≤2MB，且解析后的真实路径仍在工作区里。 */
export async function resolveBodyFile(dir, file) {
  if (typeof file !== 'string' || file.trim() === '') fail('no-text', 'file 不能为空');
  const root = await realpath(resolveWorkspaceRoot(dir));
  const absolute = isAbsolute(file) ? resolve(file) : resolve(root, file);
  let real;
  try {
    real = await realpath(absolute);
  } catch (error) {
    fail('unreadable', `读不到正文文件：${file}`, { cause: error.message });
  }
  const rel = relative(root, real);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail('path-outside', `file 必须在工作区内：${file}`);
  }
  const extension = extname(real).toLowerCase();
  if (extension !== '.md' && extension !== '.txt') fail('unreadable', '只支持 .md / .txt');
  const info = await stat(real);
  if (!info.isFile()) fail('unreadable', `不是文件：${file}`);
  if (info.size > MAX_BODY_BYTES) fail('too-large', '文件超过 2MB');
  const raw = await readFile(real, 'utf8');
  return { real, rel: rel.split(sep).join('/'), text: normalizeNewlines(raw), bytes: info.size };
}

/** 原子写回正文；覆盖前把旧文件复制成 .beat-bak（可回滚，不新增目录）。 */
export async function writeBodyFile(real, text) {
  const tmp = `${real}.beat-tmp-${process.pid}-${Date.now()}`;
  try {
    await writeFile(tmp, text, 'utf8');
    await copyFile(real, `${real}.beat-bak`).catch(() => {});
    await rename(tmp, real);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

/** 快照目录：<工作区根>/.dsh-novel-beat/<书名>/revisions/ */
export function revisionsDir(dir, book) {
  return join(bookDir(dir, book), 'revisions');
}

export async function saveSnapshot(dir, book, revisionId, text) {
  const directory = revisionsDir(dir, book);
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${revisionId}.md`);
  await writeFile(path, normalizeNewlines(text), 'utf8');
  return `revisions/${revisionId}.md`;
}

export async function readSnapshot(dir, book, revisionId) {
  const path = join(revisionsDir(dir, book), `${revisionId}.md`);
  try {
    return normalizeNewlines(await readFile(path, 'utf8'));
  } catch (error) {
    fail('no-snapshot', `找不到段落快照 ${revisionId}`, { cause: error.message });
  }
}

/** 这个文件里已经写过的段落最远到哪（只算未回退的）。 */
export function segmentEndFor(segments, file) {
  let end = 0;
  for (const segment of segments) {
    if (segment.file !== file) continue;
    if (segment.status === 'reverted') continue;
    const value = Number.isInteger(segment.offsetEnd) ? segment.offsetEnd : 0;
    if (value > end) end = value;
  }
  return end;
}

/** 段落之后还有没有别的未回退段落（回退必须从最后一段开始）。 */
export function laterSegments(segments, file, offsetEnd) {
  return segments.filter((segment) => segment.file === file
    && segment.status !== 'reverted'
    && Number.isInteger(segment.offsetStart)
    && segment.offsetStart >= offsetEnd);
}

export { dirname };
