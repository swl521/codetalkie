import { readdirSync, readFileSync, statSync, openSync, readSync, closeSync, existsSync } from 'node:fs';
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

const CWD_RE = /"cwd"\s*:\s*"([^"]+)"/;

// 这些目录永远不算"项目":家目录(demo 兜底在这跑)、临时目录、系统目录
export function isJunkCwd(cwd) {
  const home = homedir();
  return cwd === home
    || cwd === '/tmp' || cwd === '/private/tmp'
    || cwd.startsWith('/private/var/') || cwd.startsWith('/var/')
    || cwd === '/';
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
    // cwd 可能藏得深(实测 18KB 处),读 64KB;最新的可能是纯摘要,最多试 8 个。
    // 目录必须真实存在于本机 —— 同步来的外机项目(NAS/Windows/Linux)是空壳,跑不了,不收。
    for (const { f, m } of sorted.slice(0, 8)) {
      const cwd = CWD_RE.exec(readHead(f, 65536))?.[1];
      if (!cwd || !existsSync(cwd) || isJunkCwd(cwd)) continue;
      if (!out.has(cwd) || out.get(cwd).lastActive < m) out.set(cwd, { lastActive: m, file: f });
      break;
    }
  }
  return [...out].map(([cwd, v]) => ({ cwd, agent: 'claude', base: basename(cwd), lastActive: v.lastActive, file: v.file }));
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
    const cwd = CWD_RE.exec(readHead(p, 8192))?.[1];
    if (cwd && existsSync(cwd) && !isJunkCwd(cwd) && !out.has(cwd)) out.set(cwd, { lastActive: m, file: p });
  }
  return [...out].map(([cwd, v]) => ({ cwd, agent: 'codex', base: basename(cwd), lastActive: v.lastActive, file: v.file }));
}
