import { EVENT } from './events.js';

const TOOL_LABELS = {
  Bash: '跑命令', Edit: '改文件', Write: '写文件', Read: '读文件',
  Grep: '搜代码', Glob: '找文件', WebSearch: '查网页', WebFetch: '查网页',
  Task: '派子任务', TodoWrite: '记待办',
};

// computer use 等 MCP 工具:mcp__<服务>__<动作>。动作词典,缺了念服务名。
const GUI_LABELS = {
  screenshot: '截屏', left_click: '点击', double_click: '双击', right_click: '右键点击',
  triple_click: '三连击', type: '打字', key: '按键', scroll: '滚动',
  open_application: '开应用', left_click_drag: '拖拽', wait: '等待',
  read_clipboard: '读剪贴板', write_clipboard: '写剪贴板', zoom: '放大看',
};

function toolLabel(name) {
  if (TOOL_LABELS[name]) return TOOL_LABELS[name];
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name ?? '');
  if (mcp) return GUI_LABELS[mcp[2]] ?? `用 ${mcp[1]}`;
  return name ? `用 ${name}` : null;
}

export function clip(text, max = 80) {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

function shortPath(p) {
  return p ? p.split('/').slice(-2).join('/') : '某个文件';
}

// 权限请求 → 一句人话(批准播报用):「要跑命令「npm test」,批准吗?」
export function summarizeToolRequest(tool, input = {}) {
  if (tool === 'Bash') return `要跑命令「${clip(input.command ?? '', 40)}」`;
  if (tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit') return `要改文件 ${shortPath(input.file_path)}`;
  if (tool === 'Read') return `要读文件 ${shortPath(input.file_path)}`;
  if (tool === 'WebFetch' || tool === 'WebSearch') return '要上网查东西';
  const label = toolLabel(tool);
  return label ? `要${label}` : `要用 ${tool ?? '某个工具'}`;
}

// 归一事件 → 不带项目名前缀的裸播报句
export function toSpeech(event) {
  switch (event.type) {
    case EVENT.SESSION_STARTED: return '开始干活了';
    case EVENT.PROGRESS_TEXT: return clip(event.text);
    case EVENT.TOOL_STARTED: return `正在${toolLabel(event.tool) ?? '干一步'}`;
    case EVENT.TOOL_FINISHED: {
      const label = toolLabel(event.tool);
      if (!label) return event.ok ? '一步完成' : '有一步失败了';
      return event.ok ? `${label}完成` : `${label}失败了`;
    }
    case EVENT.APPROVAL_NEEDED: return `${event.summary ?? '有个操作'}，等你批准`;
    case EVENT.TASK_FINISHED: return event.text ? `任务完成。${clip(event.text)}` : '任务完成';
    case EVENT.TASK_FAILED: return `任务出错了：${event.text ?? '未知原因'}`;
    case EVENT.TASK_STUCK: return `好像卡住了，${Math.round((event.silentMs ?? 0) / 1000)} 秒没动静`;
    case EVENT.HEARTBEAT: {
      const mins = Math.max(1, Math.round((event.sinceMs ?? 0) / 60000));
      const doing = toolLabel(event.lastTool);
      return doing ? `还在${doing}，已经 ${mins} 分钟了` : `还在跑，已经 ${mins} 分钟了`;
    }
    default: return '';
  }
}
