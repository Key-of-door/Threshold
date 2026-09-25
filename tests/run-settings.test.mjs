import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { runSettings, validateModelSettings, observedModelSettings } from '../src/run-settings.mjs';
import { startPi } from '../src/pi.mjs';
import { startService } from '../src/service.mjs';
import { openStore } from '../src/store.mjs';
import { display, help } from '../src/cli-display.mjs';

const cli = resolve('src/cli.mjs'), exec = promisify(execFile);
const model = { id: 'fixture', provider: 'fixture', api: 'openai-completions', reasoning: true,
  contextWindow: 128000, maxTokens: 4096, thinkingLevelMap: { minimal: null, high: 'high', max: 'max' } };
function fixture(baseUrl = 'http://127.0.0.1:1/v1') {
  const home = mkdtempSync(join(tmpdir(), 'threshold-model-settings-')), repo = join(home, 'repo'); mkdirSync(repo);
  execFileSync('git', ['init', repo], { stdio: 'ignore', windowsHide: true });
  writeFileSync(join(home, 'models.json'), JSON.stringify({ providers: { fixture: { baseUrl, api: model.api, apiKey: 'local-fixture-only', models: [model] } } }));
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ defaultThinkingLevel: 'max', shellPath: process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash' }));
  return { home, repo };
}

test('settings reject malformed/unsupported values and report exact startup values', () => {
  assert.throws(() => validateModelSettings(model, { contextWindow: 512000 }, '/fixture/pi/models.json'), error =>
    /fixture\/fixture/.test(error.message) && /requested contextWindow=512000/.test(error.message)
    && /ceiling=128000/.test(error.message) && /not a provider rejection/.test(error.message) && error.message.includes('/fixture/pi/models.json'));
  for (const value of [null, [], { other: 1 }, { thinking: 'ultra' }, { contextWindow: '100' }, { maxOutputTokens: 0 }, { contextWindow: 1.1 }, { maxOutputTokens: Infinity }]) assert.throws(() => runSettings(value));
  assert.throws(() => validateModelSettings(model, { thinking: 'minimal' }), /unsupported/);
  assert.throws(() => validateModelSettings(model, { thinking: 'xhigh' }), /unsupported/);
  assert.throws(() => validateModelSettings({ ...model, reasoning: false }, { thinking: 'high' }), /unsupported/);
  assert.throws(() => validateModelSettings(model, { contextWindow: 128001 }), /ceiling/);
  assert.throws(() => validateModelSettings(model, { maxOutputTokens: 4097 }), /ceiling/);
  assert.throws(() => validateModelSettings(model, { contextWindow: 1024, maxOutputTokens: 2048 }), /contextWindow/);
  for (const api of ['openai-codex-responses', 'unknown-api']) assert.throws(() => validateModelSettings({ ...model, api }, { maxOutputTokens: 1024 }), /unsupported/);
  assert.throws(() => validateModelSettings({ ...model, api: 'openai-responses', compat: { supportsMaxOutputTokens: false } }, { maxOutputTokens: 1024 }), /unsupported/);
  assert.throws(() => validateModelSettings({ ...model, api: 'openai-responses' }, { maxOutputTokens: 8 }), />= 16/);
  assert.throws(() => validateModelSettings({ ...model, samplingParams: { max_tokens: 4096 } }, { maxOutputTokens: 1024 }), /samplingParams/);
  assert.throws(() => validateModelSettings({ ...model, samplingParams: { reasoning_effort: 'low' } }, { thinking: 'high' }), /samplingParams/);
  assert.throws(() => observedModelSettings({ model, thinkingLevel: 'low' }, { thinking: 'high' }), /did not apply/);
  assert.equal(observedModelSettings({ model: { ...model, api: 'openai-codex-responses' }, thinkingLevel: 'high' }, { thinking: 'high' }).maxOutputTokens, null);
});

test('Run inspection distinguishes pending, historical and provider-managed settings', () => {
  const r = { id: 'run', task_id: 'task', provider: 'openai-codex', model: 'fixture', status: 'starting', capabilities: { skills: [], extensions: [] } };
  assert.match(display(r), /Not recorded/);
  assert.match(display({ ...r, modelSettings: { requested: { thinking: 'high' }, effective: null } }), /Effective settings have not been observed/);
  const out = display({ ...r, modelSettings: { requested: { thinking: 'high' }, effective: { thinking: 'high', contextWindow: 64000, maxOutputTokens: null, outputLimit: 'provider-managed' } } });
  assert.match(out, /thinking=high/); assert.match(out, /provider-managed/); assert.match(out, /Observed at Pi startup/);
  for (const flag of ['--thinking', '--context-window', '--max-output-tokens']) assert.ok(help('run').includes(flag));
});

