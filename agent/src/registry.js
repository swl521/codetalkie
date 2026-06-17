import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// 项目注册:扫描结果 + 别名表 → 可喊的名单。规则:名字全局唯一,撞名=标记改名+语音拒绝。

export function loadAliases(filePath) {
  try { return JSON.parse(readFileSync(filePath, 'utf8')); } catch { return {}; }
}

// 别名唯一:同名指向别的项目 → 抛错(手机端收 409 提示换名)
export function saveAlias(filePath, alias, target) {
  const aliases = loadAliases(filePath);
  const exist = aliases[alias];
  if (exist && (exist.cwd !== target.cwd || exist.agent !== target.agent)) {
    throw new Error(`「${alias}」已被占用`);
  }
  // 同一项目换新名:把旧别名清掉
  for (const [k, v] of Object.entries(aliases)) {
    if (v.cwd === target.cwd && v.agent === target.agent) delete aliases[k];
  }
  aliases[alias] = { cwd: target.cwd, agent: target.agent };
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(aliases, null, 2));
  return aliases;
}

// 扫描条目 + 别名 → [{name, cwd, agent, base, lastActive, aliased, needsRename}]
export function buildRegistry(entries, aliases = {}) {
  const byKey = new Map();
  // 去重 key:claude/codex 一目录一项目(agent@cwd);hermes 多会话共用一个 cwd,
  // 必须把 sessionId 也并进 key,否则同 cwd 的会话会互相覆盖(只剩一条)。
  for (const e of entries) {
    // claude/codex 现在也带 sessionId(供详情页显示),但去重 key 仍按 cwd —— 一目录一项目,
    // 且别名查表用 agent@cwd,不能把 sessionId 并进 key。只有 hermes(多会话共用 ~/.hermes)
    // 必须用 sessionId 区分,否则同 cwd 的会话互相覆盖。
    const key = (e.agent === 'hermes' && e.sessionId) ? `${e.agent}@${e.cwd}@${e.sessionId}` : `${e.agent}@${e.cwd}`;
    byKey.set(key, { ...e, name: e.base, aliased: false });
  }
  for (const [alias, t] of Object.entries(aliases)) {
    const hit = byKey.get(`${t.agent}@${t.cwd}`);
    if (hit) { hit.name = alias; hit.aliased = true; }
  }
  // 撞名标记(别名是唯一的,撞名只会来自默认目录名)
  const byName = new Map();
  for (const e of byKey.values()) {
    byName.set(e.name, (byName.get(e.name) ?? 0) + 1);
  }
  const list = [...byKey.values()].map((e) => ({ ...e, needsRename: byName.get(e.name) > 1 }));
  list.sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
  return list;
}

// 语音解析:首词命中唯一名字 → 项目;命中重名 → ambiguous;没命中 → null(调用方走 demo 兜底)
export function resolveSpoken(text, registry) {
  const [head, ...rest] = text.trim().split(/\s+/);
  const hits = registry.filter((e) => e.name === head);
  if (hits.length === 1 && rest.length) {
    const e = hits[0];
    const job = { project: e.name, cwd: e.cwd, agent: e.agent === 'claude' ? undefined : e.agent, prompt: rest.join(' ') };
    // hermes 会话项目带 resume 句柄(来自 `hermes sessions list` 的 ID,不归 SessionStore 管)
    if (e.sessionId) job.resumeId = e.sessionId;
    return job;
  }
  if (hits.length > 1) return { ambiguous: head };
  return null;
}
