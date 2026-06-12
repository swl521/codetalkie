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
import { speak } from './speaker.js';
import { buildPayload, sendPush } from './apns.js';
import { scanClaude, scanCodex, scanHermesSessions, exportHermesSession, parseHermesHistory } from './scanProjects.js';
import { buildRegistry, resolveSpoken, saveAlias, loadAliases } from './registry.js';
import { extractTail } from './transcriptTail.js';

// 纯逻辑核心,可注入假 runner / announce 测试
export function createDaemon({
  token, runner = runTask, projects = {}, defaults = {},
  announce = async () => {}, approvalTimeoutMs = 120_000,
  logLine = () => {}, // 字幕回放:{project, role:'user'|'assistant'|'event', text}
  notify = () => {}, // 系统提示音(如重名拒绝):({project, text})
  resolver = null,   // 语音解析(text)→job|{ambiguous}|null;不传则用 projects 映射表
}) {
  const queue = [];
  let current = null;
  const approvals = new Map(); // id → { res(挂起的HTTP响应), timer, input }

  // 把挂起的权限请求收口:approve=true 放行(回 allow+原参数),false 拒绝
  function respondApproval(id, approve, denyMsg = '用户拒绝了') {
    const a = approvals.get(id);
    if (!a) return false;
    clearTimeout(a.timer);
    approvals.delete(id);
    a.res.writeHead(200, { 'Content-Type': 'application/json' });
    a.res.end(JSON.stringify(approve
      ? { behavior: 'allow', updatedInput: a.input }
      : { behavior: 'deny', message: denyMsg }));
    logLine({ project: a.project, role: 'event', text: approve ? '✅ 已批准' : `⛔ ${denyMsg}` });
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
      const msg = `有两个项目都叫「${job.ambiguous}」,先在手机上改个名再叫我`;
      notify({ project: '小易', text: msg });
      logLine({ project: job.ambiguous, role: 'event', text: `⚠️ ${msg}` });
      return job;
    }
    queue.push(job);
    pump();
    logLine({ project: job.project, role: 'user', text: (job.agent === 'codex' ? '[codex] ' : '') + job.prompt });
    // 收到即回显任务(代替"开始干活了"):让用户确认指令到位、并复述任务
    notify({ project: job.project, text: `收到,${job.prompt}` });
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
      const job = enqueueText(text);
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ queued: job.project, prompt: job.prompt }));
      return;
    }
    if (req.method === 'POST' && req.url === '/approval/request') {
      // 来自 approval-mcp(claude 的 --permission-prompt-tool):挂起响应,等手机
      let parsed;
      try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
      const id = randomUUID().slice(0, 8);
      const project = current?.project ?? 'agent';
      const summary = summarizeToolRequest(parsed.tool_name, parsed.input);
      const timer = setTimeout(() => respondApproval(id, false, '等太久没人批,先拒绝了'), approvalTimeoutMs);
      approvals.set(id, { id, res, timer, input: parsed.input ?? {}, project, summary });
      logLine({ project, role: 'event', text: `🔔 ${summary},等待批准` });
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

  return {
    handle, queueSize: () => queue.length, enqueueText, respondFromRelay,
    setResolver: (fn) => { currentResolver = fn; },
    // 手机端实时状态:在干什么、排几个、几个等批准(含摘要,供 App 内横幅直接批/拒)
    state: () => ({
      running: current?.project ?? null,
      queued: queue.length,
      pending: [...approvals.values()].map(({ id, project, summary }) => ({ id, project, summary })),
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
        } else if (m.type === 'alias') {
          await daemon.onAlias?.(m.body ?? {});
          log(`☁ 收到改名:「${m.body?.alias}」`);
        } else if (m.type === 'settings') {
          await daemon.onSettings?.(m.body ?? {});
          log(`☁ 收到设置: ${JSON.stringify(m.body)}`);
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

  // 用户设置(播报级别等):手机滑块改完经 relay 下发,落盘生效
  const settingsPath = join(dir, 'settings.json');
  const userSettings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
  const defaults = {
    level: Number(userSettings.level) || 3,
    push: apnsConfig ? apnsPath : null,
    // 批准桥接:runTask 会把权限请求经 approval-mcp 转回本 daemon
    approval: {
      daemonUrl: 'http://127.0.0.1:7780',
      token,
      mcpPath: join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'approval-mcp.mjs'),
    },
  };

  // 批准播报:Mac 出声 + 手机带「批准/拒绝」按钮的推送
  const announce = async ({ id, project, summary }) => {
    const text = `${summary}，批准吗？`;
    speak({ project, text }).catch(() => {});
    if (apnsConfig) {
      sendPush(apnsConfig, buildPayload({ project, text, category: 'APPROVAL', extra: { approvalId: id } }))
        .catch((e) => console.error('APNs:', e.message));
    }
  };

  // 机器名:多电脑时区分信箱格子。默认主机名,可用 ~/.earpiece/machine-id 覆盖
  const machineIdPath = join(dir, 'machine-id');
  const machine = (existsSync(machineIdPath)
    ? readFileSync(machineIdPath, 'utf8').trim()
    : hostname().split('.')[0]).replace(/[^\w一-龥-]/g, '-');

  // 公网 Relay(可选):~/.earpiece/relay.json = { "url": "https://your-relay.example.com", "token": "..." }
  const relayPath = join(dir, 'relay.json');
  const relayConfig = existsSync(relayPath)
    ? { ...JSON.parse(readFileSync(relayPath, 'utf8')), machine }
    : null;
  const logLine = makeRelayLogger(relayConfig); // 字幕回放

  // 系统提示(重名拒绝等):Mac 出声 + 推手机
  const notify = ({ project, text }) => {
    speak({ project, text }).catch(() => {});
    if (apnsConfig) sendPush(apnsConfig, buildPayload({ project, text })).catch(() => {});
  };

  const daemon = createDaemon({
    token, projects, announce, logLine, notify,
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
      fetch(`${relayConfig.url}/registry?machine=${encodeURIComponent(machine)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${relayConfig.token}` },
        body: JSON.stringify(registry.map(({ name, cwd, agent, base, lastActive, needsRename, aliased }) =>
          ({ name, cwd, agent, base, lastActive, needsRename, aliased }))),
      }).catch(() => {});
    }
  }
  // 历史回填:项目在 relay 上没字幕时,从电脑会话档案抽最近 10 条补上
  const relayApi = relayConfig && {
    get: (path) => fetch(`${relayConfig.url}${path}`, {
      headers: { authorization: `Bearer ${relayConfig.token}` },
    }).then((r) => r.json()),
    log: (line) => fetch(`${relayConfig.url}/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${relayConfig.token}` },
      body: JSON.stringify(line),
    }).catch(() => {}),
    del: (path) => fetch(`${relayConfig.url}${path}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${relayConfig.token}` },
    }).catch(() => {}),
  };
  // 历史 = 会话档案最近 10 条人话。档案 mtime 变了(=又聊了)就重抽替换,所以会跟着实时刷新。
  const seededMtime = new Map(); // 项目名 → 上次回填用的档案 mtime
  async function pushHistory(name, tail) {
    if (!tail.length) return;
    const baseTs = Date.now() - tail.length * 1000;
    await relayApi.del(`/history?project=${encodeURIComponent(name)}`);
    await relayApi.log({ project: name, role: 'event', text: '↻ 电脑上的最近记录', ts: baseTs - 1000 });
    for (let i = 0; i < tail.length; i++) {
      await relayApi.log({ project: name, ...tail[i], ts: baseTs + i * 1000 });
    }
  }
  async function refreshHistories() {
    if (!relayApi) return;
    for (const e of registry) {
      // hermes 会话:没有磁盘档案,导出会话拿消息。签名(message_count:ended_at)变了才重推。
      if (e.agent === 'hermes' && e.sessionId) {
        const obj = exportHermesSession(e.sessionId);
        if (!obj) continue;
        const { sig, lines } = parseHermesHistory(obj, 10);
        if (seededMtime.get(e.name) === sig) continue;
        seededMtime.set(e.name, sig);
        await pushHistory(e.name, lines);
        continue;
      }
      if (!e.file) continue;
      let mtime = 0;
      try { mtime = statSync(e.file).mtimeMs; } catch { continue; }
      if (seededMtime.get(e.name) === mtime) continue; // 没变化,跳过
      const tail = extractTail(e.file, 10);
      seededMtime.set(e.name, mtime);
      await pushHistory(e.name, tail);
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
      notify({ project: '小易', text: `好,以后叫「${alias}」` });
    } catch (e) {
      notify({ project: '小易', text: e.message });
    }
  };
  daemon.onSettings = async ({ level }) => {
    const lv = Number(level);
    if (lv >= 1 && lv <= 5) {
      defaults.level = lv; // runner 每次任务展开 defaults,即时生效
      userSettings.level = lv;
      writeFileSync(settingsPath, JSON.stringify(userSettings, null, 2));
      notify({ project: '小易', text: `好,播报改成 ${lv} 级` });
    }
  };

  // 实时状态上报(App 内横幅/状态行用),10 秒一拍。带本机局域网 IP,供手机直连发现。
  if (relayApi) {
    setInterval(() => {
      fetch(`${relayConfig.url}/state?machine=${encodeURIComponent(machine)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${relayConfig.token}` },
        body: JSON.stringify({ ...daemon.state(), lanIPs: lanIPs() }),
      }).catch(() => {});
    }, 10_000);
  }

  refreshRegistry().then(refreshHistories);
  setInterval(() => refreshRegistry().then(refreshHistories), 30_000);
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => daemon.handle(req, res, body));
  });
  server.listen(7780, '0.0.0.0', () => {
    console.log(`▶ Earpiece daemon 监听 0.0.0.0:7780,已注册项目: ${Object.keys(projects).join(', ') || '(无)'}`);
  });

  if (relayConfig) pullLoop(relayConfig, daemon);
}

// 字幕回放:往 relay 报一行(发不出去就算了,绝不影响主流程)
export function makeRelayLogger(relay) {
  if (!relay) return () => {};
  return (line) => {
    fetch(`${relay.url}/log`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${relay.token}` },
      body: JSON.stringify({ ...line, ts: Date.now() }),
    }).catch(() => {});
  };
}
