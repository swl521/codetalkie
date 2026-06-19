import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../src/cli.js';

test('parseArgs: 子命令 + 位置参数 + 标志', () => {
  const a = parseArgs(['send', 'de-tool', 'run tests', '--job', 'J1', '--wait', '--timeout', '60']);
  assert.equal(a.cmd, 'send');
  assert.deepEqual(a.positionals, ['de-tool', 'run tests']);
  assert.equal(a.flags.job, 'J1');
  assert.equal(a.flags.wait, true);
  assert.equal(a.flags.timeout, '60');
});
test('parseArgs: 无参数 → cmd undefined', () => {
  assert.equal(parseArgs([]).cmd, undefined);
});

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join as pjoin } from 'node:path';
import { tmpdir } from 'node:os';

const BIN = pjoin(process.cwd(), 'hub/bin/hub.js');

test('register: 无 HUB_PORT → 报错退出非 0', () => {
  const home = mkdtempSync(pjoin(tmpdir(), 'home-'));
  assert.throws(() => execFileSync('node', [BIN, 'register', '--engine', 'codex', '--name', 'w'], { env: { ...process.env, HOME: home, HUB_PORT: '' }, stdio: 'pipe' }));
});
test('register: 有 HUB_PORT → 写进 registry', () => {
  const home = mkdtempSync(pjoin(tmpdir(), 'home-'));
  execFileSync('node', [BIN, 'register', '--engine', 'codex', '--name', 'w1'], { env: { ...process.env, HOME: home, HUB_PORT: '18050' } });
  const reg = JSON.parse(readFileSync(pjoin(home, '.claude/agent-hub/registry.json'), 'utf-8'));
  assert.equal(reg.sessions.w1.port, 18050);
  assert.equal(reg.sessions.w1.engine, 'codex');
});
test('reply: 写 responses 文件', () => {
  const home = mkdtempSync(pjoin(tmpdir(), 'home-'));
  execFileSync('node', [BIN, 'reply', 'mid9', '{"ok":true,"summary":"hi"}'], { env: { ...process.env, HOME: home } });
  const f = pjoin(home, '.claude/agent-hub/responses/mid9.json');
  assert.ok(existsSync(f));
  assert.equal(JSON.parse(readFileSync(f, 'utf-8')).result.summary, 'hi');
});
test('register: --pid 被采纳', () => {
  const home = mkdtempSync(pjoin(tmpdir(), 'home-'));
  execFileSync('node', [BIN, 'register', '--engine', 'codex', '--name', 'wp', '--pid', '424242'], { env: { ...process.env, HOME: home, HUB_PORT: '18051' } });
  const reg = JSON.parse(readFileSync(pjoin(home, '.claude/agent-hub/registry.json'), 'utf-8'));
  assert.equal(reg.sessions.wp.pid, 424242);
});
