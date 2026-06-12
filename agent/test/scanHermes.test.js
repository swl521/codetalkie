import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHermesSessions, parseHermesHistory } from '../src/scanProjects.js';

// 仿真 `hermes sessions list` 输出(列:Title / Preview / Last Active / ID),含表头+分隔线。
const SAMPLE = [
  'Title                            Preview                                  Last Active   ID',
  '──────────────────────────────────────────────────────────────────────────────────────',
  '—                                用一句话讲个冷笑话                                29m ago       20260611_211632_7ab3c3',
  '—                                回复 delivery-test-ok                      38m ago       20260611_210757_267473',
  '—                                只回复 ok 两个字，不要用任何工具                       1h ago        20260611_202942_e47906',
  '—                                [IMPORTANT: You are running as a sched   5h ago        cron_ebbf977f8ac5_20260611_163003',
  'NVDA盘中播报与市场动态                    盘中播报 再试一次                                38m ago       20260611_133021_aa281975',
  '切换默认模型配置                         [The user sent an image but I could      yesterday     20260609_150448_4345df16',
  '黄金走势与投资分析                        财神，帮我看一下黄金走势                             3d ago        20260608_120852_1f00f549',
  '—                                Reply with just: Agnes AI is working!    4d ago        20260607_155826_a88d92',
].join('\n');

test('parseHermesSessions:抽 ID(末 token)、过滤 cron_ 和测试会话', () => {
  const rows = parseHermesSessions(SAMPLE, '/home/u/.hermes');
  // 保留:NVDA / 切换默认模型配置 / 黄金走势(三条真实会话)。
  // 过滤掉:讲个冷笑话、delivery-test、只回复 ok、Agnes(测试)、cron_(定时)。
  assert.deepEqual(rows.map((r) => r.name), ['NVDA盘中播报与市场动态', '切换默认模型配置', '黄金走势与投资分析']);
});

test('parseHermesSessions:sessionId = 行末 token,带 cwd/agent/base', () => {
  const rows = parseHermesSessions(SAMPLE, '/home/u/.hermes');
  const nvda = rows[0];
  assert.equal(nvda.sessionId, '20260611_133021_aa281975');
  assert.equal(nvda.agent, 'hermes');
  assert.equal(nvda.cwd, '/home/u/.hermes');
  assert.equal(nvda.base, nvda.name);
  assert.equal(nvda.lastActive, '38m ago');
});

test('parseHermesSessions:Title 为 — 时退到 Preview 当名字', () => {
  const out = parseHermesSessions(
    '—                                帮我查一下天气情况                             2m ago        20260611_120000_abc123',
    '/h',
  );
  assert.equal(out[0].name, '帮我查一下天气情况');
  assert.equal(out[0].sessionId, '20260611_120000_abc123');
});

test('parseHermesSessions:名字裁到 ~16 字', () => {
  const longTitle = '这是一个非常非常非常非常非常非常长的会话标题超过十六个字';
  const out = parseHermesSessions(
    `${longTitle}        预览        1m ago        20260611_120000_def456`,
    '/h',
  );
  assert.ok(out[0].name.length <= 16);
});

test('parseHermesSessions:最多保留 12 条', () => {
  const lines = [];
  for (let i = 0; i < 20; i++) {
    const id = `2026061${i % 10}_120000_${String(i).padStart(6, '0')}`;
    lines.push(`会话${i}        预览${i}        ${i}m ago        ${id}`);
  }
  const out = parseHermesSessions(lines.join('\n'), '/h');
  assert.equal(out.length, 12);
});

test('parseHermesSessions:空输入 → 空数组,表头/分隔线不入', () => {
  assert.deepEqual(parseHermesSessions('', '/h'), []);
  assert.deepEqual(parseHermesSessions('Title  Preview  Last Active  ID\n────────', '/h'), []);
});

// `hermes sessions export --session-id <ID> -` 的单对象:含 messages[] + message_count + ended_at
const EXPORT = {
  message_count: 4, ended_at: '2026-06-11T13:35:00Z',
  messages: [
    { role: 'user', content: '盘中播报 再试一次', timestamp: 1 },
    { role: 'assistant', content: 'Load the relevant skill first.', timestamp: 2 },
    { role: 'tool', content: '{"success": true}', timestamp: 3 }, // tool 跳过
    { role: 'assistant', content: '已触发重跑,结果会发到这里。', timestamp: 4 },
  ],
};

test('parseHermesHistory:只留 user/assistant,跳 tool,带 sig', () => {
  const { sig, lines } = parseHermesHistory(EXPORT, 10);
  assert.deepEqual(lines, [
    { role: 'user', text: '盘中播报 再试一次' },
    { role: 'assistant', text: 'Load the relevant skill first.' },
    { role: 'assistant', text: '已触发重跑,结果会发到这里。' },
  ]);
  assert.equal(sig, '4:2026-06-11T13:35:00Z'); // message_count:ended_at
});

test('parseHermesHistory:取最近 limit 条', () => {
  const big = { message_count: 30, messages: [] };
  for (let i = 0; i < 30; i++) big.messages.push({ role: 'user', content: `m${i}`, timestamp: i });
  const { lines } = parseHermesHistory(big, 5);
  assert.equal(lines.length, 5);
  assert.equal(lines[4].text, 'm29');
});

test('parseHermesHistory:content 数组取 text 块;空/尖括号噪音跳过;长文本截断', () => {
  const obj = { messages: [
    { role: 'assistant', content: [{ type: 'text', text: '结构化回复' }, { type: 'tool_use' }] },
    { role: 'user', content: '<untrusted_tool_result>noise' }, // < 开头跳
    { role: 'assistant', content: '' },                         // 空跳
    { role: 'user', content: 'x'.repeat(300) },                 // 截到 200
  ] };
  const { lines } = parseHermesHistory(obj, 10);
  assert.equal(lines[0].text, '结构化回复');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].text.endsWith('…') && lines[1].text.length === 200);
});

test('parseHermesHistory:空/坏对象 → 空 lines 不抛', () => {
  assert.deepEqual(parseHermesHistory(null).lines, []);
  assert.deepEqual(parseHermesHistory({}).lines, []);
  assert.deepEqual(parseHermesHistory({ messages: 'nope' }).lines, []);
});
