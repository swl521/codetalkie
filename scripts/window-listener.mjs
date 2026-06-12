// 桌面窗口的桥接收端:让"这个正开着的 Claude 窗口"也能接手机指令。
// agent-hub channel 是 MCP,桌面 App 会话加载不了 —— 这个独立小监听器顶上:
//   1. 在 agent-hub 注册表登记自己(daemon 的 findHubSession 按 cwd 找到它)
//   2. 收到 /send 把指令追加到 window-inbox.jsonl(窗口里用 Monitor 盯这个文件)
//   3. 窗口里的 Claude 干完活,把结果写 responses/<msg_id>.json(hub 回复约定)
// 用法: node scripts/window-listener.mjs [cwd] [名字] [端口]
import http from 'node:http';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HUB = join(homedir(), '.claude', 'agent-hub');
const REG = join(HUB, 'registry.json');
const INBOX = join(HUB, 'window-inbox.jsonl');
const cwd = process.argv[2] ?? process.cwd();
const name = process.argv[3] ?? '耳机窗口';
const port = Number(process.argv[4] ?? 18088);

function editRegistry(fn) {
  let reg = { sessions: {} };
  try { reg = JSON.parse(readFileSync(REG, 'utf8')); } catch { /* 首次 */ }
  reg.sessions ??= {};
  fn(reg.sessions);
  mkdirSync(HUB, { recursive: true });
  writeFileSync(REG, JSON.stringify(reg, null, 2));
}

const srv = http.createServer((req, res) => {
  if (req.url === '/status') { res.end(JSON.stringify({ name, port, pid: process.pid, cwd, status: 'idle' })); return; }
  if (req.method === 'POST' && req.url === '/send') {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => {
      try {
        const { command, msg_id } = JSON.parse(b);
        appendFileSync(INBOX, JSON.stringify({ command, msg_id, ts: Date.now() }) + '\n');
        res.end('{"ok":true}');
      } catch { res.writeHead(400); res.end('{"ok":false}'); }
    });
    return;
  }
  res.writeHead(404); res.end();
});

srv.listen(port, '127.0.0.1', () => {
  editRegistry((s) => { s[name] = { port, pid: process.pid, cwd, status: 'idle', started: new Date().toISOString() }; });
  console.log(`窗口监听器已注册:${name} @ ${port} cwd=${cwd}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { editRegistry((s) => { delete s[name]; }); process.exit(0); });
}
