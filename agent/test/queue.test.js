import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnnounceQueue } from '../src/queue.js';

test('FIFO 基本顺序;紧急插队', () => {
  const q = new AnnounceQueue();
  q.push({ project: 'wiki', text: 'a' });
  q.push({ project: 'wiki', text: 'b' });
  q.push({ project: 'wiki', text: '出错了', urgent: true });
  assert.equal(q.next().text, '出错了');
  assert.equal(q.next().text, 'a');
  assert.equal(q.next().text, 'b');
  assert.equal(q.next(), null);
});

test('进度积压超过阈值 → 合并概括,保最新', () => {
  const q = new AnnounceQueue({ mergeThreshold: 3 });
  for (const t of ['1', '2', '3', '测试通过']) q.push({ project: 'wiki', text: t });
  const merged = q.next();
  assert.equal(merged.text, '刚有 4 条进度，最新：测试通过');
  assert.equal(merged.project, 'wiki');
  assert.equal(q.next(), null);
});

test('紧急永不被合并', () => {
  const q = new AnnounceQueue({ mergeThreshold: 1 });
  q.push({ project: 'wiki', text: 'p1' });
  q.push({ project: 'wiki', text: 'p2' });
  q.push({ project: 'wiki', text: '要批准', urgent: true });
  assert.equal(q.next().text, '要批准');
  assert.equal(q.next().text, '刚有 2 条进度，最新：p2');
});
