// 8 个归一事件 + heartbeat + approval.resolved(手机回传,内部输入,不播报)
export const EVENT = {
  SESSION_STARTED: 'session.started',
  PROGRESS_TEXT: 'progress.text',
  TOOL_STARTED: 'tool.started',
  TOOL_FINISHED: 'tool.finished',
  APPROVAL_NEEDED: 'approval.needed',
  APPROVAL_RESOLVED: 'approval.resolved',
  TASK_FINISHED: 'task.finished',
  TASK_FAILED: 'task.failed',
  TASK_STUCK: 'task.stuck',
  HEARTBEAT: 'heartbeat',
};

const BASELINE = new Set([
  EVENT.APPROVAL_NEEDED, EVENT.TASK_FINISHED, EVENT.TASK_FAILED, EVENT.TASK_STUCK,
]);

export function isBaseline(event) {
  return BASELINE.has(event.type);
}

export function isBadNews(event) {
  if (event.type === EVENT.TASK_FAILED || event.type === EVENT.TASK_STUCK) return true;
  return event.type === EVENT.TOOL_FINISHED && event.ok === false;
}
