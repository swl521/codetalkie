import { readdirSync, readFileSync, statSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

// 只读取,不创建:扫描电脑上 Claude / Codex 已有的项目(会话档案里带工作目录)。

function readHead(file, bytes = 4096) {
  try {
    const fd = openSync(file, 'r');
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    closeSync(fd);
    return buf.toString('utf8', 0, n);
  } catch { return ''; }
}

const CWD_RE = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/;

// 从原始文本正则抓到的是 JSON 转义后的字面量(Windows 路径 C:\\Users 带双反斜杠)。
// 反转义回真实路径,否则 Windows 上 isJunkCwd/existsSync 全失准。
function decodeCwd(raw) {
  if (raw == null) return raw;
  try { return JSON.parse(`"${raw}"`); } catch { return raw; }
}

// 这些目录永远不算"项目":家目录(demo 兜底在这跑)、临时目录、系统/盘根目录
export function isJunkCwd(cwd) {
  const home = homedir();
  const norm = (p) => (process.platform === 'win32' ? p.toLowerCase().replace(/\//g, '\\') : p);
  const c = norm(cwd);
  return c === norm(home)
    || cwd === '/tmp' || cwd === '/private/tmp'
    || cwd.startsWith('/private/var/') || cwd.startsWith('/var/')
    || cwd === '/'
    || /^[a-z]:\\?$/i.test(cwd)                       // 盘根 C:\
    || /^[a-z]:\\(windows|temp)\\?/i.test(cwd)        // 系统/临时
    || c.includes(norm('\\AppData\\Local\\Temp'));
}

// Claude Code:~/.claude/projects/<转义路径>/ 里躺着各会话 jsonl,首段含 cwd
export function scanClaude(root = join(homedir(), '.claude', 'projects')) {
  const out = new Map(); // cwd → lastActive
  let dirs = [];
  try { dirs = readdirSync(root); } catch { return []; }
  for (const d of dirs) {
    const dir = join(root, d);
    let files = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    const sorted = files
      .map((f) => { try { return { f: join(dir, f), m: statSync(join(dir, f)).mtimeMs }; } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => b.m - a.m);
    // 同一目录下所有转写都是同一个项目(同 cwd)。所以:cwd 从"任意有它的文件"认(最新的
    // 可能是压缩后的纯摘要、开头没 cwd,往下找),但历史永远读"最新那个文件"的尾巴——否则压缩/
    // 续过的会话会卡读旧文件、停更。cwd 可能藏到 18KB 深,读 64KB;最多试 8 个。
    let cwd = null;
    for (const { f } of sorted.slice(0, 8)) {
      const c = decodeCwd(CWD_RE.exec(readHead(f, 65536))?.[1]);
      if (c) { cwd = c; break; }
    }
    if (!cwd || !existsSync(cwd) || isJunkCwd(cwd)) continue;
    const newest = sorted[0]; // 活跃会话:永远跟最新档案走
    if (!out.has(cwd) || out.get(cwd).lastActive < newest.m) out.set(cwd, { lastActive: newest.m, file: newest.f });
  }
  // sessionId = 最新档案文件名去掉 .jsonl(Claude 的会话 UUID);供手机详情页显示。
  return [...out].map(([cwd, v]) => ({
    cwd, agent: 'claude', base: basename(cwd), lastActive: v.lastActive, file: v.file,
    sessionId: basename(v.file).replace(/\.jsonl$/i, '') || null,
  }));
}

// Codex:~/.codex/sessions/<年>/<月>/<日>/rollout-*.jsonl,首行 session_meta 含 cwd
export function scanCodex(root = join(homedir(), '.codex', 'sessions'), maxFiles = 80) {
  const files = [];
  const walk = (dir, depth) => {
    let names = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      const p = join(dir, n);
      try {
        const st = statSync(p);
        if (st.isDirectory() && depth < 4) walk(p, depth + 1);
        else if (n.startsWith('rollout-') && n.endsWith('.jsonl')) files.push({ p, m: st.mtimeMs });
      } catch { /* 跳过 */ }
    }
  };
  walk(root, 0);
  files.sort((a, b) => b.m - a.m);
  const out = new Map();
  for (const { p, m } of files.slice(0, maxFiles)) {
    const cwd = decodeCwd(CWD_RE.exec(readHead(p, 8192))?.[1]);
    if (cwd && existsSync(cwd) && !isJunkCwd(cwd) && !out.has(cwd)) out.set(cwd, { lastActive: m, file: p });
  }
  return [...out].map(([cwd, v]) => ({
    cwd, agent: 'codex', base: basename(cwd), lastActive: v.lastActive, file: v.file,
    sessionId: codexSessionIdFromFile(v.file),
  }));
}

// rollout 文件名尾部的 uuid 就是 codex session id(与首行 session_meta.payload.id 一致,实测)。
const CODEX_ID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
export function codexSessionIdFromFile(file) {
  return CODEX_ID_RE.exec(file ?? '')?.[1] ?? null;
}

// agent-hub 活终端窗口:正开着的 CLI 会话(注册在 ~/.claude/agent-hub/registry.json)。
// 这些是"实时线程",和磁盘扫出来的项目合并后上报,手机才看得到正开着的窗口(带 PID/状态)。
export function scanHubWindows(registryPath = join(homedir(), '.claude', 'agent-hub', 'registry.json')) {
  let reg;
  try { reg = JSON.parse(readFileSync(registryPath, 'utf8')); } catch { return []; }
  const out = [];
  for (const [, s] of Object.entries(reg.sessions ?? {})) {
    if (!s || !s.cwd || !s.pid) continue;
    try { process.kill(s.pid, 0); } catch { continue; } // 死进程残留跳过
    if (isJunkCwd(s.cwd)) continue;
    out.push({
      cwd: s.cwd, agent: s.agent || 'claude', base: basename(s.cwd),
      lastActive: typeof s.lastActive === 'number' ? s.lastActive : Date.now(),
      sessionId: s.sessionId || null, pid: s.pid, status: s.status || 'idle', live: true,
    });
  }
  return out;
}

// 该目录最新一条 codex 会话(终端 TUI 聊的和手机无头跑的都落盘在同一处)——
// 手机指令 resume 它,就和你在终端聊的是同一个会话。
export function latestCodexSessionId(cwd, root) {
  const hit = scanCodex(root).find((e) => e.cwd === cwd);
  return hit ? codexSessionIdFromFile(hit.file) : null;
}

// Hermes:没有项目目录,单位是会话。每个会话 = 一个只读项目(摆出来,不主动发消息)。
// 会话句柄用 `hermes sessions list` 输出里每行最后一个 token(ID),不是文件名(对不上)。
const HERMES_ID_RE = /(\d{8}_\d{6}_\w+|cron_\S+)\s*$/;
// 我们自己跑出来的测试会话(preview 片段),摆出来没意义,过滤掉
const HERMES_TEST_HINTS = ['只回复 ok', 'delivery-test', '讲个冷笑话', '用一句话说你是谁', 'Agnes AI is working'];

// 名字裁到 ~16 字(中英混排按字符数算够用了)
function clipName(s, max = 16) {
  const t = s.trim();
  return t.length > max ? t.slice(0, max) : t;
}

// 纯解析:喂 `hermes sessions list` 的原始文本 → [{name, sessionId, lastActive, agent, cwd, base}]
// 跳过表头/分隔线、cron_ 定时任务、我们的测试会话;最多保留最近 12 条。
export function parseHermesSessions(listOutput, cwd = join(homedir(), '.hermes')) {
  const out = [];
  for (const line of String(listOutput).split('\n')) {
    if (!line.trim()) continue;
    const m = HERMES_ID_RE.exec(line);
    if (!m) continue;                       // 表头/分隔线/无 ID 行
    const sessionId = m[1];
    if (sessionId.startsWith('cron_')) continue; // 定时任务,不摆
    // ID 之前的整段是 Title / Preview / Last Active 三列(都是多空格分隔)
    const head = line.slice(0, m.index).replace(/\s+$/, '');
    const cols = head.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    // cols = [Title?, Preview?, LastActive?];Title 为 "—" 时退到 Preview
    const title = cols[0] && cols[0] !== '—' ? cols[0] : '';
    const preview = cols[1] ?? '';
    const lastActive = cols[cols.length - 1] ?? '';
    if (HERMES_TEST_HINTS.some((h) => preview.includes(h) || title.includes(h))) continue;
    const name = clipName(title || preview || sessionId.slice(-6));
    out.push({ name, sessionId, lastActive, agent: 'hermes', cwd, base: name });
    if (out.length >= 12) break;
  }
  return out;
}

// 仅当 ~/.hermes 存在时跑 `hermes sessions list`(daemon PATH 已注入 ~/.local/bin)。
// 拿不到(没装/报错)就返回空,绝不抛。
export function scanHermesSessions(home = homedir()) {
  if (!existsSync(join(home, '.hermes'))) return [];
  try {
    const txt = execSync('hermes sessions list --limit 30', { encoding: 'utf8', timeout: 15000 });
    return parseHermesSessions(txt, join(home, '.hermes'));
  } catch { return []; }
}

// content 取纯文字:字符串直接用;数组取 text 块拼起来(防 assistant 结构化内容)。
function hermesText(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join(' ').trim();
  }
  return '';
}

// 纯解析:喂 `hermes sessions export --session-id <ID> -` 的单个 JSON 对象 →
// { sig, lines:[{role:'user'|'assistant', text}] }。只留人话(跳 tool/空文字),截 200 字,取最近 limit 条。
// sig = message_count:ended_at,用于变更检测(没变就不重推 relay)。
export function parseHermesHistory(exportObj, limit = 10) {
  const obj = exportObj || {};
  const msgs = Array.isArray(obj.messages) ? obj.messages : [];
  const lines = [];
  for (const m of msgs) {
    if (m.role !== 'user' && m.role !== 'assistant') continue; // tool/system 跳过
    const text = hermesText(m.content);
    if (!text || text.length < 2 || text.startsWith('<')) continue;
    lines.push({ role: m.role, text: text.length > 200 ? text.slice(0, 199) + '…' : text });
  }
  const last = msgs[msgs.length - 1];
  const sig = `${obj.message_count ?? msgs.length}:${obj.ended_at ?? last?.timestamp ?? ''}`;
  return { sig, lines: lines.slice(-limit) };
}

// 导出单条会话(execSync,出错返回 null 不抛)。daemon 历史回填用。
export function exportHermesSession(sessionId, home = homedir()) {
  if (!sessionId || !existsSync(join(home, '.hermes'))) return null;
  try {
    const txt = execSync(`hermes sessions export --session-id ${sessionId} -`, {
      encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024,
    });
    return JSON.parse(txt.trim().split('\n').pop()); // 单对象,取最后一行防杂质
  } catch { return null; }
}
