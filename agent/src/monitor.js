import { EVENT } from './events.js';

// stuck:超过 stuckMs 无 CLI 事件(发一次,恢复后可再发)。
// heartbeat:超过 heartbeatMs 没播报过(5 级静默填充;级别由 filter 决定)。
export class SilenceMonitor {
  constructor({ stuckMs = 90_000, heartbeatMs = 60_000, now = Date.now() } = {}) {
    this.stuckMs = stuckMs;
    this.heartbeatMs = heartbeatMs;
    this.lastEventAt = now;
    this.lastSpokenAt = now;
    this.stuckFired = false;
    this.lastTool = null;
  }

  noteEvent(now, event) {
    this.lastEventAt = now;
    this.stuckFired = false;
    if (event?.type === EVENT.TOOL_STARTED) this.lastTool = event.tool;
  }

  noteSpoken(now) {
    this.lastSpokenAt = now;
  }

  tick(now) {
    const silentMs = now - this.lastEventAt;
    if (!this.stuckFired && silentMs >= this.stuckMs) {
      this.stuckFired = true;
      this.lastSpokenAt = now; // stuck 本身会被播,心跳重新计时
      return [{ type: EVENT.TASK_STUCK, silentMs }];
    }
    if (now - this.lastSpokenAt >= this.heartbeatMs) {
      this.lastSpokenAt = now;
      return [{ type: EVENT.HEARTBEAT, sinceMs: silentMs, lastTool: this.lastTool }];
    }
    return [];
  }
}
