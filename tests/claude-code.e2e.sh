#!/usr/bin/env bash
# End-to-end test with the real Claude Code CLI: a session runs with this plugin against a
# stand-in Anthropic API on 127.0.0.1 (tests/fixtures/fake-anthropic-api.js), and the service
# must receive every hook event it relies on, with the fields it reads, and react to them.
# Nothing leaves the machine. Needs `claude` on PATH (npm i -g @anthropic-ai/claude-code).
# Run: bash tests/claude-code.e2e.sh
set -u
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/plugins/agent-status"
WORK="$(cd -P "$(mktemp -d)" && pwd)"   # resolved: macOS temp folders are behind a symlink
FAKE="$WORK/bin"
PROJECT="$WORK/e2e-app"
mkdir -p "$FAKE" "$PROJECT" "$WORK/home/cfg"
export AGENT_STATUS_PORT=4393 AGENT_STATUS_DIR="$WORK/state" AGENT_STATUS_TICK_S=1
URL="http://127.0.0.1:$AGENT_STATUS_PORT"
API_PORT=4392
LOG="$WORK/notifications.log"
touch "$LOG"

command -v claude >/dev/null || { echo "claude not found on PATH"; exit 1; }
echo "Claude Code $(claude --version 2>/dev/null | head -n 1)"

# Stand-in osascript records notifications; stand-in caffeinate does nothing.
cat > "$FAKE/osascript" <<EOF
#!/usr/bin/env bash
echo "\$3 | \$4" >> "$LOG"
EOF
printf '#!/usr/bin/env bash\nexec sleep 3600\n' > "$FAKE/caffeinate"
chmod +x "$FAKE/osascript" "$FAKE/caffeinate"

pass=0; fail=0
t() { if eval "$2" >/dev/null 2>&1; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
compat() { curl -s "$URL/api/compat" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String($1))"; }
API=""
cleanup() { [ -n "$API" ] && kill "$API" 2>/dev/null; "$ROOT/bin/claude-s" stop >/dev/null 2>&1; rm -rf "$WORK"; }
trap cleanup EXIT

# Runs one Claude Code session in $PROJECT with a clean environment (no user settings, no
# network: the API is the local stand-in). $1: fake API mode, $2: prompt.
session() {
  [ -n "$API" ] && kill "$API" 2>/dev/null
  node "$ROOT/tests/fixtures/fake-anthropic-api.js" "$API_PORT" "$1" & API=$!
  sleep 0.5
  ( cd "$PROJECT" && env -i PATH="$FAKE:$PATH" HOME="$WORK/home" CLAUDE_CONFIG_DIR="$WORK/home/cfg" \
      ANTHROPIC_API_KEY=sk-ant-test ANTHROPIC_BASE_URL="http://127.0.0.1:$API_PORT" \
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 CLAUDE_CODE_MAX_RETRIES=0 \
      AGENT_STATUS_PORT="$AGENT_STATUS_PORT" AGENT_STATUS_DIR="$AGENT_STATUS_DIR" AGENT_STATUS_TICK_S=1 \
      timeout 120 claude -p "$2" --plugin-dir "$PLUGIN" --allowedTools "Bash(echo:*)" < /dev/null > "$WORK/claude.out" 2>&1 )
  echo "  claude exit $? · $(tail -c 120 "$WORK/claude.out" | tr '\n' ' ')"
  sleep 1.5
}

PATH="$FAKE:$PATH" "$ROOT/bin/claude-s" stop >/dev/null 2>&1
PATH="$FAKE:$PATH" "$ROOT/bin/claude-s" restart >/dev/null
node "$PLUGIN/server/ctl.js" notifications done 0 >/dev/null   # every finished task notifies

echo "session 1: a prompt that runs a Bash command"
session tool "please run the command"
for e in SessionStart UserPromptSubmit PreToolUse PostToolUse Stop SessionEnd; do
  t "hook event $e received" "[ \"\$(compat \"(d.events.$e||{}).count||0\")\" -ge 1 ]"
done
t "every event had the fields the board reads" "[ \"\$(compat 'Object.keys(d.missing).length')\" = 0 ]"
t "no unknown or malformed hook payloads" "[ \"\$(compat 'd.problems.length')\" = 0 ]"
t "finished task notified with the project and prompt" "grep -q '^Done · e2e-app | Finished after .*: please run the command' $LOG"
t "session removed from the board when it ended" "! curl -s $URL/api/agents | grep -q 'e2e-app'"

echo "session 2: the API returns an error"
session error "this request fails"
t "session that failed still reports its start and end" "[ \"\$(compat 'd.events.SessionEnd.count')\" -ge 2 ]"
t "still no unknown or malformed hook payloads" "[ \"\$(compat 'd.problems.length')\" = 0 ]"
# StopFailure itself isn't checked here: in -p mode Claude Code exits as it runs that hook.

echo "---- $pass passed, $fail failed"
[ "$fail" = 0 ]
