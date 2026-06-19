# 编排手册 — Hub Orchestrator Guide

> **本手册被 CLAUDE.md 和 AGENTS.md 引用。当你被指定为主脑（leader）时，按照本文档的编排循环执行任务；作为 worker 时跳到末尾的 Worker 节。**

---

## 1. 角色判定

启动时首先读取当前主脑，判断自己是主脑还是 worker：

```bash
node hub/bin/hub.js leader
# 输出示例:
# { "leader": "mac-main", "engine": "claude" }
```

- 若 `leader` 字段 == 本会话名 → **你是主脑**，进入第 2~8 节的编排循环。
- 否则 → **你是 Worker**，等待 channel 消息；收到任务后执行，完成后按下文 Worker 节回报结果。

**Worker 回报方式（二选一）：**

```bash
# Claude：使用 MCP 工具
hub_reply <msgId> '{"ok":true,"summary":"完成","artifacts":[],"next":null,"needsApproval":null}'

# Codex / 其他引擎：使用 CLI
node hub/bin/hub.js reply "<msgId>" '{"ok":true,"summary":"完成","artifacts":[],"next":null,"needsApproval":null}'
```

---

## 2. Mint job_id

每个编排任务开始前生成唯一 job_id，贯穿全流程：

```bash
JOB=$(node -e "console.log(require('crypto').randomBytes(4).toString('hex'))")
echo "job_id: $JOB"
```

该 `$JOB` 用于 `--job` 参数绑定所有 msg_id，也用于升级时写入 `~/.claude/agent-hub/decisions/$JOB.json`。

---

## 3. 计划

将目标拆成**步骤列表**，每步包含：

| 字段 | 说明 |
|------|------|
| `target` | 要派活的会话名（用 `hub list` 查在线会话） |
| `command` | 发给 worker 的完整命令字符串（自包含，不依赖上下文） |
| `artifacts` | 期望的产物（文件路径、结果摘要等） |

**设计原则：本期做"派整包活"** — 每步是一个完整子任务，worker 拿到命令就能独立执行，不做逐回合提线。步骤之间如有依赖，需串行派发；无依赖的可并行（见第 4 节）。

```
步骤示例:
  步骤1: target=wiki-agent  command="更新 llm-wiki 的 CEC 安全规范章节"  artifacts=[wiki 链接]
  步骤2: target=test-agent  command="跑 hub/test/*.test.ts 并输出覆盖率"  artifacts=[覆盖率报告]
```

重规划轮数上限：**maxDepth = 5**（来自 `hub/config/policy.default.json`）。超出则停止并上报。

---

## 4. 派活

每批并行不超过 **maxParallel = 4**。

```bash
# 第一步：确认目标在线
node hub/bin/hub.js list
# 输出: name / engine / status / port / cwd（制表格式）
# 只向 status=idle 的会话派活

# 第二步：派发（不带 --wait，立即返回 msg_id）
MID=$(node hub/bin/hub.js send "<target>" "<step 命令>" --job "$JOB" --from "<本会话名>")
echo "msg_id: $MID"
```

并行派发多步时，依次执行上述命令，收集所有 `MID` 后进入收集阶段。

---

## 5. 收集

对每个 `MID` 轮询回报，等到完成或超时：

```bash
RESULT=$(node hub/bin/hub.js poll "$MID" --wait --timeout 180)
echo "$RESULT"
# 返回 JSON 示例:
# { "ok": true, "summary": "测试全绿，覆盖率 87%", "artifacts": ["coverage.html"], "next": null, "needsApproval": null }
# 或超时:
# { "status": "timeout" }
```

解析字段：

| 字段 | 含义 |
|------|------|
| `ok` | `true` = 成功；`false` = 执行失败 |
| `summary` | worker 的结果摘要，聚合用 |
| `artifacts` | 产物路径/链接列表 |
| `next` | worker 建议的后续步骤（主脑可选择采纳） |
| `needsApproval` | 非空时见第 7 节 |

