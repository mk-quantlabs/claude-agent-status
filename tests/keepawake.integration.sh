#!/usr/bin/env bash
# Integration test: keep-awake and approvals against a running service, with stand-in
# `caffeinate` and `pmset` commands on PATH.
# Run: bash tests/keepawake.integration.sh
set -u
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
FAKE="$WORK/bin"
mkdir -p "$FAKE"
export AGENT_STATUS_PORT=4397 AGENT_STATUS_DIR="$WORK/state" AGENT_STATUS_TICK_S=1 AGENT_STATUS_AWAKE_GRACE_S=2
URL="http://127.0.0.1:$AGENT_STATUS_PORT"

# Stand-in caffeinate: records its arguments and stays alive until terminated.
cat > "$FAKE/caffeinate" <<EOF
#!/usr/bin/env bash
echo "\$@" > "$WORK/caffeinate.args"
exec -a agent-status-test-caffeinate sleep 3600
EOF
# Stand-in pmset: reports the power source written to $WORK/power.
cat > "$FAKE/pmset" <<EOF
#!/usr/bin/env bash
echo "Now drawing from '\$(cat "$WORK/power")'"
EOF
chmod +x "$FAKE/caffeinate" "$FAKE/pmset"
echo "AC Power" > "$WORK/power"
export PATH="$FAKE:$PATH"

pass=0; fail=0
t() { if eval "$2" >/dev/null 2>&1; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
holders() { pgrep -f agent-status-test-caffeinate | wc -l | tr -d ' '; }
field() { curl -s "$URL/api/agents" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String($1))"; }
hook() { echo "$1" | node "$ROOT/plugins/agent-status/scripts/report.js"; }
cleanup() { "$ROOT/bin/claude-s" stop >/dev/null 2>&1; pkill -f agent-status-test-caffeinate 2>/dev/null; kill "$KEEP" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

"$ROOT/bin/claude-s" stop >/dev/null 2>&1
"$ROOT/bin/claude-s" restart >/dev/null
sleep 600 & KEEP=$!   # keeps the session's "Claude" process (this shell) alive

# ---------- keep awake ----------
hook '{"hook_event_name":"UserPromptSubmit","session_id":"ka-1","cwd":"/tmp/web-app","prompt":"build it"}'
sleep 1.5
t "working agent -> one caffeinate holding" "[ \$(holders) = 1 ]"
SPID=$(curl -s "$URL/health" | node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).pid))')
t "caffeinate runs with -i -w <service pid>" "[ \"\$(cat $WORK/caffeinate.args)\" = \"-i -w $SPID\" ]"
t "state: active, reason names working agents" "[ \"\$(field 'd.keepAwake.active+\"|\"+d.keepAwake.reason')\" = 'true|1 agent working' ]"
hook '{"hook_event_name":"PreToolUse","session_id":"ka-1","tool_name":"Bash","tool_input":{"command":"npm test"}}'
sleep 1
t "still exactly one caffeinate after more events" "[ \$(holders) = 1 ]"
hook '{"hook_event_name":"Stop","session_id":"ka-1"}'
sleep 1.2
t "grace period keeps holding" "[ \$(holders) = 1 ] && field 'd.keepAwake.reason' | grep -q 'grace period'"
sleep 3
t "released after the grace period" "[ \$(holders) = 0 ] && [ \"\$(field d.keepAwake.active)\" = false ]"

