#!/usr/bin/env python3
# End-to-end test with the real Claude Code CLI in an interactive session (a pseudo-terminal),
# against a stand-in Anthropic API on 127.0.0.1 (tests/fixtures/fake-anthropic-api.js):
#   - a command that needs permission puts the session on the board as waiting for approval,
#     with the command, and sends the approval notification
#   - Esc on the permission prompt (Claude Code sends no hook event for it) clears it
#   - the next prompt finishes as done
#   - a long command that is approved shows as working while it runs (Claude Code sends no
#     hook event for the approval), with no approval reminder
#   - quitting removes the session from the board
# Nothing leaves the machine. Needs `claude` on PATH. Run: python3 tests/claude-code.interactive.py
import json, os, pty, select, shutil, subprocess, sys, tempfile, time, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
PLUGIN = os.path.join(ROOT, 'plugins', 'agent-status')
PORT, API_PORT = 4387, 4386
URL = f'http://127.0.0.1:{PORT}'
COMMAND = 'curl -s http://127.0.0.1:9/never'
LONG_COMMAND = 'python3 -c "import time; time.sleep(12)"'

work = os.path.realpath(tempfile.mkdtemp())
project = os.path.join(work, 'e2e-app')
home = os.path.join(work, 'home')
cfg = os.path.join(home, 'cfg')
fake = os.path.join(work, 'bin')
log = os.path.join(work, 'notifications.log')
for d in (project, cfg, fake):
    os.makedirs(d)
open(log, 'w').close()

# Stand-in osascript records notifications; stand-in caffeinate does nothing.
with open(os.path.join(fake, 'osascript'), 'w') as f:
    f.write(f'#!/usr/bin/env bash\necho "$3 | $4" >> "{log}"\n')
with open(os.path.join(fake, 'caffeinate'), 'w') as f:
    f.write('#!/usr/bin/env bash\nexec sleep 3600\n')
for n in ('osascript', 'caffeinate'):
    os.chmod(os.path.join(fake, n), 0o755)

# Settings that skip first-run screens: onboarding done, this folder trusted, test key accepted.
seed = {'hasCompletedOnboarding': True, 'theme': 'dark',
        'projects': {project: {'hasTrustDialogAccepted': True, 'hasCompletedProjectOnboarding': True}},
        'customApiKeyResponses': {'approved': ['sk-ant-test'], 'rejected': []}}
for p in (os.path.join(cfg, '.claude.json'), os.path.join(home, '.claude.json')):
    with open(p, 'w') as f:
        json.dump(seed, f)

env = {'PATH': fake + os.pathsep + os.environ['PATH'], 'HOME': home, 'CLAUDE_CONFIG_DIR': cfg,
       'ANTHROPIC_API_KEY': 'sk-ant-test', 'ANTHROPIC_BASE_URL': f'http://127.0.0.1:{API_PORT}',
       'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1', 'DISABLE_AUTOUPDATER': '1',
       'AGENT_STATUS_PORT': str(PORT), 'AGENT_STATUS_DIR': os.path.join(work, 'state'), 'AGENT_STATUS_TICK_S': '1',
       'TERM': 'xterm-256color', 'COLUMNS': '120', 'LINES': '40'}

passed = failed = 0
def check(name, ok):
    global passed, failed
    print(('PASS  ' if ok else 'FAIL  ') + name, flush=True)
    if ok: passed += 1
    else: failed += 1

def board():
    try:
        with urllib.request.urlopen(URL + '/api/agents', timeout=2) as r:
            return json.load(r)
    except Exception:
        return {'agents': [], 'approvals': []}

def wait_for(pred, seconds):
    end = time.time() + seconds
    while time.time() < end:
        pump(0.5)
        if pred(board()):
            return True
    return False

def agent(d):
    return next((a for a in d['agents'] if a['project'] == 'e2e-app'), None)

out = b''
fd = None
def pump(seconds):
    global out
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.1)
        if r:
            try: out += os.read(fd, 65536)
            except OSError: return

def screen_tail():
    return out[-1500:].decode('utf8', 'replace')

subprocess.run([os.path.join(ROOT, 'bin', 'claude-s'), 'stop'], env={**os.environ, **env}, capture_output=True)
subprocess.run([os.path.join(ROOT, 'bin', 'claude-s'), 'restart'], env={**os.environ, **env}, capture_output=True)
api = subprocess.Popen(['node', os.path.join(ROOT, 'tests', 'fixtures', 'fake-anthropic-api.js'), str(API_PORT), 'tool', COMMAND, LONG_COMMAND])
time.sleep(0.5)
print('Claude Code', subprocess.run(['claude', '--version'], capture_output=True, text=True).stdout.strip(), flush=True)

pid, fd = pty.fork()
if pid == 0:
    os.chdir(project)
    os.execvpe('claude', ['claude', '--plugin-dir', PLUGIN, '--permission-mode', 'default'], env)

try:
    check('session appears on the board', wait_for(lambda d: agent(d) is not None, 30))
    pump(2)
    os.write(fd, b'please run the command'); pump(1); os.write(fd, b'\r')
    ok = wait_for(lambda d: any(a['project'] == 'e2e-app' and COMMAND in a['detail'] for a in d['approvals']), 40)
    check('permission prompt -> waiting for approval, with the command', ok)
    if not ok: print(screen_tail())
    pump(1)
    check('approval notification sent', any(l.startswith('Approval needed · e2e-app | Bash: curl') for l in open(log)))
    os.write(fd, b'\x1b')
    ok = wait_for(lambda d: not d['approvals'] and agent(d) and agent(d)['status'] != 'waiting', 15)
    check('Esc on the prompt -> no longer waiting', ok)
    check('shown as interrupted', (agent(board()) or {}).get('detail') == 'Interrupted')
    pump(1)
    os.write(fd, b'say hi'); pump(1); os.write(fd, b'\r')
    check('next prompt finishes as done', wait_for(lambda d: agent(d) and agent(d)['status'] == 'done', 40))
    subprocess.run(['node', os.path.join(PLUGIN, 'server', 'ctl.js'), 'notifications', 'remind', '0.05'], env={**os.environ, **env}, capture_output=True)
    os.write(fd, b'now please run the command again'); pump(1); os.write(fd, b'\r')
    check('second command waits for approval', wait_for(lambda d: any(LONG_COMMAND in a['detail'] for a in d['approvals']), 40))
    os.write(fd, b'\r')   # approve (first option: Yes)
    ok = wait_for(lambda d: not d['approvals'] and agent(d) and agent(d)['status'] == 'in_progress', 8)
    check('approved long command -> working while it runs', ok)
    if not ok: print(screen_tail())
    pump(4)
    check('no approval reminder for the approved command', not any(l.startswith('Still waiting') for l in open(log)))
    check('then done when it finishes', wait_for(lambda d: agent(d) and agent(d)['status'] == 'done', 30))
    os.write(fd, b'/exit'); pump(1); os.write(fd, b'\r')
    ok = wait_for(lambda d: agent(d) is None, 20)
    check('quitting removes the session', ok)
    if not ok: print(screen_tail())
finally:
    try: os.kill(pid, 9)
    except OSError: pass
    api.kill()
    subprocess.run([os.path.join(ROOT, 'bin', 'claude-s'), 'stop'], env={**os.environ, **env}, capture_output=True)
    shutil.rmtree(work, ignore_errors=True)

print(f'---- {passed} passed, {failed} failed')
sys.exit(1 if failed else 0)
