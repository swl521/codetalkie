import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { buildPayload, makeJwt } from '../src/apns.js';

test('buildPayload:title=项目名,body=播报句,默认 time-sensitive', () => {
  const p = buildPayload({ project: 'wiki', text: '测试跑完了' });
  assert.deepEqual(p, {
    aps: {
      alert: { title: 'wiki', body: '测试跑完了' },
      sound: 'default',
      'interruption-level': 'time-sensitive',
    },
  });
  const urgent = buildPayload({ project: 'w', text: 'x', level: 'active' });
  assert.equal(urgent.aps['interruption-level'], 'active');
});

test('makeJwt:ES256/JOSE 签名可用公钥验证,header/claims 正确', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });

  const jwt = makeJwt({ teamId: 'TEAM123456', keyId: 'KEY1234567', privateKeyPem: pem, nowSec: 1750000000 });
  const [h, c, s] = jwt.split('.');
  assert.equal(jwt.split('.').length, 3);

  const header = JSON.parse(Buffer.from(h, 'base64url').toString());
  assert.deepEqual(header, { alg: 'ES256', kid: 'KEY1234567' });

  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  assert.deepEqual(claims, { iss: 'TEAM123456', iat: 1750000000 });

  const ok = verify('sha256', Buffer.from(`${h}.${c}`),
    { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  assert.equal(ok, true);
});
