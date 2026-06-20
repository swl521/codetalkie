import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findHubSession, runViaHub } from '../src/hubBridge.js';

function tmpRegistry(sessions) {
  const dir = mkdtempSync(join(tmpdir(), 'hub-'));
  const p = join(dir, 'registry.json');
  writeFileSync(p, JSON.stringify({ sessions }));
  return p;
}

test('findHubSession:cwd 匹配 + 进程活着 + 带 sessionId 才算;死 pid/无 sessionId/别的目录/没注册表都拿不到', () => {
  const reg = tmpRegistry({
    mine: { port: 18091, pid: process.pid, cwd: '/work/a', sessionId: 'sid-a' }, // 活(本测试进程)+ 真 hub 会话
    dead: { port: 18092, pid: 999999999, cwd: '/work/b', sessionId: 'sid-b' },   // 死 pid
    bare: { port: 18093, pid: process.pid, cwd: '/work/d' },                     // 活但没 sessionId(非真 hub 会话)
  });
  assert.deepEqual(findHubSession('/work/a', reg), { name: 'mine', port: 18091, pid: process.pid });
  assert.equal(findHubSession('/work/b', reg), null);  // 进程不在
  assert.equal(findHubSession('/work/c', reg), null);  // 目录没人
  assert.equal(findHubSession('/work/d', reg), null);  // 活但没 sessionId → 不认
  assert.equal(findHubSession('/work/a', '/nonexistent/registry.json'), null);
});

test('runViaHub:注入 → 等回复文件 → notify+logLine,回 true', async () => {
  // 假 hub:收 /send 后 200ms 把回复写进 responsesDir
  const responsesDir = mkdtempSync(join(tmpdir(), 'hub-res-'));
  let received = null;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      received = JSON.parse(body);
      setTimeout(() => {
        writeFileSync(join(responsesDir, `${received.msg_id}.json`), JSON.stringify({ result: '桥那头干完了' }));
      }, 200);
      res.writeHead(200); res.end('{"ok":true}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  const notices = [], lines = [];
  const ok = await runViaHub(
    { project: '耳机', prompt: '跑个测试' },
    { name: 'term', port },
    { notify: (n) => notices.push(n), logLine: (l) => lines.push(l), responsesDir, pollMs: 50, timeoutMs: 5000 },
  );
  srv.close();
  assert.equal(ok, true);
  assert.deepEqual(received, { command: '跑个测试', msg_id: received.msg_id });
  assert.ok(notices.some((n) => n.text === '桥那头干完了'));
  assert.ok(lines.some((l) => l.role === 'assistant' && l.text === '桥那头干完了'));
  assert.ok(!existsSync(join(responsesDir, `${received.msg_id}.json`))); // 读完即清
});

test('runViaHub:端口没人听 → false(调用方退无头)', async () => {
  const ok = await runViaHub(
    { project: 'p', prompt: 'x' },
    { name: 'ghost', port: 1 },  // 不可监听端口
    { responsesDir: mkdtempSync(join(tmpdir(), 'hub-res-')), pollMs: 50, timeoutMs: 500 },
  );
  assert.equal(ok, false);
});

test('runViaHub:送达但超时没回复 → notify 提示且回 true(不重复执行)', async () => {
  const responsesDir = mkdtempSync(join(tmpdir(), 'hub-res-'));
  const srv = http.createServer((req, res) => { res.writeHead(200); res.end('{}'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const notices = [];
  const ok = await runViaHub(
    { project: 'p', prompt: 'x' },
    { name: 'busy', port: srv.address().port },
    { notify: (n) => notices.push(n), responsesDir, pollMs: 50, timeoutMs: 300 },
  );
  srv.close();
  assert.equal(ok, true);
  assert.ok(notices.some((n) => /还在忙/.test(n.text)));
});

test('runViaHub:结构化 result → 取 summary,notify/logLine 收到摘要文本而非 [object Object]', async () => {
  const responsesDir = mkdtempSync(join(tmpdir(), 'hub-res-'));
  let received = null;
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      received = JSON.parse(body);
      setTimeout(() => {
        writeFileSync(
          join(responsesDir, `${received.msg_id}.json`),
          JSON.stringify({ result: { ok: true, summary: '结构化摘要' } }),
        );
      }, 200);
      res.writeHead(200); res.end('{"ok":true}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;

  const notices = [], lines = [];
  const ok = await runViaHub(
    { project: '耳机', prompt: '编排任务' },
    { name: 'term', port },
    { notify: (n) => notices.push(n), logLine: (l) => lines.push(l), responsesDir, pollMs: 50, timeoutMs: 5000 },
  );
  srv.close();
  assert.equal(ok, true);
  assert.ok(notices.some((n) => n.text === '结构化摘要'), `notify 应收到 '结构化摘要',实际: ${JSON.stringify(notices)}`);
  assert.ok(lines.some((l) => l.role === 'assistant' && l.text === '结构化摘要'), `logLine 应收到 '结构化摘要',实际: ${JSON.stringify(lines)}`);
  assert.ok(!notices.some((n) => n.text === '[object Object]'), 'notify 不应收到 [object Object]');
});
