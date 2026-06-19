#!/usr/bin/env bash
# scripts/zhunao.sh —— 用法: 主脑 <claude|codex> <会话名>
#   写 leader.json,并(若该会话在线)ping 它"你现在是主脑"。
set -euo pipefail
ENGINE="${1:?用法: zhunao.sh <claude|codex> <会话名>}"
NAME="${2:?需要会话名}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$HOME/.claude/agent-hub"
node "$DIR/hub/bin/hub.js" leader set "$NAME" --engine "$ENGINE" >/dev/null
node "$DIR/hub/bin/hub.js" send "$NAME" "你现在是主脑,载入 hub/ORCHESTRATOR.md 待命。" 2>/dev/null || true
echo "主脑已切到 [$ENGINE] $NAME"
