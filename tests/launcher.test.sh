#!/usr/bin/env bash
# Tests for claude-s launching Claude with or without --plugin-dir, and for the Claude Code
# plugin steps of install.sh / uninstall.sh. A stand-in `claude` records its arguments.
# Run: bash tests/launcher.test.sh
set -u
ROOT="$(cd -P "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
mkdir -p "$WORK/bin" "$WORK/home" "$WORK/cfg"
export AGENT_STATUS_PORT=4395 AGENT_STATUS_DIR="$WORK/state" AGENT_STATUS_MENUBAR=0 CLAUDE_CONFIG_DIR="$WORK/cfg"

# Stand-in claude: `plugin ...` calls are appended to $WORK/plugin-calls (exit code from
# $WORK/plugin-exit, default 0); any other call prints its arguments.
cat > "$WORK/bin/claude" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = plugin ]; then echo "\$*" >> "$WORK/plugin-calls"; exit "\$(cat "$WORK/plugin-exit" 2>/dev/null || echo 0)"; fi
echo "ARGS: \$*"
EOF
chmod +x "$WORK/bin/claude"
export PATH="$WORK/bin:$PATH"

pass=0; fail=0
t() { if eval "$2" >/dev/null 2>&1; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1"; fail=$((fail+1)); fi; }
settings() { echo "$1" > "$WORK/cfg/settings.json"; }
launch() { "$ROOT/bin/claude-s" -p hello; }
trap '"$ROOT/bin/claude-s" stop >/dev/null 2>&1; rm -rf "$WORK"' EXIT

# ---------- claude-s ----------
rm -f "$WORK/cfg/settings.json"
t "no settings -> loads the plugin with --plugin-dir" "launch | grep -q -- '--plugin-dir $ROOT/plugins/agent-status -p hello'"
settings '{"enabledPlugins":{"agent-status@agent-status":true}}'
t "plugin installed -> plain claude, arguments passed through" "[ \"\$(launch)\" = 'ARGS: -p hello' ]"
settings '{"enabledPlugins":{"agent-status@my-fork":true}}'
t "installed from another marketplace name -> plain claude" "[ \"\$(launch)\" = 'ARGS: -p hello' ]"
settings '{"enabledPlugins":{"agent-status@agent-status":false}}'
t "plugin disabled -> --plugin-dir" "launch | grep -q -- --plugin-dir"
settings '{"enabledPlugins":{"other@x":true}}'
t "only other plugins enabled -> --plugin-dir" "launch | grep -q -- --plugin-dir"
settings 'not json'
t "unreadable settings -> --plugin-dir" "launch | grep -q -- --plugin-dir"

# ---------- install.sh ----------
inst() { HOME="$WORK/home" SHELL=/bin/zsh "$ROOT/install.sh" "$@"; }
rm -f "$WORK/plugin-calls"; echo 0 > "$WORK/plugin-exit"
OUT="$(inst --no-menubar)"
t "install: adds this folder as marketplace" "grep -qx 'plugin marketplace add $ROOT' $WORK/plugin-calls"
t "install: installs agent-status@agent-status" "grep -qx 'plugin install agent-status@agent-status' $WORK/plugin-calls"
t "install: tells you to use plain claude" "echo \"\$OUT\" | grep -q 'Start Claude as usual'"
rm -f "$WORK/plugin-calls"
OUT="$(inst --no-menubar --no-plugin)"
t "install --no-plugin: no plugin calls, suggests claude-s" "[ ! -e $WORK/plugin-calls ] && echo \"\$OUT\" | grep -q 'claude-s'"
echo 1 > "$WORK/plugin-exit"
OUT="$(inst --no-menubar)"
t "install: plugin failure falls back to claude-s" "echo \"\$OUT\" | grep -q 'Plugin install failed' && echo \"\$OUT\" | grep -q 'start Claude with:'"

# ---------- uninstall.sh ----------
echo 0 > "$WORK/plugin-exit"; rm -f "$WORK/plugin-calls"
HOME="$WORK/home" "$ROOT/uninstall.sh" >/dev/null 2>&1
t "uninstall: removes the plugin and the marketplace" "grep -qx 'plugin uninstall agent-status@agent-status' $WORK/plugin-calls && grep -qx 'plugin marketplace remove agent-status' $WORK/plugin-calls"
t "uninstall: removes the alias" "! grep -q 'alias claude-s' $WORK/home/.zshrc"

echo "---- $pass passed, $fail failed"
[ "$fail" = 0 ]