---

## 6. 错误处理

超时（`status: timeout`）或 `ok == false` → 重试：

```bash
# 同 target 重试，最多 maxRetries = 2 次
for attempt in 1 2; do
  MID=$(node hub/bin/hub.js send "<target>" "<step 命令>" --job "$JOB" --from "<本会话名>")
  RESULT=$(node hub/bin/hub.js poll "$MID" --wait --timeout 180)
  ok=$(echo "$RESULT" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); console.log(JSON.parse(d).ok)")
  [ "$ok" = "true" ] && break
done
```

若目标会话已离线，或重试 2 次仍失败 → **升级到手机**：

```bash
node hub/bin/hub.js escalate "$JOB" "第N步在<target>超时/报错，请选择：换机/跳过/停止？"

# 每 3 秒轮询用户决策
while true; do
  DECISION_FILE="$HOME/.claude/agent-hub/decisions/$JOB.json"
  if [ -f "$DECISION_FILE" ]; then
    DECISION=$(node -e "const d=require('fs').readFileSync('$DECISION_FILE','utf8'); console.log(JSON.parse(d).decision)")
    [ -n "$DECISION" ] && [ "$DECISION" != "null" ] && echo "决策: $DECISION" && break
  fi
  sleep 3
done
# 根据 $DECISION 值继续: "retry:<new_target>" / "skip" / "stop"
```

---

## 7. 批准（needsApproval）

若某步 `result.needsApproval` 非空，说明 worker 触发了危险操作，已通过现有批准桥直达手机审批。

**主脑无需自己批准**，只需继续等待该 worker 的最终回报即可。批准流程复用现有机制，详见 `docs/DEPLOY.md`。

```bash
# 检测到 needsApproval 时的伪代码:
if [ "$(echo "$RESULT" | jq -r '.needsApproval')" != "null" ]; then
  echo "等待手机审批，继续 poll 该 MID…"
  # 重新 poll，等最终结果
  RESULT=$(node hub/bin/hub.js poll "$MID" --wait --timeout 300)
fi
```

---

## 8. 收工

所有步骤完成后：

1. **聚合摘要**：把各步 `result.summary` 拼合为一段话。
2. **念到耳机**：走 relay push 推送聚合摘要（详见 `docs/DEPLOY.md`）。
3. **深度检查**：统计本次重规划轮数，若已达 `maxDepth = 5`，停止并上报。

```bash
# 聚合各步摘要示例
FULL_SUMMARY="Job $JOB 完成。步骤1: $SUMMARY1。步骤2: $SUMMARY2。"

# 推送到耳机（relay push，具体接口见 docs/DEPLOY.md）
# curl -X POST http://<relay>/push -d "{\"text\":\"$FULL_SUMMARY\"}"

echo "编排完成: $FULL_SUMMARY"
```

---

## Worker 节（非主脑时阅读）

收到 `<channel source="agent-hub">` 消息后：

1. 执行消息中的任务命令。
2. 构造结构化回报 JSON：
   ```json
   {
     "ok": true,
     "summary": "一句话描述结果",
     "artifacts": ["可选：产物路径或链接"],
     "next": null,
     "needsApproval": null
   }
   ```
3. 回报（Claude 用 MCP 工具，Codex 用 CLI）：
   ```bash
   # Claude MCP:
   hub_reply <msgId> '<上面的 JSON>'

   # Codex CLI:
   node hub/bin/hub.js reply "<msgId>" '<上面的 JSON>'
   ```
4. 状态自动从 `busy` 回到 `idle`。

---

*本手册引擎中立：Claude 和 Codex 作为主脑时均按此循环执行。job_id/msg_id 贯穿全链路，回报落在 `~/.claude/agent-hub/responses/<msgId>.json`，决策落在 `~/.claude/agent-hub/decisions/<jobId>.json`。*
