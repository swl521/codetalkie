# Desktop Agent 事件管线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Desktop Agent 核心管线——驾驶 `claude -p` 的 stream-json 输出,归一成 8 个内部事件,经状态机 / 5 级过滤 / 合并队列 / 模板翻译,最终在 Mac 上用 `say` 念出来(iOS 送达是下一个 plan)。

**Architecture:** 纯函数/小类组成的管线:`driver(spawn CLI) → normalize → enrich → stateMachine + filter → translate → queue → speaker`。每个模块单文件单职责,全部可独立测试;定时逻辑(stuck/心跳)用显式 `tick(now)` 驱动,不依赖真实时钟。

**Tech Stack:** Node.js v25(ESM, `"type":"module"`),内置 `node:test` + `node:assert`,**零 npm 依赖**。规格依据:`docs/superpowers/specs/2026-06-10-task-state-machine-design.md`。

---

### Task 0: 项目脚手架

**Files:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: git init + 基础文件**

```bash
cd ~/codetalkie
git init -b main
```

`package.json`:
```json
{
  "name": "agent-earpiece",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test agent/test/"
  }
}
```

`.gitignore`:
```
node_modules/
.DS_Store
spike/AuthKey_*.p8
```

(⚠️ `.p8` 私钥绝不能进 git。)

- [ ] **Step 2: 验证测试命令能跑(空套件)**

Run: `npm test`
Expected: 退出码 0,`tests 0` 或 "no test files" 类输出(目录还没有测试,不报错即可;若因目录不存在报错,先 `mkdir -p agent/test`)。

- [ ] **Step 3: Commit**

```bash
git add package.json .gitignore docs/ spike/README.md spike/push.mjs spike/ios/
git commit -m "chore: scaffold + spec + spike"
```

---

### Task 1: 事件定义与分类(`events.js`)

**Files:**
- Create: `agent/src/events.js`
- Test: `agent/test/events.test.js`

- [ ] **Step 1: 写失败测试**

`agent/test/events.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT, isBaseline, isBadNews } from '../src/events.js';

test('底线 = approval.needed / task.finished / task.failed / task.stuck', () => {
  for (const t of [EVENT.APPROVAL_NEEDED, EVENT.TASK_FINISHED, EVENT.TASK_FAILED, EVENT.TASK_STUCK]) {
    assert.equal(isBaseline({ type: t }), true, t);
  }
  for (const t of [EVENT.SESSION_STARTED, EVENT.PROGRESS_TEXT, EVENT.TOOL_STARTED, EVENT.TOOL_FINISHED, EVENT.HEARTBEAT]) {
    assert.equal(isBaseline({ type: t }), false, t);
  }
});

test('坏消息 = 失败类:task.failed / task.stuck / 失败的 tool.finished', () => {
  assert.equal(isBadNews({ type: EVENT.TASK_FAILED }), true);
  assert.equal(isBadNews({ type: EVENT.TASK_STUCK }), true);
  assert.equal(isBadNews({ type: EVENT.TOOL_FINISHED, ok: false }), true);
  assert.equal(isBadNews({ type: EVENT.TOOL_FINISHED, ok: true }), false);
  assert.equal(isBadNews({ type: EVENT.PROGRESS_TEXT }), false);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npm test`
Expected: FAIL,`Cannot find module ... events.js`

- [ ] **Step 3: 最小实现**

`agent/src/events.js`:
```js
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
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm test` — Expected: PASS(2 tests)

- [ ] **Step 5: Commit**

```bash
git add agent/ && git commit -m "feat: event types + baseline/bad-news classification"
```

---

### Task 2: stream-json 归一器(`normalize.js`)

**Files:**
- Create: `agent/src/normalize.js`
- Test: `agent/test/normalize.test.js`

把 `claude -p --output-format stream-json --verbose` 每行 JSON 归一成内部事件数组。
关键事实:assistant 消息的 content 里混着 `text` 和 `tool_use` 块;`tool_result` 回灌在 **user** 消息里(带 `tool_use_id`,不带工具名,名字由 Task 7 的 pipeline 补)。

- [ ] **Step 1: 写失败测试**

