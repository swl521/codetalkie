import { spawn, execSync } from 'node:child_process';
import { createInterface } from 'node:readline';

// Windows 上 npm 装的 CLI 是 claude.cmd / codex.cmd,Node spawn 不带 shell 找不到。
// 用 where 解析一次真实路径并缓存(.cmd 必须经 cmd.exe 跑,用 shell:true 处理)。
const binCache = new Map();
export function resolveBin(bin) {
  if (process.platform !== 'win32') return { bin, shell: false };
  if (!binCache.has(bin)) {
    let resolved = bin;
    try {
      const lines = execSync(`where ${bin}`, { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
      // 优先可执行扩展名;无扩展名的那行是 *nix shell 脚本,Windows 上 spawn 跑不了
      resolved = lines.find((l) => /\.exe$/i.test(l))
        ?? lines.find((l) => /\.cmd$/i.test(l))
        ?? lines.find((l) => /\.bat$/i.test(l))
        ?? lines[0] ?? bin;
    } catch { /* 找不到就原样,让 spawn 报错 */ }
    binCache.set(bin, resolved);
  }
  const resolved = binCache.get(bin);
  return { bin: resolved, shell: resolved.endsWith('.cmd') || resolved.endsWith('.bat') };
}

// 启动 CLI 进程。mode='json':逐行 JSON.parse 回调(claude/codex);
// mode='text':纯文本引擎(hermes),整段 stdout 捞下来,退出时把全文塞进 onMessage 一次。
export function driveCli({ bin, args, cwd, env, mode = 'json', onMessage, onExit }) {
  const r = resolveBin(bin);
  // shell:true(Windows .cmd)下 Node 不自动加引号,含空格的 prompt 会被拆成多参 → 手动引用
  const finalArgs = r.shell
    ? args.map((a) => (/[\s"]/.test(a) ? `"${String(a).replace(/"/g, '\\"')}"` : a))
    : args;
  const child = spawn(r.bin, finalArgs, {
    cwd,
    shell: r.shell,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let textBuf = '';
  if (mode === 'text') {
    child.stdout.on('data', (d) => { textBuf += d; });
  } else {
    const rl = createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try { onMessage(JSON.parse(line)); } catch { /* 非 JSON 行忽略 */ }
    });
  }

  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d;
    process.stderr.write(d); // 照常透传到控制台
  });
  child.on('exit', (code) => {
    if (mode === 'text') onMessage({ __text: textBuf.trim() }); // 全文一次性交给归一器
    onExit?.(code ?? 1, stderr);
  });
  return child;
}

export function claudeArgs(prompt, { resume } = {}) {
  return [
    '-p', prompt,
    '--output-format', 'stream-json', '--verbose',
    ...(resume ? ['--resume', resume] : []),
  ];
}

// codex exec 的参数。resume 是子命令形态:exec resume <id> --json <prompt>
// (codex-cli 0.139.0 实测确认,resume 后 thread.started 返回同一 thread_id)。
// 沙箱可写(干活需要)+ 跳过 git 检查(demo 项目在家目录,非 git)。
const CODEX_FLAGS = ['--json', '--sandbox', 'workspace-write', '--skip-git-repo-check'];
export function codexArgs(prompt, { resume } = {}) {
  return resume
    ? ['exec', 'resume', resume, ...CODEX_FLAGS, prompt]
    : ['exec', ...CODEX_FLAGS, prompt];
}

// hermes 无头:hermes -z "<指令>" [--resume <会话>]。纯文本输出(text 模式驱动)。
// 没传 resume 时用 --continue 续上"主会话",保持上下文(先固定主会话跑通)。
export function hermesArgs(prompt, { resume } = {}) {
  return resume
    ? ['-z', prompt, '--resume', resume]
    : ['-z', prompt, '--continue'];
}
