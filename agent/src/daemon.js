// 上行通道(局域网版):手机 POST 指令 → 排队 → 串行跑管线。
// 用法: node agent/src/daemon.js   (监听 0.0.0.0:7780)
// 认证: Authorization: Bearer <~/.earpiece/lan-token>
// 指令格式: {"text":"wiki 跑一下测试"} — 首词若在 ~/.earpiece/projects.json 注册表中
// 则路由到该项目目录;否则整句给 demo 项目(家目录)。
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, hostname, networkInterfaces } from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { runTask } from './runTask.js';
import { summarizeToolRequest } from './translate.js';
import { t } from './i18n.js';
import { speak } from './speaker.js';
import { buildPayload, sendPush } from './apns.js';
import { scanClaude, scanCodex, scanHermesSessions, exportHermesSession, parseHermesHistory } from './scanProjects.js';
import { buildRegistry, resolveSpoken, saveAlias, loadAliases } from './registry.js';
import { findHubSession, runViaHub } from './hubBridge.js';
import { resolveAccountKey } from './account.js';
import { extractTail } from './transcriptTail.js';

// 纯逻辑核心,可注入假 runner / announce 测试
export function createDaemon({
  token, runner = runTask, projects = {}, defaults = {},
  announce = async () => {}, approvalTimeoutMs = 300_000,
  announceChoice = async () => {}, choiceTimeoutMs = 600_000,
  logLine = () => {}, // 字幕回放:{project, role:'user'|'assistant'|'event', text}
  notify = () => {}, // 系统提示音(如重名拒绝):({project, text})
  resolver = null,   // 语音解析(text)→job|{ambiguous}|null;不传则用 projects 映射表
}) {
  const queue = [];
  let current = null;
  const approvals = new Map(); // id → { res(挂起的HTTP响应), timer, input }
  const choices = new Map(); // id → { res, timer, project, question, options }(选择题:挂起等手机选/打数字)

  // 收口一道选择题:index = 选中的第几项(0 基)。回给提问方所选项。
  function resolveChoice(id, index) {
    const c = choices.get(id);
    if (!c) return false;
    clearTimeout(c.timer);
    choices.delete(id);
    const i = Number(index);
    const chosen = (i >= 0 && c.options[i] != null) ? c.options[i] : ''; // 无效/超时(-1)→ 空,不误选
    c.res.writeHead(200, { 'Content-Type': 'application/json' });
    c.res.end(JSON.stringify({ index: i, choice: chosen }));
    logLine({ project: c.project, role: 'event', text: `已选:${chosen}` });
    return true;
  }

  // 把挂起的权限请求收口:approve=true 放行(回 allow+原参数),false 拒绝
  function respondApproval(id, approve, denyMsg = t('userDenied')) {
    const a = approvals.get(id);
    if (!a) return false;
    clearTimeout(a.timer);
    approvals.delete(id);
    a.res.writeHead(200, { 'Content-Type': 'application/json' });
    a.res.end(JSON.stringify(approve
      ? { behavior: 'allow', updatedInput: a.input }
      : { behavior: 'deny', message: denyMsg }));
    logLine({ project: a.project, role: 'event', text: approve ? t('approved') : t('denied', { reason: denyMsg }) });
    return true;
  }

  async function pump() {
    if (current || !queue.length) return;
    current = queue.shift();
    try {
      await runner({ ...defaults, ...current });
    } catch (e) {
      console.error('任务失败:', e.message);
    }
    current = null;
    pump();
  }

  function parseCommand(text) {
    // 优先走注册表解析(名字唯一);没命中 → demo 兜底;重名 → 拒绝
    if (currentResolver) {
      const r = currentResolver(text);
      if (r?.ambiguous) return r;
      if (r) return r;
      return { project: 'demo', cwd: homedir(), prompt: text };
    }
    const [head, ...rest] = text.split(/\s+/);
    if (projects[head] && rest.length) {
      return { project: head, cwd: projects[head], prompt: rest.join(' ') };
    }
    return { project: 'demo', cwd: homedir(), prompt: text };
  }

  let currentResolver = resolver;

  // 入队一条文字指令(本地 HTTP 和公网 Relay 共用)。重名 → 不入队,语音+字幕提示改名。
  function enqueueText(text) {
    const job = parseCommand(text);
    if (job.ambiguous) {
      const msg = t('dupName', { name: job.ambiguous });
      notify({ project: t('assistantName'), text: msg });
      logLine({ project: job.ambiguous, role: 'event', text: `⚠️ ${msg}` });
      return job;
    }
    queue.push(job);
    pump();
    logLine({ project: job.project, role: 'user', text: (job.agent === 'codex' ? '[codex] ' : '') + job.prompt });
    // 收到即回显任务(代替"开始干活了"):让用户确认指令到位、并复述任务
    notify({ project: job.project, text: t('received', { prompt: job.prompt }) });
    return job;
  }

  function handle(req, res, body) {
    if ((req.headers['authorization'] ?? '') !== `Bearer ${token}`) {
      res.writeHead(401); res.end('unauthorized'); return;
    }
    if (req.method === 'POST' && req.url === '/command') {
      let parsed;
      try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
      const text = (parsed.text ?? '').trim();
      if (!text) { res.writeHead(400); res.end('empty'); return; }
      // 文字兜底:有挂起的选择题、且输入是单个数字 → 当作选答(1 起,转 0 基)。
      const num = text.match(/^[(（]?([1-9])[)）.、]?$/);
      if (num && choices.size) {
        const cid = [...choices.keys()].pop();
        resolveChoice(cid, Number(num[1]) - 1);
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choiceAnswered: cid }));
        return;
      }
      const job = enqueueText(text);
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ queued: job.project, prompt: job.prompt }));
      return;
    }
    if (req.method === 'POST' && req.url === '/choice/request') {
      // 来自 ask-mcp(被派的 Agent 提问):挂起,推手机(①②③ 通知 + 正文),等回选或数字
      let parsed;
      try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
      const id = randomUUID().slice(0, 8);
      const project = parsed.project || current?.project || 'agent';
      const question = String(parsed.question ?? '请选择');
      const options = (Array.isArray(parsed.options) ? parsed.options : []).map(String).slice(0, 6);
      if (!options.length) { res.writeHead(400); res.end('no options'); return; }
      const timer = setTimeout(() => resolveChoice(id, -1), choiceTimeoutMs);
      choices.set(id, { id, res, timer, project, question, options });
      logLine({ project, role: 'event', text: `❓ ${question}(${options.map((o, k) => `${k + 1}.${o}`).join(' ')})` });
      announceChoice({ id, project, question, options });
      return; // 长挂等 /choice/respond 或数字兜底
    }
    if (req.method === 'POST' && req.url === '/choice/respond') {
      let parsed;
      try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
      const id = parsed.id ?? [...choices.keys()].pop();
      const ok = id !== undefined && resolveChoice(id, parsed.index);
      res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok }));
      return;
    }
    if (req.method === 'POST' && req.url === '/approval/request') {
      // 来自 approval-mcp(claude 的 --permission-prompt-tool):挂起响应,等手机
      let parsed;
      try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
      const id = randomUUID().slice(0, 8);
      const project = current?.project ?? 'agent';
      const summary = summarizeToolRequest(parsed.tool_name, parsed.input);
      const timer = setTimeout(() => respondApproval(id, false, t('approvalTimeout')), approvalTimeoutMs);
      approvals.set(id, { id, res, timer, input: parsed.input ?? {}, project, summary });
      logLine({ project, role: 'event', text: t('waitingApproval', { summary }) });
      announce({ id, project, summary });
      return; // res 不结束,长挂等 /approval/respond
    }
    if (req.method === 'POST' && req.url === '/approval/respond') {
      // 来自手机:通知按钮带 id;语音("告诉小易批准")不带 id → 取最新挂起的
      let parsed;
      try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
      const id = parsed.id ?? [...approvals.keys()].pop();
      const ok = id !== undefined && respondApproval(id, parsed.approve === true);
      res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok }));
      return;
    }
    if (req.method === 'GET' && req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        running: current?.project ?? null,
        queued: queue.length,
        pendingApprovals: approvals.size,
      }));
      return;
    }
    res.writeHead(404); res.end();
  }

  // 公网 Relay 来的批准应答:带 id 精确命中,不带 id 取最新挂起
  function respondFromRelay(body) {
    const id = body.id ?? [...approvals.keys()].pop();
    return id !== undefined && respondApproval(id, body.approve === true);
  }
  // 中继来的选择题回选:带 id 精确命中,不带取最新挂起。
  function respondChoiceFromRelay(body) {
    const id = body.id ?? [...choices.keys()].pop();
    return id !== undefined && resolveChoice(id, body.index);
  }

  return {
    handle, queueSize: () => queue.length, enqueueText, respondFromRelay, respondChoiceFromRelay,
    setResolver: (fn) => { currentResolver = fn; },
    // 手机端实时状态:在干什么、排几个、几个等批准(含摘要,供 App 内横幅直接批/拒)
    state: () => ({
      running: current?.project ?? null,
      queued: queue.length,
      pending: [...approvals.values()].map(({ id, project, summary }) => ({ id, project, summary })),
      pendingChoices: [...choices.values()].map(({ id, project, question, options }) => ({ id, project, question, options })),
    }),
  };
}

