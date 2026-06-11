import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../src/sessions.js';

test('按 项目+目录 记 sessionId,落盘后新实例能读回;clear 可清除', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'earpiece-')), 'sessions.json');
  const store = new SessionStore(file);
  assert.equal(store.get('wiki', '/a'), undefined);

  store.set('wiki', '/a', 'abc-123');
  assert.equal(store.get('wiki', '/a'), 'abc-123');
  // 同项目不同目录 = 不同会话(CLI 会话绑定 cwd)
  assert.equal(store.get('wiki', '/b'), undefined);

  const reloaded = new SessionStore(file);
  assert.equal(reloaded.get('wiki', '/a'), 'abc-123');
  assert.equal(JSON.parse(readFileSync(file, 'utf8'))['wiki@/a'], 'abc-123');

  reloaded.clear('wiki', '/a');
  assert.equal(reloaded.get('wiki', '/a'), undefined);
});

test('文件不存在/损坏时静默从空开始', () => {
  const dir = mkdtempSync(join(tmpdir(), 'earpiece-'));
  const store = new SessionStore(join(dir, 'no-such.json'));
  assert.equal(store.get('x', '/y'), undefined);
});
