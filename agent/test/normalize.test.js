import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../src/events.js';
import { normalizeClaudeMessage } from '../src/normalize.js';

test('system/init → session.started,带 sessionId(resume 用)', () => {
  assert.deepEqual(normalizeClaudeMessage({ type: 'system', subtype: 'init', session_id: 'abc-123' }),
    [{ type: EVENT.SESSION_STARTED, sessionId: 'abc-123' }]);
  assert.deepEqual(normalizeClaudeMessage({ type: 'system', subtype: 'init' }),
    [{ type: EVENT.SESSION_STARTED, sessionId: undefined }]);
});

test('assistant 文字 + tool_use → progress.text + tool.started', () => {
  const out = normalizeClaudeMessage({
    type: 'assistant',
    message: { content: [
      { type: 'text', text: ' 我先看下测试文件。 ' },
      { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'npm test' } },
    ] },
  });
  assert.deepEqual(out, [
    { type: EVENT.PROGRESS_TEXT, text: '我先看下测试文件。' },
    { type: EVENT.TOOL_STARTED, id: 'tu_1', tool: 'Bash' },
  ]);
});

test('user 里的 tool_result → tool.finished(失败看 is_error)', () => {
  const out = normalizeClaudeMessage({
    type: 'user',
    message: { content: [
      { type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'boom' },
    ] },
  });
  assert.deepEqual(out, [{ type: EVENT.TOOL_FINISHED, id: 'tu_1', ok: false }]);
});

test('result → task.finished / task.failed', () => {
  assert.deepEqual(normalizeClaudeMessage({ type: 'result', subtype: 'success', result: '都改好了' }),
    [{ type: EVENT.TASK_FINISHED, text: '都改好了' }]);
  assert.deepEqual(normalizeClaudeMessage({ type: 'result', subtype: 'error_max_turns' }),
    [{ type: EVENT.TASK_FAILED, text: 'error_max_turns' }]);
});

test('空文字块、未知类型 → 忽略', () => {
  assert.deepEqual(normalizeClaudeMessage({ type: 'assistant', message: { content: [{ type: 'text', text: '  ' }] } }), []);
  assert.deepEqual(normalizeClaudeMessage({ type: 'whatever' }), []);
});