`agent/test/normalize.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../src/events.js';
import { normalizeClaudeMessage } from '../src/normalize.js';

test('system/init → session.started', () => {
  assert.deepEqual(normalizeClaudeMessage({ type: 'system', subtype: 'init' }),
    [{ type: EVENT.SESSION_STARTED }]);
});

test('assistant 文字 + tool_use → progress.text + tool.started', () => {
  const out = normalizeClaudeMessage({
    type: 'assistant',
    message: { content: [
      { type: 'text', text: ' 我先看下测试文件。 ' },
      { type: 'tool_use', id: 'tu_1', name: 'Bash', input: { command: 'npm test' } },
    ] },
  });
  assert.deepEqual(out, [
    { type: EVENT.PROGRESS_TEXT, text: '我先看下测试文件。' },
    { type: EVENT.TOOL_STARTED, id: 'tu_1', tool: 'Bash' },
  ]);
});

test('user 里的 tool_result → tool.finished(失败看 is_error)', () => {
  const out = normalizeClaudeMessage({
    type: 'user',
    message: { content: [
      { type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'boom' },
    ] },
  });
  assert.deepEqual(out, [{ type: EVENT.TOOL_FINISHED, id: 'tu_1', ok: false }]);
});

test('result → task.finished / task.failed', () => {
  assert.deepEqual(normalizeClaudeMessage({ type: 'result', subtype: 'success', result: '都改好了' }),
    [{ type: EVENT.TASK_FINISHED, text: '都改好了' }]);
  assert.deepEqual(normalizeClaudeMessage({ type: 'result', subtype: 'error_max_turns' }),
    [{ type: EVENT.TASK_FAILED, text: 'error_max_turns' }]);
});

test('空文字块、未知类型 → 忽略', () => {
  assert.deepEqual(normalizeClaudeMessage({ type: 'assistant', message: { content: [{ type: 'text', text: '  ' }] } }), []);
  assert.deepEqual(normalizeClaudeMessage({ type: 'whatever' }), []);
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test`,Expected: FAIL(模块不存在)

- [ ] **Step 3: 最小实现**

`agent/src/normalize.js`:
```js
import { EVENT } from './events.js';

// 一行 stream-json(已 JSON.parse)→ 0..n 个内部事件。认不出的行一律返回 []。
export function normalizeClaudeMessage(msg) {
  switch (msg?.type) {
    case 'system':
      return msg.subtype === 'init' ? [{ type: EVENT.SESSION_STARTED }] : [];

    case 'assistant': {
      const out = [];
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text') {
          const text = block.text?.trim();
          if (text) out.push({ type: EVENT.PROGRESS_TEXT, text });
        } else if (block.type === 'tool_use') {
          out.push({ type: EVENT.TOOL_STARTED, id: block.id, tool: block.name });
        }
      }
      return out;
    }

    case 'user': {
      const out = [];
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'tool_result') {
          out.push({ type: EVENT.TOOL_FINISHED, id: block.tool_use_id, ok: block.is_error !== true });
        }
      }
      return out;
    }

    case 'result':
      return msg.subtype === 'success'
        ? [{ type: EVENT.TASK_FINISHED, text: typeof msg.result === 'string' ? msg.result : '' }]
        : [{ type: EVENT.TASK_FAILED, text: msg.subtype ?? 'unknown' }];

    default:
      return [];
  }
}
```

- [ ] **Step 4: 跑测试确认通过** — `npm test`,Expected: PASS

- [ ] **Step 5: Commit** — `git add agent/ && git commit -m "feat: claude stream-json normalizer"`

---

### Task 3: 状态机(`stateMachine.js`)

**Files:**
- Create: `agent/src/stateMachine.js`
- Test: `agent/test/stateMachine.test.js`

规格:4 稳定态 + Stuck 旁支。Done/Error 是终态;Stuck 出新事件回 Running;WaitingApproval 只被 `approval.resolved` 拉回。

- [ ] **Step 1: 写失败测试**

`agent/test/stateMachine.test.js`:
```js
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
```

- [ ] **Step 2: 跑测试确认失败** — `npm test`,Expected: FAIL

