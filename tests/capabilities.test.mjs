import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { startPi } from '../src/pi.mjs';
import { startService } from '../src/service.mjs';
import { selectCapabilities } from '../src/capabilities.mjs';

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'threshold-capabilities-'));
  const skill = name => {
    const path = join(home, name, 'SKILL.md'); mkdirSync(join(home, name));
    writeFileSync(path, `---\nname: ${name}\ndescription: Test ${name} guidance\n---\nBody marker ${name} is not catalog metadata.\n`);
    return path;
  };
  writeFileSync(join(home, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl: 'http://127.0.0.1:1', api: 'openai-completions', apiKey: 'unused-no-model-call', models: [{ id: 'fixture' }] } } }));
  return { home, a: skill('review-sample'), b: skill('coding-sample'), dormant: skill('dormant-sample') };
}
const probe = resolve('tests/fixtures/capability-probe.ts');
const hello = resolve('node_modules/@earendil-works/pi-coding-agent/examples/extensions/hello.ts');

test('real Pi: explicit skills/extensions compose; discovered settings stay off; next session starts empty', async () => {
  const { home, a, b, dormant } = setup();
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ skills: [dormant], extensions: [hello] }));
  const sessions = new Set();
  for (const [skills, extensions] of [[[a], [hello]], [[b], []], [[a, b], [hello]], [[], []]]) {
    const pi = startPi({ cwd: home, agentDir: home, provider: 'fixture', model: 'fixture',
      capabilities: selectCapabilities(skills, [...extensions, probe]) });
    try {
      const state = await pi.request('get_state'); sessions.add(state.sessionId);
      const { commands } = await pi.request('get_commands');
      assert.deepEqual(commands.filter(c => c.source === 'skill').map(c => c.sourceInfo.path).sort(), [...skills].sort());
      await pi.request('prompt', { message: '/capability-probe' });
      const { messages } = await pi.request('get_messages');
      const observed = JSON.parse(messages.find(m => m.customType === 'capability-probe').content);
      assert.equal(observed.tools.includes('hello'), extensions.includes(hello));
      assert.ok(observed.tools.includes('read_task'));
      assert.ok(!observed.systemPrompt.includes('dormant-sample'));
      assert.ok(!observed.systemPrompt.includes('Body marker'), 'discovery does not load skill body');
      assert.equal(observed.systemPrompt.includes('review-sample'), skills.includes(a));
      assert.equal(observed.systemPrompt.includes('coding-sample'), skills.includes(b));
    } finally { assert.equal((await pi.stop()).code, 0); }
  }
  assert.equal(sessions.size, 4);
});

test('missing file and Pi extension load failure are technical errors without a model call', async () => {
  const { home } = setup();
  assert.throws(() => selectCapabilities([join(home, 'missing.md')]));
  assert.throws(() => selectCapabilities('not-an-array'));
  const bad = join(home, 'broken.ts'); writeFileSync(bad, 'export default function () { throw new Error("fixture load failure"); }');
  const pi = startPi({ cwd: home, agentDir: home, provider: 'fixture', model: 'fixture', capabilities: selectCapabilities([], [bad]) });
  try { await assert.rejects(pi.request('get_state')); }
  finally { assert.notEqual((await pi.stop()).code, 0); }
});

test('CLI selection reaches one Run and survives restart as metadata; the next Run defaults empty', async () => {
  const { home, a, b } = setup(), repo = join(home, 'repo'); mkdirSync(repo);
  execFileSync('git', ['init', repo], { stdio: 'ignore', windowsHide: true });
  let options, finish, prompt;
  const workerFactory = value => {
    options = value;
    const ended = new Promise(resolve => { finish = resolve; });
    return { request: async type => type === 'get_commands' ? { commands: value.capabilities.skills.map(file => ({ source: 'skill', sourceInfo: { path: file.path } })) } : { sessionId: 'test-session' },
      turn: message => { prompt = message; return ended; }, stop: async () => { finish(); return { code: 0 }; } };
  };
  let service = await startService({ home, agentDir: home, port: 0, workerFactory });
  const call = async (path, data) => {
    const r = await fetch(service.url + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: r.status, data: await r.json() };
  };
  try {
    const project = (await call('/projects', { name: 'Project', repoPath: repo })).data;
    const task = (await call('/tasks', { projectId: project.id, title: 'Work', instructions: 'Work normally' })).data;
    assert.equal((await call(`/tasks/${task.id}/runs`, { provider: 'fixture', model: 'fixture', skills: [join(home, 'missing')] })).status, 400);
    const cli = resolve('src/cli.mjs');
    const { stdout } = await promisify(execFile)(process.execPath, [cli, 'run', '--home', home, '--task', task.id, '--provider', 'fixture', '--model', 'fixture', '--skill', a, '--skill', b, '--extension', hello], { windowsHide: true });
    const run = JSON.parse(stdout);
    assert.deepEqual(options.capabilities, run.capabilities);
    assert.equal(run.capabilities.skills.length, 2); assert.match(run.capabilities.skills[0].sha256, /^[a-f0-9]{64}$/);
    assert.ok(prompt.includes(JSON.stringify(a))); assert.ok(prompt.includes(JSON.stringify(b)));
    await call(`/runs/${run.id}/stop`, {}); await service.close();
    service = await startService({ home, agentDir: home, port: 0, workerFactory });
    const context = (await call(`/tasks/${task.id}`)).data;
    assert.deepEqual(context.recentRuns[0].capabilities, run.capabilities);
    assert.equal(context.task.status, 'in_progress'); assert.equal(context.controlled.decisions.length, 0);
    const next = (await call(`/tasks/${task.id}/runs`, { provider: 'fixture', model: 'fixture' })).data;
    assert.deepEqual(next.capabilities, { skills: [], extensions: [] });
    assert.ok(!prompt.includes(a)); assert.ok(!prompt.includes(b));
    await call(`/runs/${next.id}/stop`, {});
  } finally { await service.close(); }
});
