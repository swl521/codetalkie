import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseCoworkSession, scanCowork } from '../src/scanProjects.js';

test('parseCoworkSession: 有 title → 出 cowork entry(name=title, preview=initialMessage)', () => {
  const e = parseCoworkSession({
    title: 'Schedule a recurring task', cwd: '/some/dir', sessionId: 'local_abc',
    lastActivityAt: 1700000000000, initialMessage: '帮我每天提醒',
  }, '/path/local_abc.json');
  assert.equal(e.name, 'Schedule a recurring task');
  assert.equal(e.agent, 'cowork');
  assert.equal(e.preview, '帮我每天提醒');
  assert.equal(e.sessionId, 'local_abc');
  assert.equal(e.lastActive, 1700000000000);
});

test('parseCoworkSession: 无 title → null', () => {
  assert.equal(parseCoworkSession({ cwd: '/x' }, '/p.json'), null);
});

test('scanCowork: 跳过 agent/ 子目录的重复 ditto,同会话只出一条', () => {
  const root = mkdtempSync(join(tmpdir(), 'cowork-'));
  const b = join(root, 'a1', 'b1');
  mkdirSync(join(b, 'agent'), { recursive: true });
  const meta = { title: '测试会话', cwd: root, sessionId: 'local_s1', lastActivityAt: 111, initialMessage: '开场白' };
  writeFileSync(join(b, 'local_s1.json'), JSON.stringify(meta));
  // agent/ 下的重复元数据(ditto)——必须被跳过
  writeFileSync(join(b, 'agent', 'local_ditto_x.json'), JSON.stringify(meta));
  const out = scanCowork(root);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, '测试会话');
  assert.equal(out[0].agent, 'cowork');
});

test('scanCowork: 目录不存在 → 空数组,不抛', () => {
  assert.deepEqual(scanCowork('/no/such/cowork/dir'), []);
});