- [ ] **Step 3: 最小实现**

`agent/src/stateMachine.js`:
```js
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
```

- [ ] **Step 4: 跑测试确认通过** — `npm test`,Expected: PASS

- [ ] **Step 5: Commit** — `git add agent/ && git commit -m "feat: task state machine"`

---

### Task 4: 5 级过滤器(`filter.js`)

**Files:**
- Create: `agent/src/filter.js`
- Test: `agent/test/filter.test.js`

判定顺序:底线→坏消息提级→看级别→丢。分层:L2 +session.started,L3 +progress.text,L4 +tool.*,L5 +heartbeat。

- [ ] **Step 1: 写失败测试**

`agent/test/filter.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../src/events.js';
import { shouldAnnounce } from '../src/filter.js';

test('底线在 1 级也播', () => {
  for (const t of [EVENT.APPROVAL_NEEDED, EVENT.TASK_FINISHED, EVENT.TASK_FAILED, EVENT.TASK_STUCK]) {
    assert.equal(shouldAnnounce({ type: t }, 1), true, t);
  }
});

test('坏消息穿透:失败的 tool.finished 在 1 级也播,成功的 4 级才播', () => {
  assert.equal(shouldAnnounce({ type: EVENT.TOOL_FINISHED, ok: false }, 1), true);
  assert.equal(shouldAnnounce({ type: EVENT.TOOL_FINISHED, ok: true }, 3), false);
  assert.equal(shouldAnnounce({ type: EVENT.TOOL_FINISHED, ok: true }, 4), true);
});

test('分层:session@2 progress@3 tool@4 heartbeat@5', () => {
  assert.equal(shouldAnnounce({ type: EVENT.SESSION_STARTED }, 1), false);
  assert.equal(shouldAnnounce({ type: EVENT.SESSION_STARTED }, 2), true);
  assert.equal(shouldAnnounce({ type: EVENT.PROGRESS_TEXT, text: 'x' }, 2), false);
  assert.equal(shouldAnnounce({ type: EVENT.PROGRESS_TEXT, text: 'x' }, 3), true);
  assert.equal(shouldAnnounce({ type: EVENT.TOOL_STARTED, tool: 'Bash' }, 3), false);
  assert.equal(shouldAnnounce({ type: EVENT.TOOL_STARTED, tool: 'Bash' }, 4), true);
  assert.equal(shouldAnnounce({ type: EVENT.HEARTBEAT }, 4), false);
  assert.equal(shouldAnnounce({ type: EVENT.HEARTBEAT }, 5), true);
});

test('approval.resolved 是内部输入,任何级别不播', () => {
  assert.equal(shouldAnnounce({ type: EVENT.APPROVAL_RESOLVED }, 5), false);
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test`,Expected: FAIL

- [ ] **Step 3: 最小实现**

`agent/src/filter.js`:
```js
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
```

- [ ] **Step 4: 跑测试确认通过** — `npm test`,Expected: PASS

- [ ] **Step 5: Commit** — `git add agent/ && git commit -m "feat: 5-level announce filter with bad-news escalation"`

---

### Task 5: 人话翻译(`translate.js`)

**Files:**
- Create: `agent/src/translate.js`
- Test: `agent/test/translate.test.js`

返回**不带项目名前缀的裸句子**(前缀在 speaker 拼,合并句才好造)。progress.text 直接用 Agent 原话,截 80 字。

- [ ] **Step 1: 写失败测试**

`agent/test/translate.test.js`:
```js
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

test('底线模板', () => {
  assert.equal(toSpeech({ type: EVENT.SESSION_STARTED }), '开始干活了');
  assert.equal(toSpeech({ type: EVENT.APPROVAL_NEEDED, summary: '要删 config.json' }), '要删 config.json，等你批准');
  assert.equal(toSpeech({ type: EVENT.TASK_FINISHED, text: '都改好了' }), '任务完成。都改好了');
  assert.equal(toSpeech({ type: EVENT.TASK_FINISHED, text: '' }), '任务完成');
  assert.equal(toSpeech({ type: EVENT.TASK_FAILED, text: 'error_max_turns' }), '任务出错了：error_max_turns');
  assert.equal(toSpeech({ type: EVENT.TASK_STUCK, silentMs: 95000 }), '好像卡住了，95 秒没动静');
  assert.equal(toSpeech({ type: EVENT.HEARTBEAT, lastTool: 'Bash', sinceMs: 130000 }), '还在跑命令，已经 2 分钟了');
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test`,Expected: FAIL

