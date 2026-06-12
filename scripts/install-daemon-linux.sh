#!/usr/bin/env bash
# 安装 Earpiece daemon 到 Linux(systemd --user 优先,失败回退 cron @reboot)。
# 幂等:重复跑覆盖。用法:在仓库目录里  bash scripts/install-daemon-linux.sh
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DAEMON="$REPO/agent/src/daemon.js"
NODE="$(command -v node || true)"
LOGDIR="$HOME/.earpiece"
LOG="$LOGDIR/daemon.log"

[ -z "$NODE" ] && { echo "找不到 node,请先安装 Node.js"; exit 1; }
[ ! -f "$DAEMON" ] && { echo "找不到 $DAEMON"; exit 1; }
mkdir -p "$LOGDIR"

# 先杀掉已在跑的旧实例
pkill -f "$DAEMON" 2>/dev/null || true
sleep 1

if command -v systemctl >/dev/null 2>&1; then
  UNIT="$HOME/.config/systemd/user"
  mkdir -p "$UNIT"
  cat > "$UNIT/earpiece-daemon.service" <<EOF
[Unit]
Description=Earpiece daemon
After=network-online.target

[Service]
ExecStart=$NODE $DAEMON
Restart=always
RestartSec=3
StandardOutput=append:$LOG
StandardError=append:$LOG

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now earpiece-daemon.service
  loginctl enable-linger "$USER" 2>/dev/null || echo "(提示:enable-linger 需要时让管理员跑一次,否则注销后服务停)"
  echo "已用 systemd --user 安装并启动 earpiece-daemon"
else
  # 回退:nohup 起 + cron @reboot 自启
  ( crontab -l 2>/dev/null | grep -v "$DAEMON"; echo "@reboot $NODE $DAEMON >> $LOG 2>&1" ) | crontab -
  nohup "$NODE" "$DAEMON" >> "$LOG" 2>&1 &
  echo "已用 cron @reboot 安装并启动 daemon"
fi
echo "  node: $NODE"
echo "  日志: $LOG"
echo "  状态: curl -s http://127.0.0.1:7780/status -H \"Authorization: Bearer \$(cat ~/.earpiece/lan-token)\""
