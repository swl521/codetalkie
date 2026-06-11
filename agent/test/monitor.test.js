import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../src/events.js';
import { SilenceMonitor } from '../src/monitor.js';

test('90s 无事件 → task.stuck,只发一次,出事件后可再触发', () => {
  // 心跳禁用,单测 stuck 行为
  const m = new SilenceMonitor({ now: 0, heartbeatMs: Infinity });
  assert.deepEqual(m.tick(89_000), []);
  const fired = m.tick(90_000);
  assert.equal(fired[0].type, EVENT.TASK_STUCK);
  assert.deepEqual(m.tick(120_000), []); // 不重复
  m.noteEvent(121_000);                   // 恢复
  assert.equal(m.tick(211_000)[0].type, EVENT.TASK_STUCK); // 再卡再发
});

test('60s 没播过 → heartbeat;播过就重新计时', () => {
  const m = new SilenceMonitor({ now: 0 });
  m.noteEvent(50_000); // 有事件,不算 stuck
  const out = m.tick(60_000);
  assert.equal(out[0].type, EVENT.HEARTBEAT);
  m.noteSpoken(61_000);
  assert.deepEqual(m.tick(120_000), []); // 61+60=121 才到
  assert.equal(m.tick(121_000)[0].type, EVENT.HEARTBEAT);
});

test('stuck 优先:同 tick 不重复发心跳', () => {
  const m = new SilenceMonitor({ now: 0 });
  const out = m.tick(90_000);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, EVENT.TASK_STUCK);
});
