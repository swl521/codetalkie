import { openSync, readSync, closeSync, statSync } from 'node:fs';

// 从 CLI 会话档案尾部抽"最近聊了什么":点进项目立刻知道上次干到哪。
// 只取人话(用户说的 + 助手说的文字),工具调用/系统注入一律跳过。

function readTailBytes(file, bytes = 524288) {
  try {
    const size = statSync(file).size;
    const start = Math.max(0, size - bytes);
    const fd = openSync(file, 'r');
    const buf = Buffer.alloc(size - start);
    const n = readSync(fd, buf, 0, buf.length, start);
    closeSync(fd);
    return buf.toString('utf8', 0, n);
  } catch { return ''; }
}

function textOfContent(content) {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .filter((b) => (b.type === 'text' || b.type === 'input_text' || b.type === 'output_text') && b.text)
      .map((b) => b.text).join(' ').trim();
  }
  return '';
}

function looksLikeNoise(text) {
  return !text
    || text.startsWith('<')
    || text.startsWith('Caveat:')
    || text.startsWith('[Request interrupted')
    || text.startsWith('This session is being continued')
    || text.startsWith('No response requested')
    || text.length < 2;
}

// 返回 [{role:'user'|'assistant', text}],最多 limit 条
export function extractTail(file, limit = 10) {
  const raw = readTailBytes(file);
  const lines = raw.split('\n');
  lines.shift(); // 第一行可能被截断,丢掉
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    // Claude Code 格式:{type:'user'|'assistant', message:{role, content}}
    let role = null;
    let content = null;
    if ((obj.type === 'user' || obj.type === 'assistant') && obj.message) {
      role = obj.type;
      content = obj.message.content;
    } else if (obj.type === 'response_item' && obj.payload?.role && obj.payload?.content) {
      // Codex rollout 格式:{type:'response_item', payload:{role, content}}
      role = obj.payload.role === 'assistant' ? 'assistant' : 'user';
      content = obj.payload.content;
    } else {
      continue;
    }

    const text = textOfContent(content);
    if (looksLikeNoise(text)) continue;
    out.push({ role, text: text.length > 2000 ? text.slice(0, 1999) + '…' : text });
  }
  return out.slice(-limit);
}
