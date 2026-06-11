#!/usr/bin/env bash
# 卸载 Earpiece daemon 的 LaunchAgent。
# 幂等:未安装时执行也不会报错。
set -euo pipefail

LABEL="com.earpiece.daemon"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# 先停掉并从 launchd 卸载(未加载时忽略错误)
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true

# 删除 plist(不存在也不报错)
rm -f "$PLIST"

echo "已卸载 $LABEL(plist 已删除,daemon 已停止)"
