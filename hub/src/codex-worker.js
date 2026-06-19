import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { RESPONSES_DIR } from './transport.js';

// 默认 runner:起 codex exec,末行输出当 summary。生产可换成复用 agent/src codex 驱动+归一。
export function defaultRunCommand(command) {
  return new Promise((resolve) => {
    const p = spawn('codex', ['exec', command], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({
      ok: code === 0,
      summary: (out.trim().split('\n').pop() || err.trim() || `codex exit ${code}`).slice(0, 500),
      artifacts: [],
    }));
  });
}

// 处理一条派活:跑命令 → 写结构化回报。runner 抛错则 ok:false。
export async function handleSend(msg, {
  runCommand = defaultRunCommand, responsesDir = RESPONSES_DIR,
  session = 'codex', now = () => new Date().toISOString(),
} = {}) {
  let result;
  try { result = await runCommand(msg.command); }
  catch (e) { result = { ok: false, summary: `worker 出错: ${e.message}`, artifacts: [] }; }
  const resp = { msg_id: msg.msg_id, job_id: msg.job_id, session, timestamp: now(), result };
  mkdirSync(responsesDir, { recursive: true });
  writeFileSync(join(responsesDir, `${msg.msg_id}.json`), JSON.stringify(resp, null, 2));
  return resp;
}
