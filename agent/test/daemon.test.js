import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDaemon } from '../src/daemon.js';

function fakeRes() {
  const r = { code: 0, body: '' };
  r.writeHead = (c) => { r.code = c; };
  r.end = (b) => { r.body = b ?? ''; };
  return r;
}

test('无 token → 401;错 token → 401', () => {
  const d = createDaemon({ token: 'secret', runner: async () => {} });
  const r1 = fakeRes();
  d.handle({ headers: {}, method: 'POST', url: '/command' }, r1, '{}');
  assert.equal(r1.code, 401);
  const r2 = fakeRes();
  d.handle({ headers: { authorization: 'Bearer wrong' }, method: 'POST', url: '/command' }, r2, '{}');
  assert.equal(r2.code, 401);
});

test('指令解析:注册项目走项目目录,未知首词整句给 demo', async () => {
  const ran = [];
  const d = createDaemon({
    token: 't',
    runner: async (job) => { ran.push(job); },
    projects: { wiki: '/path/wiki' },
    defaults: { level: 3 },
  });
  const auth = { authorization: 'Bearer t' };

  const r1 = fakeRes();
  d.handle({ headers: auth, method: 'POST', url: '/command' }, r1, JSON.stringify({ text: 'wiki 跑一下测试' }));
  assert.equal(r1.code, 202);

  const r2 = fakeRes();
  d.handle({ headers: auth, method: 'POST', url: '/command' }, r2, JSON.stringify({ text: '今天天气怎么样' }));
  assert.equal(r2.code, 202);

  await new Promise((r) => setTimeout(r, 10)); // 让 pump 串行跑完
  assert.equal(ran.length, 2);
  assert.deepEqual({ project: ran[0].project, cwd: ran[0].cwd, prompt: ran[0].prompt, level: ran[0].level },
    { project: 'wiki', cwd: '/path/wiki', prompt: '跑一下测试', level: 3 });
  assert.equal(ran[1].project, 'demo');
  assert.equal(ran[1].prompt, '今天天气怎么样');
});

test('注册表解析:命中带引擎;重名拒绝并 notify;未命中走 demo 兜底', async () => {
  const lines = [];
  const notices = [];
  const d = createDaemon({
    token: 't', runner: async () => {},
    logLine: (l) => lines.push(l),
    notify: (n) => notices.push(n),
    resolver: (text) => {
      const [head, ...rest] = text.split(/\s+/);
      if (head === '报价单') return { project: '报价单', cwd: '/q', agent: 'codex', prompt: rest.join(' ') };
      if (head === 'dup') return { ambiguous: 'dup' };
      return null;
    },
  });
  const job = d.enqueueText('报价单 继续干');
  assert.deepEqual({ agent: job.agent, cwd: job.cwd, prompt: job.prompt },
    { agent: 'codex', cwd: '/q', prompt: '继续干' });
  assert.equal(lines[0].text, '[codex] 继续干');

  const dup = d.enqueueText('dup 干活');
  assert.equal(dup.ambiguous, 'dup');
  assert.ok(notices.some((n) => /都叫「dup」/.test(n.text)));  // 成功指令现在也会回显,用 some 查
  assert.equal(d.queueSize(), 0); // 重名没入队

  const fallback = d.enqueueText('随便聊聊');
  assert.deepEqual({ project: fallback.project, prompt: fallback.prompt }, { project: 'demo', prompt: '随便聊聊' });
});

test('Relay 入口:enqueueText 复用同一套解析;respondFromRelay 不带 id 命中最新', async () => {
  const ran = [];
  const d = createDaemon({
    token: 't',
    runner: async (job) => { ran.push(job); },
    projects: { wiki: '/path/wiki' },
  });
  const job = d.enqueueText('wiki 修一下测试');
  assert.deepEqual({ project: job.project, cwd: job.cwd, prompt: job.prompt },
    { project: 'wiki', cwd: '/path/wiki', prompt: '修一下测试' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(ran.length, 1);
  assert.equal(d.respondFromRelay({ approve: true }), false); // 没有挂起的批准
});

test('坏 JSON / 空指令 → 400;status 可查', () => {
  const d = createDaemon({ token: 't', runner: async () => {} });
  const auth = { authorization: 'Bearer t' };
  const r1 = fakeRes();
  d.handle({ headers: auth, method: 'POST', url: '/command' }, r1, 'not json');
  assert.equal(r1.code, 400);
  const r2 = fakeRes();
  d.handle({ headers: auth, method: 'POST', url: '/command' }, r2, JSON.stringify({ text: '  ' }));
  assert.equal(r2.code, 400);
  const r3 = fakeRes();
  d.handle({ headers: auth, method: 'GET', url: '/status' }, r3, '');
  assert.equal(r3.code, 200);
  assert.deepEqual(JSON.parse(r3.body), { running: null, queued: 0, pendingApprovals: 0 });
});
