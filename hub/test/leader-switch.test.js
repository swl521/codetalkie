import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('zhunao.sh codex <name>:写 leader.json engine=codex', () => {
  const home = mkdtempSync(join(tmpdir(), 'home-'));
  execFileSync('bash', ['scripts/zhunao.sh', 'codex', 'de-tool'], { env: { ...process.env, HOME: home } });
  const data = JSON.parse(readFileSync(join(home, '.claude', 'agent-hub', 'leader.json'), 'utf-8'));
  assert.equal(data.engine, 'codex');
  assert.equal(data.leader, 'de-tool');
});
