import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { HUB_DIR } from './registry.js';

export const RESPONSES_DIR = join(HUB_DIR, 'responses');
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function postSend(port, body, { host = '127.0.0.1', fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`http://${host}:${port}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

export function readResponse(msgId, dir = RESPONSES_DIR) {
  const p = join(dir, `${msgId}.json`);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return null; }
}

export async function pollResponse(msgId, {
  dir = RESPONSES_DIR, timeoutMs = 180_000, intervalMs = 2000,
  sleep = defaultSleep, now = Date.now,
} = {}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const r = readResponse(msgId, dir);
    if (r) return { status: 'ok', response: r };
    if (now() >= deadline) return { status: 'timeout', msg_id: msgId };
    await sleep(intervalMs);
  }
}
