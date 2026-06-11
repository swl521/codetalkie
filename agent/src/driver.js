import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// 启动 CLI 进程,逐行 JSON.parse 回调;解析失败的行静默跳过。
export function driveCli({ bin, args, cwd, env, onMessage, onExit }) {
  const child = spawn(bin, args, {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    try { onMessage(JSON.parse(line)); } catch { /* 非 JSON 行忽略 */ }
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d;
    process.stderr.write(d); // 照常透传到控制台
  });
  child.on('exit', (code) => onExit?.(code ?? 1, stderr));
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
