// lib/transaction.js — 0.10.1 成对正文/账本回退事务与启动恢复。
// 日志和原始字节快照放在每本书自己的 transactions/ 下；这里不写旧 rewinds/ 快照。

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  bookDir,
  bookFilePath,
  computeRevision,
  readBookDataUnlocked,
  resolveWorkspaceRoot,
  withBookLock,
} from './store.js';
import { computeLedgerHash, fail, nowIso, validateBook } from './schema.js';

const HASH = /^[a-f0-9]{64}$/i;
const TERMINAL = new Set(['committed', 'rolled-back', 'quarantined']);

/** 同步给正文写入 guard 使用；账本读取失败时由调用方采用更严格的暂停策略。 */
export function isBookWriteBlockedSync(dir, book) {
  const directory = bookDir(dir, book);
  if (existsSync(join(directory, 'quarantine.json'))) return true;
  let entries = [];
  try { entries = readdirSync(txRoot(dir, book), { withFileTypes: true }); } catch (error) {
    return error.code !== 'ENOENT';
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^tx-[a-f0-9-]{16,64}$/i.test(entry.name)) continue;
    try {
      const journal = JSON.parse(readFileSync(join(txRoot(dir, book), entry.name, 'journal.json'), 'utf8'));
      if (!TERMINAL.has(journal.stage)) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function hashBytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function hashRawBytes(bytes) {
  return hashBytes(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
}

/** Read-only 0.10.2 panel projection of transaction and quarantine state. */
export async function readTransactionStatus(dir, book) {
  const directory = bookDir(dir, book);
  let data = null;
  let ledgerRawHash = null;
  let ledgerReadError = null;
  try {
    const bytes = await readFile(bookFilePath(dir, book));
    ledgerRawHash = hashBytes(bytes);
    data = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    ledgerReadError = error?.code === 'ENOENT' ? null : String(error?.message ?? error).slice(0, 240);
  }

  let quarantine = null;
  let quarantineError = null;
  const quarantineFile = join(directory, 'quarantine.json');
  if (existsSync(quarantineFile)) {
    try {
      const value = JSON.parse(await readFile(quarantineFile, 'utf8'));
      quarantine = {
        txId: String(value.txId ?? ''),
        stage: String(value.stage ?? 'quarantined'),
        reason: String(value.reason ?? '事务恢复校验失败').slice(0, 400),
        expected: value.expected ?? {},
        current: value.current ?? {},
      };
    } catch (error) {
      quarantineError = String(error?.message ?? error).slice(0, 240);
    }
  }

  let dirs = [];
  try {
    dirs = (await readdir(txRoot(dir, book), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^tx-[a-f0-9-]{16,64}$/i.test(entry.name))
      .map((entry) => entry.name);
  } catch (error) {
    if (error?.code !== 'ENOENT') ledgerReadError ??= String(error?.message ?? error).slice(0, 240);
  }
  const journals = [];
  let invalidJournal = false;
  for (const txId of dirs) {
    try {
      const journal = await readJournal(txPaths(dir, book, txId).journal);
      if (!journal || journal.txId !== txId) {
        invalidJournal = true;
        continue;
      }
      journals.push(journal);
    } catch {
      invalidJournal = true;
    }
  }
  journals.sort((left, right) => String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? '')));
  const journal = journals.at(-1) ?? null;
  const receipt = journal
    ? (data?.transactions ?? []).find((entry) => entry?.id === journal.txId && entry.kind === 'revert-transaction') ?? null
    : (data?.transactions ?? []).filter((entry) => entry?.kind === 'revert-transaction').at(-1) ?? null;

  let snapshots = null;
  let currentBodyHash = null;
  if (journal) {
    const paths = txPaths(dir, book, journal.txId);
    const readSnapshot = async (file, expected) => {
      try {
        const bytes = await readFile(file);
        const hash = hashBytes(bytes);
        return { present: true, verified: hash === expected, hash };
      } catch {
        return { present: false, verified: false, hash: null };
      }
    };
    const [body, ledger] = await Promise.all([
      readSnapshot(paths.bodyBefore, journal.bodyBeforeHash),
      readSnapshot(paths.ledgerBefore, journal.ledgerBeforeHash),
    ]);
    snapshots = { body, ledger, pairVerified: body.verified && ledger.verified };
    try {
      const bodyFile = await safeBodyPath(dir, journal.bodyRelative);
      currentBodyHash = hashBytes(await readFile(bodyFile));
    } catch {
      currentBodyHash = null;
    }
  }

  const active = journal ? !TERMINAL.has(journal.stage) : false;
  const blocked = Boolean(quarantine || quarantineError || active || invalidJournal);
  return {
    book,
    blocked,
    quarantined: Boolean(quarantine || quarantineError || journal?.stage === 'quarantined'),
    recoveryPending: active,
    recoveryFailed: Boolean(quarantine || quarantineError || invalidJournal),
    error: quarantineError ?? (invalidJournal ? '事务日志缺失或损坏。' : ledgerReadError),
    currentRevision: data ? computeRevision(data) : null,
    currentLedgerHash: data?.integrity?.ledgerHash ?? null,
    currentLedgerRawHash: ledgerRawHash,
    currentBodyHash,
    latest: journal ? {
      txId: String(journal.txId),
      stage: String(journal.stage),
      kind: String(journal.kind ?? ''),
      decisionId: String(journal.decisionId ?? ''),
      chapter: Number.isInteger(journal.chapter) ? journal.chapter : null,
      beforeRevision: Number.isInteger(journal.beforeRevision) ? journal.beforeRevision : null,
      afterRevision: Number.isInteger(journal.afterRevision) ? journal.afterRevision : null,
      bodyBeforeHash: String(journal.bodyBeforeHash ?? ''),
      bodyAfterHash: String(journal.bodyAfterHash ?? ''),
      ledgerBeforeHash: String(journal.ledgerBeforeHash ?? ''),
      ledgerAfterHash: String(journal.ledgerAfterHash ?? ''),
      snapshots,
      staleStatus: receipt?.staleStatus ?? null,
      staleChapters: Array.isArray(receipt?.stalePending) ? receipt.stalePending.filter(Number.isInteger) : [],
      briefStatus: receipt?.briefStatus ?? null,
      recovery: journal.recovery ? {
        attempts: Number(journal.recovery.attempts) || 0,
        result: journal.recovery.result ?? null,
      } : null,
    } : receipt ? {
      txId: String(receipt.id),
      stage: String(receipt.stage ?? 'committed'),
      chapter: Number.isInteger(receipt.chapter) ? receipt.chapter : null,
      beforeRevision: null,
      afterRevision: Number.isInteger(receipt.revision) ? receipt.revision : null,
      bodyBeforeHash: receipt.files?.[0]?.beforeHash ?? null,
      bodyAfterHash: receipt.files?.[0]?.afterHash ?? receipt.receipt?.bodyHash ?? null,
      ledgerBeforeHash: null,
      ledgerAfterHash: data?.integrity?.ledgerHash ?? null,
      snapshots: null,
      staleStatus: receipt.staleStatus ?? null,
      staleChapters: Array.isArray(receipt.stalePending) ? receipt.stalePending.filter(Number.isInteger) : [],
      briefStatus: receipt.briefStatus ?? null,
      recovery: null,
    } : null,
    quarantine,
  };
}

function txRoot(dir, book) {
  return join(bookDir(dir, book), 'transactions');
}

function txPaths(dir, book, txId) {
  const directory = join(txRoot(dir, book), txId);
  return {
    directory,
    journal: join(directory, 'journal.json'),
    bodyBefore: join(directory, 'body.before'),
    ledgerBefore: join(directory, 'ledger.before'),
    bodyStage: join(directory, 'body.stage'),
    ledgerStage: join(directory, 'ledger.stage'),
  };
}

async function writeDurable(file, bytes) {
  await mkdir(dirname(file), { recursive: true });
  const handle = await open(file, 'w');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeJsonAtomic(file, value) {
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeDurable(temp, `${JSON.stringify(value, null, 2)}\n`);
  try {
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function readJournal(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function safeBodyPath(dir, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || isAbsolute(relativePath)) {
    fail('tx-journal-invalid', '事务日志正文路径无效');
  }
  const root = await realpath(resolveWorkspaceRoot(dir));
  const file = resolve(root, relativePath);
  const rel = relative(root, file);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    fail('tx-journal-invalid', '事务日志正文路径越出工作区');
  }
  const real = await realpath(file);
  const realRel = relative(root, real);
  if (realRel === '..' || realRel.startsWith(`..${sep}`) || isAbsolute(realRel)) {
    fail('tx-journal-invalid', '事务日志正文真实路径越出工作区');
  }
  return real;
}

async function resolveJournalPaths(dir, book, journal) {
  if (!journal || journal.version !== 1 || journal.book !== book
    || !/^tx-[a-f0-9-]{16,64}$/i.test(journal.txId)
    || !['prepared', 'snapshot', 'staged', 'body-replaced', 'ledger-committed', 'committed', 'rolled-back', 'quarantined'].includes(journal.stage)
    || !HASH.test(journal.bodyBeforeHash ?? '') || !HASH.test(journal.bodyAfterHash ?? '')
    || !HASH.test(journal.ledgerBeforeHash ?? '') || !HASH.test(journal.ledgerAfterHash ?? '')
    || !Number.isSafeInteger(journal.beforeRevision) || journal.beforeRevision < 0
    || !Number.isSafeInteger(journal.afterRevision) || journal.afterRevision !== journal.beforeRevision + 1
    || !Array.isArray(journal.files) || journal.files.length !== 2
    || journal.files[0]?.path !== journal.bodyRelative || journal.files[1]?.path !== 'book.json'
    || journal.files[0]?.beforeHash !== journal.bodyBeforeHash || journal.files[0]?.afterHash !== journal.bodyAfterHash
    || journal.files[1]?.beforeHash !== journal.ledgerBeforeHash || journal.files[1]?.afterHash !== journal.ledgerAfterHash
    || journal.receipt?.txId !== journal.txId || journal.receipt?.revision !== journal.afterRevision
    || journal.receipt?.bodyHash !== journal.bodyAfterHash || !HASH.test(journal.receipt?.ledgerHash ?? '')) {
    fail('tx-journal-invalid', '事务日志结构或 hash 无效');
  }
  const bodyFile = await safeBodyPath(dir, journal.bodyRelative);
  const paths = txPaths(dir, book, journal.txId);
  return { ...paths, bodyFile, ledgerFile: bookFilePath(dir, book) };
}

async function hashFile(file) {
  try {
    return hashBytes(await readFile(file));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function replaceFrom(file, sourceBytes) {
  const temp = `${file}.tx-tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeDurable(temp, sourceBytes);
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function quarantine(dir, book, journal, reason, current = {}) {
  const paths = txPaths(dir, book, journal.txId);
  const value = {
    version: 1,
    book,
    txId: journal.txId,
    at: nowIso(),
    reason: String(reason?.message ?? reason),
    stage: journal.stage,
    expected: {
      bodyBeforeHash: journal.bodyBeforeHash,
      bodyAfterHash: journal.bodyAfterHash,
      ledgerBeforeHash: journal.ledgerBeforeHash,
      ledgerAfterHash: journal.ledgerAfterHash,
    },
    current,
  };
  await writeJsonAtomic(join(bookDir(dir, book), 'quarantine.json'), value);
  journal.stage = 'quarantined';
  journal.quarantine = value;
  journal.updatedAt = nowIso();
  await writeJsonAtomic(paths.journal, journal);
  return value;
}

function hasMatchingReceipt(bytes, journal) {
  try {
    const ledger = JSON.parse(bytes.toString('utf8'));
    const receipt = (ledger.transactions ?? []).find((entry) => entry?.id === journal.txId);
    return Boolean(receipt
      && receipt.kind === 'revert-transaction'
      && receipt.chapter === journal.chapter
      && receipt.revision === journal.afterRevision
      && receipt.receipt?.bodyHash === journal.bodyAfterHash
      && receipt.receipt?.revision === journal.afterRevision
      && receipt.receipt?.txId === journal.txId
      && journal.receipt?.ledgerHash === ledger.integrity?.ledgerHash
      && computeLedgerHash(ledger) === ledger.integrity?.ledgerHash);
  } catch {
    return false;
  }
}

async function restoreBefore(dir, book, journal, paths, onPhase = null) {
  let bodySnapshot;
  let ledgerSnapshot;
  try {
    bodySnapshot = await readFile(paths.bodyBefore);
    ledgerSnapshot = await readFile(paths.ledgerBefore);
  } catch (cause) {
    const error = new Error('事务 before 快照缺失');
    error.code = 'tx-snapshot-corrupt';
    error.cause = cause;
    throw error;
  }
  if (hashBytes(bodySnapshot) !== journal.bodyBeforeHash
    || hashBytes(ledgerSnapshot) !== journal.ledgerBeforeHash) {
    const error = new Error('事务 before 快照损坏或 hash 不符');
    error.code = 'tx-snapshot-corrupt';
    throw error;
  }
  const currentBody = await hashFile(paths.bodyFile);
  const currentLedger = await hashFile(paths.ledgerFile);
  if (![journal.bodyBeforeHash, journal.bodyAfterHash].includes(currentBody)
    || ![journal.ledgerBeforeHash, journal.ledgerAfterHash].includes(currentLedger)) {
    throw new Error('恢复前发现未知文件 hash，拒绝覆盖现场');
  }
  await onPhase?.('restore-body', { journal, paths });
  await replaceFrom(paths.bodyFile, bodySnapshot);
  await onPhase?.('restore-ledger', { journal, paths });
  await replaceFrom(paths.ledgerFile, ledgerSnapshot);
  const restoredBody = await hashFile(paths.bodyFile);
  const restoredLedger = await hashFile(paths.ledgerFile);
  if (restoredBody !== journal.bodyBeforeHash || restoredLedger !== journal.ledgerBeforeHash) {
    throw new Error('恢复完成后的 before hash 校验失败');
  }
  return { bodyHash: restoredBody, ledgerHash: restoredLedger };
}

async function cleanStages(paths) {
  await Promise.all([
    rm(paths.bodyStage, { force: true }).catch(() => {}),
    rm(paths.ledgerStage, { force: true }).catch(() => {}),
  ]);
}

async function recoverOneUnlocked(dir, book, journal, journalFile, { onPhase = null } = {}) {
  if (TERMINAL.has(journal.stage)) return journal;
  let paths;
  try {
    paths = await resolveJournalPaths(dir, book, journal);
    const bodyHash = await hashFile(paths.bodyFile);
    const ledgerBytes = await readFile(paths.ledgerFile).catch(() => null);
    const ledgerHash = ledgerBytes ? hashBytes(ledgerBytes) : null;
    const current = { bodyHash, ledgerHash };

    if (bodyHash === journal.bodyAfterHash && ledgerHash === journal.ledgerAfterHash
      && hasMatchingReceipt(ledgerBytes, journal)) {
      journal.stage = 'committed';
      journal.recovery = { attempts: journal.recovery?.attempts ?? 0, result: 'completed-after-pair', at: nowIso() };
      journal.updatedAt = nowIso();
      await writeJsonAtomic(journalFile, journal);
      return journal;
    }
    if (bodyHash === journal.bodyBeforeHash && ledgerHash === journal.ledgerBeforeHash) {
      await cleanStages(paths);
      journal.stage = 'rolled-back';
      journal.recovery = { attempts: journal.recovery?.attempts ?? 0, result: 'aborted-before-replacement', at: nowIso() };
      journal.updatedAt = nowIso();
      await writeJsonAtomic(journalFile, journal);
      return journal;
    }
    const retryPartialRollback = journal.recovery?.result === 'restore-failed'
      && bodyHash === journal.bodyBeforeHash && ledgerHash === journal.ledgerAfterHash;
    if (!retryPartialRollback && (bodyHash !== journal.bodyAfterHash || ledgerHash !== journal.ledgerBeforeHash)) {
      await quarantine(dir, book, journal, '未知 hash 组合或 after receipt 不匹配', current);
      return journal;
    }

    const previousAttempts = Number(journal.recovery?.attempts) || 0;
    if (previousAttempts >= 2) {
      await quarantine(dir, book, journal, '事务恢复已失败两次', current);
      return journal;
    }
    try {
      await restoreBefore(dir, book, journal, paths, onPhase);
      await cleanStages(paths);
      journal.stage = 'rolled-back';
      journal.recovery = { attempts: previousAttempts + 1, result: 'restored-before-pair', at: nowIso() };
      journal.updatedAt = nowIso();
      await writeJsonAtomic(journalFile, journal);
      return journal;
    } catch (error) {
      if (error?.code === 'tx-snapshot-corrupt') {
        journal.recovery = {
          attempts: (Number(journal.recovery?.attempts) || 0) + 1,
          result: 'snapshot-corrupt',
          at: nowIso(),
          error: String(error?.message ?? error),
        };
        journal.updatedAt = nowIso();
        await writeJsonAtomic(journalFile, journal);
        await quarantine(dir, book, journal, error, current);
        return journal;
      }
      journal.recovery = { attempts: previousAttempts + 1, result: 'restore-failed', at: nowIso(), error: String(error?.message ?? error) };
      journal.updatedAt = nowIso();
      await writeJsonAtomic(journalFile, journal);
      if (journal.recovery.attempts >= 2) {
        await quarantine(dir, book, journal, error, current);
        return journal;
      }
      fail('tx-recovery-failed', `事务 ${journal.txId} 恢复失败，已阻止该书写入；可重试恢复。`, {
        txId: journal.txId,
        attempts: journal.recovery.attempts,
        cause: error?.message,
      });
    }
  } catch (error) {
    if (error?.code === 'tx-recovery-failed') throw error;
    const current = paths ? {
      bodyHash: await hashFile(paths.bodyFile).catch(() => null),
      ledgerHash: await hashFile(paths.ledgerFile).catch(() => null),
    } : {};
    try {
      await quarantine(dir, book, journal, error, current);
    } catch (quarantineError) {
      fail('tx-recovery-failed', `事务 ${journal.txId} 无法恢复且隔离记录写入失败；该书已 fail closed。`, {
        txId: journal.txId,
        cause: quarantineError?.message,
      });
    }
    return journal;
  }
}

export async function assertBookWritableUnlocked(dir, book) {
  const quarantineFile = join(bookDir(dir, book), 'quarantine.json');
  if (existsSync(quarantineFile)) {
    fail('book-quarantined', `书「${book}」处于只读隔离状态；检查 quarantine.json 和事务现场后再解除。`);
  }
  const directory = txRoot(dir, book);
  let names = [];
  try { names = await readdir(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of names) {
    if (!/^tx-[a-f0-9-]{16,64}$/i.test(name)) continue;
    const journal = await readJournal(join(directory, name, 'journal.json'));
    if (journal && (journal.stage === 'quarantined' || !TERMINAL.has(journal.stage))) {
      fail('book-quarantined', `书「${book}」存在未恢复事务 ${journal.txId}；写入已暂停。`);
    }
  }
}

export async function recoverBookTransactionsUnlocked(dir, book, options = {}) {
  const directory = txRoot(dir, book);
  let names = [];
  try { names = await readdir(directory); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of names.sort()) {
    if (!/^tx-[a-f0-9-]{16,64}$/i.test(name)) continue;
    const journalFile = join(directory, name, 'journal.json');
    let journal;
    try {
      journal = await readJournal(journalFile);
    } catch (error) {
      const synthetic = { version: 1, txId: name, book, stage: 'prepared', bodyRelative: '', bodyBeforeHash: '', bodyAfterHash: '', ledgerBeforeHash: '', ledgerAfterHash: '' };
      await quarantine(dir, book, synthetic, error);
      continue;
    }
    if (journal && journal.txId !== name) {
      await quarantine(dir, book, { ...journal, txId: name }, new Error('事务目录名与日志 txId 不匹配'));
      continue;
    }
    if (!journal || TERMINAL.has(journal.stage)) continue;
    await recoverOneUnlocked(dir, book, journal, journalFile, options);
  }
}

export async function retryPendingBookTasksUnlocked(dir, book) {
  return retryPendingTasksUnlocked(dir, book);
}

async function saveLedgerUnlocked(file, data) {
  data.integrity.ledgerHash = computeLedgerHash(data);
  validateBook(data);
  const temp = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeDurable(temp, `${JSON.stringify(data, null, 2)}\n`);
  try {
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function updatePostCommitUnlocked(dir, book, txId, update) {
  const { data } = await readBookDataUnlocked(dir, book);
  if (!data) return null;
  const receipt = (data.transactions ?? []).find((entry) => entry.id === txId && entry.kind === 'revert-transaction');
  if (!receipt) return null;
  const changed = update(data, receipt);
  if (!changed) return receipt;
  data.revision = computeRevision(data) + 1;
  data.updatedAt = nowIso();
  await saveLedgerUnlocked(bookFilePath(dir, book), data);
  return receipt;
}

async function retryPendingTasksUnlocked(dir, book) {
  if (existsSync(join(bookDir(dir, book), 'quarantine.json'))) return;
  try {
    const raw = JSON.parse(await readFile(bookFilePath(dir, book), 'utf8'));
    if (raw?.schemaVersion !== 3 || !Array.isArray(raw.transactions)
      || !raw.transactions.some((entry) => entry?.kind === 'revert-transaction'
        && (entry.staleStatus === 'pending' || entry.briefStatus === 'pending'))) return;
  } catch {
    // Let the normal store reader report corrupt/missing books without masking it here.
    return;
  }
  const { data } = await readBookDataUnlocked(dir, book);
  if (!data) return;
  for (const entry of [...(data.transactions ?? [])]) {
    if (entry?.kind !== 'revert-transaction') continue;
    if (entry.staleStatus === 'pending' && Array.isArray(entry.stalePending) && entry.stalePending.length) {
      try {
        await updatePostCommitUnlocked(dir, book, entry.id, (state, current) => {
          if (current.staleStatus !== 'pending') return false;
          const at = nowIso();
          for (const chapter of current.stalePending) {
            const key = String(chapter);
            state.chapters[key] = {
              ...(state.chapters[key] ?? {}),
              stale: { reason: `第 ${current.chapter} 章回退了`, since: at, sourceDecisionId: current.decisionId ?? null, txId: current.id },
            };
          }
          current.staleStatus = 'complete';
          current.stalePending = [];
          current.staleAt = at;
          return true;
        });
      } catch {
        // 保留 pending；下次读/写账本时只重试标记，不接触正文。
      }
    }
    if (entry.briefStatus === 'pending' && entry.briefInput) {
      try {
        const { buildRewriteBrief } = await import('./resume.js');
        const { data: latest } = await readBookDataUnlocked(dir, book);
        const decision = latest?.decisions?.find((item) => item.id === entry.briefInput.decisionId);
        const prompt = buildRewriteBrief({
          data: latest,
          chapter: entry.briefInput.chapter,
          decision,
          plan: entry.briefInput.plan,
          tail: entry.briefInput.tail,
          maxChars: 1200,
        });
        await updatePostCommitUnlocked(dir, book, entry.id, (_state, current) => {
          if (current.briefStatus !== 'pending') return false;
          current.briefStatus = 'complete';
          current.briefText = prompt;
          current.briefCompletedAt = nowIso();
          return true;
        });
      } catch {
        // brief pending 不改变核心提交，也不阻止该书其他写操作。
      }
    }
  }
}

/** 在锁内重新读 revision/hash、重算账本变更，然后原子提交正文与账本。 */
export async function commitPairTransaction({
  dir,
  book,
  bodyFile,
  expectedRevision = null,
  expectedBodyHash = null,
  expectedLedgerHash = null,
  kind = 'revert',
  chapter,
  decisionId = null,
  staleChapters = [],
  briefInput = null,
  mutate,
  onPhase = null,
}) {
  return withBookLock(dir, book, async () => {
    await recoverBookTransactionsUnlocked(dir, book);
    await retryPendingTasksUnlocked(dir, book);
    await assertBookWritableUnlocked(dir, book);
    const ledgerFile = bookFilePath(dir, book);
    const root = await realpath(resolveWorkspaceRoot(dir));
    const bodyAbsolute = await realpath(resolve(bodyFile));
    const bodyRelative = relative(root, bodyAbsolute);
    if (bodyRelative === '..' || bodyRelative.startsWith(`..${sep}`) || isAbsolute(bodyRelative)) {
      fail('path-outside', '事务正文必须在当前工作区内');
    }
    const currentBody = await readFile(bodyAbsolute);
    const beforeBodyHash = hashBytes(currentBody);
    const currentLedgerRaw = await readFile(ledgerFile);
    const beforeLedgerHash = hashBytes(currentLedgerRaw);
    const { data: current, warnings } = await readBookDataUnlocked(dir, book);
    if (!current) fail('no-book', `书「${book}」还没有账本。`);
    const revision = computeRevision(current);
    if (expectedRevision != null && revision !== expectedRevision) {
      fail('revision-conflict', `账本已到版本 ${revision}，与预览版本 ${expectedRevision} 不一致；未产生事务副作用。`);
    }
    if (expectedBodyHash && beforeBodyHash !== expectedBodyHash) {
      fail('body-hash-conflict', '正文已在预览后改变；未产生事务副作用，请刷新预览。');
    }
    if (expectedLedgerHash && current.integrity?.ledgerHash !== expectedLedgerHash) {
      fail('revision-conflict', '账本 hash 已在预览后改变；未产生事务副作用，请刷新预览。');
    }

    const txId = `tx-${randomUUID()}`;
    const paths = txPaths(dir, book, txId);
    const bodyAfterValue = await mutate({
      data: current,
      bodyBytes: currentBody,
      bodyText: currentBody.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n'),
      bodyHash: beforeBodyHash,
      revision,
      txId,
    });
    const afterBody = Buffer.isBuffer(bodyAfterValue.body) ? bodyAfterValue.body : Buffer.from(String(bodyAfterValue.body), 'utf8');
    const afterBodyHash = hashBytes(afterBody);
    const afterRevision = revision + 1;
    const now = nowIso();
    current.revision = afterRevision;
    current.updatedAt = now;
    current.integrity ??= { algorithm: 'sha256', ledgerHash: null, bodyBindings: [] };
    current.integrity.algorithm = 'sha256';
    current.integrity.bodyBindings = Array.isArray(current.integrity.bodyBindings) ? current.integrity.bodyBindings : [];
    current.transactions ??= [];
    current.transactions.push({
      id: txId,
      kind: 'revert-transaction',
      chapter,
      decisionId,
      stage: 'committed',
      files: [{ path: bodyRelative.split(sep).join('/'), beforeHash: beforeBodyHash, afterHash: afterBodyHash }],
      revision: afterRevision,
      at: now,
      receipt: { txId, bodyHash: afterBodyHash, revision: afterRevision },
      staleStatus: staleChapters.length ? 'pending' : 'complete',
      stalePending: [...new Set(staleChapters)].sort((a, b) => a - b),
      briefStatus: briefInput ? 'pending' : 'complete',
      ...(briefInput ? { briefInput } : {}),
    });
    current.integrity.ledgerHash = computeLedgerHash(current);
    validateBook(current);
    const afterLedger = Buffer.from(`${JSON.stringify(current, null, 2)}\n`, 'utf8');
    const afterLedgerHash = hashBytes(afterLedger);
    const journal = {
      version: 1,
      txId,
      book,
      chapter,
      decisionId,
      kind,
      stage: 'prepared',
      files: [
        { path: bodyRelative.split(sep).join('/'), beforeHash: beforeBodyHash, afterHash: afterBodyHash },
        { path: 'book.json', beforeHash: beforeLedgerHash, afterHash: afterLedgerHash },
      ],
      bodyRelative: bodyRelative.split(sep).join('/'),
      bodyBeforeHash: beforeBodyHash,
      bodyAfterHash: afterBodyHash,
      ledgerBeforeHash: beforeLedgerHash,
      ledgerAfterHash: afterLedgerHash,
      beforeRevision: revision,
      afterRevision,
      receipt: { txId, revision: afterRevision, bodyHash: afterBodyHash, ledgerHash: current.integrity.ledgerHash },
      createdAt: now,
      updatedAt: now,
      recovery: { attempts: 0, result: null },
    };
    await mkdir(paths.directory, { recursive: true });
    const persistStage = async (stage) => {
      journal.stage = stage;
      journal.updatedAt = nowIso();
      await writeJsonAtomic(paths.journal, journal);
      if (stage !== 'committed') await onPhase?.(stage, { journal, paths });
    };
    const abortBeforeReplacement = async (reason, code) => {
      await cleanStages(paths);
      journal.stage = 'rolled-back';
      journal.recovery = { attempts: 0, result: 'concurrent-change-aborted', at: nowIso(), error: reason };
      journal.updatedAt = nowIso();
      await writeJsonAtomic(paths.journal, journal);
      fail(code, `${reason}；事务未替换正文或账本。`);
    };

    try {
      await persistStage('prepared');
      await onPhase?.('snapshot-write', { journal, paths });
      await writeDurable(paths.bodyBefore, currentBody);
      await writeDurable(paths.ledgerBefore, currentLedgerRaw);
      if (hashBytes(await readFile(paths.bodyBefore)) !== beforeBodyHash
        || hashBytes(await readFile(paths.ledgerBefore)) !== beforeLedgerHash) {
        throw new Error('成对 before 快照回读 hash 不符');
      }
      await persistStage('snapshot');
      await onPhase?.('stage-write', { journal, paths });
      await writeDurable(paths.bodyStage, afterBody);
      await writeDurable(paths.ledgerStage, afterLedger);
      if (hashBytes(await readFile(paths.bodyStage)) !== afterBodyHash
        || hashBytes(await readFile(paths.ledgerStage)) !== afterLedgerHash) {
        throw new Error('成对 stage 文件回读 hash 不符');
      }
      await persistStage('staged');
      await onPhase?.('body-replace', { journal, paths });
      if (await hashFile(bodyAbsolute) !== beforeBodyHash || await hashFile(ledgerFile) !== beforeLedgerHash) {
        const ledgerStillBefore = await hashFile(ledgerFile) === beforeLedgerHash;
        await abortBeforeReplacement(
          ledgerStillBefore ? '正文在事务暂存期间发生变化' : '账本在事务暂存期间发生变化',
          ledgerStillBefore ? 'body-hash-conflict' : 'revision-conflict',
        );
      }
      if (afterBodyHash === beforeBodyHash) await rm(paths.bodyStage, { force: true });
      else await rename(paths.bodyStage, bodyAbsolute);
      await persistStage('body-replaced');
      await onPhase?.('ledger-replace', { journal, paths });
      if (await hashFile(ledgerFile) !== beforeLedgerHash) {
        throw new Error('正文替换后账本发生外部变化；保留现场并隔离，拒绝覆盖新账本');
      }
      await rename(paths.ledgerStage, ledgerFile);
      await persistStage('ledger-committed');
      if (await hashFile(bodyAbsolute) !== afterBodyHash || await hashFile(ledgerFile) !== afterLedgerHash) {
        throw new Error('事务提交后正文或账本回读 hash 不符');
      }
      const storedLedger = JSON.parse((await readFile(ledgerFile, 'utf8')));
      if (!hasMatchingReceipt(Buffer.from(JSON.stringify(storedLedger)), journal)) {
        throw new Error('账本 transaction receipt 与事务日志不匹配');
      }
      await persistStage('committed');
    } catch (error) {
      try {
        await recoverOneUnlocked(dir, book, journal, paths.journal, { onPhase });
      } catch (recoveryError) {
        if (recoveryError?.code === 'tx-recovery-failed') throw recoveryError;
        fail('tx-recovery-failed', `事务失败且无法确认恢复结果；书「${book}」已暂停写入。`, { txId, cause: recoveryError?.message });
      }
      const latest = await readJournal(paths.journal);
      if (latest?.stage === 'quarantined') {
        fail('tx-recovery-failed', `事务 ${txId} 已隔离；正文/账本现场和快照已保留。`, { txId });
      }
      if (latest?.stage !== 'committed') throw error;
    }

    // 简报和 stale 均在 core commit 后独立重试；它们的失败不会回滚正文/账本。
    try {
      await onPhase?.('stale-mark', { txId, chapter, staleChapters });
      await updatePostCommitUnlocked(dir, book, txId, (state, receipt) => {
        if (receipt.staleStatus !== 'pending' || !receipt.stalePending?.length) return false;
        const at = nowIso();
        for (const laterChapter of receipt.stalePending) {
          const key = String(laterChapter);
          state.chapters[key] = {
            ...(state.chapters[key] ?? {}),
            stale: { reason: `第 ${chapter} 章回退了`, since: at, sourceDecisionId: decisionId, txId },
          };
        }
        receipt.staleStatus = 'complete';
        receipt.stalePending = [];
        receipt.staleAt = at;
        return true;
      });
    } catch {
      // receipt.stalePending 保持原样，下一次打开/写入账本时只重试 stale。
    }
    let prompt = null;
    if (briefInput) {
      try {
        await onPhase?.('brief-build', { txId, chapter, decisionId });
        const { buildRewriteBrief } = await import('./resume.js');
        const { data: committed } = await readBookDataUnlocked(dir, book);
        const decision = committed?.decisions?.find((item) => item.id === decisionId);
        prompt = buildRewriteBrief({ data: committed, chapter, decision, plan: briefInput.plan, tail: briefInput.tail, maxChars: 1200 });
        await updatePostCommitUnlocked(dir, book, txId, (_state, receipt) => {
          if (receipt.briefStatus !== 'pending') return false;
          receipt.briefStatus = 'complete';
          receipt.briefText = prompt;
          receipt.briefCompletedAt = nowIso();
          return true;
        });
        return {
          ...bodyAfterValue,
          txId,
          transactionRevision: afterRevision,
          prompt,
          warnings: [...(bodyAfterValue.warnings ?? []), ...warnings],
        };
      } catch {
        // brief remains pending and is retried independently on the next book access.
      }
    }
    const { data: finalData } = await readBookDataUnlocked(dir, book);
    const finalReceipt = finalData?.transactions?.find((entry) => entry.id === txId);
    const postCommitWarnings = [];
    if (finalReceipt?.staleStatus === 'pending') postCommitWarnings.push('stale-pending: 后续章节待复核标记将在下次访问账本时重试');
    if (finalReceipt?.briefStatus === 'pending') postCommitWarnings.push('brief-pending: 重写简报将在下次访问账本时重试');
    return {
      ...bodyAfterValue,
      txId,
      transactionRevision: afterRevision,
      prompt,
      postCommit: { staleStatus: finalReceipt?.staleStatus ?? 'complete', briefStatus: finalReceipt?.briefStatus ?? 'complete' },
      warnings: [...(bodyAfterValue.warnings ?? []), ...warnings, ...postCommitWarnings],
    };
  });
}

/** 只更新简报状态；不改正文、不回滚 core transaction。 */
export async function completeTransactionBrief(dir, book, txId, prompt) {
  return withBookLock(dir, book, async () => updatePostCommitUnlocked(dir, book, txId, (_state, receipt) => {
    if (receipt.briefStatus !== 'pending') return false;
    receipt.briefStatus = 'complete';
    receipt.briefText = String(prompt ?? '');
    receipt.briefCompletedAt = nowIso();
    return true;
  }));
}
