import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePushSink } from '../src/pushSink.js';

test('播报项 → APNs payload,经注入的 sender 发送', async () => {
  const calls = [];
  const fakeSend = async (cfg, payload) => { calls.push({ cfg, payload }); return { status: 200, body: '' }; };
  const sink = makePushSink({ deviceToken: 'tok' }, fakeSend);

  await sink({ project: 'wiki', text: '测试过了' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].payload.aps.alert, { title: 'wiki', body: '测试过了' });
  assert.equal(calls[0].payload.aps['interruption-level'], 'time-sensitive');
  assert.equal(calls[0].cfg.deviceToken, 'tok');
});

test('非 200 不抛异常,只返回结果(不能因推送失败弄死播报)', async () => {
  const sink = makePushSink({}, async () => ({ status: 400, body: 'BadDeviceToken' }));
  const res = await sink({ project: 'w', text: 'x' });
  assert.equal(res.status, 400);
});
