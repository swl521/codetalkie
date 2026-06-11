import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../src/events.js';
import { STATE, TaskStateMachine } from '../src/stateMachine.js';

test('初始 Running;finished→Done;failed→Error,且为终态', () => {
  const sm = new TaskStateMachine();
  assert.equal(sm.state, STATE.RUNNING);
  sm.apply({ type: EVENT.TASK_FINISHED });
  assert.equal(sm.state, STATE.DONE);
  sm.apply({ type: EVENT.TASK_FAILED });
  assert.equal(sm.state, STATE.DONE); // 终态不再变
});

test('approval.needed→WaitingApproval,只有 resolved 拉回 Running', () => {
  const sm = new TaskStateMachine();
  sm.apply({ type: EVENT.APPROVAL_NEEDED });
  assert.equal(sm.state, STATE.WAITING_APPROVAL);
  sm.apply({ type: EVENT.PROGRESS_TEXT, text: 'x' });
  assert.equal(sm.state, STATE.WAITING_APPROVAL);
  sm.apply({ type: EVENT.APPROVAL_RESOLVED, approved: true });
  assert.equal(sm.state, STATE.RUNNING);
});

test('stuck→Stuck,出新事件回 Running,failed 仍可进 Error', () => {
  const sm = new TaskStateMachine();
  sm.apply({ type: EVENT.TASK_STUCK });
  assert.equal(sm.state, STATE.STUCK);
  sm.apply({ type: EVENT.TOOL_STARTED, id: 't', tool: 'Bash' });
  assert.equal(sm.state, STATE.RUNNING);
  sm.apply({ type: EVENT.TASK_STUCK });
  sm.apply({ type: EVENT.TASK_FAILED });
  assert.equal(sm.state, STATE.ERROR);
});
