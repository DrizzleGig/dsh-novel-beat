import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyBook } from '../lib/schema.js';
import { bookDir, bookFilePath, computeRevision, mutateBookData, readBookData } from '../lib/store.js';
import {
  executeAdjust,
  executeDecide,
  executeFork,
  executeNext,
  executePlan,
  executeRevert,
  executeSegment,
  executeVerify,
} from '../lib/tools.js';

const BOOK = '书';
const FILE = '正文/第1章.md';
const AGENT = { id: 'revision-test' };

async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), 'novel-beat-revision-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '正文'), { recursive: true });
  return dir;
}

function beat() {
  return {
    title: '要不要救',
    kind: '分叉',
    change: '救不救会改变走向',
    options: [
      {
        label: '选 A',
        impact: 'A 的后果',
        changes: [{ entity: '林昭', key: '救人与否', from: '旁观', to: '出手', evidence: ['他推开门', '冲进去'] }],
      },
      {
        label: '选 B',
        impact: 'B 的后果',
        changes: [{ entity: '林昭', key: '救人与否', from: '旁观', to: '迟疑', evidence: ['他停下'] }],
      },
    ],
  };
}

function askAnswer(choice = '选 A') {
  return async ({ questions }) => ({
    answers: questions.map((question) => ({ id: question.id, selected: [choice] })),
  });
}

async function setupPlanned(t) {
  const dir = await workspace(t);
  await writeFile(join(dir, FILE), '开场白。\n', 'utf8');
  const planned = await executePlan({ dir, book: BOOK, chapter: 1, beats: [beat()] });
  assert.equal(planned.revision, 1);
  return dir;
}

async function setupCommitted(t) {
  const dir = await setupPlanned(t);
  await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askAnswer() });
  return dir;
}

async function currentRevision(dir) {
  return (await readBookData(dir, BOOK)).data.revision;
}

test('computeRevision uses book.revision or the legacy array lengths', () => {
  assert.equal(computeRevision({ revision: 8, revisions: [], audit: [] }), 8);
  assert.equal(computeRevision({ revisions: [{}, {}], audit: [{}, {}, {}] }), 5);
  assert.equal(emptyBook({ book: BOOK }).revision, 0);
});

test('mutateBookData increments once; a rejected mutation leaves disk unchanged', async (t) => {
  const dir = await workspace(t);
  const created = await mutateBookData(dir, BOOK, () => 'created', { create: true });
  assert.equal(created.revision, 1);
  await assert.rejects(() => mutateBookData(dir, BOOK, (data) => {
    data.meta.title = 'not committed';
    throw new Error('abort');
  }), /abort/);
  assert.equal(await currentRevision(dir), 1);
  assert.equal(JSON.parse(await readFile(bookFilePath(dir, BOOK), 'utf8')).meta.title, BOOK);
});

test('legacy array counts remain readable and the next write persists the next revision', async (t) => {
  const dir = await workspace(t);
  const directory = bookDir(dir, BOOK);
  await mkdir(directory, { recursive: true });
  const data = emptyBook({ book: BOOK });
  delete data.revision;
  data.revisions = [
    { id: 'r-0001', kind: 'adjust' },
    { id: 'r-0002', kind: 'adjust' },
  ];
  data.audit = [{ action: 'one' }, { action: 'two' }, { action: 'three' }];
  await writeFile(bookFilePath(dir, BOOK), JSON.stringify(data), 'utf8');

  const first = await readBookData(dir, BOOK);
  const second = await readBookData(dir, BOOK);
  assert.equal(computeRevision(first.data), 5);
  assert.equal(computeRevision(second.data), 5);
  assert.equal(Object.hasOwn(JSON.parse(await readFile(bookFilePath(dir, BOOK), 'utf8')), 'revision'), false);

  const written = await mutateBookData(dir, BOOK, (book) => { book.meta.genre = '悬疑'; });
  assert.equal(written.revision, 6);
  assert.equal(JSON.parse(await readFile(bookFilePath(dir, BOOK), 'utf8')).revision, 6);
});

test('legacy first write counts the pre-mutation baseline, not the entries it adds', async (t) => {
  const dir = await workspace(t);
  const directory = bookDir(dir, BOOK);
  await mkdir(directory, { recursive: true });
  const data = emptyBook({ book: BOOK });
  delete data.revision;
  data.revisions = [{ id: 'r-0001', kind: 'adjust' }, { id: 'r-0002', kind: 'adjust' }];
  data.audit = [{ action: 'one' }, { action: 'two' }, { action: 'three' }];
  await writeFile(bookFilePath(dir, BOOK), JSON.stringify(data), 'utf8');

  const written = await mutateBookData(dir, BOOK, (book) => {
    book.revisions.push({ id: 'r-0003', kind: 'adjust' });
    book.audit.push({ action: 'four' });
  });

  assert.equal(written.revision, 6, '基线 5 在 mutator 之前算，写后恰好 6');
  assert.equal(JSON.parse(await readFile(bookFilePath(dir, BOOK), 'utf8')).revision, 6);
});

