import { EVENT, isBaseline, isBadNews } from './events.js';
import { TaskStateMachine } from './stateMachine.js';
import { shouldAnnounce } from './filter.js';
import { toSpeech } from './translate.js';
import { AnnounceQueue } from './queue.js';

export class Pipeline {
  #toolNames = new Map(); // tool_use_id → 工具名

  constructor({ project, level = 3, mergeThreshold = 3 } = {}) {
    this.project = project;
    this.level = level;
    this.sm = new TaskStateMachine();
    this.queue = new AnnounceQueue({ mergeThreshold });
  }

  get state() { return this.sm.state; }

  ingest(event) {
    // 1. 补工具名
    if (event.type === EVENT.TOOL_STARTED) this.#toolNames.set(event.id, event.tool);
    if (event.type === EVENT.TOOL_FINISHED && !event.tool) {
      event = { ...event, tool: this.#toolNames.get(event.id) };
    }
    // 2. 状态机
    this.sm.apply(event);
    // 3. 过滤 → 4. 翻译 → 5. 入队
    if (!shouldAnnounce(event, this.level)) return;
    const text = toSpeech(event);
    if (!text) return;
    this.queue.push({
      project: this.project,
      text,
      urgent: isBaseline(event) || isBadNews(event),
    });
  }
}
