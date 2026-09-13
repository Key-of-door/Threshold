import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { openStore } from '../src/store.mjs';
import { startService } from '../src/service.mjs';
const temp = () => mkdtempSync(join(tmpdir(), 'threshold-task-test-'));

test('v1 migration preserves existing project/checkpoint/decision and keeps old Run objective unknown', () => {
  const path = join(temp(), 'state.sqlite');
  const old = new DatabaseSync(path);
  old.exec(readFileSync(new URL('./fixtures/state-v1.sql', import.meta.url), 'utf8')); old.close();
  const store = openStore(path);
  try {
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 5);
    assert.equal(store.run('r').capabilities, null);
    assert.equal(store.context('t').checkpoint.id, 'c');
    assert.equal(store.context('t').checkpoint.git.head, 'existing-head');
    assert.equal(store.task('t').status_update, null);
    assert.equal(store.run('r').objective, null);
    assert.equal(store.run('r').status, 'unknown');
    assert.equal(store.fakeDeploy('t', 'staging').status, 'NO');
  } finally { store.close(); }
});

test('explicit Run objective reaches the worker; task update is ordinary, attributed, reopenable and persistent', async () => {
  const home = temp(), repo = temp();
  execFileSync('git', ['init', repo], { windowsHide: true, stdio: 'ignore' });
  let env, prompt, finish;
  let service = await startService({ home, agentDir: home, port: 0, workerFactory: options => {
    env = options.env;
    const ended = new Promise(resolve => { finish = resolve; });
    return { request: async () => ({ sessionId: 'goal-session' }), turn: message => { prompt = message; return ended; },
      stop: async () => { finish(); return { code: 0 }; } };
  } });
  const call = async (path, data, token) => {
    const r = await fetch(service.url + path, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: r.status, data: await r.json() };
  };
  try {
    const project = (await call('/projects', { name: 'Test', repoPath: repo })).data;
    const task = (await call('/tasks', { projectId: project.id, title: 'Task', instructions: 'Complete parser and CLI' })).data;
    const objective = 'Finish the remaining CLI, check the whole project, then assess Task status.';
    const run = (await call(`/tasks/${task.id}/runs`, { provider: 'test', model: 'test', objective })).data;
    const token = env.THRESHOLD_RUN_TOKEN;
    assert.equal(run.objective, objective);
    assert.ok(prompt.includes(objective));
    const context = (await call('/agent/task', undefined, token)).data;
    assert.equal(context.currentRun.id, run.id);
    assert.equal(context.currentRun.objective, objective);
    assert.equal((await call('/agent/fake-deploy', { target: 'staging' }, token)).data.status, 'ASK');
    assert.equal((await call('/agent/task/status', { status: 'unknown', note: 'bad' }, token)).status, 400);
    assert.equal((await call('/agent/task/status', { status: 'done' }, token)).status, 400);
    await call('/agent/checkpoints', { summary: 'I think it is complete' }, token);
    assert.equal((await call(`/tasks/${task.id}`)).data.task.status, 'in_progress');
    const updated = (await call('/agent/task/status', { status: 'done', note: 'CLI tests passed', source: 'human', runId: 'forged' }, token)).data;
    assert.equal(updated.status, 'done');
    assert.equal(updated.status_update.source, 'agent');
    assert.equal(updated.status_update.runId, run.id);
    assert.equal(updated.status_update.note, 'CLI tests passed');
    assert.ok(updated.status_update.updatedAt);
    assert.equal((await call('/agent/fake-deploy', { target: 'staging' }, token)).data.status, 'ASK');
    const other = (await call('/tasks', { projectId: project.id, title: 'Other', instructions: 'Other work' })).data;
    assert.equal((await call(`/tasks/${other.id}/status`, { status: 'done', note: 'other' }, token)).status, 403);
    await call(`/runs/${run.id}/stop`, {});
    await service.close();
    service = await startService({ home, agentDir: home, port: 0 });
    const restored = (await call(`/tasks/${task.id}`)).data;
    assert.equal(restored.task.status, 'done');
    assert.equal(restored.task.status_update.runId, run.id);
    assert.equal(restored.recentRuns[0].objective, objective);
    // CLI is a client, not a Human Decision issuer for this ordinary operation.
    const cli = new URL('../src/cli.mjs', import.meta.url);
    const { fileURLToPath } = await import('node:url');
    const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(cli), 'task', 'update', '--home', home,
      '--task', task.id, '--status', 'in_progress', '--note', 'Review found remaining work'], { windowsHide: true });
    const reopened = JSON.parse(stdout);
    assert.equal(reopened.status, 'in_progress');
    assert.equal(reopened.status_update.source, 'client');
    assert.equal(reopened.status_update.runId, null);
    assert.equal((await call(`/runs/${run.id}`)).data.status, 'ended');
  } finally { await service.close(); }
});
