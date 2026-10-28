#!/bin/bash
# <xbar.title>Claude agents</xbar.title>
# <xbar.desc>Status of running Claude Code agents; click one to jump to its window.</xbar.desc>
# <swiftbar.hideAbout>true</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
#
# Menu-bar widget for SwiftBar (or xbar). The daemon renders the menu itself;
# this script only fetches it. Refreshes every 3s (from the file name).
out=$(curl -s --max-time 1 "http://127.0.0.1:${AGENT_STATUS_PORT:-4317}/api/swiftbar")
if [ -z "$out" ]; then
  echo "◌ | font=Menlo size=12"
  echo "---"
  echo "Agent-status daemon offline"
else
  echo "$out"
fi
