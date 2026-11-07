import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bookDir,
  bookFilePath,
  readBookData,
  mutateBookData,
  readChapterText,
  getSessionMode,
  setSessionMode,
} from '../lib/store.js';

async function makeTemp(t) {
  const dir = await mkdtemp(join(tmpdir(), 'beat-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('readBookData returns null and mutate requires create', async (t) => {
  const dir = await makeTemp(t);
  const empty = await readBookData(dir, '书');
  assert.deepEqual(empty, { data: null, migrated: false, warnings: [] });
  await assert.rejects(
    () => mutateBookData(dir, '书', () => {}),
    (error) => error.code === 'no-book',
  );
});

test('mutateBookData creates, updates updatedAt, and reads back', async (t) => {
  const dir = await makeTemp(t);
  const created = await mutateBookData(
    dir,
    '书',
    (data) => {
      data.meta.title = '测试书';
      return 'created';
    },
    { create: true, meta: { title: '书' } },
  );
  assert.equal(created.created, true);
  assert.equal(created.result, 'created');
  assert.equal(created.data.meta.title, '测试书');

  const read = await readBookData(dir, '书');
  assert.equal(read.data.meta.title, '测试书');
  assert.equal(read.data.schemaVersion, 1);
  assert.ok(read.data.updatedAt);
});

test('writes atomically and keeps a backup', async (t) => {
  const dir = await makeTemp(t);
  await mutateBookData(dir, '书', () => {}, { create: true });
  await mutateBookData(dir, '书', (data) => {
    data.meta.title = '第二版';
  });

  const names = await readdir(bookDir(dir, '书'));
  assert.ok(!names.some((name) => name.includes('.tmp-')));
  await access(`${bookFilePath(dir, '书')}.bak`);
  const backup = JSON.parse(await readFile(`${bookFilePath(dir, '书')}.bak`, 'utf8'));
  assert.equal(backup.meta.title, '书');
});

test('per-book lock serializes concurrent mutations', async (t) => {
  const dir = await makeTemp(t);
  await mutateBookData(dir, '书', (data) => {
    data.meta.count = 0;
  }, { create: true });

  await Promise.all(
    Array.from({ length: 10 }, () =>
      mutateBookData(dir, '书', async (data) => {
        const value = data.meta.count;
        await new Promise((resolve) => setTimeout(resolve, 2));
        data.meta.count = value + 1;
      }),
    ),
  );

  const { data } = await readBookData(dir, '书');
  assert.equal(data.meta.count, 10);
});

test('rejects path traversal in book names', async (t) => {
  const dir = await makeTemp(t);
  for (const book of ['..', 'a/b', 'C:\\x']) {
    await assert.rejects(() => readBookData(dir, book), (error) => error.code === 'bad-book');
  }
});

test('reports corrupt book.json without overwriting it', async (t) => {
  const dir = await makeTemp(t);
  const directory = bookDir(dir, '书');
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'book.json');
  await writeFile(file, '{bad', 'utf8');

  await assert.rejects(() => readBookData(dir, '书'), (error) => error.code === 'book-corrupt');
  assert.equal(await readFile(file, 'utf8'), '{bad');
});

test('rejects an invalid book.json schema', async (t) => {
  const dir = await makeTemp(t);
  const directory = bookDir(dir, '书');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'book.json'), JSON.stringify({ schemaVersion: 999 }), 'utf8');
  await assert.rejects(() => readBookData(dir, '书'), (error) => error.code === 'book-invalid');
});

test('migrates 0.5 chNNN.json and backs up', async (t) => {
  const dir = await makeTemp(t);
  const directory = bookDir(dir, '书');
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, 'ch001.json'),
    JSON.stringify({
      book: '书',
      chapter: 1,
      beats: [
        {
          title: '玉佩',
          change: '玉佩到手',
          status: 'decided',
          choice: '拍下',
          options: [{ label: '拍下', impact: 'x' }],
        },
      ],
    }),
    'utf8',
  );

  const migrated = await readBookData(dir, '书');
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.data.decisions.length, 1);
  assert.equal(migrated.data.decisions[0].id, 'b1-1');
  assert.equal(migrated.data.decisions[0].legacy, true);
  assert.match(migrated.warnings[0], /迁移/);
  await access(join(directory, 'legacy', 'ch001.json'));
  await access(join(directory, 'legacy', 'MIGRATION.md'));
  await access(bookFilePath(dir, '书'));
});

test('migration skips corrupt legacy files', async (t) => {
  const dir = await makeTemp(t);
  const directory = bookDir(dir, '书');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'ch001.json'), '{bad', 'utf8');
  await writeFile(
    join(directory, 'ch002.json'),
    JSON.stringify({
      book: '书',
      chapter: 2,
      beats: [{ title: '旧', change: '旧事', status: 'decided', choice: '选A' }],
    }),
    'utf8',
  );

  const migrated = await readBookData(dir, '书');
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.data.decisions[0].id, 'b2-1');
  assert.ok(migrated.warnings.some((warning) => warning === 'legacy-corrupt:ch001.json'));
});

test('session mode defaults to off and persists', async (t) => {
  const dir = await makeTemp(t);
  assert.equal((await getSessionMode(dir, 's1')).mode, 'off');
  await setSessionMode(dir, 's1', 'on');
  assert.equal((await getSessionMode(dir, 's1')).mode, 'on');
  await setSessionMode(dir, 's1', 'off');
  assert.equal((await getSessionMode(dir, 's1')).mode, 'off');
  await assert.rejects(() => setSessionMode(dir, 's1', 'bad'), (error) => error.code === 'bad-mode');
});

test('corrupt session file falls back to off', async (t) => {
  const dir = await makeTemp(t);
  await mkdir(join(dir, '.dsh-novel-beat'), { recursive: true });
  await writeFile(join(dir, '.dsh-novel-beat', '_sessions.json'), '{bad', 'utf8');
  const result = await getSessionMode(dir, 's1');
  assert.equal(result.mode, 'off');
  assert.equal(result.warning, 'sessions-corrupt');
});

test('readChapterText only reads workspace md/txt', async (t) => {
  const dir = await makeTemp(t);
  await writeFile(join(dir, 'ch1.md'), '正文', 'utf8');
  const read = await readChapterText(dir, 'ch1.md');
  assert.equal(read.text, '正文');

  await writeFile(join(dir, 'ch1.pdf'), 'x', 'utf8');
  await assert.rejects(() => readChapterText(dir, 'ch1.pdf'), (error) => error.code === 'unreadable');
  await assert.rejects(() => readChapterText(dir, 'missing.md'), (error) => error.code === 'unreadable');

  const outside = await makeTemp(t);
  await writeFile(join(outside, 'x.md'), 'x', 'utf8');
  await assert.rejects(
    () => readChapterText(dir, join(outside, 'x.md')),
    (error) => error.code === 'path-outside',
  );
});
