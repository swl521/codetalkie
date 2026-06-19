import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readLeader, writeLeader } from '../src/leader.js';

test('writeLeader 后 readLeader 读回，since 来自注入时钟', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'hub-')), 'leader.json');
  const data = writeLeader({ leader: 'de-tool', engine: 'codex' }, file, () => '2026-06-19T00:00:00.000Z');
  assert.deepEqual(data, { leader: 'de-tool', engine: 'codex', since: '2026-06-19T00:00:00.000Z' });
  assert.deepEqual(readLeader(file), data);
});

test('readLeader: 文件不存在 → null', () => {
  assert.equal(readLeader(join(tmpdir(), 'no-such-leader.json')), null);
});
