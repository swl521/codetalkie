#!/usr/bin/env node
// 把批准 hook 装进 ~/.claude/settings.json —— 让「终端里开着的 claude 会话」(agent-hub 窗口)
// 要权限时也弹到手机批准。装一次即可,对所有 claude 会话生效(交互式 + 无头)。
//
// 用法:node scripts/install-approval-hook.mjs        # 安装/更新
//       node scripts/install-approval-hook.mjs --uninstall
//
// 原理:注册 PreToolUse hook,matcher 只匹配会改东西的工具(Bash/Write/Edit/…),
// 命中就跑 agent/tools/approval-hook.mjs → POST 本机 daemon /approval/request → 等手机点。
// 读类工具(Read/Grep/…)不在 matcher 里,不打扰。无头 runTask 自带的 approval-mcp 路径
// 会设 EARPIECE_HOOK_SKIP 让 hook 让路,不会弹两遍。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const MATCHER = 'Bash|Write|Edit|MultiEdit|NotebookEdit|WebFetch';
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const hookPath = join(repoRoot, 'agent', 'tools', 'approval-hook.mjs');
const command = `node "${hookPath}"`;
const settingsPath = join(homedir(), '.claude', 'settings.json');
const uninstall = process.argv.includes('--uninstall');

function load() {
  try { return JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { return {}; }
}
function save(obj) {
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(obj, null, 2) + '\n');
}
// 认得出"是我们这条":hooks 数组里有命令指向 approval-hook.mjs 的条目
const isOurs = (entry) =>
  Array.isArray(entry?.hooks) && entry.hooks.some((h) => typeof h?.command === 'string' && h.command.includes('approval-hook.mjs'));

const settings = load();
settings.hooks = settings.hooks ?? {};
const list = Array.isArray(settings.hooks.PreToolUse) ? settings.hooks.PreToolUse : [];
const cleaned = list.filter((e) => !isOurs(e)); // 先去掉旧的我们这条(幂等/便于更新路径)

function installClaude() {
  cleaned.push({ matcher: MATCHER, hooks: [{ type: 'command', command }] });
  settings.hooks.PreToolUse = cleaned;
  save(settings);
  console.log(`✓ Claude 批准 hook 已装到 ${settingsPath}`);
  console.log(`  匹配工具: ${MATCHER}`);
  console.log(`  hook 脚本: ${hookPath}`);
  console.log('  现有终端里开着的 claude 需要重开一次才会加载新设置。');
  if (!existsSync(hookPath)) console.log('  ⚠ 没找到 hook 脚本,确认仓库完整。');
  // 路由开关:hook 默认休眠,只有标记存在才把批准送手机(避免在工作站打扰你本地操作)
  const marker = join(homedir(), '.earpiece', 'approval-to-phone');
  console.log(existsSync(marker)
    ? `  批准送手机:已开(标记 ${marker})`
    : `  批准送手机:休眠(要开:touch ${marker};headless/远程机 install-daemon 会自动开)`);
}
function uninstallClaude() {
  settings.hooks.PreToolUse = cleaned;
  if (cleaned.length === 0) delete settings.hooks.PreToolUse;
  save(settings);
  console.log('✓ 已卸载 Claude 批准 hook(终端会话恢复本地权限弹窗)');
}

// ── Hermes:~/.hermes/config.yaml 的 hooks.pre_tool_call(shell hook;文本编辑,保守) ──
// hermes 的 pre_tool_call hook 同样能 block 工具(stdout {"decision":"block"}),approval-hook.mjs
// 已按 hook_event_name 自动出 hermes 格式。matcher 只盖危险/改动类工具,读类不打扰。
const HERMES_MATCHER = 'terminal|code_execution|shell|bash|run_command|exec|write_file|edit_file|patch|apply_patch|str_replace|create_file|delete_file|remove_file|move_file';
const hermesCfg = join(homedir(), '.hermes', 'config.yaml');
const hermesBlock = `hooks:\n  pre_tool_call:\n    - matcher: "${HERMES_MATCHER}"\n      command: 'node "${hookPath}"'\n      timeout: 300`;
function hermes() {
  if (!existsSync(hermesCfg)) return; // 这台没装 hermes
  let txt;
  try { txt = readFileSync(hermesCfg, 'utf8'); } catch { return; }
  const has = txt.includes('approval-hook.mjs');
  if (uninstall) {
    console.log(has
      ? '  ⚠ Hermes:请手动从 ~/.hermes/config.yaml 的 hooks.pre_tool_call 删掉指向 approval-hook.mjs 的条目'
      : '  Hermes:未发现我们的 hook,跳过');
    return;
  }
  if (has) { console.log('  ✓ Hermes hook 已在 config.yaml(跳过)'); return; }
  if (/^hooks:[ \t]*\{\}[ \t]*$/m.test(txt)) {
    writeFileSync(hermesCfg, txt.replace(/^hooks:[ \t]*\{\}[ \t]*$/m, hermesBlock));
    console.log(`  ✓ Hermes 批准 hook 已写入 ${hermesCfg}`);
    console.log('    自检:hermes hooks doctor;新 hermes 会话生效。');
  } else {
    console.log('  ⚠ Hermes config.yaml 已有 hooks 配置,未自动改动。把下面这段并进 hooks: 里:');
    console.log(hermesBlock.split('\n').map((l) => '      ' + l).join('\n'));
  }
}

if (uninstall) { uninstallClaude(); hermes(); process.exit(0); }
installClaude();
hermes();
