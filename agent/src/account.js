import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';

// 账户密钥:既是连中继的 bearer,也是多租户隔离命名空间。
// 解析顺序(不破坏老用户):
//   1) ~/.earpiece/account.json 的 accountKey —— 正式形态
//   2) ~/.earpiece/relay.json 的 token —— 旧版/开发机(你自己的设备),原样沿用
//   3) 都没有 → 生成一把新的(256 位)写进 account.json —— 全新客户安装
export function resolveAccountKey(dir = join(homedir(), '.earpiece')) {
  const acctPath = join(dir, 'account.json');
  if (existsSync(acctPath)) {
    try { const k = JSON.parse(readFileSync(acctPath, 'utf8')).accountKey; if (k) return k; } catch { /* 坏档就重生成 */ }
  }
  // 旧设备:relay.json 里有 token 就当账户密钥,顺手迁进 account.json(下次直接命中)
  const relayPath = join(dir, 'relay.json');
  if (existsSync(relayPath)) {
    try {
      const t = JSON.parse(readFileSync(relayPath, 'utf8')).token;
      if (t && t.length >= 16) { saveAccountKey(t, dir); return t; }
    } catch { /* 忽略 */ }
  }
  const key = randomBytes(32).toString('hex'); // 64 hex 字符
  saveAccountKey(key, dir);
  return key;
}

export function saveAccountKey(accountKey, dir = join(homedir(), '.earpiece')) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'account.json'), JSON.stringify({ accountKey }, null, 2));
  return accountKey;
}

// 向中继换一个 6 位配对码(给手机扫/输)。返回 { code, expiresInSec }。
export async function requestPairCode(relayUrl, accountKey) {
  const r = await fetch(`${relayUrl}/pair/offer`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accountKey}` },
    body: '{}',
  });
  if (!r.ok) throw new Error(`配对发码失败 HTTP ${r.status}`);
  return r.json();
}