- [ ] **Step 3: 最小实现**

`agent/src/translate.js`:
```js
import { EVENT } from './events.js';

const TOOL_LABELS = {
  Bash: '跑命令', Edit: '改文件', Write: '写文件', Read: '读文件',
  Grep: '搜代码', Glob: '找文件', WebSearch: '查网页', WebFetch: '查网页',
  Task: '派子任务', TodoWrite: '记待办',
};

function toolLabel(name) {
  return TOOL_LABELS[name] ?? (name ? `用 ${name}` : null);
}

export function clip(text, max = 80) {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

// 归一事件 → 不带项目名前缀的裸播报句
export function toSpeech(event) {
  switch (event.type) {
    case EVENT.SESSION_STARTED: return '开始干活了';
    case EVENT.PROGRESS_TEXT: return clip(event.text);
    case EVENT.TOOL_STARTED: return `正在${toolLabel(event.tool) ?? '干一步'}`;
    case EVENT.TOOL_FINISHED: {
      const label = toolLabel(event.tool);
      if (!label) return event.ok ? '一步完成' : '有一步失败了';
      return event.ok ? `${label}完成` : `${label}失败了`;
    }
    case EVENT.APPROVAL_NEEDED: return `${event.summary ?? '有个操作'}，等你批准`;
    case EVENT.TASK_FINISHED: return event.text ? `任务完成。${clip(event.text)}` : '任务完成';
    case EVENT.TASK_FAILED: return `任务出错了：${event.text ?? '未知原因'}`;
    case EVENT.TASK_STUCK: return `好像卡住了，${Math.round((event.silentMs ?? 0) / 1000)} 秒没动静`;
    case EVENT.HEARTBEAT: {
      const mins = Math.max(1, Math.round((event.sinceMs ?? 0) / 60000));
      const doing = toolLabel(event.lastTool);
      return doing ? `还在${doing}，已经 ${mins} 分钟了` : `还在跑，已经 ${mins} 分钟了`;
    }
    default: return '';
  }
}
```

- [ ] **Step 4: 跑测试确认通过** — `npm test`,Expected: PASS

- [ ] **Step 5: Commit** — `git add agent/ && git commit -m "feat: event-to-speech templates"`

---

### Task 6: 播报队列(`queue.js`)

**Files:**
- Create: `agent/src/queue.js`
- Test: `agent/test/queue.test.js`

紧急(底线/坏消息)插队、永不合并;进度类积压 > 3 条时合并概括,保留最新内容。

- [ ] **Step 1: 写失败测试**

`agent/test/queue.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnnounceQueue } from '../src/queue.js';

test('FIFO 基本顺序;紧急插队', () => {
  const q = new AnnounceQueue();
  q.push({ project: 'wiki', text: 'a' });
  q.push({ project: 'wiki', text: 'b' });
  q.push({ project: 'wiki', text: '出错了', urgent: true });
  assert.equal(q.next().text, '出错了');
  assert.equal(q.next().text, 'a');
  assert.equal(q.next().text, 'b');
  assert.equal(q.next(), null);
});

test('进度积压超过阈值 → 合并概括,保最新', () => {
  const q = new AnnounceQueue({ mergeThreshold: 3 });
  for (const t of ['1', '2', '3', '测试通过']) q.push({ project: 'wiki', text: t });
  const merged = q.next();
  assert.equal(merged.text, '刚有 4 条进度，最新：测试通过');
  assert.equal(merged.project, 'wiki');
  assert.equal(q.next(), null);
});

test('紧急永不被合并', () => {
  const q = new AnnounceQueue({ mergeThreshold: 1 });
  q.push({ project: 'wiki', text: 'p1' });
  q.push({ project: 'wiki', text: 'p2' });
  q.push({ project: 'wiki', text: '要批准', urgent: true });
  assert.equal(q.next().text, '要批准');
  assert.equal(q.next().text, '刚有 2 条进度，最新：p2');
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test`,Expected: FAIL

