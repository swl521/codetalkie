import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPolicy, DEFAULT_POLICY } from '../src/policy.js';

test('文件不存在 → 全默认', () => {
  assert.deepEqual(readPolicy(join(tmpdir(), 'no-policy.json')), DEFAULT_POLICY);
});

test('部分覆盖 → 与默认合并', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'hub-')), 'policy.json');
  writeFileSync(file, JSON.stringify({ maxParallel: 8 }));
  const p = readPolicy(file);
  assert.equal(p.maxParallel, 8);
  assert.equal(p.maxRetries, DEFAULT_POLICY.maxRetries);
});
