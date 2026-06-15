import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadLang, listLangs, t, lang } from '../src/i18n.js';

const LANG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'lang');

test('语言包键齐全:每个包必须覆盖 zh-CN 的全部键(贡献新语言的硬门槛)', () => {
  const base = JSON.parse(readFileSync(join(LANG_DIR, 'zh-CN.json'), 'utf8'));
  for (const f of readdirSync(LANG_DIR).filter((x) => x.endsWith('.json'))) {
    const pack = JSON.parse(readFileSync(join(LANG_DIR, f), 'utf8'));
    for (const section of ['meta', 'tools', 'gui', 'phrases']) {
      const missing = Object.keys(base[section]).filter((k) => !(k in (pack[section] ?? {})));
      assert.deepEqual(missing, [], `${f} 的 ${section} 缺键: ${missing.join(',')}`);
    }
  }
});

test('t():模板插值;默认 zh-CN;缺键回 key 本身', () => {
  assert.equal(lang().code, 'zh-CN'); // 测试环境无 EARPIECE_LANG/设置
  assert.equal(t('received', { prompt: '跑测试' }), '收到,跑测试');
  assert.equal(t('stuck', { sec: 60 }), '好像卡住了，60 秒没动静');
  assert.equal(t('不存在的键'), '不存在的键');
});

test('loadLang(en-US):英文输出生效', () => {
  const en = loadLang('en-US');
  assert.equal(en.meta.speechLocale, 'en-US');
  assert.equal(en.tools.Bash, 'running a command');
  assert.ok(en.phrases.taskDone.startsWith('Task complete'));
});

test('残缺语言包:缺的键回落 zh-CN(翻一半也能用)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lang-'));
  writeFileSync(join(dir, 'zh-CN.json'), readFileSync(join(LANG_DIR, 'zh-CN.json')));
  writeFileSync(join(dir, 'xx-XX.json'), JSON.stringify({
    meta: { name: '半成品' },
    phrases: { taskDone: 'DONE!' },
  }));
  const xx = loadLang('xx-XX', dir);
  assert.equal(xx.phrases.taskDone, 'DONE!');           // 翻了的用新值
  assert.equal(xx.phrases.received, '收到,{prompt}');    // 没翻的回落中文
  assert.equal(xx.meta.speechLocale, 'zh-CN');           // meta 同理
  assert.ok(listLangs(dir).includes('xx-XX'));           // 丢文件即被发现
});

test('不存在的语言码:整体回落 zh-CN 不抛', () => {
  const ghost = loadLang('no-SUCH');
  assert.equal(ghost.code, 'zh-CN');
});
