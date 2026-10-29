#!/usr/bin/env bash
# Tests the Homebrew install layout without Homebrew: the files are laid out the way the
# formula installs them (<prefix>/Cellar/agent-status/<version>/libexec, <prefix>/opt link,
# <prefix>/bin links), then setup, the menu, and an upgrade that removes the old version.
# A stand-in `claude` records plugin commands.
# Run: bash tests/homebrew.layout.test.sh
set -u
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(cd -P "$(mktemp -d)" && pwd)"   # resolved: macOS temp folders are behind a symlink
P="$WORK/brew"                      # Homebrew prefix
OPT="$P/opt/agent-status/libexec"
mkdir -p "$WORK/home" "$WORK/cfg" "$WORK/fake" "$P/bin" "$P/opt"
export AGENT_STATUS_PORT=4388 AGENT_STATUS_DIR="$WORK/state" AGENT_STATUS_TICK_S=1 AGENT_STATUS_MENUBAR=0 CLAUDE_CONFIG_DIR="$WORK/cfg"
URL="http://127.0.0.1:$AGENT_STATUS_PORT"

cat > "$WORK/fake/claude" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = plugin ]; then echo "\$*" >> "$WORK/plugin-calls"; exit 0; fi
echo "ARGS: \$*"
EOF
chmod +x "$WORK/fake/claude"
export PATH="$WORK/fake:$PATH"

pass=0; fail=0
t() { if eval "$2" >/dev/null 2>&1; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
health() { curl -s "$URL/health" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.$1))"; }
cleanup() { "$P/bin/claude-s" stop >/dev/null 2>&1; pkill -f "$P/" 2>/dev/null; kill "$KEEP" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

# Lays out version $1 the way the formula's install step does.
brew_install() {
  local cellar="$P/Cellar/agent-status/$1"
  mkdir -p "$cellar/libexec"
  (cd "$ROOT" && tar --exclude=.git -cf - .) | (cd "$cellar/libexec" && tar -xf -)
  node -e 'const f=process.argv[1];const j=JSON.parse(require("fs").readFileSync(f));j.version=process.argv[2];require("fs").writeFileSync(f,JSON.stringify(j))' \
    "$cellar/libexec/plugins/agent-status/.claude-plugin/plugin.json" "$1"
  ln -sfn "../Cellar/agent-status/$1" "$P/opt/agent-status"
  ln -sfn "../Cellar/agent-status/$1/libexec/bin/claude-s" "$P/bin/claude-s"
  printf '#!/bin/bash\nAGENT_STATUS_HOME="%s" exec "%s/install.sh" --no-alias "$@"\n' "$OPT" "$OPT" > "$P/bin/agent-status-setup"
  chmod +x "$P/bin/agent-status-setup"
}

brew_install 9.0.0
echo "alias claude-s='/old/clone/bin/claude-s'  # agent-status" > "$WORK/home/.zshrc"
OUT="$(HOME="$WORK/home" SHELL=/bin/zsh "$P/bin/agent-status-setup" --no-menubar)"
t "setup registers the upgrade-proof opt path with Claude Code" "grep -qx 'plugin marketplace add $OPT' $WORK/plugin-calls && grep -qx 'plugin install agent-status@agent-status' $WORK/plugin-calls"
t "setup removes an old claude-s alias and adds none" "! grep -q 'alias claude-s' $WORK/home/.zshrc && echo \"\$OUT\" | grep -q 'Removed the old claude-s alias'"
t "claude-s works through the bin link" "$P/bin/claude-s help | grep -q 'claude-s'"

"$P/bin/claude-s" restart >/dev/null
sleep 600 & KEEP=$!
echo '{"hook_event_name":"UserPromptSubmit","session_id":"b-1","cwd":"/tmp/web-app","prompt":"go"}' | node "$OPT/plugins/agent-status/scripts/report.js"
sleep 0.5
t "service runs version 9.0.0, session recorded" "[ \"\$(health version)\" = 9.0.0 ] && curl -s $URL/api/agents | grep -q '\"b-1\"'"
t "menu clicks use the opt path, not the versioned Cellar path" "curl -s $URL/api/swiftbar | grep -q 'param1=\"$OPT/plugins/agent-status/server/focus-cli.js\"' && ! curl -s $URL/api/swiftbar | grep -q '/Cellar/'"

P1="$(health pid)"
brew_install 9.0.1
rm -rf "$P/Cellar/agent-status/9.0.0"      # brew upgrade removes the old version
sleep 4.5
t "after an upgrade the service restarts itself on the new version" "[ \"\$(health version)\" = 9.0.1 ] && [ \"\$(health pid)\" != \"$P1\" ]"
t "sessions kept across the upgrade" "curl -s $URL/api/agents | grep -q '\"b-1\"'"
t "hooks keep working through the opt path" "echo '{\"hook_event_name\":\"Stop\",\"session_id\":\"b-1\"}' | node $OPT/plugins/agent-status/scripts/report.js && sleep 0.3 && curl -s $URL/api/agents | grep -q '\"status\":\"done\"'"
t "uninstall points to brew uninstall" "HOME=$WORK/home $OPT/uninstall.sh 2>/dev/null | grep -q 'brew uninstall agent-status'"

echo "---- $pass passed, $fail failed"
[ "$fail" = 0 ]
