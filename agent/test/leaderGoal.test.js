import { test } from 'node:test';
import assert from 'node:assert/strict';
import { routeLeaderGoal, LEADER_NAME } from '../src/leaderGoal.js';

function deps(over = {}) {
  const calls = { hubSend: [], codexPost: [], notify: [] };
  return [{
    hubSend: async (n, c) => calls.hubSend.push([n, c]),
    codexPost: async (c) => calls.codexPost.push(c),
    notify: async (m) => calls.notify.push(m),
    hubAlive: () => true,
    ...over,
  }, calls];
}

test('LEADER_NAME 是「🧠主脑」(无空格,resolveSpoken 单词匹配)', () => { assert.equal(LEADER_NAME, '🧠主脑'); });

test('engine=codex → 调 codexPost,带编排提示', async () => {
  const [d, calls] = deps();
  const r = await routeLeaderGoal('测一遍', { engine: 'codex', leader: 'codex-x' }, d);
  assert.equal(r.ok, true);
  assert.equal(calls.codexPost.length, 1);
  assert.match(calls.codexPost[0], /测一遍/);
  assert.match(calls.codexPost[0], /ORCHESTRATOR\.md/);
});

test('engine=claude 且会话在线 → 调 hubSend', async () => {
  const [d, calls] = deps();
  const r = await routeLeaderGoal('测一遍', { engine: 'claude', leader: 'mac-main' }, d);
  assert.equal(r.ok, true);
  assert.deepEqual(calls.hubSend[0][0], 'mac-main');
  assert.match(calls.hubSend[0][1], /测一遍/);
});

test('engine=claude 但会话离线 → notify 提示,不发', async () => {
  const [d, calls] = deps({ hubAlive: () => false });
  const r = await routeLeaderGoal('测一遍', { engine: 'claude', leader: 'mac-main' }, d);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'leader-offline');
  assert.equal(calls.hubSend.length, 0);
  assert.equal(calls.notify.length, 1);
});

test('没设主脑 → notify 提示', async () => {
  const [d, calls] = deps();
  const r = await routeLeaderGoal('测一遍', null, d);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-leader');
  assert.equal(calls.notify.length, 1);
});
