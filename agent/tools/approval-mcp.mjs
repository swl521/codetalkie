// claude --permission-prompt-tool 用的最小 stdio MCP 服务器。
// 唯一工具 approve:把权限请求 POST 给 daemon(/approval/request),
// daemon 播报+推手机并挂起,等用户在手机上点「批准/拒绝」,结果原样返回给 claude。
// 环境变量:EARPIECE_DAEMON(如 http://127.0.0.1:7780)、EARPIECE_TOKEN
import { createInterface } from 'node:readline';

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

const rl = createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0', id,
      result: {
        protocolVersion: params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'earpiece-approval', version: '0.1.0' },
      },
    });
  } else if (method === 'tools/list') {
    send({
      jsonrpc: '2.0', id,
      result: {
        tools: [{
          name: 'approve',
          description: '把工具权限请求转给用户手机批准',
          inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' } }, additionalProperties: true },
        }],
      },
    });
  } else if (method === 'tools/call') {
    let decision;
    try {
      const r = await fetch(`${process.env.EARPIECE_DAEMON}/approval/request`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${process.env.EARPIECE_TOKEN}`,
        },
        body: JSON.stringify(params?.arguments ?? {}),
      });
      decision = await r.json();
    } catch (e) {
      decision = { behavior: 'deny', message: `批准桥接故障: ${e.message}` };
    }
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } });
  } else if (id !== undefined) {
    send({ jsonrpc: '2.0', id, result: {} }); // 其他请求一律空成功,通知直接忽略
  }
});
