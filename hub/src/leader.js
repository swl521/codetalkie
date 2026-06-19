import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HUB_DIR } from './registry.js';

export const LEADER_FILE = join(HUB_DIR, 'leader.json');

export function readLeader(file = LEADER_FILE) {
  try { return JSON.parse(readFileSync(file, 'utf-8')); } catch { return null; }
}

export function writeLeader({ leader, engine }, file = LEADER_FILE, nowIso = () => new Date().toISOString()) {
  const data = { leader, engine, since: nowIso() };
  writeFileSync(file, JSON.stringify(data, null, 2));
  return data;
}
