import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractTail } from '../src/transcriptTail.js';

function tmpFile(lines) {
  const f = join(mkdtempSync(join(tmpdir(), 'earpiece-')), 's.jsonl');
  writeFileSync(f, lines.map((o) => JSON.stringify(o)).join('\n') + '\n');
  return f;
}

test('Claude 格式:抽人话,跳过工具结果和系统注入', () => {
  const f = tmpFile([
    { type: 'summary', summary: 'x' },
    { type: 'user', message: { role: 'user', content: '帮我跑测试' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: '好,先看测试文件。' }, { type: 'tool_use', id: 't', name: 'Read', input: {} }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't', content: 'xxx' }] } },
    { type: 'user', message: { content: '<system-reminder>注入的</system-reminder>' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: '测试全过了。' }] } },
  ]);
  assert.deepEqual(extractTail(f), [
    { role: 'user', text: '帮我跑测试' },
    { role: 'assistant', text: '好,先看测试文件。' },
    { role: 'assistant', text: '测试全过了。' },
  ]);
});

test('Codex rollout 格式 + limit 截断 + 长文截短', () => {
  const f = tmpFile([
    { type: 'session_meta', payload: { cwd: '/x' } },
    { type: 'response_item', payload: { role: 'user', content: [{ type: 'input_text', text: '修一下登录' }] } },
    { type: 'response_item', payload: { role: 'assistant', content: [{ type: 'output_text', text: '改'.repeat(3000) }] } },
    { type: 'response_item', payload: { role: 'assistant', content: [{ type: 'output_text', text: '修好了' }] } },
  ]);
  const out = extractTail(f, 2);
  assert.equal(out.length, 2);
  assert.equal(out[0].role, 'assistant');
  assert.equal(out[0].text.length, 2000); // 每行上限 2000(0cb38c3:长消息在手机显示全),超出截短并补 …
  assert.ok(out[0].text.endsWith('…'));
  assert.deepEqual(out[1], { role: 'assistant', text: '修好了' });
});
