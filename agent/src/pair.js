// 配对发码 CLI:在电脑上跑一下,亮出 6 位配对码给手机扫/输。
//   node agent/src/pair.js
// 读 ~/.earpiece/relay.json 的主中继 + ~/.earpiece/account.json 的账户密钥,
// 向中继换一个 10 分钟有效的配对码。手机 App「绑定电脑」里输码即可接管本机。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { resolveAccountKey, requestPairCode } from './account.js';

function primaryRelay(dir) {
  const c = JSON.parse(readFileSync(join(dir, 'relay.json'), 'utf8'));
  return (c.urls ?? [c.url]).filter(Boolean)[0];
}

const dir = join(homedir(), '.earpiece');
const relay = primaryRelay(dir);
const key = resolveAccountKey(dir);

const { code, expiresInSec } = await requestPairCode(relay, key);
const link = `codetalkie://pair?code=${code}`;
const pretty = `${code.slice(0, 3)} ${code.slice(3)}`;

console.log('');
console.log('  ┌──────────────────────────────┐');
console.log(`  │     配对码   ${pretty}        │`);
console.log('  └──────────────────────────────┘');
console.log('');
console.log('  手机「答鸭」→ 绑定电脑 → 输入这 6 位(或扫二维码)');
console.log(`  ${Math.round(expiresInSec / 60)} 分钟内有效,用过即失效。`);
console.log(`  深链(二维码内容): ${link}`);
console.log('');
