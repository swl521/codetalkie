import { EVENT } from './events.js';

// codex exec --json 的一行 → 内部事件。事件形状对应 openai/codex sdk 的
// thread.*/turn.*/item.* 模型。item.updated 非终态,只认 item.completed。
// 注意:exec 模式没有 approval 事件(越权直接失败),批准要走 app-server,二期。

const TOOL_OF_ITEM = {
  command_execution: 'Bash',
  file_change: 'Edit',
  mcp_tool_call: 'MCP',
  web_search: 'WebSearch',
};

export function normalizeCodexMessage(msg) {
  switch (msg?.type) {
    case 'thread.started':
      return [{ type: EVENT.SESSION_STARTED, sessionId: msg.thread_id }];

    case 'item.started': {
      const tool = TOOL_OF_ITEM[msg.item?.type];
      return tool ? [{ type: EVENT.TOOL_STARTED, id: msg.item.id, tool }] : [];
    }

    case 'item.completed': {
      const item = msg.item ?? {};
      if (item.type === 'agent_message' && item.text?.trim()) {
        return [{ type: EVENT.PROGRESS_TEXT, text: item.text.trim() }];
      }
      const tool = TOOL_OF_ITEM[item.type];
      if (tool) {
        return [{ type: EVENT.TOOL_FINISHED, id: item.id, tool, ok: item.status !== 'failed' }];
      }
      return [];
    }

    case 'turn.completed':
      return [{ type: EVENT.TASK_FINISHED, text: '' }];

    case 'turn.failed':
      return [{ type: EVENT.TASK_FAILED, text: msg.error?.message ?? 'unknown' }];

    case 'error':
      return [{ type: EVENT.TASK_FAILED, text: msg.message ?? 'unknown' }];

    default:
      return [];
  }
}
