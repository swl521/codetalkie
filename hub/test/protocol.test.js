import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mintId, normalizeResult, buildSendBody } from '../src/protocol.js';

test('mintId: 8 位十六进制,且每次不同', () => {
  const a = mintId(), b = mintId();
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.notEqual(a, b);
});

test('normalizeResult: 老纯字符串 → {ok:true,summary}', () => {
  assert.deepEqual(normalizeResult('done'), { ok: true, summary: 'done' });
});

test('normalizeResult: 结构化对象透传,ok 默认 true', () => {
  assert.deepEqual(
    normalizeResult({ summary: 'x', artifacts: ['a.js'], next: 'go' }),
    { ok: true, summary: 'x', artifacts: ['a.js'], next: 'go', needsApproval: undefined });
});

test('normalizeResult: ok:false 保留', () => {
  assert.equal(normalizeResult({ ok: false, summary: 'boom' }).ok, false);
});

test('buildSendBody: 省略 undefined 字段', () => {
  assert.deepEqual(buildSendBody({ command: 'ls', msgId: 'abc' }),
    { command: 'ls', msg_id: 'abc' });
  assert.deepEqual(buildSendBody({ command: 'ls', msgId: 'abc', jobId: 'J', from: 'me', wait: true, timeout: 60 }),
    { command: 'ls', msg_id: 'abc', job_id: 'J', from: 'me', wait: true, timeout: 60 });
});
