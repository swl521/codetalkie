export const LEADER_NAME = '🧠主脑';

const PLAYBOOK = '\n——你现在是主脑,按 hub/ORCHESTRATOR.md 编排执行;每到里程碑用 `node hub/bin/hub.js announce "<进度>"` 念耳机,收工念结论。';

// 把"主脑目标"按 leader 配置分流。纯函数 + 注入依赖。
// leader: { engine, leader } 来自 leader.json(可能为 null)
// deps: { hubSend(name,cmd), codexPost(cmd), notify({project,text}), hubAlive(name) }
export async function routeLeaderGoal(goal, leader, { hubSend, codexPost, notify, hubAlive }) {
  if (!leader || !leader.engine) {
    await notify({ project: LEADER_NAME, text: '还没设主脑,先在电脑上跑 `主脑 claude` 或 `主脑 codex`。' });
    return { ok: false, reason: 'no-leader' };
  }
  const command = goal + PLAYBOOK;
  if (leader.engine === 'codex') {
    await codexPost(command);
    return { ok: true, engine: 'codex' };
  }
  if (!hubAlive(leader.leader)) {
    await notify({ project: LEADER_NAME, text: '主脑(Claude)没在跑,去电脑开一个 claude,或用 `主脑 codex` 切换。' });
    return { ok: false, reason: 'leader-offline' };
  }
  await hubSend(leader.leader, command);
  return { ok: true, engine: 'claude' };
}
