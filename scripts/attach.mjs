// 终端接上手机聊的那条会话(真同链,不是副本):
//   node scripts/attach.mjs 耳机      → claude --resume <手机链>
//   node scripts/attach.mjs 报价单    → codex resume <该目录最新会话>
// 不带参数列出所有可接的会话。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import { latestCodexSessionId } from '../agent/src/scanProjects.js';

const store = JSON.parse(readFileSync(join(homedir(), '.earpiece', 'sessions.json'), 'utf8'));
const want = process.argv[2];

const entries = Object.entries(store).map(([k, id]) => {
  const m = /^(?:(codex|hermes):)?(.+)@(.+)$/.exec(k);
  return m && { agent: m[1] ?? 'claude', project: m[2], cwd: m[3], id };
}).filter(Boolean);

if (!want) {
  console.log('可接的会话(node scripts/attach.mjs <项目名>):');
  for (const e of entries) console.log(`  ${e.project}  [${e.agent}]  ${e.cwd}`);
  process.exit(0);
}

const hit = entries.find((e) => e.project === want);
if (!hit) { console.error(`没有「${want}」的会话链,先用手机对它说一句话`); process.exit(1); }
if (hit.agent === 'hermes') { console.error('hermes 会话在 VM 上,用 ssh 进去 hermes sessions browse'); process.exit(1); }

// codex 接"该目录最新落盘会话"(终端/手机谁最后聊都接得上);claude 接 SessionStore 链头
const [bin, args] = hit.agent === 'codex'
  ? ['codex', ['resume', latestCodexSessionId(hit.cwd) ?? hit.id]]
  : ['claude', ['--resume', hit.id]];
console.log(`⇄ ${bin} ${args.join(' ')}  @ ${hit.cwd}`);
spawn(bin, args, { cwd: hit.cwd, stdio: 'inherit' });
