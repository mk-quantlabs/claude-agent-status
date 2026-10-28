#!/bin/bash
# <xbar.title>Claude agents</xbar.title>
# <xbar.desc>Status of running Claude Code agents; click one to jump to its window.</xbar.desc>
# <swiftbar.hideAbout>true</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
#
# SwiftBar / xbar plugin: prints the menu served by the Agent Status service.
# The "3s" in the file name sets the refresh interval.
out=$(curl -s --max-time 1 "http://127.0.0.1:${AGENT_STATUS_PORT:-4317}/api/swiftbar")
if [ -z "$out" ]; then
  echo "◌ | font=Menlo size=12"
  echo "---"
  echo "Agent-status daemon offline"
else
  echo "$out"
fi
