import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const HOOK = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'approval-hook.mjs');

// 起个假 daemon:/approval/request 按 reply 回 allow/deny
function fakeDaemon(reply) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let b = ''; req.on('data', (d) => { b += d; });
      req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(reply(JSON.parse(b || '{}')))); });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

// 跑 hook:喂 stdin,收 stdout + 退出码
function runHook(input, env) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [HOOK], { env: { ...process.env, ...env } });
    let out = '', err = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('exit', (code) => resolve({ out, err, code }));
    c.stdin.end(JSON.stringify(input));
  });
}

test('hook:daemon 放行 → permissionDecision allow', async () => {
  const { srv, port } = await fakeDaemon(() => ({ behavior: 'allow' }));
  const { out, code } = await runHook(
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/x' },
    { EARPIECE_DAEMON: `http://127.0.0.1:${port}`, EARPIECE_TOKEN: 't', EARPIECE_HOOK_SKIP: '', EARPIECE_APPROVE_PHONE: '1' },
  );
  srv.close();
  assert.equal(code, 0);
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'allow');
});

test('hook:daemon 拒绝 → deny + 原因', async () => {
  const { srv, port } = await fakeDaemon(() => ({ behavior: 'deny', message: '手机拒了' }));
  const { out } = await runHook(
    { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: {}, cwd: '/x' },
    { EARPIECE_DAEMON: `http://127.0.0.1:${port}`, EARPIECE_TOKEN: 't', EARPIECE_HOOK_SKIP: '', EARPIECE_APPROVE_PHONE: '1' },
  );
  srv.close();
  const d = JSON.parse(out).hookSpecificOutput;
  assert.equal(d.permissionDecision, 'deny');
  assert.equal(d.permissionDecisionReason, '手机拒了');
});

test('hook:EARPIECE_HOOK_SKIP=1 → 空输出放手(让无头 MCP 接管)', async () => {
  const { out, code } = await runHook(
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} },
    { EARPIECE_HOOK_SKIP: '1' },
  );
  assert.equal(code, 0);
  assert.equal(out.trim(), '');
});

test('hook:daemon 连不上 → ask(回到本地确认,不卡死)', async () => {
  // 指一个没人听的端口
  const { out } = await runHook(
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {}, cwd: '/x' },
    { EARPIECE_DAEMON: 'http://127.0.0.1:1', EARPIECE_TOKEN: 't', EARPIECE_HOOK_SKIP: '', EARPIECE_APPROVE_PHONE: '1' },
  );
  assert.equal(JSON.parse(out).hookSpecificOutput.permissionDecision, 'ask');
});

// ── Hermes(pre_tool_call):输出 {"decision":"block"} 拦 / {} 放行 ──

test('hook[hermes]:daemon 拒绝 → {"decision":"block"}', async () => {
  const { srv, port } = await fakeDaemon(() => ({ behavior: 'deny', message: '手机拒了' }));
  const { out } = await runHook(
    { hook_event_name: 'pre_tool_call', tool_name: 'terminal', tool_input: { command: 'rm -rf /' }, cwd: '/x' },
    { EARPIECE_DAEMON: `http://127.0.0.1:${port}`, EARPIECE_TOKEN: 't', EARPIECE_HOOK_SKIP: '', EARPIECE_APPROVE_PHONE: '1' },
  );
  srv.close();
  const d = JSON.parse(out);
  assert.equal(d.decision, 'block');
  assert.equal(d.reason, '手机拒了');
});

test('hook[hermes]:daemon 放行 → 空对象 {}(不拦)', async () => {
  const { srv, port } = await fakeDaemon(() => ({ behavior: 'allow' }));
  const { out } = await runHook(
    { hook_event_name: 'pre_tool_call', tool_name: 'terminal', tool_input: { command: 'ls' }, cwd: '/x' },
    { EARPIECE_DAEMON: `http://127.0.0.1:${port}`, EARPIECE_TOKEN: 't', EARPIECE_HOOK_SKIP: '', EARPIECE_APPROVE_PHONE: '1' },
  );
  srv.close();
  assert.deepEqual(JSON.parse(out), {});
});

test('hook[hermes]:daemon 连不上 → 空对象放行(无 ask 语义)', async () => {
  const { out } = await runHook(
    { hook_event_name: 'pre_tool_call', tool_name: 'terminal', tool_input: {}, cwd: '/x' },
    { EARPIECE_DAEMON: 'http://127.0.0.1:1', EARPIECE_TOKEN: 't', EARPIECE_HOOK_SKIP: '', EARPIECE_APPROVE_PHONE: '1' },
  );
  assert.deepEqual(JSON.parse(out), {});
});

test('hook:无路由标记 → 休眠空输出(交互式工作站默认不打扰)', async () => {
  // 不设 EARPIECE_APPROVE_PHONE、HOME 指向无标记的临时目录 → hook 直接放手
  const { out, code } = await runHook(
    { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/x' },
    { EARPIECE_DAEMON: 'http://127.0.0.1:1', EARPIECE_TOKEN: 't', EARPIECE_HOOK_SKIP: '', EARPIECE_APPROVE_PHONE: '', HOME: '/nonexistent-home-xyz' },
  );
  assert.equal(code, 0);
  assert.equal(out.trim(), '');
});
