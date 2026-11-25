import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyBook, computeLedgerHash } from '../lib/schema.js';
import { bookDir, bookFilePath, readBookData, withBookLock } from '../lib/store.js';
import { commitPairTransaction, hashRawBytes, readTransactionStatus, recoverBookTransactionsUnlocked } from '../lib/transaction.js';

const BOOK = '事务测试书';
const BODY = '正文/第1章.md';

async function fixture(t, body = Buffer.from('before\r\n正文🙂', 'utf8')) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-transaction-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '正文'), { recursive: true });
  await mkdir(bookDir(dir, BOOK), { recursive: true });
  await writeFile(join(dir, BODY), body);
  const data = emptyBook({ book: BOOK, now: '2026-11-25T00:00:00.000Z' });
  data.revision = 0;
  data.integrity.ledgerHash = computeLedgerHash(data);
  const ledger = Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await writeFile(bookFilePath(dir, BOOK), ledger);
  return { dir, bodyBefore: body, ledgerBefore: ledger };
}

function commit(dir, options = {}) {
  return commitPairTransaction({
    dir,
    book: BOOK,
    bodyFile: join(dir, BODY),
    chapter: 1,
    decisionId: 'd1',
    mutate: ({ data }) => {
      data.audit.push({ at: '2026-11-25T00:00:01.000Z', action: 'test-revert', chapter: 1 });
      return { body: Buffer.from('after\n正文🙂', 'utf8'), result: { ok: true } };
    },
    ...options,
  });
}

async function onlyJournal(dir) {
  const root = join(bookDir(dir, BOOK), 'transactions');
  const [id] = await readdir(root);
  return { root, directory: join(root, id), file: join(root, id, 'journal.json') };
}

test('双文件成功提交：事务收据、正文/账本 hash 与 revision 一致', async (t) => {
  const { dir, bodyBefore } = await fixture(t);
  const result = await commit(dir);
  const body = await readFile(join(dir, BODY));
  const ledgerBytes = await readFile(bookFilePath(dir, BOOK));
  const ledger = JSON.parse(ledgerBytes.toString('utf8'));
  const receipt = ledger.transactions.find((item) => item.id === result.txId);
  const journal = JSON.parse(await readFile((await onlyJournal(dir)).file, 'utf8'));

  assert.equal(hashRawBytes(body), journal.bodyAfterHash);
  assert.equal(hashRawBytes(ledgerBytes), journal.ledgerAfterHash);
  assert.equal(receipt.stage, 'committed');
  assert.equal(receipt.receipt.txId, journal.txId);
  assert.equal(receipt.receipt.bodyHash, journal.bodyAfterHash);
  assert.equal(receipt.revision, journal.afterRevision);
  assert.equal(journal.stage, 'committed');
  assert.notEqual(hashRawBytes(body), hashRawBytes(bodyBefore));
  const status = await readTransactionStatus(dir, BOOK);
  assert.equal(status.blocked, false);
  assert.equal(status.latest.txId, result.txId);
  assert.equal(status.latest.beforeRevision, 0);
  assert.equal(status.latest.afterRevision, 1);
  assert.equal(status.latest.snapshots.pairVerified, true);
  assert.equal(status.currentBodyHash, journal.bodyAfterHash);
});

test('冲突在 prepared 前拒绝：正文、账本和 transactions 目录均无变化', async (t) => {
  const { dir, bodyBefore, ledgerBefore } = await fixture(t);
  await assert.rejects(() => commit(dir, { expectedRevision: 99 }), { code: 'revision-conflict' });
  assert.deepEqual(await readFile(join(dir, BODY)), bodyBefore);
  assert.deepEqual(await readFile(bookFilePath(dir, BOOK)), ledgerBefore);
  await assert.rejects(() => readdir(join(bookDir(dir, BOOK), 'transactions')), { code: 'ENOENT' });
});

test('stage 后并发正文变化不会被事务覆盖；正文替换后并发账本变化会隔离保留现场', async (t) => {
  await t.test('正文在替换前变化', async (st) => {
    const { dir, ledgerBefore } = await fixture(st);
    const externalBody = Buffer.from('author edit during staging', 'utf8');
    await assert.rejects(() => commit(dir, {
      onPhase: async (phase) => { if (phase === 'staged') await writeFile(join(dir, BODY), externalBody); },
    }), { code: 'body-hash-conflict' });
    assert.deepEqual(await readFile(join(dir, BODY)), externalBody);
    assert.deepEqual(await readFile(bookFilePath(dir, BOOK)), ledgerBefore);
    assert.equal(JSON.parse(await readFile((await onlyJournal(dir)).file, 'utf8')).stage, 'rolled-back');
  });

  await t.test('账本在正文替换后变化', async (st) => {
    const { dir } = await fixture(st);
    const externalLedger = Buffer.from('{ external ledger write }', 'utf8');
    await assert.rejects(() => commit(dir, {
      onPhase: async (phase) => { if (phase === 'ledger-replace') await writeFile(bookFilePath(dir, BOOK), externalLedger); },
    }), { code: 'tx-recovery-failed' });
    assert.deepEqual(await readFile(bookFilePath(dir, BOOK)), externalLedger);
    assert.ok(await readFile(join(bookDir(dir, BOOK), 'quarantine.json')));
  });
});

