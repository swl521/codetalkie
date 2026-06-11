import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT, isBaseline, isBadNews } from '../src/events.js';

test('底线 = approval.needed / task.finished / task.failed / task.stuck', () => {
  for (const t of [EVENT.APPROVAL_NEEDED, EVENT.TASK_FINISHED, EVENT.TASK_FAILED, EVENT.TASK_STUCK]) {
    assert.equal(isBaseline({ type: t }), true, t);
  }
  for (const t of [EVENT.SESSION_STARTED, EVENT.PROGRESS_TEXT, EVENT.TOOL_STARTED, EVENT.TOOL_FINISHED, EVENT.HEARTBEAT]) {
    assert.equal(isBaseline({ type: t }), false, t);
  }
});

test('坏消息 = 失败类:task.failed / task.stuck / 失败的 tool.finished', () => {
  assert.equal(isBadNews({ type: EVENT.TASK_FAILED }), true);
  assert.equal(isBadNews({ type: EVENT.TASK_STUCK }), true);
  assert.equal(isBadNews({ type: EVENT.TOOL_FINISHED, ok: false }), true);
  assert.equal(isBadNews({ type: EVENT.TOOL_FINISHED, ok: true }), false);
  assert.equal(isBadNews({ type: EVENT.PROGRESS_TEXT }), false);
});
