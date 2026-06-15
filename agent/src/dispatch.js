#!/usr/bin/env node
// 跨机派活:在任意一台装了 daemon 的电脑上,把一条指令投给"拥有某项目"的机器执行,
// 并把对面的回复实时拉回来打印。和手机发指令同一条路(中继 /command 按项目名路由),
// 所以天然双向对称:Mac 能派给 Windows,Windows 也能派给 Mac。
//
//   用法:  node agent/src/dispatch.js "<项目名> <要做的事>"
//   例子:  node agent/src/dispatch.js "wiki 跑一下测试,把结果告诉我"
//
// 不改中继、不改 daemon —— 纯用现成端点(POST /command + GET /history?project=)。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { resolveAccountKey } from './account.js';

const DIR = join(homedir(), '.earpiece');
const POLL_MS = 2000;          // 轮询间隔
const IDLE_DONE_MS = 8000;     // 连续多久没新行就算这轮答完
const MAX_MS = 15 * 60_000;    // 最长等待

function loadRelay() {
  const p = join(DIR, 'relay.json');
  if (!existsSync(p)) throw new Error(`没找到 ${p} —— 这台机器还没配公网中继`);
  const c = JSON.parse(readFileSync(p, 'utf8'));
  const url = (c.urls ?? [c.url]).filter(Boolean)[0];
  if (!url) throw new Error('relay.json 里没有可用的 url');
  return { url, token: resolveAccountKey(DIR) };
}

const api = (relay) => ({
  post: (path, body) => fetch(`${relay.url}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${relay.token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  }),
  history: (project) => fetch(`${relay.url}/history?project=${encodeURIComponent(project)}`, {
    headers: { authorization: `Bearer ${relay.token}` },
    signal: AbortSignal.timeout(10_000),
  }).then((r) => (r.ok ? r.json() : [])),
});

async function main() {
  const text = process.argv.slice(2).join(' ').trim();
  if (!text) {
    console.error('用法: node agent/src/dispatch.js "<项目名> <要做的事>"');
    process.exit(2);
  }
  // 开头是 `@机器名` 时,真正的项目名是第二个词(中继会按 @机器名 投递并剥掉前缀)。
  const toks = text.split(/\s+/);
  const project = toks[0].startsWith('@') ? (toks[1] ?? '') : toks[0];
  const relay = loadRelay();
  const r = api(relay);

  // 基线:记下发指令前已有多少条历史,之后只显示新增的。
  const baseline = (await r.history(project)).length;

  const resp = await r.post('/command', { text });
  if (!resp.ok) throw new Error(`中继拒收指令: HTTP ${resp.status}`);
  console.error(`→ 已投给「${project}」所在机器,等它干活并回话…\n`);

  const t0 = Date.now();
  let seen = baseline;
  let gotAssistant = false;     // 见过对面真正的回复(不算用户指令回显)
  let lastAssistant = 0;        // 最近一条 assistant 行的时间
  for (;;) {
    await new Promise((s) => setTimeout(s, POLL_MS));
    let lines = [];
    try { lines = await r.history(project); } catch { /* 网络抖动,下轮再来 */ }
    if (lines.length > seen) {
      for (const l of lines.slice(seen)) {
        const tag = l.role === 'assistant' ? '🤖' : l.role === 'user' ? '🧑' : '·';
        console.log(`${tag} ${l.text}`);
        if (l.role === 'assistant') { gotAssistant = true; lastAssistant = Date.now(); }
      }
      seen = lines.length;
    }
    // 只有"出现过 assistant 回复 + 之后静默够久"才算答完 —— 用户指令回显不触发,
    // 慢引擎(如 Codex 冷启动)也不会被提前掐断。
    if (gotAssistant && Date.now() - lastAssistant > IDLE_DONE_MS) break;
    if (Date.now() - t0 > MAX_MS) { console.error('\n(超时,对面可能还在跑长任务)'); break; }
  }
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
