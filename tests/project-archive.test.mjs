import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { git, observeGit } from '../src/git.mjs';
import { openStore } from '../src/store.mjs';
import { startService } from '../src/service.mjs';

const exec = promisify(execFile), cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const temp = () => mkdtempSync(join(tmpdir(), 'threshold-archive-'));

test('v6 migration, archive, restart and restore preserve project history and repository files', async () => {
  const home = temp();
  git(home, 'init', join(home, 'repo'));
  const repo = realpathSync(join(home, 'repo'));
  writeFileSync(join(repo, 'keep.txt'), 'unfinished work');
  const beforeGit = git(repo, 'status', '--short');
  const store = openStore(join(home, 'project.sqlite'));
  const project = store.createProject('Old project', repo);
  const task = store.createTask(project.id, 'Continue work', 'Inspect actual files');
  const run = store.startRun(task.id, 'fixture', 'fixture', 'First increment');
  store.running(run.id, 'old-session'); store.endRun(run.id, { code: 0 });
  store.checkpoint(task.id, run.id, 'Continue from files', observeGit(repo));
  store.sendMessage(task.id, 'Please review the actual diff', run.id);
  store.updateTaskStatus(task.id, 'done', 'First increment complete', run.id);
  store.decide(task.id, 'staging', 'deny');
  // Exercise startup from the actual preceding layout with meaningful history.
  store.db.exec('ALTER TABLE runs DROP COLUMN execution_json; ALTER TABLE runs DROP COLUMN model_settings_json; ALTER TABLE projects DROP COLUMN archived_at; PRAGMA user_version=6;');
  store.close();

  const options = { home, agentDir: home, port: 0 };
  let service = await startService(options);
  const call = async (path, data) => {
    const response = await fetch(service.url+path, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  const command = (args, cwd = home) => exec(process.execPath, [cli, ...args, '--home', home], { cwd, windowsHide: true, timeout: 15000 });
  const jsonCommand = async (args, cwd) => JSON.parse((await command([...args, '--json'], cwd)).stdout);
  try {
    const before = (await call(`/tasks/${task.id}`)).body;
    const messages = (await call(`/tasks/${task.id}/messages`)).body;
    const budget = (await call(`/projects/${project.id}/board`)).body.resources;
    assert.equal(before.project.archived_at, null);
    assert.equal(before.currentGit.head, null);
    assert.match((await command(['status', '--task', task.id])).stdout, /No commits yet/);

    await assert.rejects(command(['project', 'archive']), error => /Missing --project/.test(error.stderr));
    await assert.rejects(command(['project', 'archive', project.id, '--include-archived']), error => /status option/.test(error.stderr));
    const archived = await jsonCommand(['project', 'archive', project.id.slice(0, 8)]);
    assert.ok(Number.isFinite(Date.parse(archived.archived_at)));
    assert.deepEqual(await jsonCommand(['project', 'archive', '--project', project.id]), archived);
    assert.deepEqual((await call('/status')).body, { projects: [], tasks: [], unresolvedRuns: [] });
    assert.deepEqual(await jsonCommand(['status', '--all']), { projects: [], tasks: [], unresolvedRuns: [] });
    const all = await jsonCommand(['status', '--all', '--include-archived']);
    assert.equal(all.projects[0].archived_at, archived.archived_at);
    assert.equal(all.tasks[0].id, task.id);
    assert.match((await command(['status', '--all', '--include-archived'])).stdout, /archived/);
    const localStatus = (await command(['status'], repo)).stdout;
    assert.match(localStatus, /Archived \/ history retained/);
    assert.match(localStatus, /threshold project restore/);
    assert.doesNotMatch(localStatus, /No Project here|threshold run --attach|threshold task create/);
    assert.equal((await jsonCommand(['board', '--project', project.id])).project.archived_at, archived.archived_at);

    // Re-registering must neither create a duplicate nor silently restore it.
    const registered = await jsonCommand(['project', 'create', '--repo', repo]);
    assert.equal(registered.id, project.id); assert.equal(registered.archived_at, archived.archived_at);
    assert.deepEqual((await call('/projects', { name: 'New name', repoPath: repo })).body, archived);
    assert.equal((await call('/tasks', { projectId: project.id, title: 'New', instructions: 'Work' })).status, 409);
    // Archive rejection happens before model checks and does not consume a start.
    const launch = await call(`/tasks/${task.id}/runs`, { provider: 'unconfigured', model: 'unconfigured' });
    assert.equal(launch.status, 409); assert.match(launch.body.error, /archived/);
    assert.deepEqual((await call(`/projects/${project.id}/board`)).body.resources, budget);

    await service.close(); service = await startService(options);
    assert.deepEqual((await call('/status')).body, { projects: [], tasks: [], unresolvedRuns: [] });
    const after = (await call(`/tasks/${task.id}`)).body;
    assert.equal(after.project.archived_at, archived.archived_at);
    assert.deepEqual(after.task, before.task);
    assert.deepEqual(after.checkpoint, before.checkpoint);
    assert.deepEqual(after.recentRuns, before.recentRuns);
    assert.deepEqual(after.controlled, before.controlled);
    assert.deepEqual((await call(`/tasks/${task.id}/messages`)).body, messages);
    assert.equal((await jsonCommand(['status', '--run', run.id])).session_id, 'old-session');
    const restored = await jsonCommand(['project', 'restore', '--project', project.id.slice(0, 8)]);
    assert.equal(restored.archived_at, null); assert.equal(restored.id, project.id);
    assert.deepEqual(await jsonCommand(['project', 'restore', project.id]), restored);
    assert.equal((await call('/status')).body.projects[0].id, project.id);
    assert.equal((await call('/tasks', { projectId: project.id, title: 'Next', instructions: 'Keep going' })).status, 201);
    assert.equal(git(repo, 'status', '--short'), beforeGit);
    assert.equal(readFileSync(join(repo, 'keep.txt'), 'utf8'), 'unfinished work');
  } finally { await service.close(); }
});

test('archive refuses active and unresolved Runs without stopping workers or rewriting outcomes', async () => {
  const home = temp();
  git(home, 'init', join(home, 'repo'));
  const repo = realpathSync(join(home, 'repo'));
  const store = openStore(join(home, 'project.sqlite'));
  const project = store.createProject('Busy project', repo), task = store.createTask(project.id, 'Work', 'Inspect');
  const old = store.startRun(task.id, 'fixture', 'fixture'); store.running(old.id, 'old-session'); store.close();
  let starts = 0, stops = 0;
  const workerFactory = () => {
    starts++;
    let finish; const ended = new Promise(resolve => { finish = resolve; });
    return { request: async () => ({ sessionId: 'new-session' }), turn: () => ended,
      stop: async () => { stops++; finish(); return { code: 0 }; } };
  };
  const service = await startService({ home, agentDir: home, port: 0, workerFactory });
  const call = async (path, data) => {
    const response = await fetch(service.url+path, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  const archive = () => call(`/projects/${project.id}/archive`, {});
  const launch = () => call(`/tasks/${task.id}/runs`, { provider: 'fixture', model: 'fixture' });
  try {
    assert.equal((await archive()).status, 409);
    assert.equal((await call(`/runs/${old.id}`)).body.status, 'unknown');
    await call(`/runs/${old.id}/recover`, { confirmReusable: true, note: 'Fixture old worker is gone' });
    assert.equal((await archive()).status, 200);
    assert.equal((await launch()).status, 409); assert.equal(starts, 0);
    await call(`/projects/${project.id}/restore`, {});
    const active = await launch(); assert.equal(active.status, 202); assert.equal(starts, 1);
    assert.equal((await archive()).status, 409); assert.equal(stops, 0);
    assert.equal((await call(`/runs/${active.body.id}/live`)).body.active, true);
    await call(`/runs/${active.body.id}/stop`, {});
    assert.equal((await archive()).status, 200);
    const oldAfter = (await call(`/runs/${old.id}`)).body;
    assert.equal(oldAfter.status, 'unknown'); assert.equal(oldAfter.session_id, 'old-session');
    assert.ok(oldAfter.workspace_recovery);
  } finally { await service.close(); }
});
