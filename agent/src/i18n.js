import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

// 语言包即插即用:agent/lang/<BCP47>.json 放进去就能选。
// 结构 {meta:{name,speechLocale,edgeVoice}, tools:{}, gui:{}, phrases:{key:"模板 {var}"}}。
// 缺键自动回落基准语言(zh-CN),所以翻一半的包也能用。
// 选择优先级:EARPIECE_LANG 环境变量 > ~/.earpiece/settings.json 的 lang > zh-CN。

const LANG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'lang');
const BASE = 'zh-CN';
let current = null; // { code, meta, tools, gui, phrases }

function readPack(code, dir) {
  return JSON.parse(readFileSync(join(dir, `${code}.json`), 'utf8'));
}

// 浅合并三段词典:语言包缺的键用基准包补
export function loadLang(code, dir = LANG_DIR) {
  const base = readPack(BASE, dir);
  if (code === BASE || !existsSync(join(dir, `${code}.json`))) return { code: BASE, ...base };
  const over = readPack(code, dir);
  return {
    code,
    meta: { ...base.meta, ...over.meta },
    tools: { ...base.tools, ...over.tools },
    gui: { ...base.gui, ...over.gui },
    phrases: { ...base.phrases, ...over.phrases },
  };
}

export function listLangs(dir = LANG_DIR) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  } catch { return [BASE]; }
}

function resolveCode() {
  if (process.env.EARPIECE_LANG) return process.env.EARPIECE_LANG;
  try {
    const s = JSON.parse(readFileSync(join(homedir(), '.earpiece', 'settings.json'), 'utf8'));
    if (s.lang) return s.lang;
  } catch { /* 没配置就基准语言 */ }
  return BASE;
}

export function lang() {
  if (!current) current = loadLang(resolveCode());
  return current;
}

// 运行时切换(daemon 设置同步用);传 null 重新按配置解析
export function setLang(code) {
  current = code ? loadLang(code) : null;
  return lang();
}

// 模板取词:t('received', {prompt:'跑测试'}) → "收到,跑测试"。缺键回 key 本身(可见即可修)。
export function t(key, vars = {}) {
  const tpl = lang().phrases[key] ?? key;
  return tpl.replace(/\{(\w+)\}/g, (_, k) => `${vars[k] ?? ''}`);
}

export const toolWord = (name) => lang().tools[name];
export const guiWord = (action) => lang().gui[action];