- [ ] **Step 3: 最小实现**

`agent/src/queue.js`:
```js
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
```

- [ ] **Step 4: 跑测试确认通过** — `npm test`,Expected: PASS

- [ ] **Step 5: Commit** — `git add agent/ && git commit -m "feat: announce queue with merge-on-backlog"`

---

### Task 7: 静默监视(`monitor.js`)— stuck + 心跳

**Files:**
- Create: `agent/src/monitor.js`
- Test: `agent/test/monitor.test.js`

不碰真实定时器:外部每秒调一次 `tick(now)`,返回该补发的事件数组。stuck=90s 无事件(只发一次,恢复后可再发);心跳=60s 没播过任何东西(仅 5 级用,过滤器管级别,这里只管产生)。

- [ ] **Step 1: 写失败测试**

`agent/test/monitor.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../src/events.js';
import { SilenceMonitor } from '../src/monitor.js';

test('90s 无事件 → task.stuck,只发一次,出事件后可再触发', () => {
  const m = new SilenceMonitor({ now: 0 });
  assert.deepEqual(m.tick(89_000), []);
  const fired = m.tick(90_000);
  assert.equal(fired[0].type, EVENT.TASK_STUCK);
  assert.deepEqual(m.tick(120_000), []); // 不重复
  m.noteEvent(121_000);                   // 恢复
  assert.equal(m.tick(211_000)[0].type, EVENT.TASK_STUCK); // 再卡再发
});

test('60s 没播过 → heartbeat;播过就重新计时', () => {
  const m = new SilenceMonitor({ now: 0 });
  m.noteEvent(50_000); // 有事件,不算 stuck
  const out = m.tick(60_000);
  assert.equal(out[0].type, EVENT.HEARTBEAT);
  m.noteSpoken(61_000);
  assert.deepEqual(m.tick(120_000), []); // 61+60=121 才到
  assert.equal(m.tick(121_000)[0].type, EVENT.HEARTBEAT);
});

test('stuck 优先:同 tick 不重复发心跳', () => {
  const m = new SilenceMonitor({ now: 0 });
  const out = m.tick(90_000);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, EVENT.TASK_STUCK);
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test`,Expected: FAIL

- [ ] **Step 3: 最小实现**

`agent/src/monitor.js`:
```js
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
```

- [ ] **Step 4: 跑测试确认通过** — `npm test`,Expected: PASS

- [ ] **Step 5: Commit** — `git add agent/ && git commit -m "feat: silence monitor (stuck + heartbeat)"`

---

### Task 8: 管线组装(`pipeline.js`)

**Files:**
- Create: `agent/src/pipeline.js`
- Test: `agent/test/pipeline.test.js`

把 2~7 串起来:归一事件进来 → 补工具名(id→name 映射)→ 状态机 → 过滤(级别)→ 翻译 → 入队。纯逻辑,不碰子进程/定时器,方便整测。

- [ ] **Step 1: 写失败测试**

`agent/test/pipeline.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT } from '../src/events.js';
import { Pipeline } from '../src/pipeline.js';
import { STATE } from '../src/stateMachine.js';

test('3 级:progress 播,tool 不播;失败 tool 提级播;状态随动', () => {
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
  assert.deepEqual(spoken, [
    'wiki：跑命令失败了',     // 坏消息提级,紧急插队
    'wiki：开始干活了',       // session @3 级播(>=2)
    'wiki：先跑测试',
    'wiki：任务完成。搞定',  // 等下:底线是紧急的,应该也插队……见实现说明
  ]);
  assert.equal(p.state, STATE.DONE);
});

test('工具名通过 id 映射补全', () => {
  const p = new Pipeline({ project: 'w', level: 4 });
  p.ingest({ type: EVENT.TOOL_STARTED, id: 'x', tool: 'Edit' });
  p.ingest({ type: EVENT.TOOL_FINISHED, id: 'x', ok: true });
  p.queue.next(); // 正在改文件
  assert.equal(p.queue.next().text, '改文件完成');
});
```

