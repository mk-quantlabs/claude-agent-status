// Tests for click-to-focus navigation: which window or tab belongs to a session.
// Run: node tests/navigation.test.js   (no dependencies)
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-status-home-'));
process.env.HOME = tmpHome; // temporary home folder for the JetBrains fixtures
const { parseWindowList, titleMatches, chooseTarget, windowNeedles, pickOpenJetBrainsProject, tildePath } =
  require('../plugins/agent-status/server/focus.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS  ${name}`); } catch (e) { console.log(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}
const W = (w, title) => `W\t${w}\t${title}`;
const T = (w, g, b, title) => `T\t${w}\t${g}\t${b}\t${title}`;

// ---------- title matching ----------
test('JetBrains title "proj – file"', () => assert(titleMatches('data-pipeline – loader.py', 'data-pipeline')));
test('JetBrains title with path "proj [~/a/proj] – file"', () => assert(titleMatches('api [~/work/api] – main.py', 'api')));
test('VS Code title "file — proj"', () => assert(titleMatches('loader.py — data-pipeline', 'data-pipeline')));
test('VS Code title "file — proj — Visual Studio Code"', () => assert(titleMatches('a.ts — web-app — Visual Studio Code', 'web-app')));
test('terminal title "~/path/proj"', () => assert(titleMatches('~/PycharmProjects/workspace/data-pipeline', 'data-pipeline')));
test('exact title', () => assert(titleMatches('data-pipeline', 'data-pipeline')));
test('similar names never match: app vs app-v2', () => assert(!titleMatches('app-v2 – main.py', 'app')));
test('substring never matches: data vs data-pipeline', () => assert(!titleMatches('data-pipeline – x.py', 'data')));
test('file named like the project does not match', () => assert(!titleMatches('web-app – data-pipeline.py', 'data-pipeline')));
test('path needle matches "[~/a/api]"', () => assert(titleMatches('api [~/a/api] – x.py', '~/a/api')));
test('path needle rejects other folder with same name', () => assert(!titleMatches('api [~/b/api] – x.py', '~/a/api')));

// ---------- choosing the target ----------
test('projects as tabs of one window -> press the right tab', () => {
  const e = parseWindowList([
    W(1, 'web-app – settings.py'),
    T(1, 1, 1, 'web-app – settings.py'), T(1, 1, 2, 'api-server – routes/users.py'), T(1, 1, 3, 'data-pipeline – loader.py'),
  ].join('\n'));
  const t = chooseTarget(e, ['data-pipeline']);
  assert.deepStrictEqual([t.kind, t.w, t.g, t.b], ['tab', 1, 1, 3]);
});
test('one window per project -> raise the right window', () => {
  const e = parseWindowList([W(1, 'api-server – a.py'), W(2, 'data-pipeline – b.py'), W(3, 'web-app – c.py')].join('\n'));
  const t = chooseTarget(e, ['data-pipeline']);
  assert.deepStrictEqual([t.kind, t.w], ['window', 2]);
});
test('tabs win over a background window with the same title', () => {
  const e = parseWindowList([W(1, 'api-server – a.py'), W(2, 'data-pipeline – b.py'), T(1, 1, 2, 'data-pipeline – b.py')].join('\n'));
  assert.strictEqual(chooseTarget(e, ['data-pipeline']).kind, 'tab');
});
test('most specific needle wins (exact path before name)', () => {
  const e = parseWindowList([W(1, 'api [~/b/api] – x.py'), W(2, 'api [~/a/api] – y.py')].join('\n'));
  assert.strictEqual(chooseTarget(e, ['~/a/api', 'api']).w, 2);
});
test('session in a subfolder of the open project -> parent name matches', () => {
  const e = parseWindowList([W(1, 'workspace – web-app/settings.py')].join('\n'));
  assert.strictEqual(chooseTarget(e, ['web-app', 'workspace']).w, 1);
});
test('no matching window -> null (nothing is touched)', () => {
  const e = parseWindowList([W(1, 'api-server – a.py')].join('\n'));
  assert.strictEqual(chooseTarget(e, ['data-pipeline']), null);
});
test('tab titles containing tabs/odd characters are parsed', () => {
  const e = parseWindowList(T(2, 1, 4, 'weird\tname – x'));
  assert.deepStrictEqual([e[0].w, e[0].b, e[0].title], [2, 4, 'weird\tname – x']);
});

// ---------- needles from the session folder ----------
test('needles: folder then parent', () => assert.deepStrictEqual(windowNeedles('/Users/x/PycharmProjects/workspace/web-app'), ['web-app', 'workspace']));
test('tildePath', () => assert.strictEqual(tildePath(path.join(tmpHome, 'a', 'b')), '~/a/b'));

// ---------- which JetBrains project is open ----------
const proj = (...p) => path.join(tmpHome, 'PycharmProjects', ...p);
fs.mkdirSync(proj('workspace', '.idea'), { recursive: true });
fs.mkdirSync(proj('workspace', 'web-app', '.idea'), { recursive: true });
fs.mkdirSync(proj('solo', '.idea'), { recursive: true });
function recent(product, entries) {
  const dir = path.join(tmpHome, 'Library', 'Application Support', 'JetBrains', product, 'options');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'recentProjects.xml'), `<application><component name="RecentProjectsManager"><option name="additionalInfo"><map>
${entries.map(([key, opened]) => `<entry key="${key}"><value><RecentProjectMetaInfo frameTitle="x"${opened ? ' opened="true"' : ''} projectWorkspaceId="y"></RecentProjectMetaInfo></value></entry>`).join('\n')}
</map></option></component></application>`);
}
recent('PyCharm2026.2', [['$USER_HOME$/PycharmProjects/workspace', true], ['$USER_HOME$/PycharmProjects/workspace/web-app', false]]);
recent('Rider2026.1', [[proj('solo'), true]]);

test('parent project open -> picks the parent, not the stale child .idea',
  () => assert.strictEqual(pickOpenJetBrainsProject([proj('workspace', 'web-app'), proj('workspace')]), proj('workspace')));
test('project not open -> null (we never open it)',
  () => assert.strictEqual(pickOpenJetBrainsProject([proj('workspace', 'web-app')]), null));
test('several IDEs / versions are all read (Rider + PyCharm)',
  () => assert.strictEqual(pickOpenJetBrainsProject([proj('solo')]), proj('solo')));
test('candidate without .idea is ignored',
  () => assert.strictEqual(pickOpenJetBrainsProject([path.join(tmpHome, 'nope')]), null));

fs.rmSync(tmpHome, { recursive: true, force: true });
console.log(`---- ${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
