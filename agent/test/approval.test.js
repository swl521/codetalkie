import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDaemon } from '../src/daemon.js';
import { summarizeToolRequest } from '../src/translate.js';
import { buildPayload } from '../src/apns.js';

function fakeRes() {
  const r = { code: 0, body: '' };
  r.writeHead = (c) => { r.code = c; };
  r.end = (b) => { r.body = b ?? ''; r.ended = true; };
  return r;
}
const auth = { authorization: 'Bearer t' };

test('权限请求摘要成人话', () => {
  assert.equal(summarizeToolRequest('Bash', { command: 'npm test' }), '要跑命令「npm test」');
  assert.equal(summarizeToolRequest('Edit', { file_path: '/a/b/c.js' }), '要改文件 b/c.js');
  assert.equal(summarizeToolRequest('WebSearch', {}), '要上网查东西');
  assert.equal(summarizeToolRequest('FooTool', {}), '要用 FooTool');
});

test('APNs payload 可带 category 和顶层附加字段', () => {
  const p = buildPayload({ project: 'w', text: 'x', category: 'APPROVAL', extra: { approvalId: 'a1' } });
  assert.equal(p.aps.category, 'APPROVAL');
  assert.equal(p.approvalId, 'a1');
});

test('批准流:请求挂起→announce 被叫→respond 批准→挂起响应收到 allow+原参数', async () => {
  const announced = [];
  const d = createDaemon({ token: 't', runner: async () => {}, announce: async (a) => announced.push(a) });

  const held = fakeRes();
  d.handle({ headers: auth, method: 'POST', url: '/approval/request' }, held,
    JSON.stringify({ tool_name: 'Bash', input: { command: 'rm x' } }));
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(held.ended, undefined); // 还挂着
  assert.equal(announced.length, 1);
  assert.equal(announced[0].summary, '要跑命令「rm x」');

  const phone = fakeRes();
  d.handle({ headers: auth, method: 'POST', url: '/approval/respond' }, phone,
    JSON.stringify({ id: announced[0].id, approve: true }));
  assert.equal(phone.code, 200);
  assert.equal(held.code, 200);
  assert.deepEqual(JSON.parse(held.body), { behavior: 'allow', updatedInput: { command: 'rm x' } });
});

test('拒绝与超时都回 deny;未知 id 回 404', async () => {
  const announced = [];
  const d = createDaemon({ token: 't', runner: async () => {}, announce: async (a) => announced.push(a), approvalTimeoutMs: 20 });

  // 拒绝
  const held1 = fakeRes();
  d.handle({ headers: auth, method: 'POST', url: '/approval/request' }, held1, JSON.stringify({ tool_name: 'Edit', input: {} }));
  await new Promise((r) => setTimeout(r, 2));
  const phone1 = fakeRes();
  d.handle({ headers: auth, method: 'POST', url: '/approval/respond' }, phone1, JSON.stringify({ id: announced[0].id, approve: false }));
  assert.equal(JSON.parse(held1.body).behavior, 'deny');

  // 超时
  const held2 = fakeRes();
  d.handle({ headers: auth, method: 'POST', url: '/approval/request' }, held2, JSON.stringify({ tool_name: 'Bash', input: {} }));
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(JSON.parse(held2.body).behavior, 'deny');

  // 未知 id
  const phone2 = fakeRes();
  d.handle({ headers: auth, method: 'POST', url: '/approval/respond' }, phone2, JSON.stringify({ id: 'nope', approve: true }));
  assert.equal(phone2.code, 404);
});

test('语音批准:不带 id → 命中最新挂起的请求;没有挂起时 404', async () => {
  const announced = [];
  const d = createDaemon({ token: 't', runner: async () => {}, announce: async (a) => announced.push(a) });

  const held = fakeRes();
  d.handle({ headers: auth, method: 'POST', url: '/approval/request' }, held, JSON.stringify({ tool_name: 'Bash', input: { command: 'x' } }));
  await new Promise((r) => setTimeout(r, 5));

  const voice = fakeRes();
  d.handle({ headers: auth, method: 'POST', url: '/approval/respond' }, voice, JSON.stringify({ approve: true }));
  assert.equal(voice.code, 200);
  assert.equal(JSON.parse(held.body).behavior, 'allow');

  const voice2 = fakeRes();
  d.handle({ headers: auth, method: 'POST', url: '/approval/respond' }, voice2, JSON.stringify({ approve: true }));
  assert.equal(voice2.code, 404); // 没有挂起的了
});
