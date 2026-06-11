import { EVENT } from './events.js';

export const STATE = {
  RUNNING: 'running',
  WAITING_APPROVAL: 'waiting_approval',
  STUCK: 'stuck',
  DONE: 'done',
  ERROR: 'error',
};

export class TaskStateMachine {
  #state = STATE.RUNNING;
  get state() { return this.#state; }

  apply(event) {
    if (this.#state === STATE.DONE || this.#state === STATE.ERROR) return this.#state;
    switch (event.type) {
      case EVENT.TASK_FINISHED: this.#state = STATE.DONE; break;
      case EVENT.TASK_FAILED: this.#state = STATE.ERROR; break;
      case EVENT.APPROVAL_NEEDED: this.#state = STATE.WAITING_APPROVAL; break;
      case EVENT.APPROVAL_RESOLVED:
        if (this.#state === STATE.WAITING_APPROVAL) this.#state = STATE.RUNNING;
        break;
      case EVENT.TASK_STUCK:
        if (this.#state === STATE.RUNNING) this.#state = STATE.STUCK;
        break;
      default:
        if (this.#state === STATE.STUCK) this.#state = STATE.RUNNING;
    }
    return this.#state;
  }
}
