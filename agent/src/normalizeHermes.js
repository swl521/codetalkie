import { EVENT } from './events.js';

// hermes -z 是纯文本引擎:整段 stdout 一次性给过来(driver text 模式发 {__text})。
// 没有逐步事件,所以一条任务=把回复当结果念出来。续接靠固定主会话(--continue),
// 会话扫描是另一回事(scanProjects 里做)。
export function normalizeHermesMessage(msg) {
  if (msg && typeof msg.__text === 'string') {
    const text = msg.__text.trim();
    return text
      ? [{ type: EVENT.TASK_FINISHED, text }]
      : [{ type: EVENT.TASK_FAILED, text: 'hermes 没有输出' }];
  }
  return [];
}
