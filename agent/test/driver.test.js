import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveCli, codexArgs, hermesArgs } from '../src/driver.js';

test('逐行解析 NDJSON,坏行忽略,退出回调', async () => {
  const lines = [];
  const script = `console.log(JSON.stringify({type:'system',subtype:'init'}));` +
    `console.log('not json');` +
    `console.log(JSON.stringify({type:'result',subtype:'success',result:'ok'}));`;
  const exitCode = await new Promise((resolve) => {
    driveCli({
      bin: process.execPath, // node 本体假装 claude
      args: ['-e', script],
      onMessage: (m) => lines.push(m.type),
      onExit: resolve,
    });
  });
  assert.deepEqual(lines, ['system', 'result']);
  assert.equal(exitCode, 0);
});

const CODEX_FLAGS = ['--json', '--sandbox', 'workspace-write', '--skip-git-repo-check'];

test('codexArgs 无 resume:exec + 标准旗子 + prompt', () => {
  assert.deepEqual(codexArgs('跑测试'), ['exec', ...CODEX_FLAGS, '跑测试']);
});

test('codexArgs 有 resume:exec resume <id> + 标准旗子 + prompt(0.139.0 实测顺序)', () => {
  assert.deepEqual(
    codexArgs('继续', { resume: 'abc-123' }),
    ['exec', 'resume', 'abc-123', ...CODEX_FLAGS, '继续'],
  );
});

test('hermesArgs 无 resume:-z prompt --continue(续主会话)', () => {
  assert.deepEqual(hermesArgs('查天气'), ['-z', '查天气', '--continue']);
});

test('hermesArgs 有 resume:-z prompt --resume <会话>', () => {
  assert.deepEqual(hermesArgs('继续', { resume: 's1' }), ['-z', '继续', '--resume', 's1']);
});
