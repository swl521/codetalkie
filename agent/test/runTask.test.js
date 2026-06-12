import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickResume } from '../src/runTask.js';
import { codexSessionIdFromFile } from '../src/scanProjects.js';

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

test('pickResume:claude 忽略 resumeId 用 SessionStore;codex 认 resumeId(同一个会话)', () => {
  assert.equal(
    pickResume({ agent: 'claude', resumeId: '20260611_133021_aa281975', fresh: false, sessionResume: 'claude-sess' }),
    'claude-sess',
  );
  // codex:resumeId 指"该目录最新落盘会话"(终端 TUI 聊的也算),优先于无头自己的链
  assert.equal(
    pickResume({ agent: 'codex', resumeId: '019ddabe-398a-7862-9919-a5bccc165687', fresh: false, sessionResume: 'codex-thread' }),
    '019ddabe-398a-7862-9919-a5bccc165687',
  );
  assert.equal(
    pickResume({ agent: 'codex', resumeId: null, fresh: false, sessionResume: 'codex-thread' }),
    'codex-thread',
  );
});

test('codexSessionIdFromFile:rollout 文件名尾部 uuid;非法名 → null', () => {
  assert.equal(
    codexSessionIdFromFile('/x/2026/04/29/rollout-2026-04-29T15-36-32-019ddabe-398a-7862-9919-a5bccc165687.jsonl'),
    '019ddabe-398a-7862-9919-a5bccc165687',
  );
  assert.equal(codexSessionIdFromFile('/x/whatever.jsonl'), null);
  assert.equal(codexSessionIdFromFile(null), null);
});

test('pickResume:fresh 一律不续(即使有 resumeId)', () => {
  assert.equal(
    pickResume({ agent: 'hermes', resumeId: '20260611_133021_aa281975', fresh: true, sessionResume: 'store-xyz' }),
    undefined,
  );
});
