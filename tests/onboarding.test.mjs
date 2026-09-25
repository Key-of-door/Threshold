import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { modelRuntime, modelChoices, setupModels } from '../src/pi-config.mjs';
import { startService } from '../src/service.mjs';
import { serviceState } from '../src/service-process.mjs';
import { runtimeError } from '../src/runtime-error.mjs';
import { createServer } from 'node:http';
import { startPi } from '../src/pi.mjs';
import { openStore } from '../src/store.mjs';

const exec = promisify(execFile), cli = resolve('src/cli.mjs');
const temp = () => mkdtempSync(join(tmpdir(), 'threshold-onboarding-'));
const invoke = (home, ...args) => exec(process.execPath, [cli, ...args, '--home', home], { windowsHide: true, timeout: 20000 });
const json = file => JSON.parse(readFileSync(file, 'utf8'));
const write = (file, value) => writeFileSync(file, JSON.stringify(value));
const fixtureModel = { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions', models: [{ id: 'fixture' }] };
function answers(values) {
  return { async ask(label) { assert.ok(values.length, `Unexpected prompt: ${label}`); return values.shift(); },
    async choose() { return 'openai-completions'; } };
}
const sink = () => ({ text: '', write(chunk) { this.text += chunk; } });

test('setup uses Pi credential storage, preserves unrelated config, and new runtime reloads the key', async () => {
  const dir = temp(), output = sink(), key = '!not-a-command-$literal';
  write(join(dir, 'models.json'), { providers: { fixture: { ...fixtureModel, apiKey: '$MISSING_TEST_KEY' }, other: { ...fixtureModel } } });
  write(join(dir, 'settings.json'), { defaultProvider: 'old', defaultModel: 'old', shellPath: process.execPath, editor: 'keep' });
  write(join(dir, 'auth.json'), { other: { type: 'api_key', key: 'preserve-me' } });
  await setupModels(dir, answers(['fixture', 'fixture', key]), output);
  assert.equal(json(join(dir, 'settings.json')).editor, 'keep');
  assert.equal(json(join(dir, 'settings.json')).defaultModel, 'fixture');
  assert.deepEqual(json(join(dir, 'models.json')).providers.other, fixtureModel);
  assert.equal(json(join(dir, 'models.json')).providers.fixture.apiKey, undefined);
  assert.equal(json(join(dir, 'auth.json')).other.key, 'preserve-me');
  const runtime = await modelRuntime(dir, ['fixture']);
  assert.equal((await runtime.getAuth('fixture')).auth.apiKey, key);
  assert.equal((await modelChoices(dir)).models.find(m => m.provider === 'fixture').configured, true);
  assert.ok((await modelChoices(dir)).models.some(m => m.configured === null), 'unprobed native providers are not reported as missing credentials');
  assert.ok(!output.text.includes(key));
  assert.ok(!JSON.stringify(await modelChoices(dir)).includes(key));
});

test('setup cancellation or malformed existing config does not replace prior files', async () => {
  const dir = temp(), settings = join(dir, 'settings.json');
  write(settings, { shellPath: process.execPath, keep: true });
  const before = readFileSync(settings, 'utf8');
  await assert.rejects(setupModels(dir, { ask: async () => { throw new Error('Cancelled'); } }, sink()), /Cancelled/);
  assert.equal(readFileSync(settings, 'utf8'), before);
  writeFileSync(join(dir, 'auth.json'), '{bad json');
  await assert.rejects(setupModels(dir, answers([]), sink()), /Cannot read configuration/);
  assert.equal(readFileSync(join(dir, 'auth.json'), 'utf8'), '{bad json');
});

test('setup confirms unknown capacities and preserves existing declarations instead of silently raising them', async () => {
  const dir = temp(), output = sink();
  write(join(dir, 'settings.json'), { shellPath: process.execPath });
  await setupModels(dir, answers(['custom', 'new-model', 'http://127.0.0.1:1/v1', '512000', '300000', 'local-test-key']), output);
  assert.deepEqual(json(join(dir, 'models.json')).providers.custom.models[0], { id: 'new-model', name: 'new-model', contextWindow: 512000, maxTokens: 300000 });
  assert.match(output.text, /not an online capability check/);
  const before = readFileSync(join(dir, 'models.json'), 'utf8');
  await setupModels(dir, answers(['custom', 'new-model', '']), output);
  assert.equal(readFileSync(join(dir, 'models.json'), 'utf8'), before);
  assert.match(output.text, /contextWindow=512000, maxTokens=300000/);
  assert.doesNotMatch(output.text, /local-test-key/);
  const badDir = temp(); write(join(badDir, 'settings.json'), { shellPath: process.execPath });
  await assert.rejects(setupModels(badDir, answers(['custom', 'bad-model', 'http://127.0.0.1:1/v1', '4096', '8192']), sink()), /Output capacity/);
  assert.equal(existsSync(join(badDir, 'models.json')), false);
});

test('official Flash setup confirms the documented example capacities and permits the reported large Run settings', async () => {
  const dir = temp(), output = sink(), seen = [];
  write(join(dir, 'settings.json'), { shellPath: process.execPath });
  const values = ['deepseek', 'deepseek-flash', 'https://api.deepseek.com', undefined, undefined, 'local-only-key'];
  await setupModels(dir, { async ask(label, options) { seen.push({ label, fallback: options?.fallback }); return values.shift() ?? options.fallback; }, async choose() { return 'openai-completions'; } }, output);
  const entry = json(join(dir, 'models.json')).providers.deepseek.models[0];
  assert.equal(entry.contextWindow, 1000000); assert.equal(entry.maxTokens, 384000);
  assert.ok(seen.some(item => item.label === 'Model context capacity (tokens)' && item.fallback === '1000000'));
  const { validateModelSettings } = await import('../src/run-settings.mjs');
  const runtime = await modelRuntime(dir, ['deepseek']);
  assert.doesNotThrow(() => validateModelSettings(runtime.getModel('deepseek', 'deepseek-flash'), { thinking: 'max', contextWindow: 512000, maxOutputTokens: 300000 }));
});

test('pipes/JSON never prompt for secrets or infer missing Run arguments', async () => {
  const dir = temp();
  await assert.rejects(invoke(dir, 'setup'), e => /interactive terminal/.test(e.stderr));
  await assert.rejects(invoke(dir, 'setup', '--json'), e => /interactive terminal/.test(e.stderr));
  await assert.rejects(invoke(dir, 'run', '--attach', '--json'), e => /Missing --task/.test(e.stderr));
  assert.equal(existsSync(join(dir, 'project.sqlite')), false);
});

test('background start returns, reuses a live instance, stops cleanly and preserves the DB across restart', async () => {
  const dir = temp(), home = join(dir, 'home'), agent = join(dir, 'pi'); mkdirSync(agent);
  try {
    const first = JSON.parse((await invoke(home, 'service', 'start', '--port', '0', '--agent-dir', agent, '--json')).stdout);
    assert.equal(first.state, 'running');
    const second = JSON.parse((await invoke(home, 'service', 'start', '--json')).stdout);
    assert.equal(second.pid, first.pid); assert.equal(second.alreadyRunning, true);
    assert.equal((await serviceState(home)).state, 'running');
    await invoke(home, 'service', 'stop');
    for (let i = 0; i < 100 && (await serviceState(home)).state !== 'stopped'; i++) await delay(30);
    assert.equal((await serviceState(home)).state, 'stopped');
    assert.ok(existsSync(join(home, 'project.sqlite')));
    const stopped = await invoke(home, 'service', 'stop'); assert.match(stopped.stdout, /not running/);
    const third = JSON.parse((await invoke(home, 'service', 'start', '--port', '0', '--agent-dir', agent, '--json')).stdout);
    assert.notEqual(third.pid, first.pid);
  } finally {
    if ((await serviceState(home)).state === 'running') await invoke(home, 'service', 'stop');
  }
});

test('stale markers are reported without deleting state or starting a second service', async () => {
  const dir = temp(), lock = join(dir, 'server.lock');
  write(lock, { pid: 2147483647 });
  const before = readFileSync(lock, 'utf8');
  assert.equal((await serviceState(dir)).state, 'stale');
  await assert.rejects(invoke(dir, 'service', 'start'), e => /runtime markers remain/.test(e.stderr));
  assert.equal(readFileSync(lock, 'utf8'), before);
});

test('occupied port leaves existing Run state unchanged and does not create a new project database', async () => {
  const dir = temp(), store = openStore(join(dir, 'project.sqlite'));
  const project = store.createProject('Existing project', '/fixture');
  const task = store.createTask(project.id, 'Existing task', 'Keep the existing worker state');
  const run = store.startRun(task.id, 'fixture', 'fixture');
  store.running(run.id, 'existing-session');
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port, freshHome = join(temp(), 'new-home');
  try {
    await assert.rejects(startService({ home: dir, agentDir: dir, port }), /already in use/);
    assert.equal(store.run(run.id).status, 'running');
    assert.equal(store.run(run.id).session_id, 'existing-session');
    assert.equal(existsSync(join(dir, 'server.lock')), false);
    await assert.rejects(startService({ home: freshHome, agentDir: dir, port }), /already in use/);
    assert.equal(existsSync(join(freshHome, 'project.sqlite')), false);
  } finally { store.close(); await new Promise(resolve => listener.close(resolve)); }
});

test('explicit folder initialization requires intent, never registers its parent silently, and JSON stays structured', async () => {
  const dir = temp(), repo = join(dir, 'my project'); mkdirSync(repo);
  const home = join(dir, 'state'), service = await startService({ home, agentDir: dir, port: 0 });
  try {
    await assert.rejects(invoke(home, 'project', 'create', '--repo', repo, '--json'), e => /--init-git/.test(e.stderr));
    assert.equal(existsSync(join(repo, '.git')), false);
    const project = JSON.parse((await invoke(home, 'project', 'create', '--repo', repo, '--init-git', '--json')).stdout);
    assert.equal(project.repo_path, repo);
    const nested = join(repo, 'nested'); mkdirSync(nested);
    await assert.rejects(invoke(home, 'project', 'create', '--repo', nested, '--init-git'), e => /parent Git repository/.test(e.stderr));
    assert.equal(existsSync(join(nested, '.git')), false);
    assert.equal(JSON.parse((await invoke(home, 'status', '--all', '--json')).stdout).projects.length, 1);
  } finally { await service.close(); }
});

test('real service checks model/credential before creating a Run; catalog contains no secret', async () => {
  const dir = temp(), home = join(dir, 'home'), repo = join(dir, 'repo'); mkdirSync(repo);
  await exec('git', ['init', repo], { windowsHide: true });
  write(join(dir, 'models.json'), { providers: { fixture: { ...fixtureModel, apiKey: '$MISSING_THRESHOLD_FIXTURE_KEY' } } });
  const service = await startService({ home, agentDir: dir, port: 0 });
  const call = async (path, data) => {
    const response = await fetch(service.url + path, { method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: data && JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const p = (await call('/projects', { name: 'P', repoPath: repo })).body;
    const t = (await call('/tasks', { projectId: p.id, title: 'T', instructions: 'test' })).body;
    const missing = await call(`/tasks/${t.id}/runs`, { provider: 'fixture', model: 'fixture' });
    assert.equal(missing.status, 400); assert.match(missing.body.error, /API key or provider login is missing/);
    const unknown = await call(`/tasks/${t.id}/runs`, { provider: 'fixture', model: 'absent' });
    assert.equal(unknown.status, 400); assert.match(unknown.body.error, /Model not found/);
    assert.equal((await call(`/tasks/${t.id}`)).body.recentRuns.length, 0);
    assert.equal((await call(`/projects/${p.id}/board`)).body.resources.started, 0);
    assert.equal((await call('/models')).body.models.find(m => m.provider === 'fixture').configured, false);
  } finally { await service.close(); }
});

test('diagnostics give known causes without copying raw provider payloads into history', () => {
  assert.match(runtimeError(new Error('No API key for fixture/model')), /API key is missing/);
  assert.match(runtimeError(Object.assign(new Error('secret provider payload'), { status: 401 })), /HTTP 401/);
  assert.match(runtimeError(new Error('429 secret provider payload')), /HTTP 429/);
  assert.match(runtimeError(new Error('fetch failed')), /connection failed/);
  assert.equal(runtimeError(new Error('credential=must-not-leak')), 'request failed (exact cause unavailable)');
});

test('real Pi loads saved credentials after restart; extension-defined providers still resolve inside Pi', async () => {
  const dir = temp(), repo = join(dir, 'repo'); mkdirSync(repo);
  await exec('git', ['init', repo], { windowsHide: true });
  const requests = [], failures = [], key = 'test-only-saved-credential';
  const workerFactory = options => startPi({ ...options, onEvent(event) {
    if (event.type === 'message_end' && event.message?.stopReason === 'error') failures.push(event.message.errorMessage);
    options.onEvent(event);
  } });
  const api = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, authenticated: req.headers.authorization === `Bearer ${key}`, model: JSON.parse(body).model });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture' };
    res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: 'assistant', content: 'Local fixture response.' }, finish_reason: null }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const provider = { ...fixtureModel, baseUrl: `http://127.0.0.1:${api.address().port}/v1` };
  write(join(dir, 'models.json'), { providers: { fixture: provider } });
  write(join(dir, 'auth.json'), { fixture: { type: 'api_key', key } });
  write(join(dir, 'settings.json'), { shellPath: process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash' });
  const extension = join(dir, 'provider.ts');
  const extensionProvider = { ...provider, apiKey: key, models: [{ id: 'fixture', name: 'Fixture', reasoning: false,
    input: ['text'], contextWindow: 128000, maxTokens: 1024, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] };
  writeFileSync(extension, `export default function(pi) { pi.registerProvider('extension-fixture', ${JSON.stringify(extensionProvider)}); }`);
  let service;
  try {
    const home = join(dir, 'home');
    service = await startService({ home, agentDir: dir, port: 0, workerFactory });
    const call = async (path, data) => {
      const response = await fetch(service.url + path, { method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: data && JSON.stringify(data) });
      const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
    };
    const p = await call('/projects', { name: 'P', repoPath: repo });
    const task = await call('/tasks', { projectId: p.id, title: 'T', instructions: 'Local fixture only' });
    await service.close();
    service = await startService({ home, agentDir: dir, port: 0, workerFactory });
    for (const extensions of [[], [extension]]) {
      const run = await call(`/tasks/${task.id}/runs`, { provider: extensions.length ? 'extension-fixture' : 'fixture', model: 'fixture', extensions });
      const deadline = Date.now() + 15000;
      let state;
      do { await delay(50); state = await call(`/runs/${run.id}`); } while (state.status !== 'ended' && Date.now() < deadline);
      assert.equal(state.status, 'ended'); assert.equal(state.error, null, JSON.stringify({ requests, failures }));
      assert.ok(!JSON.stringify(state).includes(key));
    }
    assert.equal(requests.length, 2); assert.ok(requests.every(r => r.authenticated));
    assert.ok(requests.every(r => r.url === '/v1/chat/completions' && r.model === 'fixture'));
  } finally { await service?.close(); await new Promise(resolve => api.close(resolve)); }
});
