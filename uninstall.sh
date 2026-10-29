#!/usr/bin/env bash
# Agent Status uninstaller: stops the service and removes the Claude Code plugin, the claude-s
# alias, the widgets and the saved state. SwiftBar and Übersicht stay installed.
set -uo pipefail

ok() { printf '\e[32m✓\e[0m %s\n' "$*"; }

pkill -f "node[^ ]* [^ ]*agent-status/server/server\.js" 2>/dev/null && ok "Stopped the daemon"

if command -v claude >/dev/null; then
  claude plugin uninstall agent-status@agent-status >/dev/null 2>&1 && ok "Removed the Claude Code plugin"
  claude plugin marketplace remove agent-status >/dev/null 2>&1
fi

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
case "$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)" in
  */Cellar/*) echo "Done. Remove the program with: brew uninstall agent-status" ;;
  *) echo "Done. You can now delete this folder." ;;
esac
