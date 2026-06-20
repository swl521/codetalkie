import { EVENT } from './events.js';

// 一行 stream-json(已 JSON.parse)→ 0..n 个内部事件。认不出的行一律返回 []。
export function normalizeClaudeMessage(msg) {
  switch (msg?.type) {
    case 'system':
      return msg.subtype === 'init'
        ? [{ type: EVENT.SESSION_STARTED, sessionId: msg.session_id }]
        : [];

    case 'assistant': {
      const out = [];
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text') {
          const text = block.text?.trim();
          if (text) out.push({ type: EVENT.PROGRESS_TEXT, text });
        } else if (block.type === 'tool_use') {
          out.push({ type: EVENT.TOOL_STARTED, id: block.id, tool: block.name });
        }
      }
      return out;
    }

    case 'user': {
      const out = [];
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'tool_result') {
          out.push({ type: EVENT.TOOL_FINISHED, id: block.tool_use_id, ok: block.is_error !== true });
        }
      }
      return out;
    }

    case 'result': {
      if (msg.subtype !== 'success') return [{ type: EVENT.TASK_FAILED, text: msg.subtype ?? 'unknown' }];
      const ev = { type: EVENT.TASK_FINISHED, text: typeof msg.result === 'string' ? msg.result : '' };
      if (msg.usage) ev.tokens = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);
      return [ev];
    }

    default:
      return [];
  }
}