test('real Pi startup applies per-Run limits and thinking without changing global files or the next session', async () => {
  const { home, repo } = fixture();
  const before = ['settings.json', 'models.json'].map(f => readFileSync(join(home, f), 'utf8'));
  for (const settings of [{ thinking: 'high', contextWindow: 64000, maxOutputTokens: 2048 }, {}]) {
    const pi = startPi({ cwd: repo, agentDir: home, provider: 'fixture', model: 'fixture', modelSettings: settings });
    try {
      const state = await pi.request('get_state');
      const effective = observedModelSettings(state, settings);
      assert.equal(effective.thinking, settings.thinking ?? 'low');
      assert.equal(effective.contextWindow, settings.contextWindow ?? 128000);
      assert.equal(effective.maxOutputTokens, settings.maxOutputTokens ?? 4096);
    } finally { await pi.stop(); }
  }
  assert.deepEqual(['settings.json', 'models.json'].map(f => readFileSync(join(home, f), 'utf8')), before);
});

test('CLI -> service -> real Pi forwards output/reasoning, persists observation and fails before inference on startup mismatch', async () => {
  const requests = [];
  const api = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture' };
    res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const { home, repo } = fixture(`http://127.0.0.1:${api.address().port}/v1`);
  let service = await startService({ home, agentDir: home, port: 0 });
  const call = async (path, data) => {
    const r = await fetch(service.url + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: r.status, data: await r.json() };
  };
  const wait = async id => {
    for (let i = 0; i < 200; i++) { const r = (await call(`/runs/${id}`)).data; if (r.status === 'ended') return r; await delay(50); }
    throw new Error('Run did not end');
  };
  try {
    const p = (await call('/projects', { name: 'settings', repoPath: repo })).data;
    const t = (await call('/tasks', { projectId: p.id, title: 'settings', instructions: 'Local fixture' })).data;
    const normal = { provider: 'fixture', model: 'fixture' };
    assert.equal((await call(`/tasks/${t.id}/runs`, { ...normal, modelSettings: { thinking: 'minimal' } })).status, 400);
    assert.equal((await call(`/tasks/${t.id}/runs`, { ...normal, modelSettings: { maxOutputTokens: '100' } })).status, 400);
    assert.equal((await call(`/tasks/${t.id}`)).data.recentRuns.length, 0);
    const { stdout } = await exec(process.execPath, [cli, 'run', '--home', home, '--json', '--task', t.id, '--provider', 'fixture', '--model', 'fixture', '--thinking', 'high', '--context-window', '64000', '--max-output-tokens', '2048'], { windowsHide: true });
    const started = JSON.parse(stdout), ended = await wait(started.id);
    assert.equal(ended.error, null);
    assert.deepEqual(ended.modelSettings.requested, { thinking: 'high', contextWindow: 64000, maxOutputTokens: 2048 });
    assert.deepEqual(ended.modelSettings.effective, { thinking: 'high', contextWindow: 64000, maxOutputTokens: 2048, outputLimit: 'pi-adapter' });
    assert.equal(requests.length, 1);
    assert.equal(requests[0].max_completion_tokens ?? requests[0].max_tokens, 2048);
    assert.equal(requests[0].reasoning_effort, 'high');
    await service.close(); service = await startService({ home, agentDir: home, port: 0 });
    assert.deepEqual((await call(`/runs/${ended.id}`)).data.modelSettings, ended.modelSettings);
    const next = await wait((await call(`/tasks/${t.id}/runs`, normal)).data.id);
    assert.deepEqual(next.modelSettings.requested, {});
    assert.equal(next.modelSettings.effective.thinking, 'low');
    assert.equal(next.modelSettings.effective.contextWindow, 128000);
    assert.equal(next.modelSettings.effective.maxOutputTokens, 4096);
    const bad = join(home, 'bad.ts');
    writeFileSync(bad, 'export default function(pi) { pi.on("session_start", () => { throw new Error("private fixture details"); }); }');
    const failed = await wait((await call(`/tasks/${t.id}/runs`, { ...normal, extensions: [bad], modelSettings: { thinking: 'high' } })).data.id);
    assert.match(failed.error, /startup extension failed/);
    assert.ok(!failed.error.includes('private fixture details'));
    assert.equal(failed.modelSettings.effective, null);
    assert.equal(requests.length, 2, 'rejected startup must never infer');
  } finally { await service.close(); await new Promise(resolve => api.close(resolve)); }
});

test('v7 migration keeps old Run settings unknown and preserves history', () => {
  const { home, repo } = fixture(), path = join(home, 'old.sqlite');
  let store = openStore(path);
  const p = store.createProject('old', repo), t = store.createTask(p.id, 'old', 'old');
  const r = store.startRun(t.id, 'fixture', 'fixture'); store.endRun(r.id, { code: 0 });
  store.sendMessage(t.id, 'keep', r.id);
  store.db.exec('ALTER TABLE runs DROP COLUMN execution_json; ALTER TABLE runs DROP COLUMN model_settings_json; PRAGMA user_version=7;'); store.close();
  store = openStore(path);
  try { assert.equal(store.run(r.id).modelSettings, null); assert.equal(store.readMessages(t.id).messages[0].body, 'keep'); }
  finally { store.close(); }
});

test('CLI rejects invalid token counts and settings on attach without accessing a service', async () => {
  for (const args of [['run', '--context-window', '1e6'], ['run', '--max-output-tokens', '0'], ['run', '--thinking', 'ultra'], ['run', 'attach', 'abcd', '--thinking', 'high']]) {
    await assert.rejects(exec(process.execPath, [cli, ...args], { windowsHide: true }), error => !error.stderr.includes('Service address unavailable'));
  }
});
