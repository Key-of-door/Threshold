import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { startService } from '../src/service.mjs';
import { defaultHome } from '../src/cli-display.mjs';
const cli = resolve('src/cli.mjs');
const exec = promisify(execFile);
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { windowsHide: true, stdio: 'ignore' });
function repoAt(path) {
  mkdirSync(path); git(path, 'init');
  git(path, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'seed');
  return path;
}

test('help/version require no service; failures point to a user action without creating home', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'threshold-help-')), missing = join(dir, 'missing');
  for (const words of [[], ['--help'], ['task', '--help'], ['task', 'create', '--help'], ['run', 'stop', '--help'], ['--version']]) {
    const result = await exec(process.execPath, [cli, ...words, '--home', missing], { cwd: dir, windowsHide: true });
    assert.equal(result.stderr, ''); assert.ok(result.stdout.includes('threshold'));
  }
  await assert.rejects(exec(process.execPath, [cli, 'status', '--home', missing], { cwd: dir }), error => {
    assert.match(error.stderr, /No readable service address/); assert.match(error.stderr, /threshold serve/);
    assert.doesNotMatch(error.stderr, /ENOENT|\n\s+at /); return true;
  });
  await assert.rejects(exec(process.execPath, [cli, 'run', '--home', missing], { cwd: dir }), error => {
    assert.match(error.stderr, /Missing --task/); return true;
  });
  assert.equal(existsSync(missing), false);
});

test('same default home across cwd; current Git Project and short IDs work without copying UUIDs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'threshold-first-'));
  const env = { ...process.env, LOCALAPPDATA: dir, XDG_STATE_HOME: dir };
  // macOS uses homedir rather than an environment override; explicit test home there.
  const home = process.platform === 'darwin' ? join(dir, 'state') : defaultHome(process.platform, env);
  const argsHome = process.platform === 'darwin' ? ['--home', home] : [];
  const repo = repoAt(join(dir, 'project')), sub = join(repo, 'nested'); mkdirSync(sub);
  const other = join(dir, 'unrelated'); mkdirSync(other);
  const service = await startService({ home, agentDir: dir, port: 0 });
  const invoke = (cwd, ...args) => exec(process.execPath, [cli, ...args, ...argsHome], { cwd, env, windowsHide: true });
  const json = async (cwd, ...args) => JSON.parse((await invoke(cwd, ...args, '--json')).stdout);
  try {
    const project = await json(sub, 'project', 'create');
    assert.equal((await json(repo, 'project', 'create')).id, project.id);
    assert.equal((await json(other, 'status', '--all')).projects.length, 1);
    const instructions = join(dir, 'task.txt'); writeFileSync(instructions, 'Inspect the actual source.\nThen continue.');
    const task = await json(sub, 'task', 'create', '--title', 'Real task', '--instructions-file', instructions);
    const result = await json(other, 'status', '--task', task.id.slice(0, 8));
    assert.equal(result.task.instructions, 'Inspect the actual source.\nThen continue.');
    assert.equal((await json(sub, 'status')).project.id, project.id);
    assert.match((await invoke(sub, 'status')).stdout, /Real task/);
    assert.equal(existsSync(join(repo, '.local', 'threshold')), false);
    assert.equal(existsSync(join(other, '.local', 'threshold')), false);
    assert.match((await invoke(other, 'status', '--all')).stdout, /Projects:/);
  } finally { await service.close(); }
});