test('prepared、snapshot、stage 与替换故障均恢复两份原字节', async (t) => {
  const phases = ['prepared', 'snapshot-write', 'snapshot', 'stage-write', 'staged', 'body-replace', 'body-replaced', 'ledger-replace'];
  for (const phase of phases) {
    await t.test(phase, async (st) => {
      const { dir, bodyBefore, ledgerBefore } = await fixture(st);
      await assert.rejects(() => commit(dir, {
        onPhase: async (current) => { if (current === phase) throw new Error(`fault:${phase}`); },
      }), new RegExp(`fault:${phase}`));
      assert.deepEqual(await readFile(join(dir, BODY)), bodyBefore);
      assert.deepEqual(await readFile(bookFilePath(dir, BOOK)), ledgerBefore);
      const tx = await onlyJournal(dir);
      const journal = JSON.parse(await readFile(tx.file, 'utf8'));
      assert.equal(journal.stage, 'rolled-back');
    });
  }
});

test('ledger replacement 后的 crash recovery 识别有效 after pair，不重复应用账本 mutation', async (t) => {
  const { dir } = await fixture(t);
  const result = await commit(dir, {
    onPhase: async (phase) => { if (phase === 'ledger-committed') throw new Error('simulated-crash'); },
  });
  assert.ok(result.txId);
  const { file } = await onlyJournal(dir);
  const journal = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(journal.stage, 'committed');
  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.audit.filter((item) => item.action === 'test-revert').length, 1);
  assert.equal(data.transactions.filter((item) => item.id === result.txId).length, 1);
});

