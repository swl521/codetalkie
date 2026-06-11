// 播报串行且慢,事件快:紧急插队永不丢;进度积压就合并概括,始终追上现实。
export class AnnounceQueue {
  #urgent = [];
  #normal = [];

  constructor({ mergeThreshold = 3 } = {}) {
    this.mergeThreshold = mergeThreshold;
  }

  push(item) {
    (item.urgent ? this.#urgent : this.#normal).push(item);
  }

  get size() {
    return this.#urgent.length + this.#normal.length;
  }

  next() {
    if (this.#urgent.length) return this.#urgent.shift();
    if (!this.#normal.length) return null;
    if (this.#normal.length > this.mergeThreshold) {
      const items = this.#normal.splice(0);
      const latest = items[items.length - 1];
      return { ...latest, text: `刚有 ${items.length} 条进度，最新：${latest.text}` };
    }
    return this.#normal.shift();
  }
}
