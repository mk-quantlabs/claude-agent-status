#!/usr/bin/env bash
# Agent Status installer.
#   ./install.sh               installs the plugin in Claude Code, adds the `claude-s` command and
#                              the menu-bar icon (macOS)
#   ./install.sh --no-plugin   skips the Claude Code plugin install (use `claude-s` to start sessions)
#   ./install.sh --no-menubar  skips the menu-bar icon
#   ./install.sh --no-alias    doesn't add the claude-s alias (and removes an old one), for
#                              installs that put claude-s on PATH (Homebrew)
# AGENT_STATUS_HOME, when set, is the folder registered with Claude Code instead of this
# script's folder (Homebrew passes its upgrade-proof opt/ path).
set -euo pipefail

ROOT="${AGENT_STATUS_HOME:-$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
MENUBAR=1
PLUGIN=1
ALIAS=1
PLUGIN_OK=0
for arg in "$@"; do
  case "$arg" in
    --no-menubar) MENUBAR=0 ;;
    --no-plugin) PLUGIN=0 ;;
    --no-alias) ALIAS=0 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 1 ;;
  esac
done

g=$'\e[32m'; y=$'\e[33m'; r=$'\e[31m'; b=$'\e[1m'; n=$'\e[0m'
ok()   { printf '%s✓%s %s\n' "$g" "$n" "$*"; }
note() { printf '%s!%s %s\n' "$y" "$n" "$*"; }
fail() { printf '%s✗ %s%s\n' "$r" "$*" "$n" >&2; exit 1; }

echo "${b}Installing Agent Status${n}  ($ROOT)"

# Requirements
command -v node >/dev/null || fail "Node.js 18+ is required (macOS: brew install node)"
major="$(node -p 'process.versions.node.split(".")[0]')"
[ "$major" -ge 18 ] || fail "Node.js 18+ is required (found $(node -v))"
ok "Node $(node -v)"
command -v claude >/dev/null && ok "Claude Code found" || note "Claude Code not found on PATH — install it before running claude-s"

case "$ROOT" in
  "$HOME/Documents"*|"$HOME/Desktop"*|"$HOME/Downloads"*)
    note "This folder is inside Documents/Desktop/Downloads. macOS may block apps like IDE terminals"
    note "from reading it, and their sessions won't show up. Moving it to ~/ is recommended." ;;
esac

# Executable bits
chmod +x "$ROOT/bin/claude-s" "$ROOT/uninstall.sh" "$ROOT/widgets/swiftbar/"*.sh "$ROOT/plugins/agent-status/scripts/report.js" 2>/dev/null || true

# claude-s alias in the shell config file
shell_name="$(basename "${SHELL:-zsh}")"
case "$shell_name" in
  zsh)  rc="$HOME/.zshrc" ;;
  bash) if [ "$(uname)" = "Darwin" ]; then rc="$HOME/.bash_profile"; else rc="$HOME/.bashrc"; fi ;;
  *)    rc="" ;;
esac
line="alias claude-s='$ROOT/bin/claude-s'  # agent-status"
if [ -n "$rc" ]; then
  touch "$rc"
  if grep -q "alias claude-s=" "$rc"; then
    tmp="$(mktemp)"; { grep -v "alias claude-s=" "$rc" || true; } > "$tmp"; cat "$tmp" > "$rc"; rm -f "$tmp"
    [ "$ALIAS" = 0 ] && ok "Removed the old claude-s alias from $rc"
  fi
  if [ "$ALIAS" = 1 ]; then
    if [ -s "$rc" ] && [ -n "$(tail -c1 "$rc")" ]; then echo >> "$rc"; fi
    echo "$line" >> "$rc"
    ok "Added the claude-s command to $rc"
  fi
elif [ "$ALIAS" = 1 ]; then
  note "Unknown shell ($shell_name). Add this line to your shell config yourself:"
  echo "    $line"
fi

# Claude Code plugin: loaded in place from this folder by every `claude` session
if [ "$PLUGIN" = 1 ] && command -v claude >/dev/null; then
  if claude plugin marketplace add "$ROOT" >/dev/null 2>&1 && claude plugin install agent-status@agent-status >/dev/null 2>&1; then
    ok "Plugin installed in Claude Code: every claude session reports its status"
    PLUGIN_OK=1
  else
    note "Plugin install failed; start sessions with claude-s instead (or retry: claude plugin install agent-status@agent-status)"
  fi
elif [ "$PLUGIN" = 1 ]; then
  note "Claude Code not found: plugin not installed; run ./install.sh again after installing Claude Code"
fi

# Menu-bar icon (macOS)
if [ "$MENUBAR" = 1 ] && [ "$(uname)" = "Darwin" ]; then
  "$ROOT/bin/claude-s" menubar --no-claude && ok "Menu-bar icon ready" || note "Menu-bar setup skipped (run: claude-s menubar)"
elif [ "$MENUBAR" = 1 ]; then
  note "Menu-bar icon is macOS-only; use the dashboard instead (claude-s open)"
fi

# A running background service is restarted, so it runs the code installed here.
if curl -s --max-time 1 "http://127.0.0.1:${AGENT_STATUS_PORT:-4317}/health" >/dev/null 2>&1; then
  "$ROOT/bin/claude-s" restart >/dev/null 2>&1 && ok "Restarted the background service"
fi

echo
if [ "$PLUGIN_OK" = 1 ]; then
  echo "${b}Done.${n} Start Claude as usual in any project:"
  echo
  echo "    ${b}claude${n}"
  echo
  if [ "$ALIAS" = 1 ]; then
    echo "Helper commands (open a new terminal or run: source $rc): claude-s status, claude-s awake, claude-s help"
  else
    echo "Helper commands: claude-s status, claude-s notifications, claude-s help"
  fi
else
  echo "${b}Done.${n} Open a new terminal (or run: source $rc), then start Claude with:"
  echo
  echo "    ${b}claude-s${n}"
fi
echo
echo "Dashboard: http://127.0.0.1:4317   ·   All options: claude-s help"
