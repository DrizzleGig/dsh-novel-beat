// 0.7.0 执行层：guard 判定纯函数（不碰磁盘、不需要宿主）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WRITE_TOOL_NAMES,
  DEFAULT_BODY_ROOTS,
  DENY,
  targetPaths,
  isProtectedPath,
  chapterFromPath,
  evaluateWrite,
} from '../lib/enforce.js';

const CWD = 'D:\\工作区\\书';

test('写盘工具名单就是 write/edit/apply_patch/str_replace_editor', () => {
  assert.deepEqual(WRITE_TOOL_NAMES, ['write', 'edit', 'apply_patch', 'str_replace_editor']);
  assert.deepEqual(DEFAULT_BODY_ROOTS, ['正文']);
});

test('targetPaths：write/edit 取 file_path，str_replace_editor 取 path', () => {
  assert.deepEqual(targetPaths('write', { file_path: '正文/第001章.md', content: 'x' }), ['正文/第001章.md']);
  assert.deepEqual(targetPaths('edit', { file_path: 'a.md' }), ['a.md']);
  assert.deepEqual(targetPaths('str_replace_editor', { path: '正文/第002章.md' }), ['正文/第002章.md']);
  assert.deepEqual(targetPaths('write', {}), []);
  assert.deepEqual(targetPaths('bash', { command: 'echo hi > 正文/x.md' }), []);
});

test('targetPaths：apply_patch 解析补丁头，多文件都取到', () => {
  const patch = [
    '*** Begin Patch',
    '*** Update File: 正文/第001章.md',
    '@@ -1,2 +1,2 @@',
    '-旧',
    '+新',
    '*** Add File: 正文/第002章.md',
    '+新建',
    '*** Delete File: 草稿/废稿.md',
    '*** End Patch',
  ].join('\n');
  assert.deepEqual(targetPaths('apply_patch', { patch }), [
    '正文/第001章.md',
    '正文/第002章.md',
    '草稿/废稿.md',
  ]);
});

test('isProtectedPath：正文/ 及其子路径受保护，正文兄弟目录与根文件不受保护', () => {
  assert.equal(isProtectedPath(`${CWD}\\正文\\第001章.md`, CWD), true);
  assert.equal(isProtectedPath(`${CWD}\\正文\\第1部\\第001章.md`, CWD), true);
  assert.equal(isProtectedPath(`${CWD}\\正文`, CWD), true);
  assert.equal(isProtectedPath(`${CWD}\\设定\\人物.md`, CWD), false);
  assert.equal(isProtectedPath(`${CWD}\\README.md`, CWD), false);
  assert.equal(isProtectedPath('D:\\别处\\正文\\a.md', CWD), false);
  assert.equal(isProtectedPath(`${CWD}\\正文稿\\a.md`, CWD), false, '前缀相同但不是同一目录');
});

test('isProtectedPath：bodyRoots 可换可加，斜杠方向与大小写都吃', () => {
  assert.equal(isProtectedPath(`${CWD}\\稿件\\a.md`, CWD, ['稿件']), true);
  assert.equal(isProtectedPath(`${CWD}\\正文\\a.md`, CWD, ['稿件']), false);
  assert.equal(isProtectedPath(`${CWD}/正文/a.md`, CWD), true, '正斜杠写法');
  assert.equal(isProtectedPath(`d:\\工作区\\书\\正文\\a.md`, CWD), true, '盘符大小写');
  assert.equal(isProtectedPath(`${CWD}\\正文\\a.md`, CWD, []), false, '空名单 = 只保护已登记段落（M4）');
});

test('evaluateWrite：模式关、非写盘工具、非正文路径 → 一律放行', () => {
  const args = { file_path: `${CWD}\\正文\\第001章.md` };
  assert.equal(evaluateWrite({ toolName: 'write', args, cwd: CWD, state: { on: false } }).blocked, false);
  assert.equal(evaluateWrite({ toolName: 'read', args, cwd: CWD, state: { on: true } }).blocked, false);
  assert.equal(
    evaluateWrite({ toolName: 'write', args: { file_path: `${CWD}\\设定\\人物.md` }, cwd: CWD, state: { on: true, chapter: 1, open: 3 } }).blocked,
    false,
  );
});

test('evaluateWrite：事务隔离时正文写入被阻止，即使拍板模式已关闭', () => {
  const verdict = evaluateWrite({
    toolName: 'write',
    args: { file_path: `${CWD}\\正文\\第001章.md` },
    cwd: CWD,
    state: { on: false, quarantined: true },
  });
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.detail.code, DENY.BOOK_QUARANTINED);
});

test('evaluateWrite：一章还没登记任何决策 → 放行（正在写开场）', () => {
  const verdict = evaluateWrite({
    toolName: 'write',
    args: { file_path: `${CWD}\\正文\\第001章.md` },
    cwd: CWD,
    state: { on: true, chapter: null, open: 0 },
  });
  assert.equal(verdict.blocked, false);
});

test('chapterFromPath：认得出"第N章"，认不出就返回 null', () => {
  assert.equal(chapterFromPath('D:\\书\\正文\\第8章_雷霆.md'), 8);
  assert.equal(chapterFromPath('正文/第 008 章.md'), 8);
  assert.equal(chapterFromPath('D:\\书\\正文\\第八部\\第12章.md'), 12);
  assert.equal(chapterFromPath('D:\\书\\正文\\第八章.md'), null, '汉字章号是已知边界');
  assert.equal(chapterFromPath('D:\\书\\正文\\番外.md'), null);
  assert.equal(chapterFromPath(''), null);
});

