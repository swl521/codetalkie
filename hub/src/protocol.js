import { randomBytes } from 'node:crypto';

export function mintId() {
  return randomBytes(4).toString('hex');
}

// worker 回报的 result 归一:老纯字符串当成功摘要;对象按字段取,ok 默认 true。
export function normalizeResult(result) {
  if (result && typeof result === 'object') {
    return {
      ok: result.ok !== false,
      summary: String(result.summary ?? ''),
      artifacts: result.artifacts,
      next: result.next,
      needsApproval: result.needsApproval,
    };
  }
  return { ok: true, summary: String(result ?? '') };
}

export function buildSendBody({ command, msgId, jobId, from, wait, timeout }) {
  const body = { command, msg_id: msgId };
  if (jobId) body.job_id = jobId;
  if (from) body.from = from;
  if (wait) body.wait = true;
  if (timeout) body.timeout = timeout;
  return body;
}
