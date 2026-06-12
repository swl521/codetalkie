// UserPromptSubmit hook:把手机线程的新消息"复制进这个窗口"。
// 每次用户在终端/桌面窗口发话,查 relay 上本项目(按 cwd 匹配)的现场行
// (手机指令 + 无头/桥的回复,不含 seed 回填),有新的就贴成上下文 ——
// 窗口里的 Claude 自然知道你在手机上聊过什么。失败一律静默(不挡正常对话)。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SEEN = join(homedir(), '.earpiece', 'phone-sync-seen.json');

async function main() {
  let input = '';
  for await (const c of process.stdin) input += c;
  const cwd = JSON.parse(input || '{}').cwd ?? process.cwd();

  // relay 配置(没配公网就没有手机线程,直接退出)
  const relayPath = join(homedir(), '.earpiece', 'relay.json');
  if (!existsSync(relayPath)) return;
  const { url, token } = JSON.parse(readFileSync(relayPath, 'utf8'));
  const auth = { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) };

  // cwd → 项目名(只认 claude 引擎;hermes/codex 各有各的窗口)
  const reg = await fetch(`${url}/registry`, auth).then((r) => r.json()).catch(() => []);
  const mine = (Array.isArray(reg) ? reg : []).find((e) => e.cwd === cwd && (e.agent ?? 'claude') === 'claude');
  if (!mine) return;

  const hist = await fetch(`${url}/history?project=${encodeURIComponent(mine.name)}`, auth)
    .then((r) => r.json()).catch(() => []);
  if (!Array.isArray(hist)) return;

  let seen = {};
  try { seen = JSON.parse(readFileSync(SEEN, 'utf8')); } catch { /* 首次 */ }
  const last = seen[mine.name] ?? 0;
  // 现场行才算"手机上聊的"(seed 是本窗口自己的字幕,贴回来就成回音了)
  const fresh = hist.filter((l) => l.src !== 'seed' && (l.ts ?? 0) > last
    && (l.role === 'user' || l.role === 'assistant') && (l.text ?? '').trim());
  if (!fresh.length) return;

  seen[mine.name] = Math.max(...fresh.map((l) => l.ts));
  writeFileSync(SEEN, JSON.stringify(seen));

  const lines = fresh.slice(-20).map((l) =>
    `${l.role === 'user' ? '你(手机)' : '小易'}:${l.text.length > 300 ? l.text.slice(0, 299) + '…' : l.text}`);
  console.log(`📲 手机线程「${mine.name}」自上次以来的新消息(自动同步进本窗口):\n${lines.join('\n')}`);
}

main().catch(() => {}); // 任何失败都不挡用户说话
