import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { postSend, readResponse, pollResponse, postAnnounce } from '../src/transport.js';

test('postSend: 用注入的 fetch 发到 /send', async () => {
  let captured;
  const fakeFetch = async (url, opts) => { captured = { url, opts }; return { status: 200, json: async () => ({ status: 'delivered', msg_id: 'm1' }) }; };
  const { status, data } = await postSend(18001, { command: 'ls', msg_id: 'm1' }, { fetchImpl: fakeFetch });
  assert.equal(status, 200);
  assert.equal(data.msg_id, 'm1');
  assert.equal(captured.url, 'http://127.0.0.1:18001/send');
  assert.equal(JSON.parse(captured.opts.body).command, 'ls');
});
test('readResponse: 文件在 → 解析,不在 → null', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-'));
  writeFileSync(join(dir, 'm2.json'), JSON.stringify({ msg_id: 'm2', result: 'ok' }));
  assert.equal(readResponse('m2', dir).result, 'ok');
  assert.equal(readResponse('nope', dir), null);
});
test('pollResponse: 出现即返回', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-'));
  writeFileSync(join(dir, 'm3.json'), JSON.stringify({ msg_id: 'm3', result: 'r' }));
  const r = await pollResponse('m3', { dir, sleep: async () => {} });
  assert.equal(r.status, 'ok');
  assert.equal(r.response.result, 'r');
});
test('pollResponse: 超时返回 timeout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-'));
  let t = 0;
  const r = await pollResponse('absent', { dir, timeoutMs: 10, intervalMs: 5, sleep: async () => { t += 5; }, now: () => t });
  assert.equal(r.status, 'timeout');
});

test('postAnnounce: POST 到 daemon /announce 带 text/level', async () => {
  let captured;
  const fakeFetch = async (url, opts) => { captured = { url, body: JSON.parse(opts.body) }; return { status: 202, json: async () => ({ announced: true }) }; };
  const r = await postAnnounce(7780, '第3步完成', 3, { fetchImpl: fakeFetch });
  assert.equal(r.status, 202);
  assert.equal(captured.url, 'http://127.0.0.1:7780/announce');
  assert.equal(captured.body.text, '第3步完成');
  assert.equal(captured.body.level, 3);
});
