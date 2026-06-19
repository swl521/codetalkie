import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HUB_DIR } from './registry.js';

export const POLICY_FILE = join(HUB_DIR, 'policy.json');

export const DEFAULT_POLICY = {
  auto: ['read', 'test', 'lint', 'sandbox'],
  escalate: ['write', 'git', 'delete', 'egress'],
  maxParallel: 4,
  maxRetries: 2,
  stepTimeoutSec: 180,
  maxDepth: 5,
};

export function readPolicy(file = POLICY_FILE) {
  try {
    const custom = JSON.parse(readFileSync(file, 'utf-8'));
    return { ...DEFAULT_POLICY, ...custom };
  } catch {
    return { ...DEFAULT_POLICY };
  }
}
