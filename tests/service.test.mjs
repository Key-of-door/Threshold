import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openStore } from '../src/store.mjs';
import { startService } from '../src/service.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'threshold-test-'));
test('restart preserves project/checkpoint/decision/results, and does not turn a missing exit into success', () => {
  const file = join(temp(), 'state.sqlite');
  let store = openStore(file);
  const project = store.createProject('example', '/example');
  const task = store.createTask(project.id, 'Task', 'One increment');
  const run = store.startRun(task.id, 'test', 'test');
  store.running(run.id, 'native-session');
  store.checkpoint(task.id, run.id, 'I think it is done', { source: 'git_observation', head: 'a', status: ' M example' });
  store.decide(task.id, 'staging', 'allow');
  assert.equal(store.fakeDeploy(task.id, 'staging').status, 'GO');
  store.close(); store = openStore(file);
  try {
    assert.equal(store.context(task.id).task.status, 'in_progress');
    assert.equal(store.context(task.id).checkpoint.source, 'agent_summary');
    assert.equal(store.context(task.id).checkpoint.git.status, ' M example');
    assert.equal(store.run(run.id).status, 'unknown');
    assert.equal(store.run(run.id).exit_code, null);
    assert.equal(store.controlledState(task.id).results.length, 1);
    assert.equal(store.fakeDeploy(task.id, 'preview').status, 'ASK');
    const other = store.createTask(project.id, 'Other', 'Other scope');
    assert.equal(store.fakeDeploy(other.id, 'staging').status, 'ASK');
    store.decide(task.id, 'staging', 'deny');
    assert.equal(store.fakeDeploy(task.id, 'staging').status, 'NO');
  } finally { store.close(); }
});

test('HTTP run credentials cannot issue Human decisions; local ASK allows checkpoints and persists across normal restart', async () => {
  const home = temp(), repo = temp();
  execFileSync('git', ['init', repo], { windowsHide: true, stdio: 'ignore' });
  let credentials, finish;
  const workerFactory = options => {
    credentials = options.env;
    const ended = new Promise(resolve => { finish = resolve; });
    return { request: async () => ({ sessionId: 'test-session' }), turn: () => ended,
      stop: async () => { finish(); return { code: 0 }; } };
  };
  let service = await startService({ home, agentDir: home, port: 0, workerFactory });
  const call = async (path, data, key) => {
    const response = await fetch(service.url + path, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  try {
    await assert.rejects(startService({ home, agentDir: home, port: 0 }), /lock exists/);
    const p = (await call('/projects', { name: 'Test', repoPath: repo })).body;
    assert.equal((await call('/tasks', { projectId: p.id })).status, 400);
    const t = (await call('/tasks', { projectId: p.id, title: 'Task', instructions: 'Do work' })).body;
    const r = (await call(`/tasks/${t.id}/runs`, { provider: 'test', model: 'test' })).body;
    const key = credentials.THRESHOLD_RUN_TOKEN;
    assert.equal((await call('/agent/fake-deploy', { target: 'staging' }, key)).body.status, 'ASK');
    assert.equal((await call('/agent/fake-deploy', { target: 'production' }, key)).status, 400);
    const cp = await call('/agent/checkpoints', { summary: 'Ordinary work continues despite deployment ASK' }, key);
    assert.equal(cp.status, 201);
    assert.equal((await call('/human/decisions', { taskId: t.id, target: 'staging', decision: 'allow', actor: 'human' }, key)).status, 401);
    assert.equal((await call(`/tasks/${t.id}/runs`, { provider: 'test', model: 'test' })).status, 409);
    const human = readFileSync(join(home, 'human.key'), 'utf8');
    assert.equal((await call('/human/decisions', { taskId: t.id, target: 'staging', decision: 'allow' }, human)).status, 200);
    assert.equal((await call(`/tasks/${t.id}`)).body.controlled.results.length, 0);
    assert.equal((await call('/agent/fake-deploy', { target: 'staging' }, key)).body.status, 'GO');
    await service.close();
    service = await startService({ home, agentDir: home, port: 0, workerFactory });
    const state = (await call(`/tasks/${t.id}`)).body;
    assert.equal(state.checkpoint.id, cp.body.id);
    assert.equal(state.controlled.results.length, 1);
    assert.equal(state.controlled.decisions[0].decision, 'allow');
    assert.equal(state.recentRuns[0].status, 'ended');
    assert.equal(state.recentRuns[0].id, r.id);
    assert.equal((await call('/agent/task', undefined, key)).status, 401);
    const r2 = (await call(`/tasks/${t.id}/runs`, { provider: 'test', model: 'test' })).body;
    assert.equal((await call('/agent/fake-deploy', { target: 'staging' }, credentials.THRESHOLD_RUN_TOKEN)).body.status, 'GO');
    await call(`/runs/${r2.id}/stop`, {});
  } finally { await service.close(); }
});

test('a model error followed by agent_end and process exit 0 remains a runtime error, not Task success', async () => {
  const home = temp(), repo = temp();
  execFileSync('git', ['init', repo], { windowsHide: true, stdio: 'ignore' });
  const service = await startService({ home, agentDir: home, port: 0, workerFactory: ({ onEvent }) => ({
    request: async () => ({ sessionId: 'failed-model-session' }),
    turn: async () => {
      onEvent({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'provider detail omitted' } });
      onEvent({ type: 'agent_end' });
    }, stop: async () => ({ code: 0 }),
  }) });
  const call = async (path, data) => {
    const r = await fetch(service.url + path, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    assert.ok(r.ok); return r.json();
  };
  try {
    const project = await call('/projects', { name: 'Error test', repoPath: repo });
    const task = await call('/tasks', { projectId: project.id, title: 'Task', instructions: 'Work' });
    const run = await call(`/tasks/${task.id}/runs`, { provider: 'test', model: 'test' });
    const actual = await call(`/runs/${run.id}`);
    assert.equal(actual.exit_code, 0);
    assert.equal(actual.status, 'ended');
    assert.match(actual.error, /model turn error/);
    const state = await call(`/tasks/${task.id}`);
    assert.equal(state.task.status, 'in_progress');
    assert.equal(state.checkpoint, null);
  } finally { await service.close(); }
});