test('evaluateWrite：按文件名章号判——第 8 章有岔路没问 → PENDING_DECISIONS（不再是 NO_TASK）', () => {
  const verdict = evaluateWrite({
    toolName: 'write',
    args: { file_path: '正文/第8章_雷霆之力.md' },
    cwd: CWD,
    // 账本进度停在第 7 章（全部拍完），第 8 章刚登记了两条岔路、还没问
    state: {
      on: true,
      chapter: 7,
      open: 0,
      chapters: { 1: { total: 3, open: 0 }, 7: { total: 2, open: 0 }, 8: { total: 2, open: 2, awaitingSegment: 0 } },
    },
  });
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.detail.code, DENY.PENDING_DECISIONS);
  assert.equal(verdict.detail.chapter, 8);
  assert.match(verdict.reason, /第 8 章还有 2 个岔路没问/);
});

test('evaluateWrite：第 8 章刚拍完板、正在写那一段 → 放行（等登记）', () => {
  const verdict = evaluateWrite({
    toolName: 'write',
    args: { file_path: '正文/第8章_雷霆之力.md' },
    cwd: CWD,
    state: {
      on: true,
      chapter: 8,
      open: 1,
      chapters: { 8: { total: 2, open: 1, awaitingSegment: 1 } },
    },
  });
  assert.equal(verdict.blocked, false, '这一段的答案刚拿到，写它是合法的');
});

test('evaluateWrite：按文件名章号判——第 7 章全拍完，写第 7 章放行', () => {
  const verdict = evaluateWrite({
    toolName: 'edit',
    args: { file_path: '正文/第7章_第一魂环.md' },
    cwd: CWD,
    state: { on: true, chapter: 7, open: 0, chapters: { 7: { total: 2, open: 0 } } },
  });
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.reason, 'ok');
});

test('evaluateWrite：刚登记完一段 → CONTINUATION_CHECK，检查完才放行', () => {
  const args = { file_path: '正文/第8章_雷霆之力.md' };
  const blocked = evaluateWrite({
    toolName: 'write',
    args,
    cwd: CWD,
    state: {
      on: true,
      chapter: 8,
      open: 0,
      chapters: { 8: { total: 2, open: 0, awaitingSegment: 0, needsCheck: true } },
    },
  });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.detail.code, DENY.CONTINUATION_CHECK);
  assert.match(blocked.reason, /续写检查/);

  const cleared = evaluateWrite({
    toolName: 'write',
    args,
    cwd: CWD,
    state: {
      on: true,
      chapter: 8,
      open: 0,
      chapters: { 8: { total: 2, open: 0, awaitingSegment: 0, needsCheck: false } },
    },
  });
  assert.equal(cleared.blocked, false, '检查完成后可以接着写下一段');
});

test('evaluateWrite：作者选了会改设定的选项、还没确认 → PENDING_DECISIONS（别往下写）', () => {
  const blocked = evaluateWrite({
    toolName: 'write',
    args: { file_path: '正文/第8章_雷霆之力.md' },
    cwd: CWD,
    state: {
      on: true,
      chapter: 8,
      open: 0,
      chapters: { 8: { total: 2, open: 0, awaitingSegment: 0, needsCheck: false, pendingConfirm: 1 } },
    },
  });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.detail.code, DENY.PENDING_DECISIONS);
  assert.match(blocked.reason, /待确认/);
});

test('evaluateWrite：文件名认不出章号时退回账本进度（已知边界）', () => {
  const blocked = evaluateWrite({
    toolName: 'write',
    args: { file_path: '正文/番外_独孤博.md' },
    cwd: CWD,
    state: { on: true, chapter: 7, open: 1, chapters: { 7: { total: 2, open: 1 } } },
  });
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.detail.code, DENY.PENDING_DECISIONS);

  const noProgress = evaluateWrite({
    toolName: 'write',
    args: { file_path: '正文/番外_独孤博.md' },
    cwd: CWD,
    state: { on: true, chapter: null, open: 0, chapters: {} },
  });
  assert.equal(noProgress.blocked, false, '账本里没有待问的岔路就不拦');
});

test('evaluateWrite：正文路径 + 还有未问的岔路 → PENDING_DECISIONS', () => {
  const verdict = evaluateWrite({
    toolName: 'edit',
    args: { file_path: `${CWD}\\正文\\第003章.md` },
    cwd: CWD,
    state: { on: true, chapter: 3, open: 2, chapters: { 3: { total: 2, open: 2 } } },
  });
  assert.equal(verdict.blocked, true);
  assert.equal(verdict.detail.code, DENY.PENDING_DECISIONS);
  assert.equal(verdict.detail.chapter, 3);
  assert.match(verdict.reason, /还有 2 个岔路没问/);
});

test('evaluateWrite：全部问完 → 放行', () => {
  const verdict = evaluateWrite({
    toolName: 'write',
    args: { file_path: `${CWD}\\正文\\第003章.md` },
    cwd: CWD,
    state: { on: true, chapter: 3, open: 0, chapters: { 3: { total: 2, open: 0 } } },
  });
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.reason, 'ok');
});

test('evaluateWrite：apply_patch 里只要有一处写正文就拦', () => {
  const patch = '*** Update File: 设定/人物.md\n*** Add File: 正文/第004章.md\n';
  const verdict = evaluateWrite({
    toolName: 'apply_patch',
    args: { patch },
    cwd: CWD,
    state: { on: true, chapter: 4, open: 1, chapters: { 4: { total: 1, open: 1 } } },
  });
  assert.equal(verdict.blocked, true);
  assert.deepEqual(verdict.detail.paths, ['正文/第004章.md']);
});