// 本机全部私网 IPv4(给手机直连发现用)。手机按自己网段挑匹配的,
// 所以多网卡(Hyper-V/WSL/VMware/Tailscale)全报出来,真实 LAN 排前面。
export function lanIPs() {
  const all = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family === 'IPv4' && !i.internal
        && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\./.test(i.address)) all.push(i.address);
    }
  }
  // 192.168 / 10. 是真实家用网段,优先;172.16-31 多为虚拟网卡,靠后
  const rank = (ip) => (ip.startsWith('192.168') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return all.sort((a, b) => rank(a) - rank(b));
}

// 电脑 → Relay 长轮询取自己机器格子的信。断网自动重试,永不退出。
export async function pullLoop(relay, daemon, log = console.log) {
  log(`☁ Relay 取信循环启动: ${relay.url} [${relay.machine}]`);
  for (;;) {
    try {
      const r = await fetch(`${relay.url}/pull?wait=25&machine=${encodeURIComponent(relay.machine)}`, {
        headers: { authorization: `Bearer ${relay.token}` },
      });
      if (!r.ok) { await new Promise((s) => setTimeout(s, 5000)); continue; }
      const msgs = await r.json();
      for (const m of msgs) {
        if (m.type === 'command' && m.body?.text) {
          const job = daemon.enqueueText(String(m.body.text).trim());
          if (job.ambiguous) log(`☁ 指令重名被拒:「${job.ambiguous}」`);
          else log(`☁ 收到指令 → [${job.project}] ${job.prompt}`);
        } else if (m.type === 'approval') {
          daemon.respondFromRelay(m.body ?? {});
          log('☁ 收到批准应答');
        } else if (m.type === 'choice') {
          daemon.respondChoiceFromRelay(m.body ?? {});
          log(`☁ 收到选择题回选: ${JSON.stringify(m.body)}`);
        } else if (m.type === 'alias') {
          await daemon.onAlias?.(m.body ?? {});
          log(`☁ 收到改名:「${m.body?.alias}」`);
        } else if (m.type === 'settings') {
          await daemon.onSettings?.(m.body ?? {});
          log(`☁ 收到设置: ${JSON.stringify(m.body)}`);
        } else if (m.type === 'resync') {
          await daemon.onResync?.(m.body ?? {});
          log(`☁ 强制重推 [${m.body?.project}]`);
        }
      }
    } catch {
      await new Promise((s) => setTimeout(s, 5000)); // 断网等 5 秒再试
    }
  }
}

