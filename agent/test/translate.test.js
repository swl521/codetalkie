import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../src/events.js';
import { toSpeech, clip } from '../src/translate.js';

test('progress.text 用原话,超 80 字截断加省略号', () => {
  assert.equal(toSpeech({ type: EVENT.PROGRESS_TEXT, text: '测试都过了' }), '测试都过了');
  const long = '字'.repeat(100);
  const out = toSpeech({ type: EVENT.PROGRESS_TEXT, text: long });
  assert.equal(out.length, 80);
  assert.ok(out.endsWith('…'));
  assert.equal(clip('短句'), '短句');
});

test('工具模板:已知工具有中文动词,未知工具兜底', () => {
  assert.equal(toSpeech({ type: EVENT.TOOL_STARTED, tool: 'Bash' }), '正在跑命令');
  assert.equal(toSpeech({ type: EVENT.TOOL_STARTED, tool: 'Edit' }), '正在改文件');
  assert.equal(toSpeech({ type: EVENT.TOOL_STARTED, tool: 'FooBar' }), '正在用 FooBar');
  assert.equal(toSpeech({ type: EVENT.TOOL_FINISHED, tool: 'Bash', ok: true }), '跑命令完成');
  assert.equal(toSpeech({ type: EVENT.TOOL_FINISHED, tool: 'Bash', ok: false }), '跑命令失败了');
  assert.equal(toSpeech({ type: EVENT.TOOL_FINISHED, ok: false }), '有一步失败了');
});

test('computer use / MCP 工具有人话动词', () => {
  assert.equal(toSpeech({ type: EVENT.TOOL_STARTED, tool: 'mcp__computer-use__screenshot' }), '正在截屏');
  assert.equal(toSpeech({ type: EVENT.TOOL_STARTED, tool: 'mcp__computer-use__left_click' }), '正在点击');
  assert.equal(toSpeech({ type: EVENT.TOOL_STARTED, tool: 'mcp__computer-use__type' }), '正在打字');
  assert.equal(toSpeech({ type: EVENT.TOOL_STARTED, tool: 'mcp__computer-use__open_application' }), '正在开应用');
  assert.equal(toSpeech({ type: EVENT.TOOL_FINISHED, tool: 'mcp__computer-use__left_click', ok: true }), '点击完成');
  // 未知 MCP 工具兜底:念服务名
  assert.equal(toSpeech({ type: EVENT.TOOL_STARTED, tool: 'mcp__weather__forecast' }), '正在用 weather');
});

test('底线模板', () => {
  assert.equal(toSpeech({ type: EVENT.SESSION_STARTED }), '开始干活了');
  assert.equal(toSpeech({ type: EVENT.APPROVAL_NEEDED, summary: '要删 config.json' }), '要删 config.json，等你批准');
  assert.equal(toSpeech({ type: EVENT.TASK_FINISHED, text: '都改好了' }), '任务完成。都改好了');
  assert.equal(toSpeech({ type: EVENT.TASK_FINISHED, text: '' }), '任务完成');
  assert.equal(toSpeech({ type: EVENT.TASK_FAILED, text: 'error_max_turns' }), '任务出错了：error_max_turns');
  assert.equal(toSpeech({ type: EVENT.TASK_STUCK, silentMs: 95000 }), '好像卡住了，95 秒没动静');
  assert.equal(toSpeech({ type: EVENT.HEARTBEAT, lastTool: 'Bash', sinceMs: 130000 }), '还在跑命令，已经 2 分钟了');
});