node "$ROOT/plugins/agent-status/server/ctl.js" awake power >/dev/null
echo "Battery Power" > "$WORK/power"
sleep 3.5
hook '{"hook_event_name":"UserPromptSubmit","session_id":"ka-1","cwd":"/tmp/web-app","prompt":"again"}'
sleep 1.5
t "mode power on battery -> no hold" "[ \$(holders) = 0 ] && field 'd.keepAwake.reason' | grep -q 'on battery'"
node "$ROOT/plugins/agent-status/server/ctl.js" awake always >/dev/null
sleep 1.5
t "mode always on battery -> hold" "[ \$(holders) = 1 ]"
node "$ROOT/plugins/agent-status/server/ctl.js" awake off >/dev/null
sleep 1.5
t "mode off -> released" "[ \$(holders) = 0 ]"
t "mode saved to config.json" "grep -q '\"keepAwake\": \"off\"' $AGENT_STATUS_DIR/config.json"
node "$ROOT/plugins/agent-status/server/ctl.js" awake always >/dev/null
sleep 1.5
t "service stop ends caffeinate" "[ \$(holders) = 1 ] && $ROOT/bin/claude-s stop && sleep 0.5 && [ \$(holders) = 0 ]"
"$ROOT/bin/claude-s" restart >/dev/null
sleep 0.5
t "config survives restart" "[ \"\$(field d.config.keepAwake)\" = always ]"

# ---------- approvals ----------
hook '{"hook_event_name":"UserPromptSubmit","session_id":"ap-1","cwd":"/tmp/data-pipeline","prompt":"clean up"}'
hook '{"hook_event_name":"PreToolUse","session_id":"ap-1","tool_name":"Bash","tool_input":{"command":"rm -rf build"}}'
hook '{"hook_event_name":"Notification","session_id":"ap-1","notification_type":"permission_prompt","message":"Claude needs your permission to use Bash"}'
t "approval listed with the tool call" "[ \"\$(field 'd.approvals.map(a=>a.project+\": \"+a.detail).join()')\" = 'data-pipeline: Bash: rm -rf build' ]"
t "menu: approval section first, title orange" "curl -s $URL/api/swiftbar | head -3 | grep -q 'color=#F5A524' && curl -s $URL/api/swiftbar | grep -q 'Needs your approval (1)'"
t "menu: approval row runs focus only" "curl -s $URL/api/swiftbar | grep 'data-pipeline · Bash' | grep -q 'focus-cli.js'"
t "menu: waiting agent not listed twice" "[ \$(curl -s $URL/api/swiftbar | grep -c 'data-pipeline') = 1 ]"
t "key image says APPROVE?" "curl -s $URL/api/slot/\$(field 'd.approvals[0].slot').svg | grep -q 'APPROVE?'"
t "claude-s status shows the approval first" "$ROOT/bin/claude-s status | head -1 | grep -q 'need.* your approval'"
t "idle prompt is not an approval" "hook '{\"hook_event_name\":\"Notification\",\"session_id\":\"ap-2\",\"cwd\":\"/tmp/x\",\"notification_type\":\"idle_prompt\",\"message\":\"waiting\"}' && [ \"\$(field d.approvals.length)\" = 1 ]"
hook '{"hook_event_name":"PostToolUse","session_id":"ap-1","tool_name":"Bash"}'
t "approval clears when the session continues" "[ \"\$(field d.approvals.length)\" = 0 ]"

menu_actions_ok() {
  curl -s "$URL/api/swiftbar" | node -e '
    const lines = require("fs").readFileSync(0, "utf8").split("\n");
    const bad = lines.filter((l) => /\b(bash|href|shell)=/.test(l)).filter((l) => {
      const focus = /bash="[^"]+" param1="[^"]*focus-cli\.js" param2=[\w-]+ param3=menubar terminal=false refresh=true/.test(l) && !/param4=/.test(l);
      const dashboard = /\| href=http:\/\/127\.0\.0\.1:\d+\/$/.test(l) && /^Open dashboard /.test(l);
      return !(focus || dashboard);
    });
    if (bad.length) { console.error(bad.join("\n")); process.exit(1); }'
}
t "menu: only actions are focusing a session and opening the dashboard" "menu_actions_ok"
t "menu: keep-awake line has no action" "curl -s $URL/api/swiftbar | grep -E '^(☕|Sleep allowed)' | grep -vqE 'bash=|href='"

# ---------- guards ----------
t "focus code never sends keystrokes or input" "! grep -nE 'keystroke|key code|/dev/tty[^\\\\]' $ROOT/plugins/agent-status/server/focus.js $ROOT/plugins/agent-status/server/focus-cli.js"

echo "---- $pass passed, $fail failed"
[ "$fail" = 0 ]
