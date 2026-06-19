import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readRegistry, listSessions, HUB_DIR, REGISTRY_FILE } from './registry.js';
import { mintId, buildSendBody, normalizeResult } from './protocol.js';
import { postSend, pollResponse, readResponse, RESPONSES_DIR } from './transport.js';
import { readLeader, writeLeader } from './leader.js';

// 极简 arg 解析:第一个非 -- 的是 cmd,其余非 -- 的是 positionals;--k v 进 flags,--k(后接 -- 或结尾)= true。
export function parseArgs(argv) {
  const flags = {}; const positionals = []; let cmd;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const key = t.slice(2);
      const nxt = argv[i + 1];
      if (nxt === undefined || nxt.startsWith('--')) { flags[key] = true; }
      else { flags[key] = nxt; i++; }
    } else if (cmd === undefined) { cmd = t; }
    else { positionals.push(t); }
  }
  return { cmd, positionals, flags };
}

function portOf(target) {
  const s = listSessions(readRegistry()).find((x) => x.name === target);
  if (!s) throw new Error(`目标会话不在线: ${target}`);
  return s.port;
}

// 主分发。返回字符串(打印给 stdout)。
export async function run(argv, { now = () => new Date().toISOString() } = {}) {
  const { cmd, positionals, flags } = parseArgs(argv);
  switch (cmd) {
    case 'list': {
      const sessions = listSessions(readRegistry(), { cap: flags.caps });
      return sessions.map((s) => `${s.name}\t${s.engine || '?'}\t${s.status || '?'}\t${s.port}\t${s.cwd || ''}`).join('\n') || '(无在线会话)';
    }
    case 'send': {
      const [target, command] = positionals;
      const msgId = mintId();
      // 始终非阻塞发送(不让 server long-poll),由客户端 pollResponse 统一等 —— 对 Claude/Codex worker 都一致
      const body = buildSendBody({ command, msgId, jobId: flags.job, from: flags.from });
      await postSend(portOf(target), body);
      if (!flags.wait) return msgId;
      const r = await pollResponse(msgId, { timeoutMs: (Number(flags.timeout) || 180) * 1000 });
      if (r.status === 'timeout') return JSON.stringify({ status: 'timeout', msg_id: msgId });
      return JSON.stringify({ ...r.response, result: normalizeResult(r.response.result) });
    }
    case 'poll': {
      const [msgId] = positionals;
      if (flags.wait) {
        const r = await pollResponse(msgId, { timeoutMs: (Number(flags.timeout) || 180) * 1000 });
        if (r.status === 'timeout') return JSON.stringify({ status: 'timeout', msg_id: msgId });
        return JSON.stringify({ ...r.response, result: normalizeResult(r.response.result) });
      }
      const resp = readResponse(msgId);
      return resp
        ? JSON.stringify({ ...resp, result: normalizeResult(resp.result) })
        : JSON.stringify({ status: 'pending', msg_id: msgId });
    }
    case 'reply': {
      const [msgId, json] = positionals;
      let result; try { result = JSON.parse(json); } catch { result = json; }
      const resp = { msg_id: msgId, session: flags.from || 'unknown', result, timestamp: now() };
      mkdirSync(RESPONSES_DIR, { recursive: true });
      writeFileSync(join(RESPONSES_DIR, `${msgId}.json`), JSON.stringify(resp, null, 2));
      return `已回复 ${msgId}`;
    }
    case 'register': {
      // 给没有自动注册的引擎(Codex)用。端口由环境变量 HUB_PORT 提供。
      const port = Number(process.env.HUB_PORT);
      if (!port) throw new Error('register 需要 HUB_PORT 环境变量(worker 守护监听的端口)');
      mkdirSync(HUB_DIR, { recursive: true });
      let reg; try { reg = JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8')); } catch { reg = { sessions: {} }; }
      const name = flags.name || `${flags.engine || 'worker'}-${process.pid}`;
      reg.sessions[name] = {
        port, pid: Number(flags.pid) || process.pid, sessionId: randomUUID().slice(0, 8),
        cwd: process.cwd(), started: now(), status: 'idle', lastSeen: now(),
        engine: flags.engine || 'codex', caps: flags.caps ? String(flags.caps).split(',') : undefined,
      };
      writeFileSync(REGISTRY_FILE, JSON.stringify(reg, null, 2));
      return `已注册 ${name}`;
    }
    case 'leader': {
      const [sub, value] = positionals;
      if (sub === 'set') return JSON.stringify(writeLeader({ leader: value, engine: flags.engine || value }, undefined, now));
      return JSON.stringify(readLeader() || { leader: null });
    }
    case 'escalate': {
      const [jobId, question] = positionals;
      const dir = join(HUB_DIR, 'decisions');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${jobId}.json`), JSON.stringify({ job_id: jobId, question, asked: now(), decision: null }, null, 2));
      return `已升级 ${jobId}(等手机回 decisions/${jobId}.json)`;
    }
    default:
      return 'hub <list|send|poll|reply|register|leader|escalate> ...';
  }
}
