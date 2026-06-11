import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRegistry, resolveSpoken, saveAlias, loadAliases } from '../src/registry.js';

const E = (cwd, agent, base, lastActive = 0) => ({ cwd, agent, base, lastActive });

test('撞名(同目录双引擎/异目录同名)→ 全部标 needsRename', () => {
  const reg = buildRegistry([
    E('/a/wiki', 'claude', 'wiki', 3),
    E('/a/wiki', 'codex', 'wiki', 2),
    E('/b/app', 'claude', 'app', 1),
  ]);
  assert.deepEqual(reg.map((e) => [e.name, e.needsRename]),
    [['wiki', true], ['wiki', true], ['app', false]]);
});

test('别名解决撞名;按最近活跃排序', () => {
  const reg = buildRegistry(
    [E('/a/wiki', 'claude', 'wiki', 3), E('/a/wiki', 'codex', 'wiki', 9)],
    { '维基X': { cwd: '/a/wiki', agent: 'codex' } },
  );
  assert.deepEqual(reg.map((e) => [e.name, e.needsRename, e.aliased]),
    [['维基X', false, true], ['wiki', false, false]]);
});

test('语音解析:唯一命中带引擎;重名→ambiguous;未命中→null', () => {
  const reg = buildRegistry(
    [E('/a/wiki', 'claude', 'wiki'), E('/q', 'codex', 'quotes'), E('/x/demo2', 'claude', 'dup'), E('/y/demo2', 'claude', 'dup')],
    { '报价单': { cwd: '/q', agent: 'codex' } },
  );
  assert.deepEqual(resolveSpoken('wiki 跑测试', reg),
    { project: 'wiki', cwd: '/a/wiki', agent: undefined, prompt: '跑测试' });
  assert.equal(resolveSpoken('报价单 继续', reg).agent, 'codex');
  assert.deepEqual(resolveSpoken('dup 干活', reg), { ambiguous: 'dup' });
  assert.equal(resolveSpoken('随便聊聊天气', reg), null);
});

test('saveAlias:唯一性强制;同项目改名清旧名', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'earpiece-')), 'aliases.json');
  saveAlias(file, '维基', { cwd: '/a/wiki', agent: 'claude' });
  assert.throws(() => saveAlias(file, '维基', { cwd: '/other', agent: 'claude' }), /已被占用/);
  saveAlias(file, '百科', { cwd: '/a/wiki', agent: 'claude' }); // 改名
  assert.deepEqual(Object.keys(loadAliases(file)), ['百科']);
});
