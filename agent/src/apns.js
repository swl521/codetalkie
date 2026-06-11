import { readFileSync } from 'node:fs';
import { sign } from 'node:crypto';
import http2 from 'node:http2';

// 播报项 → APNs payload。title=项目名(Siri 会念),body=播报句。
// category 用于带动作按钮的通知(如 APPROVAL=批准/拒绝);extra 合并进顶层(如 approvalId)。
export function buildPayload({ project, text, level = 'time-sensitive', category, extra }) {
  const payload = {
    aps: {
      alert: { title: project, body: text },
      sound: 'default',
      'interruption-level': level,
    },
  };
  if (category) payload.aps.category = category;
  if (extra) Object.assign(payload, extra);
  return payload;
}

// APNs provider token(ES256 JWT,JOSE r||s 签名)。有效期 1 小时,调用方负责复用/刷新。
export function makeJwt({ teamId, keyId, privateKeyPem, nowSec = Math.floor(Date.now() / 1000) }) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const input = `${b64({ alg: 'ES256', kid: keyId })}.${b64({ iss: teamId, iat: nowSec })}`;
  const sig = sign('sha256', Buffer.from(input), { key: privateKeyPem, dsaEncoding: 'ieee-p1363' });
  return `${input}.${sig.toString('base64url')}`;
}

// 发送一条推送。config 同 spike/push.mjs:{p8Path,keyId,teamId,bundleId,deviceToken,host}
// 返回 { status, body }。JWT 缓存 50 分钟。
const jwtCache = new Map(); // keyId → { jwt, madeAt }

export function sendPush(config, payload) {
  const { p8Path, keyId, teamId, bundleId, deviceToken, host = 'api.sandbox.push.apple.com' } = config;
  let cached = jwtCache.get(keyId);
  if (!cached || Date.now() - cached.madeAt > 50 * 60 * 1000) {
    cached = { jwt: makeJwt({ teamId, keyId, privateKeyPem: readFileSync(p8Path) }), madeAt: Date.now() };
    jwtCache.set(keyId, cached);
  }
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://${host}`);
    client.on('error', reject);
    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'authorization': `bearer ${cached.jwt}`,
      'apns-topic': bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
    });
    let status = 0;
    let body = '';
    req.setEncoding('utf8');
    req.on('response', (headers) => { status = headers[':status']; });
    req.on('data', (d) => { body += d; });
    req.on('end', () => { client.close(); resolve({ status, body }); });
    req.on('error', reject);
    req.write(JSON.stringify(payload));
    req.end();
  });
}
