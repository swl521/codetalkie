import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAlive, listSessions } from '../src/registry.js';

const ALIVE = process.pid;
const DEAD = 2147483646;

test('isAlive: 死 pid → false', () => {
  assert.equal(isAlive({ pid: DEAD }), false);
});

test('isAlive: 活 pid 且无 lastSeen → true', () => {
  assert.equal(isAlive({ pid: ALIVE }), true);
});

test('isAlive: 活 pid 但 lastSeen 过期 → false', () => {
  const old = new Date(Date.now() - 60_000).toISOString();
  assert.equal(isAlive({ pid: ALIVE, lastSeen: old }, Date.now(), 30_000), false);
});

test('listSessions: 过滤死会话 + 按 cap 筛', () => {
  const reg = { sessions: {
    a: { pid: ALIVE, caps: ['node'] },
    b: { pid: DEAD,  caps: ['node'] },
    c: { pid: ALIVE, caps: ['ios'] },
  }};
  const node = listSessions(reg, { cap: 'node' });
  assert.deepEqual(node.map((s) => s.name), ['a']);
  const all = listSessions(reg);
  assert.deepEqual(all.map((s) => s.name).sort(), ['a', 'c']);
});
