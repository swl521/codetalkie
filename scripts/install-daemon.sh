#!/usr/bin/env bash
# 安装 Earpiece daemon 的 LaunchAgent(开机自启)。
# 幂等:重复执行会覆盖 plist 并重新加载,不会产生重复实例。
set -euo pipefail

LABEL="com.earpiece.daemon"
DAEMON_JS="~/codetalkie/agent/src/daemon.js"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/.earpiece"
LOG_FILE="$LOG_DIR/daemon.log"

# 检测 node 路径(LaunchAgent 环境没有 shell PATH,必须写绝对路径)
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "错误:找不到 node,请先安装 Node.js" >&2
  exit 1
fi

if [ ! -f "$DAEMON_JS" ]; then
  echo "错误:找不到 daemon 脚本 $DAEMON_JS" >&2
  exit 1
fi

mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

# 生成 plist(每次覆盖,保证幂等)
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_BIN</string>
        <string>$DAEMON_JS</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$LOG_FILE</string>
    <key>StandardErrorPath</key>
    <string>$LOG_FILE</string>
</dict>
</plist>
EOF

# 已加载则先卸载再加载(幂等;bootout 在未加载时会失败,忽略即可)
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "已安装并加载 $LABEL"
echo "  node:  $NODE_BIN"
echo "  脚本:  $DAEMON_JS"
echo "  日志:  $LOG_FILE"

# 顺手装批准 hook:让终端里开着的 claude 要权限时也弹手机批准(幂等)。
# Mac 多为你坐键盘前的工作站 → 默认**不建**路由标记,hook 装着但休眠,不打扰你的本地操作。
# 要把这台的终端批准也送手机(如常不在机前):touch ~/.earpiece/approval-to-phone
REPO_ROOT="$(cd "$(dirname "$DAEMON_JS")/../.." && pwd)"
"$NODE_BIN" "$REPO_ROOT/scripts/install-approval-hook.mjs" \
  || echo "  ⚠ 批准 hook 安装跳过(可手动:node scripts/install-approval-hook.mjs)"
echo "  批准 hook 已装但休眠(工作站默认);要送手机:touch ~/.earpiece/approval-to-phone"