test('0.6→0.7 迁移写盘时初始化 revision（不 +1、不跳号）', async (t) => {
  const dir = await workspace(t);
  const directory = bookDir(dir, BOOK);
  await mkdir(directory, { recursive: true });
  const v1 = {
    schemaVersion: 1,
    book: BOOK,
    meta: { title: BOOK, genre: '', logline: '' },
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    chapters: { 1: { status: 'pending', decisionIds: ['b1-1'], verifiedAt: null } },
    decisions: [{
      id: 'b1-1', chapter: 1, title: '拍下玉佩', kind: '得失', change: '玉佩到手',
      status: 'decided',
      options: [{ label: '拍下', impact: '花钱' }, { label: '放弃', impact: '省钱' }],
      chosen: { label: '拍下', impact: '花钱', changes: [], obligations: [], forbidden: [] },
      createdAt: '2026-11-01T00:00:00.000Z', decidedAt: '2026-11-02T00:00:00.000Z',
      supersededBy: null, legacy: false,
    }],
    canon: [], obligations: [], audit: [],
  };
  await writeFile(bookFilePath(dir, BOOK), JSON.stringify(v1), 'utf8');

  const { data } = await readBookData(dir, BOOK);
  assert.equal(data.schemaVersion, 2);
  assert.equal(typeof data.revision, 'number', '迁移后必须落一个整数 revision');
  assert.equal(data.revision, computeRevision(data), '迁移只初始化，不 +1');
  const onDisk = JSON.parse(await readFile(bookFilePath(dir, BOOK), 'utf8'));
  assert.equal(onDisk.revision, data.revision);
});

test('beat_plan, beat_next, and beat_decide each return the committed book revision', async (t) => {
  const nextDir = await setupPlanned(t);
  const beforeNext = await currentRevision(nextDir);
  const next = await executeNext({ dir: nextDir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askAnswer() });
  assert.equal(next.revision, beforeNext + 1);
  assert.equal(await currentRevision(nextDir), next.revision);

  const decideDir = await setupPlanned(t);
  const beforeDecide = await currentRevision(decideDir);
  const decide = await executeDecide({
    dir: decideDir, book: BOOK, chapter: 1, id: 'b1-1', choice: '选 A',
  }, { agent: AGENT });
  assert.equal(decide.revision, beforeDecide + 1);
  assert.equal(await currentRevision(decideDir), decide.revision);
});

test('beat_segment and beat_revert each advance the book revision exactly once', async (t) => {
  const dir = await setupCommitted(t);
  const body = '开场白。\n他推开门，冲进去。\n';
  await writeFile(join(dir, FILE), body, 'utf8');
  const beforeSegment = await currentRevision(dir);
  const segment = await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'], excerpt: '他推开门，冲进去。\n',
  });
  assert.equal(segment.revision, beforeSegment + 1);
  assert.equal(typeof segment.revisionRecord.id, 'string');
  assert.equal(await currentRevision(dir), segment.revision);

  const beforeRevert = await currentRevision(dir);
  const reverted = await executeRevert({ dir, book: BOOK, chapter: 1, segment: segment.segment.id });
  assert.equal(reverted.revision, beforeRevert + 1);
  assert.equal(await currentRevision(dir), reverted.revision);
});

test('beat_adjust advances once and repeated beat_verify does not advance', async (t) => {
  const dir = await setupCommitted(t);
  const beforeAdjust = await currentRevision(dir);
  const adjusted = await executeAdjust({
    dir, book: BOOK, action: 'supersede', id: 'b1-1', reason: '作者改了主意',
  });
  assert.equal(adjusted.revision, beforeAdjust + 1);

  const verifyDir = await setupCommitted(t);
  const text = '他推开门，冲进去。';
  const beforeVerify = await currentRevision(verifyDir);
  const verified = await executeVerify({
    dir: verifyDir, book: BOOK, chapter: 1, text, strict: false,
  });
  assert.equal(verified.revision, beforeVerify + 1);
  const repeated = await executeVerify({
    dir: verifyDir, book: BOOK, chapter: 1, text, strict: false,
  });
  assert.equal(repeated.revision, verified.revision);
  assert.equal(await currentRevision(verifyDir), verified.revision);
});

test('beat_next read-only completion and duplicate beat_fork do not advance revision', async (t) => {
  const dir = await setupCommitted(t);
  const body = '开场白。\n他推开门，冲进去。\n';
  await writeFile(join(dir, FILE), body, 'utf8');
  await executeSegment({
    dir, book: BOOK, chapter: 1, file: FILE, decisionIds: ['b1-1'], excerpt: '他推开门，冲进去。\n',
  });
  const beforeNext = await currentRevision(dir);
  const finished = await executeNext({ dir, book: BOOK, chapter: 1 }, { agent: AGENT }, { ask: askAnswer() });
  assert.equal(finished.revision, beforeNext);
  assert.equal(await currentRevision(dir), beforeNext);

  const forkDir = await workspace(t);
  const first = await executeFork({ dir: forkDir, book: BOOK, chapter: 1, text: '是否救人' });
  const duplicate = await executeFork({ dir: forkDir, book: BOOK, chapter: 1, text: '是否救人' });
  assert.equal(first.revision, 1);
  assert.equal(duplicate.revision, first.revision);
  assert.equal(await currentRevision(forkDir), first.revision);
});
