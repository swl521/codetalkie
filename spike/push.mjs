// Earpiece spike — APNs time-sensitive push sender (zero dependencies)
//
// 用法:
//   node push.mjs "wiki: 测试跑完了，3 个通过"
//   node push.mjs "config.json 要删，批准吗？" critical
//
// 第二个参数是中断级别(可选):active | time-sensitive(默认) | critical | passive
//   - time-sensitive：锁屏 + 戴 AirPods 时,Siri 会响一声然后自动朗读。spike 用这个。
//   - critical：会突破静音/勿扰(需要 Apple 额外授权 entitlement,先别用)。
//
// 跑之前把下面 CONFIG 的 5 个值填好。

import { readFileSync } from 'node:fs';
import { sign } from 'node:crypto';
import http2 from 'node:http2';

// ── CONFIG ──────────────────────────────────────────────────────────────
const CONFIG = {
  P8_PATH:      './AuthKey_XXXXXXXXXX.p8',   // 你的 .p8 文件路径
  KEY_ID:       'XXXXXXXXXX',                // .p8 的 Key ID(10 位)
  TEAM_ID:      'XXXXXXXXXX',                // Apple Developer Team ID(10 位)
  BUNDLE_ID:    'com.example.codetalkie',  // 必须和 Xcode 里的 Bundle Identifier 完全一致
  DEVICE_TOKEN: 'PASTE_FROM_APP',            // 从 App 屏幕上复制的那串 token

  // Xcode 直接装到真机的是 development build → 用 sandbox 服务器。
  // 走 TestFlight / App Store 的才用 api.push.apple.com。
  HOST: 'api.sandbox.push.apple.com',
};
// ────────────────────────────────────────────────────────────────────────

const message = process.argv[2] ?? 'Earpiece spike: 锁屏朗读测试';
const level   = process.argv[3] ?? 'time-sensitive';

// 把 "wiki: xxx" 拆成 title=wiki, body=xxx,模拟"每句带项目名"的播报
let title = 'Earpiece';
let body  = message;
const colon = message.indexOf(':');
const colonCN = message.indexOf('：');
const idx = [colon, colonCN].filter(i => i >= 0).sort((a, b) => a - b)[0];
if (idx !== undefined && idx > 0 && idx < 12) {
  title = message.slice(0, idx).trim();
  body  = message.slice(idx + 1).trim();
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeJWT() {
  const privateKey = readFileSync(CONFIG.P8_PATH);
  const header = b64url(JSON.stringify({ alg: 'ES256', kid: CONFIG.KEY_ID }));
  const claims = b64url(JSON.stringify({ iss: CONFIG.TEAM_ID, iat: Math.floor(Date.now() / 1000) }));
  const signingInput = `${header}.${claims}`;
  // APNs 要 JOSE 格式签名(r||s),不是 DER,所以用 ieee-p1363
  const signature = sign('sha256', Buffer.from(signingInput), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(signature)}`;
}

const payload = JSON.stringify({
  aps: {
    alert: { title, body },
    sound: 'default',
    'interruption-level': level,
  },
});

const jwt = makeJWT();
const client = http2.connect(`https://${CONFIG.HOST}`);
client.on('error', (e) => { console.error('连接错误:', e.message); process.exit(1); });

const req = client.request({
  ':method': 'POST',
  ':path': `/3/device/${CONFIG.DEVICE_TOKEN}`,
  'authorization': `bearer ${jwt}`,
  'apns-topic': CONFIG.BUNDLE_ID,
  'apns-push-type': 'alert',
  'apns-priority': '10',
});

req.setEncoding('utf8');
let data = '';
req.on('response', (headers) => {
  const status = headers[':status'];
  console.log(`APNs 状态: ${status}  ${status === 200 ? '✅ 已投递' : '❌ 看下面错误'}`);
});
req.on('data', (d) => { data += d; });
req.on('end', () => {
  if (data) console.log('APNs 返回:', data);
  console.log(`已发送 → [${title}] ${body}  (级别: ${level})`);
  client.close();
});
req.write(payload);
req.end();
