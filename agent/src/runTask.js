import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { driveCli, claudeArgs, codexArgs, hermesArgs } from './driver.js';
import { normalizeClaudeMessage } from './normalize.js';
import { normalizeCodexMessage } from './normalizeCodex.js';
import { normalizeHermesMessage } from './normalizeHermes.js';
import { Pipeline } from './pipeline.js';
import { SilenceMonitor } from './monitor.js';
import { speak } from './speaker.js';
import { SessionStore } from './sessions.js';
import { EVENT } from './events.js';
import { makePushSink } from './pushSink.js';
import { latestCodexSessionId } from './scanProjects.js';

// 无头认证:~/.earpiece/oauth-token 存 claude setup-token 生成的长期令牌
export function loadAuthEnv() {
  try {
    const token = readFileSync(join(homedir(), '.earpiece', 'oauth-token'), 'utf8').trim();
    if (token) return { CLAUDE_CODE_OAUTH_TOKEN: token };
  } catch { /* 没有 token 文件就用默认认证 */ }
  return undefined;
}

// 跑一个任务直到结束:驾驶 CLI → 管线 → say/APNs。返回最终状态。
// main.js(命令行)和 daemon.js(常驻)共用。
// agent: 'claude'(默认)| 'codex' — 决定 bin、参数形态、归一器、env。
// resume 句柄解析:hermes 用会话列表的 ID;codex 用"该目录最新落盘会话"(终端 TUI
// 和手机无头落同一处,resume 它 = 真同一个会话);claude 用 SessionStore 链头。fresh 一律不续。
export function pickResume({ agent, resumeId, fresh, sessionResume }) {
  if (fresh) return undefined;
  if ((agent === 'hermes' || agent === 'codex') && resumeId) return resumeId;
  return sessionResume;
}

export function runTask({
  project, prompt, cwd = process.cwd(), level = 3,
  silent = false, fresh = false, push = null,
  agent = 'claude', bin = agent === 'codex' ? 'codex' : agent === 'hermes' ? 'hermes' : 'claude',
  resumeId = null, // hermes 会话 resume 句柄(其他引擎忽略)
  approval = null, // { daemonUrl, token, mcpPath }:权限请求经 approval-mcp 转给手机批准(仅 claude)
  onSpoken = null, // 每句播报后回调(字幕回放用)
  log = console.log,
}) {
  // 每个 agent 一套"参数函数 + 归一器 + 默认 bin + 驱动模式"。bin 被换掉时走回放路径(只传 prompt)。
  const profile = agent === 'codex'
    ? { defaultBin: 'codex', makeArgs: codexArgs, normalize: normalizeCodexMessage, mode: 'json' }
    : agent === 'hermes'
      ? { defaultBin: 'hermes', makeArgs: hermesArgs, normalize: normalizeHermesMessage, mode: 'text' }
      : { defaultBin: 'claude', makeArgs: claudeArgs, normalize: normalizeClaudeMessage, mode: 'json' };
  // 会话 key:codex/hermes 各加前缀隔离,避免与同名 claude 会话串号;claude 不加,向后兼容旧档案。
  const sessionProject = agent === 'claude' ? project : `${agent}:${project}`;

  const pushSink = push ? makePushSink(JSON.parse(readFileSync(push, 'utf8'))) : null;
  const sessions = new SessionStore(join(homedir(), '.earpiece', 'sessions.json'));
  // codex:没显式 resumeId 就接"该目录最新落盘会话"——你在终端 TUI 聊的也算,同一个会话
  const effectiveResumeId = resumeId ?? (agent === 'codex' ? latestCodexSessionId(cwd) : null);
  const resume = pickResume({ agent, resumeId: effectiveResumeId, fresh, sessionResume: sessions.get(sessionProject, cwd) });

  const pipeline = new Pipeline({ project, level });
  const monitor = new SilenceMonitor();
  let speaking = false;
  let cliDone = false;

  return new Promise((resolve) => {
    async function drain() {
      if (speaking) return;
      speaking = true;
      for (let item = pipeline.queue.next(); item; item = pipeline.queue.next()) {
        const pushing = pushSink ? pushSink(item) : null; // 推手机与本机播报并行
        await speak(item, { silent });
        if (pushing) await pushing;
        try { onSpoken?.(item); } catch { /* 字幕失败不影响播报 */ }
        monitor.noteSpoken(Date.now());
      }
      speaking = false;
      if (cliDone && pipeline.queue.size === 0) {
        clearInterval(timer);
        resolve(pipeline.state);
      }
    }

    const timer = setInterval(() => {
      for (const e of monitor.tick(Date.now())) pipeline.ingest(e);
      drain();
    }, 1000);

    let args = bin === profile.defaultBin ? profile.makeArgs(prompt, { resume }) : [prompt];
    if (approval && agent === 'claude' && bin === 'claude') {
      const env = { EARPIECE_DAEMON: approval.daemonUrl, EARPIECE_TOKEN: approval.token };
      const mcpServers = {
        approval: { command: process.execPath, args: [approval.mcpPath], env },
      };
      // 提问工具 ask_user(可选):让被派的 Agent 能向用户手机发选择题。普通工具,无需 permission-prompt。
      if (approval.askMcpPath) {
        mcpServers.ask = { command: process.execPath, args: [approval.askMcpPath], env };
      }
      args = [...args, '--permission-prompt-tool', 'mcp__approval__approve', '--mcp-config', JSON.stringify({ mcpServers })];
    }

    log(`▶ [${project}]${agent === 'codex' ? ' agent=codex' : ''} level=${level} cwd=${cwd}${resume ? ` resume=${resume}` : ''}${approval ? ' approval=on' : ''}`);
    driveCli({
      bin,
      args,
      cwd,
      mode: profile.mode,
      // 仅 claude 注入 CLAUDE_CODE_OAUTH_TOKEN;codex/hermes 用各自的认证。
      // approval=on(无头走 approval-mcp)时设 EARPIECE_HOOK_SKIP,叫全局 PreToolUse hook 让路,
      // 否则同一请求会被 MCP 和 hook 各弹一遍。没 MCP 时不设 → 让 hook 也能给无头补批准。
      env: (() => {
        const e = agent === 'claude' && bin === 'claude' ? (loadAuthEnv() || {}) : {};
        if (approval) e.EARPIECE_HOOK_SKIP = '1';
        return Object.keys(e).length ? e : undefined;
      })(),
      onMessage: (msg) => {
        for (const e of profile.normalize(msg)) {
          if (e.type === EVENT.SESSION_STARTED && e.sessionId) {
            sessions.set(sessionProject, cwd, e.sessionId); // 记链头,下次同项目+目录自动续
          }
          monitor.noteEvent(Date.now(), e);
          pipeline.ingest(e);
        }
        drain();
      },
      onExit: (code, stderr = '') => {
        // 会话档案失效(被删/换目录遗留)→ 清掉,下次自动新开
        if (resume && stderr.includes('No conversation found')) {
          sessions.clear(sessionProject, cwd);
          log(`⚠ 会话 ${resume} 已失效,已清除,重说一次即可`);
        }
        cliDone = true;
        log(`◀ CLI 退出 code=${code} 状态=${pipeline.state}`);
        drain();
      },
    });
  });
}