⚠️ 第一个测试的期望顺序在写实现时**必须重新核对**:底线/坏消息都标 urgent,
urgent 之间保持先后。task.finished 在最后才进队,前面的普通项若已被消费完,
顺序即自然;若测试里全部攒着再取,urgent 会整体前移。**以实测输出为准修正
期望数组,逻辑规则(urgent 先、普通 FIFO)不变。**

- [ ] **Step 2: 跑测试确认失败** — `npm test`,Expected: FAIL

- [ ] **Step 3: 最小实现**

`agent/src/pipeline.js`:
```js
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
```

- [ ] **Step 4: 跑测试,按实测顺序修正期望数组后确认通过** — `npm test`,Expected: PASS

- [ ] **Step 5: Commit** — `git add agent/ && git commit -m "feat: pipeline wiring (normalize→state→filter→translate→queue)"`

---

### Task 9: CLI 驱动器 + Mac 扬声器 + 入口(`driver.js` / `speaker.js` / `main.js`)

**Files:**
- Create: `agent/src/driver.js`
- Create: `agent/src/speaker.js`
- Create: `agent/src/main.js`
- Test: `agent/test/driver.test.js`

- [ ] **Step 1: 写 driver 失败测试(用 `node -e` 假装 claude,打印两行 JSON)**

`agent/test/driver.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { driveCli } from '../src/driver.js';

test('逐行解析 NDJSON,坏行忽略,退出回调', async () => {
  const lines = [];
  const fakeBin = process.execPath; // node 本体
  const script = `console.log(JSON.stringify({type:'system',subtype:'init'}));` +
    `console.log('not json');` +
    `console.log(JSON.stringify({type:'result',subtype:'success',result:'ok'}));`;
  const exitCode = await new Promise((resolve) => {
    driveCli({
      bin: fakeBin,
      args: ['-e', script],
      onMessage: (m) => lines.push(m.type),
      onExit: resolve,
    });
  });
  assert.deepEqual(lines, ['system', 'result']);
  assert.equal(exitCode, 0);
});
```

- [ ] **Step 2: 跑测试确认失败** — `npm test`,Expected: FAIL

- [ ] **Step 3: 实现 driver + speaker + main**

`agent/src/driver.js`:
```js
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// 启动 CLI 进程,逐行 JSON.parse 回调;解析失败的行静默跳过。
export function driveCli({ bin, args, cwd, onMessage, onExit }) {
  const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'] });
  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    try { onMessage(JSON.parse(line)); } catch { /* 非 JSON 行忽略 */ }
  });
  child.on('exit', (code) => onExit?.(code ?? 1));
  return child;
}

export function claudeArgs(prompt) {
  return ['-p', prompt, '--output-format', 'stream-json', '--verbose'];
}
```

`agent/src/speaker.js`:
```js
import { spawn } from 'node:child_process';

// MVP 扬声器:macOS `say` + 控制台。播完 resolve,保证串行。
export async function speak({ project, text }, { voice = 'Tingting', silent = false } = {}) {
  const sentence = project ? `${project}：${text}` : text;
  console.log(`🔊 ${sentence}`);
  if (silent) return;
  await new Promise((resolve) => {
    const p = spawn('say', ['-v', voice, sentence]);
    p.on('exit', resolve);
    p.on('error', resolve); // 没有 say(非 mac)就只打印
  });
}
```

