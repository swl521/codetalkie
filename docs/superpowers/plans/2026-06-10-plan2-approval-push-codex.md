# Plan 2:批准桥接 + 真机推送 + Codex 驱动

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan 1 的管线上补三块:权限请求转外部批准(approval.needed 真正触发)、播报经 APNs 推到 iPhone(接通 spike)、`codex exec --json` 作为第二个被驱动的 CLI。

**Architecture:** 批准走 `--permission-prompt-tool` + 本地 MCP 工具(HTTP 回调 Desktop Agent,先用终端 y/n + 语音提示当"假手机",iOS 好了换真手机);推送 sink 与 `say` sink 并联;Codex 复用 driver,换 args 和归一器。

**Tech Stack:** 同 Plan 1(Node 25 零依赖)。研究依据:两份 2026-06-10 后台调研简报(见 git log 与记忆)。

**已完成(写 plan 前已落地,2026-06-10):**
- ✅ `agent/src/apns.js`:payload + ES256 JWT(验签测试)+ http2 发送
- ✅ `agent/src/sessions.js` + main.js 自动 `--resume`(持续对话=串行 resume 链;`--fresh` 强制新会话)
- ✅ `agent/src/normalizeCodex.js`:thread/turn/item → 7/8 事件(exec 模式无 approval,by design)

---

### Task A: 推送 sink(管线 → iPhone)

**Files:**
- Create: `agent/src/pushSink.js`
- Modify: `agent/src/main.js`(加 `--push <配置文件>` 选项)
- Test: `agent/test/pushSink.test.js`

- [ ] Step 1 失败测试:`pushSink.test.js` — 给定假 sender(收集调用),`makePushSink(cfg, fakeSend)` 返回的函数被 `{project:'wiki',text:'测试过了',urgent:false}` 调用后,fakeSend 收到 `(cfg, payload)`,payload.aps.alert = `{title:'wiki',body:'测试过了'}`,`interruption-level: 'time-sensitive'`;urgent=true 时不变(仍 time-sensitive,critical 需特批,不用)。

```js
import { buildPayload, sendPush } from './apns.js';
// 配置文件 JSON:{p8Path,keyId,teamId,bundleId,deviceToken,host?}
export function makePushSink(config, send = sendPush) {
  return async ({ project, text }) => {
    const res = await send(config, buildPayload({ project, text }));
    if (res.status !== 200) console.error(`APNs ${res.status}: ${res.body}`);
    return res;
  };
}
```

- [ ] Step 2 红 → 实现 → 绿:`npm test`
- [ ] Step 3 main.js 接入:`--push apns.json` 时 drain 循环里 `speak` 后并行 `pushSink(item)`(推送失败只 console.error,不阻塞播报)。
- [ ] Step 4 Commit:`feat: APNs push sink`
- [ ] Step 5 【需用户】端到端:iPhone spike App 拿到 token 填进 `apns.json`(已 gitignore 形如 AuthKey),跑 `node agent/src/main.js --push apns.json --project demo --level 3 "..."`,锁屏戴 AirPods 听 Siri 念管线播报。**这是产品第一次完整闭环。**

### Task B: 批准桥接(approval.needed 激活)

**Files:**
- Create: `agent/src/approvalServer.js`(HTTP,监听 127.0.0.1:7779)
- Create: `agent/tools/approval-mcp.mjs`(stdio MCP server,claude 调它,它 POST 7779)
- Modify: `agent/src/main.js`(起 approvalServer;收到请求 → 入队 urgent 播报「X,等你批准」→ MVP 用终端 y/n 应答;预留 phone 应答接口)
- Test: `agent/test/approvalServer.test.js`

- [ ] Step 1 失败测试:approvalServer — POST `/approve` `{tool_name:'Bash',input:{command:'rm x'}}` 后,`pendingApprovals()` 出现一项;调用 `resolveApproval(id, true)` 后 POST 的响应体为 `{behavior:'allow',updatedInput:{command:'rm x'}}`;`resolveApproval(id,false)` → `{behavior:'deny',message:…}`。60s 无应答自动 deny。
- [ ] Step 2 红 → 实现(http.createServer,挂起的 res 存 Map)→ 绿
- [ ] Step 3 approval-mcp.mjs:最小 stdio MCP(initialize/tools/list/tools/call 三个方法,零依赖手写 JSON-RPC),tool `approve` 收到参数原样 POST 7779,把响应作为 tool result 返回。
- [ ] Step 4 main.js:spawn claude 时加 `--permission-prompt-tool mcp__approval__approve --mcp-config agent/tools/approval-mcp.json`;approval 请求产生 `approval.needed` 事件入管线(底线,必播);终端读 y/n 调 resolveApproval。
- [ ] Step 5 Commit:`feat: approval bridge (permission-prompt-tool → local HTTP)`
- [ ] Step 6 【需用户】真机验证:用户终端跑一个会触发权限的任务(如让它删个文件),听到「要删 X,等你批准」,按 y 放行。⚠️ 研究简报标注 `--permission-prompt-tool` 文档稀少,**这步必须实测,接口形状可能要按实际调**。

### Task C: Codex 驱动接入

**Files:**
- Modify: `agent/src/main.js`(`--agent codex`:bin='codex',args=`['exec','--json',prompt]`,resume=`['exec','resume',id,prompt]`,归一器换 normalizeCodexMessage)
- Modify: `agent/src/driver.js`(`codexArgs(prompt,{resume})` 函数 + 测试)

- [ ] Step 1 失败测试:`codexArgs('x')` → `['exec','--json','x']`;`codexArgs('x',{resume:'th-1'})` → `['exec','resume','th-1','--json','x']`(顺序以实测为准,简报未给全,先按此假设)
- [ ] Step 2 红 → 实现 → 绿;main.js 按 `--agent` 选 bin/args/归一器,sessions key 加 agent 前缀(`codex:wiki`)
- [ ] Step 3 Commit:`feat: codex exec driver`
- [ ] Step 4 【需用户】装了 codex 的话实测一次;Codex 批准走 sandbox 级别(`--sandbox workspace-write`),exec 模式无 approval 事件——文档里注明这个差异。

### 不做(记录在案)

- Codex app-server JSON-RPC 批准(二期,等 iOS 端有了真批准 UI 一起做)
- critical 中断级别(要 Apple 特批 entitlement)
- 运行中插话(CLI 不支持,resume 链已覆盖需求)

## 自查

- 覆盖:approval.needed 激活(B)、推送送达(A)、Codex(C),对应记忆里"下个 plan"四项中三项;--resume 已提前完成。
- 占位:Task B Step 3 的 MCP 协议细节和 C 的 resume 参数顺序标注了"按实测调",是显式风险标记非占位。
- 一致:pushSink 用 Task 3 已交付的 buildPayload/sendPush 签名;approval 事件字段 `summary` 与 translate.js 模板一致。
