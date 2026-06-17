// 统一的「工具执行前」批准 hook:Claude Code(PreToolUse)和 Hermes(pre_tool_call)共用。
// 在交互式终端 + 无头都触发,同步阻塞,把权限请求转给手机批准后再放行。
//
// 为什么要它:
//   - Claude:--permission-prompt-tool(approval-mcp)只在无头 -p 生效;终端 TUI 弹窗 daemon 拦不到。
//   - Hermes:exec/-z 文本模式没有 approval 事件;但它的 pre_tool_call shell hook 能 block 工具。
//   两边 stdin 字段同名(tool_name/tool_input/cwd),只是要的「放行/拦截」输出格式不同 → 按
//   hook_event_name 自动分流。
//
// 装法:scripts/install-approval-hook.mjs
//   - Claude → ~/.claude/settings.json 的 hooks.PreToolUse(event 名 "PreToolUse")
//   - Hermes → ~/.hermes/config.yaml 的 hooks.pre_tool_call(event 名 "pre_tool_call")
//
// 复用 daemon 的 /approval/request(挂起→播报+推手机→等 /approval/respond→返回 allow/deny)。
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

let hermes = false; // 由 stdin 的 hook_event_name 决定输出格式

function out(decision, reason) {
  if (hermes) {
    // Hermes:只有 block 才输出决定,放行/ask 一律空对象(= 不拦,继续)
    process.stdout.write(decision === 'deny'
      ? JSON.stringify({ decision: 'block', reason: reason || '手机端已拒绝' })
      : '{}');
  } else {
    // Claude:hookSpecificOutput.permissionDecision = allow|deny|ask
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
        ...(reason ? { permissionDecisionReason: reason } : {}),
      },
    }));
  }
  process.exit(0);
}

// 无头 runTask 已用 approval-mcp 走批准:那条路设了 EARPIECE_HOOK_SKIP=1,hook 直接放手
// (空输出 exit 0 = 回到引擎自己的权限流,由 MCP 接管),避免一条请求弹两遍。
if (process.env.EARPIECE_HOOK_SKIP) process.exit(0);

// 路由开关(默认休眠):只有该机标记「把批准送手机」才拦截路由,否则空输出放手。
// 这样在交互式工作站(你坐键盘前的 Mac)装了也不打扰;headless/远程机(由手机驱动)才开。
// 开 = 文件 ~/.earpiece/approval-to-phone 存在,或 env EARPIECE_APPROVE_PHONE 非空。
const routeOn = process.env.EARPIECE_APPROVE_PHONE
  || existsSync(join(homedir(), '.earpiece', 'approval-to-phone'));
if (!routeOn) process.exit(0);

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let h = {};
try { h = JSON.parse(raw); } catch { process.exit(0); } // 非法输入:不阻塞,回到本地权限流
hermes = h.hook_event_name === 'pre_tool_call';

const daemon = process.env.EARPIECE_DAEMON || 'http://127.0.0.1:7780';
let token = process.env.EARPIECE_TOKEN;
if (!token) {
  try { token = readFileSync(join(homedir(), '.earpiece', 'lan-token'), 'utf8').trim(); } catch { /* 没 token 也试 */ }
}

try {
  const r = await fetch(`${daemon}/approval/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token ?? ''}` },
    body: JSON.stringify({ tool_name: h.tool_name, input: h.tool_input, cwd: h.cwd }),
  });
  const d = await r.json();
  if (d && d.behavior === 'allow') out('allow');
  out('deny', (d && d.message) || '手机端已拒绝');
} catch (e) {
  // 桥断了(daemon 没开/网络问题):不卡死用户。Claude → ask(回到本地确认);
  // Hermes 无 ask 语义 → 空对象放行(它自己的危险命令批准仍会按 config 兜底)。
  out('ask', `批准桥接不可用,回到本地确认: ${e.message}`);
}
