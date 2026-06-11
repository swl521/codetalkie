import { buildPayload, sendPush } from './apns.js';

// 播报项 → iPhone 推送。与 say 扬声器并联;失败不抛,只记日志,绝不阻塞播报。
export function makePushSink(config, send = sendPush) {
  return async ({ project, text }) => {
    try {
      const res = await send(config, buildPayload({ project, text }));
      if (res.status !== 200) console.error(`APNs ${res.status}: ${res.body}`);
      return res;
    } catch (e) {
      console.error(`APNs 异常: ${e.message}`);
      return { status: 0, body: e.message };
    }
  };
}
