#!/usr/bin/env bash
# Integration test against a running service: approval, reminder and long-task notifications
# (a stand-in `osascript` on PATH records them), the hook compatibility record, and the
# service restarting itself when its code on disk changes.
# Run: bash tests/notifications.integration.sh
set -u
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(cd -P "$(mktemp -d)" && pwd)"   # resolved: macOS temp folders are behind a symlink
FAKE="$WORK/bin"
mkdir -p "$FAKE"
export AGENT_STATUS_PORT=4394 AGENT_STATUS_DIR="$WORK/state" AGENT_STATUS_TICK_S=1 AGENT_STATUS_AWAKE_GRACE_S=1
URL="http://127.0.0.1:$AGENT_STATUS_PORT"
LOG="$WORK/notifications.log"

# Stand-in osascript: appends "title | body" (and "+sound" when the script plays one).
cat > "$FAKE/osascript" <<EOF
#!/usr/bin/env bash
s=""; case "\$2" in *"sound name"*) s=" +sound" ;; esac
echo "\$3 | \$4\$s" >> "$LOG"
EOF
# Stand-in caffeinate (keep-awake is not under test here).
printf '#!/usr/bin/env bash\nexec sleep 3600\n' > "$FAKE/caffeinate"
chmod +x "$FAKE/osascript" "$FAKE/caffeinate"
export PATH="$FAKE:$PATH"
touch "$LOG"

