import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleSend } from '../src/codex-worker.js';

test('handleSend: 跑命令成功 → 写结构化回报 ok:true', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'resp-'));
  const runCommand = async (cmd) => ({ ok: true, summary: `ran:${cmd}`, artifacts: ['x'] });
  await handleSend({ command: 'lint', msg_id: 'w1', job_id: 'J' }, { runCommand, responsesDir: dir, session: 'codex-de', now: () => 'T' });
  const r = JSON.parse(readFileSync(join(dir, 'w1.json'), 'utf-8'));
  assert.equal(r.msg_id, 'w1');
  assert.equal(r.job_id, 'J');
  assert.equal(r.result.ok, true);
  assert.equal(r.result.summary, 'ran:lint');
});
test('handleSend: runner 抛错 → ok:false', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'resp-'));
  const runCommand = async () => { throw new Error('boom'); };
  await handleSend({ command: 'x', msg_id: 'w2' }, { runCommand, responsesDir: dir, session: 'codex-de', now: () => 'T' });
  const r = JSON.parse(readFileSync(join(dir, 'w2.json'), 'utf-8'));
  assert.equal(r.result.ok, false);
  assert.match(r.result.summary, /boom/);
});
