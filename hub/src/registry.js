import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export const HUB_DIR = join(homedir(), '.claude', 'agent-hub');
export const REGISTRY_FILE = join(HUB_DIR, 'registry.json');

export function readRegistry(file = REGISTRY_FILE) {
  try { return JSON.parse(readFileSync(file, 'utf-8')); }
  catch { return { sessions: {} }; }
}

// 活 = pid 存活 且 (无 lastSeen 或 lastSeen 在 maxAgeMs 内)。注:pid 校验只对本机有效。
export function isAlive(info, now = Date.now(), maxAgeMs = 30_000) {
  if (!info || !info.pid) return false;
  try { process.kill(info.pid, 0); } catch { return false; }
  if (info.lastSeen) {
    const age = now - Date.parse(info.lastSeen);
    if (Number.isFinite(age) && age > maxAgeMs) return false;
  }
  return true;
}

export function listSessions(reg, { cap, now } = {}) {
  return Object.entries(reg?.sessions || {})
    .filter(([, info]) => isAlive(info, now))
    .filter(([, info]) => !cap || (info.caps || []).includes(cap))
    .map(([name, info]) => ({ name, ...info }));
}
