// 用法: node agent/src/main.js --project wiki --cwd ~/program/wiki --level 3 "跑一下测试"
// 同一项目第二次调用会自动 --resume 上次会话(持续对话);--fresh 强制新会话。
// --push apns.json 同时推送 iPhone;--silent 不出声只打印。
import { runTask } from './runTask.js';

function parseArgs(argv) {
  // bin 不在这里设默认:runTask 按 agent 决定(claude/codex),--bin 显式传才覆盖
  const opts = { level: 3, project: 'task', cwd: process.cwd(), silent: false };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') opts.project = argv[++i];
    else if (a === '--cwd') opts.cwd = argv[++i];
    else if (a === '--level') opts.level = Number(argv[++i]);
    else if (a === '--silent') opts.silent = true;
    else if (a === '--fresh') opts.fresh = true; // 不 resume,强制新会话
    else if (a === '--push') opts.push = argv[++i]; // APNs 配置 json,播报同时推手机
    else if (a === '--agent') opts.agent = argv[++i]; // claude(默认)| codex
    else if (a === '--bin') opts.bin = argv[++i]; // 测试/回放用:换掉 CLI 本体
    else rest.push(a);
  }
  opts.prompt = rest.join(' ');
  return opts;
}

const opts = parseArgs(process.argv);
if (!opts.prompt) {
  console.error('用法: node agent/src/main.js --project <名字> [--cwd 目录] [--level 1-5] [--silent] [--push apns.json] "指令"');
  process.exit(1);
}

await runTask(opts);
