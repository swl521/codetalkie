import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../src/events.js';
import { normalizeHermesMessage } from '../src/normalizeHermes.js';

test('text 模式整段输出 → task.finished(去空白)', () => {
  assert.deepEqual(normalizeHermesMessage({ __text: '  搞定了,结果是 42  ' }),
    [{ type: EVENT.TASK_FINISHED, text: '搞定了,结果是 42' }]);
});

test('空输出 → task.failed', () => {
  assert.deepEqual(normalizeHermesMessage({ __text: '   ' }),
    [{ type: EVENT.TASK_FAILED, text: 'hermes 没有输出' }]);
});

test('非 __text 消息 → 忽略', () => {
  assert.deepEqual(normalizeHermesMessage({ type: 'whatever' }), []);
  assert.deepEqual(normalizeHermesMessage(null), []);
});