test('lookup detects ambiguity, honors Project scope and finds a Run beyond the recent-five window', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'threshold-lookup-')), home = join(dir, 'state'), repo = repoAt(join(dir, 'project'));
  const service = await startService({ home, agentDir: dir, port: 0, workerFactory: () => ({
    request: async () => ({ sessionId: 'fixture' }), turn: async () => {}, stop: async () => ({ code: 0 }) }) });
  const call = async (path, data) => {
    const response = await fetch(service.url + path, { method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
    assert.ok(response.ok); return response.json();
  };
  const invoke = (...args) => exec(process.execPath, [cli, ...args, '--home', home], { windowsHide: true });
  try {
    const project = await call('/projects', { name: 'one', repoPath: repo });
    const second = await call('/projects', { name: 'two', repoPath: repoAt(join(dir, 'second')) });
    const tasks = [];
    for (let i = 0; i < 17; i++) tasks.push(await call('/tasks', { projectId: project.id, title: `Task ${i}`, instructions: 'test' }));
    const repeated = tasks.find(t => tasks.filter(other => other.id[0] === t.id[0]).length > 1).id[0];
    await assert.rejects(invoke('status', '--task', repeated), error => { assert.match(error.stderr, /Ambiguous task/); return true; });
    await assert.rejects(invoke('task', 'update', '--task', tasks[0].id, '--project', second.id, '--status', 'done', '--note', 'wrong scope'), error => { assert.match(error.stderr, /No task matches/); return true; });
    const runs = [];
    for (let i = 0; i < 7; i++) {
      const run = await call(`/tasks/${tasks[0].id}/runs`, { provider: 'fixture', model: 'fixture' }); runs.push(run);
      while ((await call(`/runs/${run.id}`)).status !== 'ended') await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(!(await call(`/tasks/${tasks[0].id}`)).recentRuns.some(run => run.id === runs[0].id));
    assert.equal(JSON.parse((await invoke('status', '--run', runs[0].id.slice(0, 35), '--json')).stdout).id, runs[0].id);
  } finally { await service.close(); }
});

test('bare stop cannot shut down service; explicit Run stop leaves a peer and the service alive', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'threshold-stop-')), home = join(dir, 'state');
  const service = await startService({ home, agentDir: dir, port: 0, workerFactory: () => {
    let finish; const done = new Promise(resolve => { finish = resolve; });
    return { request: async () => ({ sessionId: 'fixture' }), turn: () => done, stop: async () => { finish(); return { code: 0 }; } };
  } });
  const call = async (path, data) => (await fetch(service.url + path, { method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined })).json();
  const invoke = (...args) => exec(process.execPath, [cli, ...args, '--home', home], { windowsHide: true });
  try {
    const runs = [];
    for (let i = 0; i < 2; i++) {
      const project = await call('/projects', { name: `P${i}`, repoPath: repoAt(join(dir, `repo${i}`)) });
      const task = await call('/tasks', { projectId: project.id, title: 'Work', instructions: 'test' });
      runs.push(await call(`/tasks/${task.id}/runs`, { provider: 'fixture', model: 'fixture' }));
    }
    await assert.rejects(invoke('stop'), error => { assert.match(error.stderr, /No action taken/); return true; });
    const stopped = JSON.parse((await invoke('run', 'stop', runs[0].id.slice(0, 8), '--json')).stdout);
    assert.equal(stopped.status, 'ended'); assert.match(stopped.error, /interrupted/);
    assert.equal((await call(`/runs/${runs[1].id}`)).status, 'running');
    assert.equal((await call('/status')).projects.length, 2);
    await invoke('service', 'stop'); await service.close();
    assert.equal(existsSync(join(home, 'server.json')), false);
  } finally { await service.close(); }
});

test('runtime failure exposes known phase/timeout without leaking a raw provider error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'threshold-diagnosis-'));
  const service = await startService({ home: join(dir, 'state'), agentDir: dir, port: 0, workerFactory: () => ({
    request: async () => ({ sessionId: 'fixture' }),
    turn: async () => { throw Object.assign(new Error('provider raw secret should never appear'), { code: 'THRESHOLD_TURN_TIMEOUT' }); },
    stop: async () => ({ code: 0 }),
  }) });
  const call = async (path, data) => (await fetch(service.url + path, { method: data ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: data ? JSON.stringify(data) : undefined })).json();
  try {
    const project = await call('/projects', { name: 'P', repoPath: repoAt(join(dir, 'repo')) });
    const task = await call('/tasks', { projectId: project.id, title: 'Work', instructions: 'test' });
    const run = await call(`/tasks/${task.id}/runs`, { provider: 'fixture', model: 'fixture' });
    let current; do { current = await call(`/runs/${run.id}`); } while (current.status !== 'ended');
    assert.match(current.error, /model turn: 3-minute turn limit reached/);
    assert.doesNotMatch(JSON.stringify(current), /raw secret/);
  } finally { await service.close(); }
});
