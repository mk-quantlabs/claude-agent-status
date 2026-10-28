#!/usr/bin/env bash
# Agent Status installer.
#   ./install.sh               adds the `claude-s` command and the menu-bar icon (macOS)
#   ./install.sh --no-menubar  adds the `claude-s` command only
set -euo pipefail

ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MENUBAR=1
for arg in "$@"; do
  case "$arg" in
    --no-menubar) MENUBAR=0 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
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
chmod +x "$ROOT/bin/claude-s" "$ROOT/uninstall.sh" "$ROOT/widgets/swiftbar/"*.sh "$ROOT/plugins/agent-status/scripts/report.js"

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
  fi
  if [ -s "$rc" ] && [ -n "$(tail -c1 "$rc")" ]; then echo >> "$rc"; fi
  echo "$line" >> "$rc"
  ok "Added the claude-s command to $rc"
else
  note "Unknown shell ($shell_name). Add this line to your shell config yourself:"
  echo "    $line"
fi

# Menu-bar icon (macOS)
if [ "$MENUBAR" = 1 ] && [ "$(uname)" = "Darwin" ]; then
  "$ROOT/bin/claude-s" menubar --no-claude && ok "Menu-bar icon ready" || note "Menu-bar setup skipped (run: claude-s menubar)"
elif [ "$MENUBAR" = 1 ]; then
  note "Menu-bar icon is macOS-only; use the dashboard instead (claude-s open)"
fi

echo
echo "${b}Done.${n} Open a new terminal (or run: source $rc), then start Claude with:"
echo
echo "    ${b}claude-s${n}"
echo
echo "Dashboard: http://127.0.0.1:4317   ·   All options: claude-s help"
