import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

// 桥:手机指令优先注入"同目录的活终端窗口"(agent-hub 会话),让正开着的 CLI
// 带全部上下文干活 —— 手机和电脑前的对话是同一个脑子。没有活终端才退回无头分身。
//
// agent-hub 约定(见 ~/.claude/CLAUDE.md):
// - 注册表 ~/.claude/agent-hub/registry.json:{ sessions: { 名: {port,pid,cwd,status} } }
// - 注入:POST 127.0.0.1:{port}/send {"command","msg_id"}
// - 回复:CLI 调 hub_reply 写 ~/.claude/agent-hub/responses/{msg_id}.json = {result}

const HUB_DIR = join(homedir(), '.claude', 'agent-hub');

// 找 cwd 完全一致、进程还活着的终端会话。找不到 → null(走无头)。
export function findHubSession(cwd, registryPath = join(HUB_DIR, 'registry.json')) {
  try {
    const reg = JSON.parse(readFileSync(registryPath, 'utf8'));
    for (const [name, s] of Object.entries(reg.sessions ?? {})) {
      if (s.cwd !== cwd || !s.port || !s.pid) continue;
      try { process.kill(s.pid, 0); } catch { continue; } // 死进程的残留注册
      return { name, port: s.port, pid: s.pid };
    }
  } catch { /* 没装 hub / 注册表坏 → 无桥可走 */ }
  return null;
}

// 注入指令并等回复。返回 true=桥已接手(含超时,避免无头重复执行);false=注入失败(调用方退无头)。
export async function runViaHub(job, hub, {
  notify = () => {}, logLine = () => {},
  responsesDir = join(HUB_DIR, 'responses'),
  timeoutMs = 15 * 60_000, pollMs = 3000,
} = {}) {
  const msgId = randomBytes(4).toString('hex');
  try {
    const r = await fetch(`http://127.0.0.1:${hub.port}/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: job.prompt, msg_id: msgId }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return false;
  } catch { return false; } // 端口没人听 → 退无头
  logLine({ project: job.project, role: 'event', text: `⇄ 已交给终端窗口「${hub.name}」(同一个对话)` });

  const resFile = join(responsesDir, `${msgId}.json`);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((s) => setTimeout(s, pollMs));
    if (!existsSync(resFile)) continue;
    let parsed;
    try { parsed = JSON.parse(readFileSync(resFile, 'utf8')); } catch { continue; } // 半写状态,下轮再读
    try { unlinkSync(resFile); } catch { /* 清不掉不碍事 */ }
    const text = String(parsed.result ?? '').trim() || '终端干完了,但没说结果';
    notify({ project: job.project, text });
    logLine({ project: job.project, role: 'assistant', text });
    return true;
  }
  // 超时:终端可能还在忙(长任务/排队),不退无头 —— 注入的指令仍会被执行,重复跑会干两遍活
  notify({ project: job.project, text: '终端窗口还在忙,它干完结果会进字幕' });
  return true;
}
