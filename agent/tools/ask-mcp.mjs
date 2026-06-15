// 最小 stdio MCP 服务器:给 Agent 一个 ask_user 工具,向用户(手机)提一道选择题,
// 经 daemon /choice/request 挂起,等用户在手机上点 ①②③(或对话里打数字)后返回所选项。
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
        serverInfo: { name: 'earpiece-ask', version: '0.1.0' },
      },
    });
  } else if (method === 'tools/list') {
    send({
      jsonrpc: '2.0', id,
      result: {
        tools: [{
          name: 'ask_user',
          description: '需要用户拿主意时,向用户手机提一道选择题并等待选择。返回 {index, choice}(index 为 0 基,-1=超时未选)。',
          inputSchema: {
            type: 'object',
            properties: {
              question: { type: 'string', description: '问题' },
              options: { type: 'array', items: { type: 'string' }, description: '2~6 个选项' },
            },
            required: ['question', 'options'],
          },
        }],
      },
    });
  } else if (method === 'tools/call') {
    let out;
    try {
      const r = await fetch(`${process.env.EARPIECE_DAEMON}/choice/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.EARPIECE_TOKEN}` },
        body: JSON.stringify(params?.arguments ?? {}),
      });
      out = await r.json();
    } catch (e) {
      out = { index: -1, choice: '', error: `提问桥接故障: ${e.message}` };
    }
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out) }] } });
  } else if (id !== undefined) {
    send({ jsonrpc: '2.0', id, result: {} });
  }
});
