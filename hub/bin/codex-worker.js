#!/usr/bin/env node
// Codex worker 守护:注册 engine=codex,开端口,/send 到达就 handleSend。
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { handleSend } from '../src/codex-worker.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = process.env.HUB_NAME || `codex-${process.pid}`;
let PORT = 18001;
const srv = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', async () => {
      let msg;
      try { msg = JSON.parse(body || '{}'); }
      catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'bad json' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'delivered', msg_id: msg.msg_id }));
      await handleSend(msg, { session: NAME }); // 异步跑,回报落 responses/
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ name: NAME, port: PORT, engine: 'codex', status: 'idle' }));
    return;
  }
  res.writeHead(404); res.end('Not found');
});
(function listen(p) {
  if (p > 18099) throw new Error('无可用端口');
  srv.once('error', () => listen(p + 1));
  srv.listen(p, '127.0.0.1', () => {
    PORT = p;
    const reg = () => { try { execFileSync('node', [join(HERE, 'hub.js'), 'register', '--engine', 'codex', '--name', NAME, '--pid', String(process.pid)], { env: { ...process.env, HUB_PORT: String(p) } }); } catch {} };
    reg();
    const hb = setInterval(reg, 10_000); hb.unref?.();
    console.error(`[codex-worker] ${NAME} on ${p}`);
  });
})(PORT);
