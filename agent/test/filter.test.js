import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../src/events.js';
import { shouldAnnounce } from '../src/filter.js';

test('底线在 1 级也播', () => {
  for (const t of [EVENT.APPROVAL_NEEDED, EVENT.TASK_FINISHED, EVENT.TASK_FAILED, EVENT.TASK_STUCK]) {
    assert.equal(shouldAnnounce({ type: t }, 1), true, t);
  }
});

test('坏消息穿透:失败的 tool.finished 在 1 级也播,成功的 4 级才播', () => {
  assert.equal(shouldAnnounce({ type: EVENT.TOOL_FINISHED, ok: false }, 1), true);
  assert.equal(shouldAnnounce({ type: EVENT.TOOL_FINISHED, ok: true }, 3), false);
  assert.equal(shouldAnnounce({ type: EVENT.TOOL_FINISHED, ok: true }, 4), true);
});

test('分层:session@2 progress@3 tool@4 heartbeat@5', () => {
  assert.equal(shouldAnnounce({ type: EVENT.SESSION_STARTED }, 1), false);
  assert.equal(shouldAnnounce({ type: EVENT.SESSION_STARTED }, 2), true);
  assert.equal(shouldAnnounce({ type: EVENT.PROGRESS_TEXT, text: 'x' }, 2), false);
  assert.equal(shouldAnnounce({ type: EVENT.PROGRESS_TEXT, text: 'x' }, 3), true);
  assert.equal(shouldAnnounce({ type: EVENT.TOOL_STARTED, tool: 'Bash' }, 3), false);
  assert.equal(shouldAnnounce({ type: EVENT.TOOL_STARTED, tool: 'Bash' }, 4), true);
  assert.equal(shouldAnnounce({ type: EVENT.HEARTBEAT }, 4), false);
  assert.equal(shouldAnnounce({ type: EVENT.HEARTBEAT }, 5), true);
});

test('approval.resolved 是内部输入,任何级别不播', () => {
  assert.equal(shouldAnnounce({ type: EVENT.APPROVAL_RESOLVED }, 5), false);
});
