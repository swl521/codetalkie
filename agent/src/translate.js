import { EVENT } from './events.js';
import { t, toolWord, guiWord } from './i18n.js';

// 所有人话词典都在 agent/lang/<语言>.json —— 放新语言文件进去即可换语言(见 docs/I18N.md)。

function toolLabel(name) {
  const word = toolWord(name);
  if (word) return word;
  // computer use 等 MCP 工具:mcp__<服务>__<动作>。动作词典缺了念服务名。
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name ?? '');
  if (mcp) return guiWord(mcp[2]) ?? t('useTool', { name: mcp[1] });
  return name ? t('useTool', { name }) : null;
}

export function clip(text, max = 80) {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

function shortPath(p) {
  return p ? p.split('/').slice(-2).join('/') : t('someFile');
}

// 权限请求 → 一句人话(批准播报用):「要跑命令「npm test」,批准吗?」
export function summarizeToolRequest(tool, input = {}) {
  if (tool === 'Bash') return t('askBash', { cmd: clip(input.command ?? '', 40) });
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return t('askEditFile', { path: shortPath(input.file_path) });
  if (tool === 'Read') return t('askReadFile', { path: shortPath(input.file_path) });
  if (tool === 'WebFetch' || tool === 'WebSearch') return t('askWeb');
  const label = toolLabel(tool);
  return label ? t('askLabeled', { label }) : t('askUnknown', { tool: tool ?? t('someTool') });
}

// 归一事件 → 不带项目名前缀的裸播报句
export function toSpeech(event) {
  switch (event.type) {
    case EVENT.SESSION_STARTED: return ''; // 不播"开始干活了";开工提示改由 daemon 收到指令时回显任务
    case EVENT.PROGRESS_TEXT: return clip(event.text);
    case EVENT.TOOL_STARTED: return t('toolStarted', { label: toolLabel(event.tool) ?? t('stepGeneric') });
    case EVENT.TOOL_FINISHED: {
      const label = toolLabel(event.tool);
      if (!label) return event.ok ? t('stepDone') : t('stepFailed');
      return event.ok ? t('toolDone', { label }) : t('toolFailed', { label });
    }
    case EVENT.APPROVAL_NEEDED: return t('approvalNeeded', { summary: event.summary ?? t('someOperation') });
    case EVENT.TASK_FINISHED: return event.text ? t('taskDoneWith', { text: clip(event.text) }) : t('taskDone');
    case EVENT.TASK_FAILED: return t('taskFailed', { reason: event.text ?? t('unknownReason') });
    case EVENT.TASK_STUCK: return t('stuck', { sec: Math.round((event.silentMs ?? 0) / 1000) });
    case EVENT.HEARTBEAT: {
      const mins = Math.max(1, Math.round((event.sinceMs ?? 0) / 60000));
      const doing = toolLabel(event.lastTool);
      return doing ? t('heartbeatDoing', { label: doing, min: mins }) : t('heartbeatGeneric', { min: mins });
    }
    default: return '';
  }
}
