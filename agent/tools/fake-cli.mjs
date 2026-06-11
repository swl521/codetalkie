// 假 CLI:按真实 stream-json 的形状回放一段任务,带延迟,模拟真实节奏。
// 用法: node agent/src/main.js --bin node --silent agent/tools/fake-cli.mjs
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const emit = (o) => console.log(JSON.stringify(o));

emit({ type: 'system', subtype: 'init', session_id: 'fake' });
await sleep(300);
emit({ type: 'assistant', message: { content: [{ type: 'text', text: '我先看一下测试文件,然后跑一遍测试。' }] } });
await sleep(300);
emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'x.test.js' } }] } });
await sleep(400);
emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
await sleep(300);
emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }] } });
await sleep(600);
emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: '2 failing' } ] } });
await sleep(300);
emit({ type: 'assistant', message: { content: [{ type: 'text', text: '有两个测试挂了,我修一下断言。' }] } });
await sleep(300);
emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: 'x.test.js' } }] } });
await sleep(400);
emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't3', content: 'ok' }] } });
await sleep(300);
emit({ type: 'result', subtype: 'success', result: '修好了,测试全过' });
