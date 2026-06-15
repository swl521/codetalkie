import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { t } from './i18n.js';

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
    const alive = Object.entries(reg.sessions ?? {}).filter(([, s]) => {
      if (s.cwd !== cwd || !s.port || !s.pid) return false;
      try { process.kill(s.pid, 0); return true; } catch { return false; } // 跳过死进程残留
    });
    // 只认真正的 agent-hub CLI 会话(带 sessionId)。没有就返回 null → daemon 走 headless
    // 自动执行。不再回退到 window-listener(那种文件侧信道一重启就断,是"乱"的根源)。
    const pick = alive.find(([, s]) => s.sessionId);
    if (pick) return { name: pick[0], port: pick[1].port, pid: pick[1].pid };
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
  logLine({ project: job.project, role: 'event', text: t('handedToWindow', { name: hub.name }) });

  const resFile = join(responsesDir, `${msgId}.json`);
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((s) => setTimeout(s, pollMs));
    if (!existsSync(resFile)) continue;
    let parsed;
    try { parsed = JSON.parse(readFileSync(resFile, 'utf8')); } catch { continue; } // 半写状态,下轮再读
    try { unlinkSync(resFile); } catch { /* 清不掉不碍事 */ }
    const full = String(parsed.result ?? '').trim() || t('windowEmptyReply');
    // 念耳机 = 精简版(窗口按真实回复压成一两句);进线程 = 全文(复盘看)。
    // 窗口没给 spoken 就退回念全文。播报由此与窗口内容联动,而不是另生成一套。
    const spoken = String(parsed.spoken ?? '').trim() || full;
    notify({ project: job.project, text: spoken });
    logLine({ project: job.project, role: 'assistant', text: full });
    return true;
  }
  // 超时:终端可能还在忙(长任务/排队),不退无头 —— 注入的指令仍会被执行,重复跑会干两遍活
  notify({ project: job.project, text: t('windowBusy') });
  return true;
}
