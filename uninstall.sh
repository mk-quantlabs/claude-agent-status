#!/usr/bin/env bash
# Agent Status uninstaller: removes the claude-s alias, widgets, daemon and its state.
# Leaves SwiftBar / Übersicht apps installed (remove them with brew if you like).
set -uo pipefail

ok() { printf '\e[32m✓\e[0m %s\n' "$*"; }

pkill -f "agent-status/server/server.js" 2>/dev/null && ok "Stopped the daemon"

for rc in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
  if [ -f "$rc" ] && grep -q "alias claude-s=" "$rc"; then
    tmp="$(mktemp)"; { grep -v "alias claude-s=" "$rc" || true; } > "$tmp"; cat "$tmp" > "$rc"; rm -f "$tmp"
    ok "Removed the claude-s alias from $rc"
  fi
done

if [ "$(uname)" = "Darwin" ]; then
  dir="$(defaults read com.ameba.SwiftBar PluginDirectory 2>/dev/null || true)"
  if [ -n "$dir" ] && [ -f "$dir/claude-agents.3s.sh" ]; then
    rm -f "$dir/claude-agents.3s.sh"; ok "Removed the menu-bar icon"
    open -g "swiftbar://refreshallplugins" 2>/dev/null || true
  fi
  w="$HOME/Library/Application Support/Übersicht/widgets/claude-agents.widget"
  [ -d "$w" ] && rm -rf "$w" && ok "Removed the desktop widget"
fi

rm -rf "${AGENT_STATUS_DIR:-$HOME/.claude/agent-status}" && ok "Removed saved state"
echo "Done. You can now delete this folder."
