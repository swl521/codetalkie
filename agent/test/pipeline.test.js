import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../src/events.js';
import { Pipeline } from '../src/pipeline.js';
import { STATE } from '../src/stateMachine.js';

test('3 级:progress 播,tool 不播;失败 tool 提级;紧急先出;状态随动', () => {
  const p = new Pipeline({ project: 'wiki', level: 3 });
  p.ingest({ type: EVENT.SESSION_STARTED });
  p.ingest({ type: EVENT.PROGRESS_TEXT, text: '先跑测试' });
  p.ingest({ type: EVENT.TOOL_STARTED, id: 't1', tool: 'Bash' });
  p.ingest({ type: EVENT.TOOL_FINISHED, id: 't1', ok: false });
  p.ingest({ type: EVENT.TASK_FINISHED, text: '搞定' });

  const spoken = [];
  for (let item = p.queue.next(); item; item = p.queue.next()) {
    spoken.push(`${item.project}：${item.text}`);
  }
  // 全部攒着一次性取:urgent(坏消息、底线)整体在前,普通 FIFO 在后
  assert.deepEqual(spoken, [
    'wiki：跑命令失败了',
    'wiki：任务完成。搞定',
    'wiki：先跑测试',
  ]);
  assert.equal(p.state, STATE.DONE);
});

test('工具名通过 id 映射补全', () => {
  const p = new Pipeline({ project: 'w', level: 4 });
  p.ingest({ type: EVENT.TOOL_STARTED, id: 'x', tool: 'Edit' });
  p.ingest({ type: EVENT.TOOL_FINISHED, id: 'x', ok: true });
  assert.equal(p.queue.next().text, '正在改文件');
  assert.equal(p.queue.next().text, '改文件完成');
});
