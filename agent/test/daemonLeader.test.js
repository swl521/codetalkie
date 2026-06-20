import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDaemon } from '../src/daemon.js';
import { LEADER_NAME } from '../src/leaderGoal.js';

function mk(over = {}) {
  const calls = { notify: [], hubSend: [], codexPost: [] };
  const d = createDaemon({
    token: 'tk',
    notify: (m) => calls.notify.push(m),
    leaderRead: () => ({ engine: 'codex', leader: 'codex-x' }),
    hubSend: async (n, c) => calls.hubSend.push([n, c]),
    codexPost: async (c) => calls.codexPost.push(c),
    hubAlive: () => true,
    ...over,
  });
  return { d, calls };
}
function reqres(method, url) {
  const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b || ''; } };
  return [{ method, url, headers: { authorization: 'Bearer tk' } }, res];
}

test('POST /announce → 调 notify,202', () => {
  const { d, calls } = mk();
  const [req, res] = reqres('POST', '/announce');
  d.handle(req, res, JSON.stringify({ text: '第2步完成', level: 3 }));
  assert.equal(res.code, 202);
  assert.equal(calls.notify.at(-1).text, '第2步完成');
});

test('routeIfLeader: 主脑项 → routeLeaderGoal(codex 转守护)', async () => {
  const { d, calls } = mk();
  const handled = await d.routeIfLeader({ project: LEADER_NAME, prompt: '全测一遍' });
  assert.equal(handled, true);
  assert.equal(calls.codexPost.length, 1);
});

test('routeIfLeader: 普通项目不拦', async () => {
  const { d } = mk();
  assert.equal(await d.routeIfLeader({ project: '耳机', prompt: 'x' }), false);
});

test('routeIfLeader: 依赖抛错也不崩(吞错)', async () => {
  const { d } = mk({ codexPost: async () => { throw new Error('boom'); } });
  const handled = await d.routeIfLeader({ project: LEADER_NAME, prompt: 'x' });
  assert.equal(handled, true); // 仍返回 true,不抛
});