pass=0; fail=0
t() { if eval "$2" >/dev/null 2>&1; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
# Sends a hook payload; prompts get a transcript path like real ones have.
hook() {
  local p="$1"
  if [[ "$p" == *UserPromptSubmit* && "$p" != *transcript_path* ]]; then p="${p%\}},\"transcript_path\":\"$WORK/none.jsonl\"}"; fi
  echo "$p" | node "$ROOT/plugins/agent-status/scripts/report.js"
}
ctl() { node "$ROOT/plugins/agent-status/server/ctl.js" "$@" >/dev/null; }
count() { grep -c -- "$1" "$LOG" || true; }
health() { curl -s "$URL/health" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String(d.$1))"; }
compat() { curl -s "$URL/api/compat" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(String($1))"; }
cleanup() {
  "$ROOT/bin/claude-s" stop >/dev/null 2>&1
  [ -n "${SPID:-}" ] && kill "$SPID" 2>/dev/null
  pkill -f "$WORK/copy" 2>/dev/null
  kill "$KEEP" 2>/dev/null; rm -rf "$WORK"
}
trap cleanup EXIT

"$ROOT/bin/claude-s" stop >/dev/null 2>&1
"$ROOT/bin/claude-s" restart >/dev/null
sleep 600 & KEEP=$!   # keeps the sessions' "Claude" process (this shell) alive

# ---------- approval and reminder ----------
ctl notifications remind 0.05      # 3 seconds
hook '{"hook_event_name":"UserPromptSubmit","session_id":"n-1","cwd":"/tmp/data-pipeline","prompt":"clean up"}'
hook '{"hook_event_name":"PreToolUse","session_id":"n-1","tool_name":"Bash","tool_input":{"command":"rm -rf build"}}'
hook '{"hook_event_name":"Notification","session_id":"n-1","notification_type":"permission_prompt","message":"Claude needs your permission to use Bash"}'
sleep 0.5
t "approval -> one notification with the command" "[ \$(count 'Approval needed · data-pipeline | Bash: rm -rf build') = 1 ]"
t "no reminder before the reminder time" "[ \$(count 'Still waiting') = 0 ]"
sleep 4
t "reminder after the reminder time" "[ \$(count 'Still waiting for approval · data-pipeline | Bash: rm -rf build · waiting') = 1 ]"
sleep 2.5
t "reminder sent only once" "[ \$(count 'Still waiting') = 1 ]"
hook '{"hook_event_name":"PostToolUse","session_id":"n-1","tool_name":"Bash"}'

# ---------- interrupted with Esc (no hook event; the transcript shows it) ----------
TR="$WORK/session.jsonl"
iso() { node -e 'console.log(new Date(Date.now() + Number(process.argv[1] || 0)).toISOString())' "${1:-0}"; }
echo "{\"type\":\"user\",\"timestamp\":\"$(iso -1000)\",\"message\":{\"content\":\"deploy\"}}" > "$TR"
hook "{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"e-1\",\"cwd\":\"/tmp/mobile-app\",\"prompt\":\"deploy\",\"transcript_path\":\"$TR\"}"
hook '{"hook_event_name":"PreToolUse","session_id":"e-1","tool_name":"Bash","tool_input":{"command":"./deploy.sh"},"tool_use_id":"toolu_e1"}'
hook '{"hook_event_name":"Notification","session_id":"e-1","notification_type":"permission_prompt","message":"Claude needs your permission to use Bash"}'
sleep 1.5
t "waiting while the permission prompt is open" "curl -s $URL/api/agents | grep -q '\"approvals\":\\[{\"id\":\"e-1\"'"
echo "{\"type\":\"user\",\"timestamp\":\"$(iso)\",\"message\":{\"content\":[{\"type\":\"tool_result\",\"tool_use_id\":\"toolu_e1\",\"content\":\"rejected\"}]}}" >> "$TR"
echo "{\"type\":\"user\",\"timestamp\":\"$(iso)\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"[Request interrupted by user for tool use]\"}]}}" >> "$TR"
sleep 2
t "prompt dismissed with Esc -> no longer waiting, shown as interrupted" "curl -s $URL/api/agents | node -e 'const d=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));const a=d.agents.find(x=>x.id===\"e-1\");process.exit(a&&a.status===\"sleeping\"&&a.detail===\"Interrupted\"&&!d.approvals.length?0:1)'"
sleep 2
t "no reminder for a dismissed prompt" "[ \$(count 'mobile-app') = 1 ]"

# ---------- approved command keeps running (no hook event until it finishes) ----------
fake_claude() { node "$ROOT/tests/fixtures/fake-claude.js" "$1"; }
fake_claude '[["shell",20],
  ["hook",{"hook_event_name":"UserPromptSubmit","session_id":"c-1","cwd":"/tmp/build-tools","prompt":"run the tests","transcript_path":"/tmp/none.jsonl"}],
  ["hook",{"hook_event_name":"PreToolUse","session_id":"c-1","tool_name":"Bash","tool_input":{"command":"npm test"},"tool_use_id":"toolu_c1"}],
  ["hook",{"hook_event_name":"Notification","session_id":"c-1","notification_type":"permission_prompt","message":"permission"}],
  ["sleep",2500], ["shell",8], ["sleep",6000]]' &
FC=$!
sleep 2
t "a command shell that was already running doesn't count as approval" "curl -s $URL/api/agents | grep -q '\"approvals\":\\[{\"id\":\"c-1\"'"
sleep 2.5
t "approved command running -> working again, approval cleared" "curl -s $URL/api/agents | node -e 'const d=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));const a=d.agents.find(x=>x.id===\"c-1\");process.exit(a&&a.status===\"in_progress\"&&!d.approvals.length?0:1)'"
sleep 2
t "no reminder for an approved command" "[ \$(count 'Still waiting for approval · build-tools') = 0 ]"
t "keep-awake holds while the approved command runs" "[ \"\$(curl -s $URL/api/agents | node -e 'process.stdout.write(String(JSON.parse(require(\"fs\").readFileSync(0,\"utf8\")).keepAwake.reason))')\" != 'no agent working' ]"
wait $FC 2>/dev/null

# ---------- long task finished ----------
ctl notifications done 0.03       # 1.8 seconds
hook '{"hook_event_name":"UserPromptSubmit","session_id":"n-2","cwd":"/tmp/web-app","prompt":"build it"}'
sleep 2.2
hook '{"hook_event_name":"Stop","session_id":"n-2"}'
sleep 0.3
t "long task done -> notification with duration and prompt" "grep -qE '^Done · web-app \\| Finished after [23] s: build it\$' $LOG"
hook '{"hook_event_name":"UserPromptSubmit","session_id":"n-2","cwd":"/tmp/web-app","prompt":"quick one"}'
hook '{"hook_event_name":"Stop","session_id":"n-2"}'
sleep 0.3
t "short task -> no notification" "[ \$(count 'quick one') = 0 ]"
hook '{"hook_event_name":"UserPromptSubmit","session_id":"n-2","cwd":"/tmp/web-app","prompt":"interrupted"}'
sleep 1.5
hook '{"hook_event_name":"UserPromptSubmit","session_id":"n-2","cwd":"/tmp/web-app","prompt":"new prompt"}'
sleep 0.5
hook '{"hook_event_name":"Stop","session_id":"n-2"}'
sleep 0.3
t "a new prompt starts a new task (an interrupted task sends no Stop)" "[ \$(count 'new prompt') = 0 ] && [ \$(count 'interrupted') = 0 ]"
hook '{"hook_event_name":"UserPromptSubmit","session_id":"n-3","cwd":"/tmp/api-server","prompt":"migrate"}'
sleep 2.2
hook '{"hook_event_name":"StopFailure","session_id":"n-3","error":"overloaded","last_assistant_message":"API Error: 529 Overloaded"}'
sleep 0.3
t "long task failed -> error notification with the API message" "grep -q '^Stopped with an error · api-server | After [23] s: API Error: 529 Overloaded' $LOG"

hook '{"hook_event_name":"UserPromptSubmit","session_id":"n-3","cwd":"/tmp/api-server","prompt":"again"}'
hook '{"hook_event_name":"StopFailure","session_id":"n-3","error":"rate_limit"}'
t "API error without a message -> readable error type on the board" "curl -s $URL/api/agents | grep -q '\"detail\":\"Rate limited\"'"

ctl notifications sound on
hook '{"hook_event_name":"UserPromptSubmit","session_id":"n-2","cwd":"/tmp/web-app","prompt":"with sound"}'
sleep 2.2
hook '{"hook_event_name":"Stop","session_id":"n-2"}'
sleep 0.3
t "sound on -> notification plays a sound" "grep -q 'with sound +sound' $LOG"
ctl notifications done off
hook '{"hook_event_name":"UserPromptSubmit","session_id":"n-2","cwd":"/tmp/web-app","prompt":"done off"}'
sleep 2.2
hook '{"hook_event_name":"Stop","session_id":"n-2"}'
sleep 0.3
t "done notifications off -> none" "[ \$(count 'done off') = 0 ]"
ctl notifications off
hook '{"hook_event_name":"Notification","session_id":"n-3","notification_type":"permission_prompt","message":"permission"}'
sleep 0.3
t "all notifications off -> no approval notification" "[ \$(count 'api-server | permission') = 0 ] && [ \$(count 'Approval needed · api-server') = 0 ]"
t "settings saved" "grep -q '\"systemNotifications\": false' $AGENT_STATUS_DIR/config.json && grep -q '\"notificationSound\": true' $AGENT_STATUS_DIR/config.json"
t "claude-s notifications shows the settings" "$ROOT/bin/claude-s notifications on | grep -q 'long task ended:   off'"
t "claude-s notifications rejects bad arguments" "! $ROOT/bin/claude-s notifications done soon"

# ---------- hook compatibility record ----------
t "complete events -> no problems" "[ \"\$(compat 'd.problems.length')\" = 0 ] && [ \"\$(compat 'd.events.UserPromptSubmit.count > 0')\" = true ]"
t "notification types are counted" "[ \"\$(compat 'd.notificationTypes.permission_prompt.count')\" = 4 ]"
hook '{"hook_event_name":"PreToolUse","session_id":"n-4","cwd":"/tmp/x","tool_name":"Bash"}'
t "event without an expected field -> reported" "compat 'd.problems.map(p=>p.text).join()' | grep -q 'PreToolUse events arrive without: tool_input'"
hook '{"hookEventName":"Stop","sessionId":"n-4"}'
t "payload without session id / event name -> reported with its field names" "compat 'd.problems.map(p=>p.text).join()' | grep -q 'hookEventName, sessionId'"
curl -s -X POST -H 'Content-Type: application/json' -d '{"event":"BrandNewEvent","session_id":"n-5"}' "$URL/event" >/dev/null
t "unknown event -> reported, no agent created" "compat 'd.problems.map(p=>p.text).join()' | grep -q 'BrandNewEvent' && ! curl -s $URL/api/agents | grep -q '\"n-5\"'"
"$ROOT/bin/claude-s" restart >/dev/null
t "record survives a restart" "compat 'd.problems.length' | grep -q 3"

# ---------- Claude desktop app sessions ----------
hook '{"hook_event_name":"UserPromptSubmit","session_id":"d-1","cwd":"/Users/u/Library/Application Support/Claude/scratch-workspaces/5523/b703/scratch-2026-10-29-b1d025","prompt":"hey"}'
t "a \"!\" shell command shows as \"! command\"" "hook '{\"hook_event_name\":\"UserPromptSubmit\",\"session_id\":\"d-2\",\"cwd\":\"/tmp/web-app\",\"prompt\":\"<bash-input>ls -la</bash-input><bash-stdout>x</bash-stdout>\"}' && curl -s $URL/api/agents | grep -q '\"prompt\":\"! ls -la\"'"
t "a Claude desktop app session is named Claude app" "curl -s $URL/api/agents | grep -q '\"id\":\"d-1\",\"slot\":[0-9]*,\"project\":\"Claude app\"'"

# ---------- names with their app; idle sessions hidden ----------
post_event() { curl -s -X POST -H 'Content-Type: application/json' -d "$1" "$URL/event" >/dev/null; }
post_event '{"event":"UserPromptSubmit","session_id":"h-1","cwd":"/tmp/report-builder","prompt":"go","loc":{"hostApp":"/Applications/PyCharm.app","pid":'$KEEP'}}'
t "name shows the app the session runs in" "curl -s $URL/api/swiftbar | grep -q 'report-builder (PyCharm) — in progress'"
post_event '{"event":"PreToolUse","session_id":"h-1","tool":"Bash","detail":"Bash: make release"}'
post_event '{"event":"Notification","session_id":"h-1","notification_type":"permission_prompt","message":"permission"}'
sleep 0.5   # the notification is shown asynchronously
t "notifications name the app too" "grep -q '^Approval needed · report-builder (PyCharm) | Bash: make release' $LOG"
t "no app in brackets for Claude app sessions" "! curl -s $URL/api/swiftbar | grep -q 'Claude app ('"
post_event '{"event":"Stop","session_id":"h-1"}'
ctl hide-idle 0.0005             # 1.8 seconds
sleep 3
t "idle session hidden from the menu, with a count line" "! curl -s $URL/api/swiftbar | grep -q 'report-builder' && curl -s $URL/api/swiftbar | grep -qE '^\+[0-9]+ idle'"
t "idle session listed under idle in the API" "curl -s $URL/api/agents | node -e 'const d=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));process.exit(d.idle.some(a=>a.id===\"h-1\")&&!d.agents.some(a=>a.id===\"h-1\")?0:1)'"
t "sessions that need you are never hidden" "curl -s $URL/api/agents | node -e 'const d=JSON.parse(require(\"fs\").readFileSync(0,\"utf8\"));process.exit(d.idle.some(a=>[\"waiting\",\"retry\",\"in_progress\"].includes(a.status))?1:0)'"
post_event '{"event":"UserPromptSubmit","session_id":"h-1","cwd":"/tmp/report-builder","prompt":"again"}'
t "back in the menu after new activity" "curl -s $URL/api/swiftbar | grep -q 'report-builder (PyCharm)'"
t "claude-s hide-idle off and its setting" "$ROOT/bin/claude-s hide-idle off | grep -q 'never hidden' && grep -q '\"hideIdleHours\": 0' $AGENT_STATUS_DIR/config.json"
t "claude-s hide-idle rejects bad values" "! $ROOT/bin/claude-s hide-idle soon"

# ---------- the hook never fails ----------
hook_rc() { printf '%s' "$1" | node "$ROOT/plugins/agent-status/scripts/report.js" >/dev/null 2>&1; echo $?; }
t "hook exits 0 on any input" "[ \"\$(hook_rc 'not json')\$(hook_rc '[1,2]')\$(hook_rc null)\$(hook_rc '')\$(hook_rc '{\"hook_event_name\":\"Stop\",\"session_id\":\"../../x\"}')\" = 00000 ]"

# ---------- restart on code update ----------
"$ROOT/bin/claude-s" stop >/dev/null
cp -R "$ROOT/plugins/agent-status" "$WORK/copy"
node -e 'require("child_process").spawn(process.execPath, [process.argv[1]], { detached: true, stdio: "ignore" }).unref()' "$WORK/copy/server/server.js"
sleep 0.8
P1="$(health pid)"
hook '{"hook_event_name":"UserPromptSubmit","session_id":"u-1","cwd":"/tmp/web-app","prompt":"keep me"}'
echo "const broken = (" >> "$WORK/copy/server/notifications.js"
sleep 3.5
t "update that doesn't pass node --check -> keeps running" "[ \"\$(health pid)\" = \"$P1\" ]"
cp "$WORK/copy/server/notifications.js" "$WORK/notifications.js.broken"
node -e 'const f=process.argv[1];const s=require("fs").readFileSync(f,"utf8");require("fs").writeFileSync(f,"require(\"./does-not-exist\");\n"+s.replace("const broken = (\n",""))' "$WORK/copy/server/notifications.js"
sleep 4.5
t "update that fails when it starts -> old version keeps serving" "[ \"\$(health pid)\" = \"$P1\" ] && curl -s $URL/api/agents | grep -q '\"u-1\"'"
sleep 3
takeovers() { ps -eo args | grep -c "^node.*$WORK/copy/server/server.js --takeover" || true; }
t "failed update not retried until the code changes again" "[ \"\$(health pid)\" = \"$P1\" ] && [ \$(takeovers) = 0 ]"
[ "$(takeovers)" = 0 ] || ps -eo pid,etime,args | grep -- --takeover | grep -v grep
node -e 'const f=process.argv[1];const s=require("fs").readFileSync(f,"utf8");require("fs").writeFileSync(f,s.replace("require(\"./does-not-exist\");\n","// updated\n"))' "$WORK/copy/server/notifications.js"
sleep 4
P2="$(health pid)"
t "code updated on disk -> service restarted itself" "[ -n \"$P2\" ] && [ \"$P2\" != \"$P1\" ] && [ \"$P2\" != undefined ]"
t "sessions kept across the restart" "curl -s $URL/api/agents | grep -q '\"u-1\"'"
SPID="$P2"

# ---------- a service from before 0.3 is replaced; later ones update themselves ----------
"$ROOT/bin/claude-s" stop >/dev/null 2>&1; kill "$SPID" 2>/dev/null; sleep 0.5
setver() { node -e 'const f=process.argv[1];const j=JSON.parse(require("fs").readFileSync(f));if(process.argv[2])j.version=process.argv[2];else delete j.version;require("fs").writeFileSync(f,JSON.stringify(j))' "$WORK/copy/.claude-plugin/plugin.json" "${1:-}"; }
start_copy() { node -e 'require("child_process").spawn(process.execPath, [process.argv[1]], { detached: true, stdio: "ignore" }).unref()' "$WORK/copy/server/server.js"; sleep 0.8; }
MINE="$(node -p 'require(process.argv[1]).version' "$ROOT/plugins/agent-status/.claude-plugin/plugin.json")"
setver ""; start_copy
t "stand-in for a pre-0.3 service reports no version" "[ \"\$(health version)\" = undefined ]"
hook '{"hook_event_name":"UserPromptSubmit","session_id":"v-1","cwd":"/tmp/web-app","prompt":"hi"}'
sleep 1.5
t "pre-0.3 service replaced by the hook, sessions kept" "[ \"\$(health version)\" = \"$MINE\" ] && curl -s $URL/api/agents | grep -q '\"v-1\"'"
"$ROOT/bin/claude-s" stop >/dev/null 2>&1; sleep 0.3
setver 0.0.1; start_copy
P3="$(health pid)"
hook '{"hook_event_name":"Stop","session_id":"v-1"}'
"$ROOT/bin/claude-s" awake >/dev/null
sleep 1
t "a service with a version is never killed by hooks or claude-s" "[ \"\$(health pid)\" = \"$P3\" ]"
kill "$P3" 2>/dev/null; sleep 0.3
setver ""; start_copy
"$ROOT/bin/claude-s" awake >/dev/null
t "claude-s replaces a pre-0.3 service too" "[ \"\$(health version)\" = \"$MINE\" ]"

echo "---- $pass passed, $fail failed"
[ "$fail" = 0 ]