// ── 启动入口 ──
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  // systemd/计划任务的 PATH 很窄,补上各 CLI 的常见安装位置,否则 spawn 找不到 claude/codex/hermes
  const extra = [
    join(homedir(), '.local', 'bin'),
    join(homedir(), '.npm-global', 'bin'),
    '/opt/homebrew/bin', '/usr/local/bin',
  ];
  process.env.PATH = [...extra, process.env.PATH ?? ''].join(':');

  const dir = join(homedir(), '.earpiece');
  mkdirSync(dir, { recursive: true });

  // 启动即清理 agent-hub 注册表里的死进程残留,避免越堆越乱(抗重启:每次开机/重启都自清)。
  try {
    const regPath = join(homedir(), '.claude', 'agent-hub', 'registry.json');
    if (existsSync(regPath)) {
      const reg = JSON.parse(readFileSync(regPath, 'utf8'));
      let changed = false;
      for (const [k, v] of Object.entries(reg.sessions ?? {})) {
        let alive = false;
        try { process.kill(v.pid, 0); alive = true; } catch { /* 进程已死 */ }
        if (!alive) { delete reg.sessions[k]; changed = true; }
      }
      if (changed) writeFileSync(regPath, JSON.stringify(reg, null, 2));
    }
  } catch { /* 注册表坏/没装 hub:忽略 */ }

  const tokenPath = join(dir, 'lan-token');
  if (!existsSync(tokenPath)) {
    writeFileSync(tokenPath, randomBytes(16).toString('hex'), { mode: 0o600 });
    console.log('已生成新 LAN token');
  }
  const token = readFileSync(tokenPath, 'utf8').trim();

  const projectsPath = join(dir, 'projects.json');
  const projects = existsSync(projectsPath) ? JSON.parse(readFileSync(projectsPath, 'utf8')) : {};

  // APNs 配置:优先 ~/.earpiece/apns.json,兼容仓库内 spike/apns.json
  const apnsPath = [
    join(dir, 'apns.json'),
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'spike', 'apns.json'),
  ].find(existsSync) ?? null;
  const apnsConfig = apnsPath ? JSON.parse(readFileSync(apnsPath, 'utf8')) : null;
  // 动态设备 token:手机上报到中继,daemon 周期取来覆盖静态 deviceToken(治"重装后通知到不了")。
  let liveApnsToken = null;
  const apnsCfg = () => (liveApnsToken && apnsConfig ? { ...apnsConfig, deviceToken: liveApnsToken } : apnsConfig);

  // 用户设置(播报级别等):手机滑块改完经 relay 下发,落盘生效
  const settingsPath = join(dir, 'settings.json');
  const userSettings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
  // 产品是"耳机里":默认电脑不出声,播报由手机念(iOS SpeechOutput / Android EarpieceService)。
  // 想让电脑也念,settings.json 里设 speakOnComputer:true。
  const speakLocal = userSettings.speakOnComputer === true;
  const defaults = {
    level: Number(userSettings.level) || 3,
    silent: !speakLocal,   // 传给 runTask:任务播报不在电脑出声
    push: apnsConfig ? apnsPath : null,
    // 批准桥接:runTask 会把权限请求经 approval-mcp 转回本 daemon
    approval: {
      daemonUrl: 'http://127.0.0.1:7780',
      token,
      mcpPath: join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'approval-mcp.mjs'),
      askMcpPath: join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'ask-mcp.mjs'),
    },
  };

  // 批准播报:本机出声 + 手机带「批准/拒绝」按钮的推送。
  // 推送优先走中继集中发(/approval/notify)——这样没有 .p8 的机器(如 Windows)也能弹到手机;
  // 没配中继才退回本机直发(需本机有 apns.json+.p8)。二选一,避免重复通知。
  const announce = async ({ id, project, summary }) => {
    const text = `${summary}，批准吗？`;
    speak({ project, text }, { silent: !speakLocal }).catch(() => {});
    if (relayApi) {
      relayApi.post('/approval/notify', { id, project, summary }).catch(() => {});
    } else if (apnsConfig) {
      sendPush(apnsCfg(), buildPayload({ project, text, category: 'APPROVAL', extra: { approvalId: id } }))
        .catch((e) => console.error('APNs:', e.message));
    }
  };

  // 选择题播报:本机念问题 + 经中继统一推送(①②③ 通知);无中继才本机直发。
  const announceChoice = async ({ id, project, question, options }) => {
    const spoken = `${question}。${options.map((o, k) => `${k + 1}、${o}`).join(';')}`;
    speak({ project, text: spoken }, { silent: !speakLocal }).catch(() => {});
    if (relayApi) {
      relayApi.post('/choice/notify', { id, project, question, options }).catch(() => {});
    } else if (apnsConfig) {
      const body = `${question}\n${options.map((o, k) => `${k + 1}. ${o}`).join('\n')}`;
      sendPush(apnsCfg(), buildPayload({ project, text: body, category: 'CHOICE', extra: { choiceId: id, options } }))
        .catch((e) => console.error('APNs:', e.message));
    }
  };

  // 机器名:多电脑时区分信箱格子。默认主机名,可用 ~/.earpiece/machine-id 覆盖
  const machineIdPath = join(dir, 'machine-id');
  const machine = (existsSync(machineIdPath)
    ? readFileSync(machineIdPath, 'utf8').trim()
    : hostname().split('.')[0]).replace(/[^\w一-龥-]/g, '-');

  // 公网 Relay(可选):~/.earpiece/relay.json = { "urls": ["https://主中继","https://备中继"] }
  // 兼容旧单 url 形态。双中继互为兜底:写=两边都发,读=按序试,取信=两边各挂一条长轮询。
  // bearer 用账户密钥(多租户隔离):account.json 优先,旧设备回退 relay.json.token,全新装则生成。
  const relayPath = join(dir, 'relay.json');
  const relayConfig = existsSync(relayPath)
    ? (() => {
        const c = JSON.parse(readFileSync(relayPath, 'utf8'));
        const urls = (c.urls ?? [c.url]).filter(Boolean);
        return { ...c, urls, url: urls[0], token: resolveAccountKey(dir), machine };
      })()
    : null;
  const logLine = makeRelayLogger(relayConfig); // 字幕回放

  // 系统提示(重名拒绝等):Mac 出声 + 推手机
  const notify = ({ project, text }) => {
    speak({ project, text }, { silent: !speakLocal }).catch(() => {});
    if (apnsConfig) sendPush(apnsCfg(), buildPayload({ project, text })).catch(() => {});
  };

  const daemon = createDaemon({
    token, projects, announce, announceChoice, logLine, notify,
    // 桥优先:claude 项目若本机有"同目录的活终端窗口"(agent-hub),指令注入那个窗口
    // —— 手机和电脑前是同一个对话。注入失败(没终端/端口死)才退回无头分身。
    runner: async (job) => {
      if (!job.agent || job.agent === 'claude') {
        const hub = findHubSession(job.cwd);
        if (hub && await runViaHub(job, hub, { notify, logLine })) return;
      }
      return runTask(job);
    },
    defaults: {
      ...defaults,
      // 每句播报顺手记进字幕(assistant 气泡)
      onSpoken: (item) => logLine({ project: item.project, role: 'assistant', text: item.text }),
    },
  });

  // 项目注册表:扫描现成的 Claude/Codex 项目 + 别名,每分钟刷新并上报 relay
  const aliasesPath = join(dir, 'aliases.json');
  let registry = [];
  // hermes 没有项目目录,它的单位是会话。装了 hermes(~/.hermes 存在)就把每个会话
  // 摆成一个只读项目(scanHermesSessions 跑 `hermes sessions list` 解析,带 sessionId 句柄)。

  async function refreshRegistry() {
    registry = buildRegistry([...scanClaude(), ...scanCodex(), ...scanHermesSessions()], loadAliases(aliasesPath));
    daemon.setResolver((text) => resolveSpoken(text, registry));
    if (relayConfig) {
      const body = JSON.stringify(registry.map(({ name, cwd, agent, base, lastActive, needsRename, aliased }) =>
        ({ name, cwd, agent, base, lastActive, needsRename, aliased })));
      for (const u of relayConfig.urls) {
        fetch(`${u}/registry?machine=${encodeURIComponent(machine)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${relayConfig.token}` },
          body,
        }).catch(() => {});
      }
    }
  }
  // 历史回填:项目在 relay 上没字幕时,从电脑会话档案抽最近 10 条补上
  // 读:按序试到第一个成功;写:两边都发(兜底语义)
  const auth = () => ({ authorization: `Bearer ${relayConfig.token}` });
  // 所有中继 fetch 必须带超时:某个中继连上但不回应(挂住)会让整个串行回填循环
  // 永远卡死、后面项目(如「耳机」)永远轮不到 —— 这是手机停更的真凶。
  const RELAY_TIMEOUT = 10_000;
  const sig = () => AbortSignal.timeout(RELAY_TIMEOUT);
  const relayApi = relayConfig && {
    get: async (path) => {
      for (const u of relayConfig.urls) {
        try {
          const r = await fetch(`${u}${path}`, { headers: auth(), signal: sig() });
          if (r.ok) return await r.json();
        } catch { /* 超时/失败 → 下一个 */ }
      }
      throw new Error('all relays down');
    },
    log: (line) => Promise.all(relayConfig.urls.map((u) => fetch(`${u}/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth() },
      body: JSON.stringify(line),
      signal: sig(),
    }).catch(() => {}))),
    del: (path) => Promise.all(relayConfig.urls.map((u) => fetch(`${u}${path}`, {
      method: 'DELETE', headers: auth(), signal: sig(),
    }).catch(() => {}))),
    post: (path, body) => Promise.all(relayConfig.urls.map((u) => fetch(`${u}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth() },
      body: JSON.stringify(body),
      signal: sig(),
    }).catch(() => {}))),
  };
  // 历史 = 会话档案最近 50 条人话。配额优化:单请求批量回填(/history/seed,服务端
  // 保留现场行)。档案变了就刷(mtime 检测),不再额外节流 —— 配额凶手是"一次回填发 52
  // 个请求",已用批量端点(1 请求)根治;原来的 5 分钟节流是多余的,还把活跃项目卡住停更。
  const seededMtime = new Map();  // 项目名 → 上次回填的签名(mtime/会话 sig);相等才跳过
  async function pushHistory(name, tail) {
    if (!tail.length) return;
    const baseTs = Date.now() - (tail.length + 1) * 1000;
    const lines = [
      { role: 'event', text: t('recentFromComputer'), ts: baseTs },
      ...tail.map((l, i) => ({ ...l, ts: baseTs + (i + 1) * 1000 })),
    ];
    await relayApi.post('/history/seed', { project: name, lines });
  }
  async function refreshHistories() {
    if (!relayApi) return;
    for (const e of registry) {
      try { // 单个项目失败/超时不连累后面的项目(否则前面卡住,「耳机」永远轮不到)
        // hermes 会话:没有磁盘档案,导出会话拿消息。签名(message_count:ended_at)变了才重推。
        if (e.agent === 'hermes' && e.sessionId) {
          const obj = exportHermesSession(e.sessionId);
          if (!obj) continue;
          const { sig: hsig, lines } = parseHermesHistory(obj, 50);
          if (seededMtime.get(e.name) === hsig) continue;
          seededMtime.set(e.name, hsig);
          await pushHistory(e.name, lines);
          continue;
        }
        if (!e.file) continue;
        let mtime = 0;
        try { mtime = statSync(e.file).mtimeMs; } catch { continue; }
        if (seededMtime.get(e.name) === mtime) continue; // 没变化,跳过
        const tail = extractTail(e.file, 50);
        seededMtime.set(e.name, mtime);
        await pushHistory(e.name, tail);
      } catch { /* 这个项目这轮跳过,下轮再试 */ }
    }
  }

  daemon.onAlias = async ({ alias, cwd, agent }) => {
    try {
      // 广播消息:这个项目不在本机就不归我管,静默忽略(在哪台机就由哪台应答)
      if (!registry.some((r) => r.cwd === cwd && r.agent === agent)) return;
      // 搬历史:旧名下的字幕复制到新名(改名不丢上下文)
      const old = registry.find((r) => r.cwd === cwd && r.agent === agent)?.name;
      saveAlias(aliasesPath, alias, { cwd, agent });
      if (relayApi && old && old !== alias) {
        const lines = await relayApi.get(`/history?project=${encodeURIComponent(old)}`).catch(() => []);
        for (const l of (Array.isArray(lines) ? lines : [])) {
          await relayApi.log({ project: alias, ...l });
        }
      }
      await refreshRegistry();
      notify({ project: t('assistantName'), text: t('renamed', { alias }) });
    } catch (e) {
      notify({ project: t('assistantName'), text: e.message });
    }
  };
  daemon.onSettings = async ({ level }) => {
    const lv = Number(level);
    if (lv >= 1 && lv <= 5) {
      defaults.level = lv; // runner 每次任务展开 defaults,即时生效
      userSettings.level = lv;
      writeFileSync(settingsPath, JSON.stringify(userSettings, null, 2));
      notify({ project: t('assistantName'), text: t('levelChanged', { level: lv }) });
    }
  };
  // 强制同步:手机在某项目里点刷新 → 重扫该项目(压缩/续会话也跟上)→ 立刻重推最新尾巴。
  // 绕过 seededMtime 缓存,无条件推一次。
  daemon.onResync = async ({ project }) => {
    if (!relayApi || !project) return;
    await refreshRegistry();
    const e = registry.find((r) => r.name === project);
    if (!e) return;
    let lines = [];
    if (e.agent === 'hermes' && e.sessionId) {
      const obj = exportHermesSession(e.sessionId);
      lines = obj ? parseHermesHistory(obj, 50).lines : [];
    } else if (e.file) {
      lines = extractTail(e.file, 50);
      try { seededMtime.set(e.name, statSync(e.file).mtimeMs); } catch { /* 档案没了就算 */ }
    }
    await pushHistory(e.name, lines);
  };

  // 实时状态上报(App 内横幅/状态行用),10 秒一拍。带本机局域网 IP,供手机直连发现。
  if (relayApi) {
    setInterval(() => {
      const stateBody = JSON.stringify({ ...daemon.state(), lanIPs: lanIPs() });
      for (const u of relayConfig.urls) {
        fetch(`${u}/state?machine=${encodeURIComponent(machine)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${relayConfig.token}` },
          body: stateBody,
        }).catch(() => {});
      }
    }, 20_000); // 状态上报 20s 一拍(配额优化,原 10s)
    // 周期取手机上报的 APNs token(重装/换机后自动跟上,推送不再发去死 token)
    const pullToken = () => relayApi.get('/apns-token').then((r) => { if (r?.token) liveApnsToken = r.token; }).catch(() => {});
    pullToken();
    setInterval(pullToken, 30_000);
  }

  refreshRegistry().then(refreshHistories);
  setInterval(() => refreshRegistry().then(refreshHistories), 60_000); // 配额优化,原 30s
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => daemon.handle(req, res, body));
  });
  server.listen(7780, '0.0.0.0', () => {
    console.log(`▶ Earpiece daemon 监听 0.0.0.0:7780,已注册项目: ${Object.keys(projects).join(', ') || '(无)'}`);
  });

  if (relayConfig) for (const u of relayConfig.urls) pullLoop({ ...relayConfig, url: u }, daemon);
}

// 字幕回放:往 relay 报一行(发不出去就算了,绝不影响主流程)
export function makeRelayLogger(relay) {
  if (!relay) return () => {};
  const urls = relay.urls ?? [relay.url];
  return (line) => {
    const body = JSON.stringify({ ...line, ts: Date.now() });
    for (const u of urls) {
      fetch(`${u}/log`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${relay.token}` },
        body,
      }).catch(() => {});
    }
  };
}
