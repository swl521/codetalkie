import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickResume } from '../src/runTask.js';

test('pickResume:hermes 有 resumeId → 用它(绕过 SessionStore)', () => {
  assert.equal(
    pickResume({ agent: 'hermes', resumeId: '20260611_133021_aa281975', fresh: false, sessionResume: 'store-xyz' }),
    '20260611_133021_aa281975',
  );
});

test('pickResume:hermes 无 resumeId → 退回 SessionStore', () => {
  assert.equal(
    pickResume({ agent: 'hermes', resumeId: null, fresh: false, sessionResume: 'store-xyz' }),
    'store-xyz',
  );
});

test('pickResume:非 hermes 引擎忽略 resumeId,只用 SessionStore', () => {
  assert.equal(
    pickResume({ agent: 'claude', resumeId: '20260611_133021_aa281975', fresh: false, sessionResume: 'claude-sess' }),
    'claude-sess',
  );
  assert.equal(
    pickResume({ agent: 'codex', resumeId: 'should-ignore', fresh: false, sessionResume: 'codex-thread' }),
    'codex-thread',
  );
});

test('pickResume:fresh 一律不续(即使有 resumeId)', () => {
  assert.equal(
    pickResume({ agent: 'hermes', resumeId: '20260611_133021_aa281975', fresh: true, sessionResume: 'store-xyz' }),
    undefined,
  );
});
