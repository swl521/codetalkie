import { EVENT, isBaseline, isBadNews } from './events.js';

const MIN_LEVEL = {
  [EVENT.SESSION_STARTED]: 2,
  [EVENT.PROGRESS_TEXT]: 3,
  [EVENT.TOOL_STARTED]: 4,
  [EVENT.TOOL_FINISHED]: 4,
  [EVENT.HEARTBEAT]: 5,
};

// 判定顺序:底线 → 坏消息提级 → 分层 → 丢
export function shouldAnnounce(event, level) {
  if (isBaseline(event)) return true;
  if (isBadNews(event)) return true;
  const min = MIN_LEVEL[event.type];
  return min !== undefined && level >= min;
}
