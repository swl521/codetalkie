import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../src/events.js';
import { normalizeCodexMessage } from '../src/normalizeCodex.js';

test('thread.started → session.started 带 sessionId', () => {
  assert.deepEqual(normalizeCodexMessage({ type: 'thread.started', thread_id: 'th-1' }),
    [{ type: EVENT.SESSION_STARTED, sessionId: 'th-1' }]);
});

test('item.completed agent_message → progress.text', () => {
  assert.deepEqual(normalizeCodexMessage({
    type: 'item.completed',
    item: { id: 'i1', type: 'agent_message', text: '仓库里有三个目录。' },
  }), [{ type: EVENT.PROGRESS_TEXT, text: '仓库里有三个目录。' }]);
});

test('item.started 工具类 → tool.started(命令/MCP/搜索/改文件)', () => {
  assert.deepEqual(normalizeCodexMessage({
    type: 'item.started',
    item: { id: 'i2', type: 'command_execution', command: 'npm test', status: 'in_progress' },
  }), [{ type: EVENT.TOOL_STARTED, id: 'i2', tool: 'Bash' }]);
  assert.deepEqual(normalizeCodexMessage({
    type: 'item.started',
    item: { id: 'i3', type: 'file_change', changes: [], status: 'in_progress' },
  }), [{ type: EVENT.TOOL_STARTED, id: 'i3', tool: 'Edit' }]);
});

test('item.completed 工具类 → tool.finished,status=failed 算失败;item.updated 忽略', () => {
  assert.deepEqual(normalizeCodexMessage({
    type: 'item.completed',
    item: { id: 'i2', type: 'command_execution', command: 'npm test', exit_code: 1, status: 'failed' },
  }), [{ type: EVENT.TOOL_FINISHED, id: 'i2', tool: 'Bash', ok: false }]);
  // item.updated 不是终态,只认 item.completed
  assert.deepEqual(normalizeCodexMessage({
    type: 'item.updated',
    item: { id: 'i2', type: 'command_execution', status: 'in_progress' },
  }), []);
});

test('turn.completed → task.finished;turn.failed / error → task.failed', () => {
  assert.deepEqual(normalizeCodexMessage({ type: 'turn.completed', usage: {} }),
    [{ type: EVENT.TASK_FINISHED, text: '', tokens: undefined }]);
  assert.deepEqual(normalizeCodexMessage({ type: 'turn.failed', error: { message: 'boom' } }),
    [{ type: EVENT.TASK_FAILED, text: 'boom' }]);
  assert.deepEqual(normalizeCodexMessage({ type: 'error', message: 'fatal' }),
    [{ type: EVENT.TASK_FAILED, text: 'fatal' }]);
});

test('reasoning / todo_list / 未知类型 → 忽略', () => {
  assert.deepEqual(normalizeCodexMessage({
    type: 'item.completed', item: { id: 'r', type: 'reasoning', text: 'thinking...' },
  }), []);
  assert.deepEqual(normalizeCodexMessage({ type: 'whatever' }), []);
});

test('codex turn.completed 带 usage → task.finished.tokens', () => {
  const out = normalizeCodexMessage({ type: 'turn.completed', usage: { input_tokens: 50, output_tokens: 70 } });
  assert.equal(out[0].type, EVENT.TASK_FINISHED);
  assert.equal(out[0].tokens, 120);
});

test('codex turn.completed 无 usage → 无 tokens', () => {
  const out = normalizeCodexMessage({ type: 'turn.completed' });
  assert.equal(out[0].type, EVENT.TASK_FINISHED);
  assert.equal(out[0].tokens, undefined);
});