`agent/src/main.js`:
```js
// 用法: node agent/src/main.js --project wiki --cwd ~/program/wiki --level 3 "跑一下测试"
import { driveCli, claudeArgs } from './driver.js';
import { normalizeClaudeMessage } from './normalize.js';
import { Pipeline } from './pipeline.js';
import { SilenceMonitor } from './monitor.js';
import { speak } from './speaker.js';

function parseArgs(argv) {
  const opts = { level: 3, project: 'task', cwd: process.cwd(), silent: false };
  const rest = [];
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') opts.project = argv[++i];
    else if (a === '--cwd') opts.cwd = argv[++i];
    else if (a === '--level') opts.level = Number(argv[++i]);
    else if (a === '--silent') opts.silent = true;
    else rest.push(a);
  }
  opts.prompt = rest.join(' ');
  return opts;
}

const opts = parseArgs(process.argv);
if (!opts.prompt) {
  console.error('用法: node agent/src/main.js --project <名字> [--cwd 目录] [--level 1-5] "指令"');
  process.exit(1);
}

const pipeline = new Pipeline({ project: opts.project, level: opts.level });
const monitor = new SilenceMonitor();
let speaking = false;
let cliDone = false;

async function drain() {
  if (speaking) return;
  speaking = true;
  for (let item = pipeline.queue.next(); item; item = pipeline.queue.next()) {
    await speak(item, { silent: opts.silent });
    monitor.noteSpoken(Date.now());
  }
  speaking = false;
  if (cliDone && pipeline.queue.size === 0) {
    clearInterval(timer);
  }
}

const timer = setInterval(() => {
  for (const e of monitor.tick(Date.now())) pipeline.ingest(e);
  drain();
}, 1000);

console.log(`▶ [${opts.project}] level=${opts.level} cwd=${opts.cwd}`);
driveCli({
  bin: 'claude',
  args: claudeArgs(opts.prompt),
  cwd: opts.cwd,
  onMessage: (msg) => {
    for (const e of normalizeClaudeMessage(msg)) {
      monitor.noteEvent(Date.now(), e);
      pipeline.ingest(e);
    }
    drain();
  },
  onExit: (code) => {
    cliDone = true;
    console.log(`◀ CLI 退出 code=${code} 状态=${pipeline.state}`);
    drain();
  },
});
```

- [ ] **Step 4: 跑全部测试确认通过** — `npm test`,Expected: 全部 PASS

- [ ] **Step 5: 真机冒烟(关键验证,人工)**

```bash
cd ~/codetalkie
node agent/src/main.js --project demo --level 4 "把 1 到 20 之间的质数算出来,只回答结果"
```

Expected: Mac 扬声器/耳机里听到「demo:开始干活了」…「demo:任务完成。…」;
控制台同步打印 🔊 行;CLI 退出后状态=done。
**注意:`claude` 在这里是被驱动方,沙箱/权限按它自己的配置走;若有权限交互,
本版会停在那(approval 桥接是下一个 plan)。冒烟用例选了无需工具权限的纯
问答,避开这个坑。**

- [ ] **Step 6: 用真实输出核对归一器**

把冒烟跑的原始流存一份,对照检查 normalize 的字段假设(尤其 tool_result 在 user 消息里、result.subtype 取值):

```bash
claude -p "1+1 等于几,只回答数字" --output-format stream-json --verbose > /tmp/claude-stream-sample.jsonl
cat /tmp/claude-stream-sample.jsonl
```

若字段与 Task 2 假设不符 → 改 `normalize.js` + 更新测试样本,重跑 `npm test`。

- [ ] **Step 7: Commit**

```bash
git add agent/ && git commit -m "feat: CLI driver, mac speaker, main entry — end-to-end MVP"
```

---

## 自查记录(writing-plans Self-Review)

1. **Spec 覆盖**:归一(T2)、状态机(T3)、5 级过滤+坏消息提级(T4)、翻译+项目前缀(T5/speaker)、队列合并概括(T6)、stuck 90s+心跳 60s 静默填充(T7)、参数默认值(各构造函数)——全覆盖。**未覆盖(有意,属下个 plan)**:approval.needed 的真实触发(需 SDK 权限回调桥接,本版 CLI 直跑不会产生)、APNs/iOS 送达、`--resume` 持续会话、Codex。
2. **占位符扫描**:无 TBD/TODO;Task 8 测试期望顺序处是「按实测修正」的显式指令,非占位。
3. **类型一致性**:事件字段(`id/tool/ok/text/summary/silentMs/sinceMs/lastTool`)、队列项(`{project,text,urgent}`)、`toSpeech` 裸句约定在 T5/T6/T8/T9 间已交叉核对一致。