test('启动恢复：body after + ledger before 回滚；both before 中止', async (t) => {
  for (const mode of ['body-after', 'both-before']) {
    await t.test(mode, async (st) => {
      const { dir, bodyBefore, ledgerBefore } = await fixture(st);
      const result = await commit(dir);
      const tx = await onlyJournal(dir);
      const journal = JSON.parse(await readFile(tx.file, 'utf8'));
      journal.stage = 'body-replaced';
      await writeFile(tx.file, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
      if (mode === 'body-after') {
        await writeFile(bookFilePath(dir, BOOK), ledgerBefore);
      } else {
        await writeFile(join(dir, BODY), bodyBefore);
        await writeFile(bookFilePath(dir, BOOK), ledgerBefore);
      }

      await readBookData(dir, BOOK);
      assert.deepEqual(await readFile(join(dir, BODY)), bodyBefore);
      assert.deepEqual(await readFile(bookFilePath(dir, BOOK)), ledgerBefore);
      const recovered = JSON.parse(await readFile(tx.file, 'utf8'));
      assert.equal(recovered.stage, 'rolled-back');
      assert.equal(recovered.recovery.result, mode === 'body-after' ? 'restored-before-pair' : 'aborted-before-replacement');
      assert.ok(result.txId);
    });
  }
});

test('恢复写账本中断后，下一次启动从 both-before 幂等收敛；快照损坏立即隔离', async (t) => {
  await t.test('恢复写入中断', async (st) => {
    const { dir, ledgerBefore, bodyBefore } = await fixture(st);
    await commit(dir);
    const tx = await onlyJournal(dir);
    const journal = JSON.parse(await readFile(tx.file, 'utf8'));
    journal.stage = 'body-replaced';
    await writeFile(bookFilePath(dir, BOOK), ledgerBefore);
    await writeFile(tx.file, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
    await assert.rejects(() => withBookLock(dir, BOOK, () => recoverBookTransactionsUnlocked(dir, BOOK, {
      onPhase: async (phase) => { if (phase === 'restore-ledger') throw new Error('restore-ledger-fault'); },
    })), { code: 'tx-recovery-failed' });
    await readBookData(dir, BOOK);
    assert.deepEqual(await readFile(join(dir, BODY)), bodyBefore);
    assert.deepEqual(await readFile(bookFilePath(dir, BOOK)), ledgerBefore);
    assert.equal(JSON.parse(await readFile(tx.file, 'utf8')).stage, 'rolled-back');
  });

  await t.test('快照损坏', async (st) => {
    const { dir, ledgerBefore } = await fixture(st);
    await commit(dir);
    const tx = await onlyJournal(dir);
    const journal = JSON.parse(await readFile(tx.file, 'utf8'));
    journal.stage = 'body-replaced';
    await writeFile(bookFilePath(dir, BOOK), ledgerBefore);
    await writeFile(tx.file, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
    await writeFile(join(tx.directory, 'body.before'), 'damaged snapshot', 'utf8');
    await readBookData(dir, BOOK);
    assert.ok(await readFile(join(bookDir(dir, BOOK), 'quarantine.json')));
    assert.equal(JSON.parse(await readFile(tx.file, 'utf8')).stage, 'quarantined');
    const status = await readTransactionStatus(dir, BOOK);
    assert.equal(status.blocked, true);
    assert.equal(status.quarantined, true);
    assert.equal(status.latest.stage, 'quarantined');
  });
});

test('未知 hash 或 after pair receipt 不匹配时隔离并拒绝后续写入', async (t) => {
  for (const mode of ['unknown-hash', 'receipt-mismatch']) {
    await t.test(mode, async (st) => {
      const { dir, ledgerBefore } = await fixture(st);
      await commit(dir);
      const tx = await onlyJournal(dir);
      const journal = JSON.parse(await readFile(tx.file, 'utf8'));
      journal.stage = 'body-replaced';
      if (mode === 'unknown-hash') {
        await writeFile(join(dir, BODY), 'third state', 'utf8');
        await writeFile(bookFilePath(dir, BOOK), ledgerBefore);
      } else {
        journal.receipt.ledgerHash = '0'.repeat(64);
      }
      await writeFile(tx.file, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
      await readBookData(dir, BOOK);
      const quarantine = JSON.parse(await readFile(join(bookDir(dir, BOOK), 'quarantine.json'), 'utf8'));
      assert.equal(quarantine.txId, journal.txId);
      const { data } = await readBookData(dir, BOOK);
      data.audit.push({ at: '2026-11-25T00:00:02.000Z', action: 'should-not-write' });
      const { mutateBookData } = await import('../lib/store.js');
      await assert.rejects(() => mutateBookData(dir, BOOK, (current) => current.audit.push(data.audit.at(-1))), { code: 'book-quarantined' });
    });
  }
});

test('恢复连续失败两次后隔离；简报/stale 失败只保留 pending 并可单独重试', async (t) => {
  const { dir, ledgerBefore } = await fixture(t);
  await commit(dir);
  const tx = await onlyJournal(dir);
  const journal = JSON.parse(await readFile(tx.file, 'utf8'));
  journal.stage = 'body-replaced';
  await writeFile(bookFilePath(dir, BOOK), ledgerBefore);
  await writeFile(tx.file, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
  const injector = async (phase) => { if (phase === 'restore-body') throw new Error('restore-fault'); };
  await assert.rejects(() => withBookLock(dir, BOOK, () => recoverBookTransactionsUnlocked(dir, BOOK, { onPhase: injector })), { code: 'tx-recovery-failed' });
  await withBookLock(dir, BOOK, () => recoverBookTransactionsUnlocked(dir, BOOK, { onPhase: injector }));
  assert.ok(await readFile(join(bookDir(dir, BOOK), 'quarantine.json')));
});

test('stale 和简报失败只保留独立待办，重试时不触碰正文', async (t) => {
  const { dir, bodyBefore } = await fixture(t);
  let injectedStale = false;
  let injectedBrief = false;
  const result = await commit(dir, {
    staleChapters: [2],
    briefInput: { decisionId: 'd1', chapter: 1, plan: {}, tail: '原文末尾' },
    onPhase: async (phase) => {
      if (phase === 'stale-mark' && !injectedStale) { injectedStale = true; throw new Error('stale-fault'); }
      if (phase === 'brief-build' && !injectedBrief) { injectedBrief = true; throw new Error('brief-fault'); }
    },
  });
  const raw = JSON.parse(await readFile(bookFilePath(dir, BOOK), 'utf8'));
  const pending = raw.transactions.find((item) => item.id === result.txId);
  assert.equal(pending.staleStatus, 'pending');
  assert.equal(pending.briefStatus, 'pending');
  assert.deepEqual(await readFile(join(dir, BODY)), Buffer.from('after\n正文🙂', 'utf8'));

  const { data } = await readBookData(dir, BOOK);
  const done = data.transactions.find((item) => item.id === result.txId);
  assert.equal(done.staleStatus, 'complete');
  assert.equal(done.briefStatus, 'complete');
  assert.ok(done.briefText);
  assert.ok(data.chapters['2'].stale.txId === result.txId);
  assert.deepEqual(await readFile(join(dir, BODY)), Buffer.from('after\n正文🙂', 'utf8'));
  assert.notDeepEqual(await readFile(join(dir, BODY)), bodyBefore);
});
