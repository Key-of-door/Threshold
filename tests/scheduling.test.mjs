import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git } from '../src/git.mjs';
import { startService } from '../src/service.mjs';
import { openStore } from '../src/store.mjs';

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'threshold-scheduling-')), repo = join(home, 'repo');
  git(home, 'init', repo); git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'seed');
  const a = join(home, 'a'), b = join(home, 'b');
  git(repo, 'worktree', 'add', '-b', 'a', a); git(repo, 'worktree', 'add', '-b', 'b', b);
  const workers = [];
  const workerFactory = options => {
    let finish;
    const ended = new Promise(resolve => { finish = resolve; });
    workers.push({ ...options, finish, key: options.env.THRESHOLD_RUN_TOKEN });
    return { request: async () => ({ sessionId: `session-${workers.length}` }), turn: () => ended,
      stop: async () => { finish(); return { code: 0 }; } };
  };
  return { home, repo, a, b, workers, workerFactory };
}
function client(service) {
  return async (path, data, key) => {
    const r = await fetch(service.url + path, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: r.status, data: await r.json() };
  };
}
async function create(call, repo) {
  const project = (await call('/projects', { name: 'Project', repoPath: repo })).data;
  const task = (await call('/tasks', { projectId: project.id, title: 'Coordinate', instructions: 'Ordinary work' })).data;
  return { project, task };
}
const normal = { provider: 'fixture', model: 'fixture', objective: 'Work' };

test('peers use distinct worktrees, retain workers after scheduler exits, and a new scheduler reads shared progress', async () => {
  const env = setup();
  const service = await startService({ ...env, agentDir: env.home, port: 0, maxRuns: 6 });
  const call = client(service);
  try {
    const { project, task } = await create(call, env.repo);
    const s1 = (await call(`/tasks/${task.id}/runs`, normal)).data;
    const key = env.workers[0].key;
    const a = (await call('/agent/project/tasks', { title: 'A', instructions: 'Implement A', projectId: 'forged' }, key)).data;
    const b = (await call('/agent/project/tasks', { title: 'B', instructions: 'Implement B' }, key)).data;
    assert.equal(a.project_id, project.id);
    const [ra, rb] = await Promise.all([
      call('/agent/project/runs', { taskId: a.id, workspacePath: env.a, objective: 'A', startedBy: 'forged' }, key),
      call('/agent/project/runs', { taskId: b.id, workspacePath: env.b, objective: 'B' }, key),
    ]);
    assert.equal(ra.status, 202); assert.equal(rb.status, 202);
    assert.equal(ra.data.started_by_run_id, s1.id);
    assert.deepEqual(ra.data.capabilities, { skills: [], extensions: [] });
    assert.deepEqual(env.workers.slice(1).map(worker => worker.cwd).sort(), [env.a, env.b].sort());
    const workerKey = env.workers.find(worker => worker.cwd === env.a).key;
    // Ordinary Project API: no file identity or scheduler-role check. Tool exposure belongs to the extension.
    const ordinaryTask = await call('/agent/project/tasks', { title: 'Another task', instructions: 'Ordinary project API' }, workerKey);
    assert.equal(ordinaryTask.status, 201);
    assert.equal(ordinaryTask.data.project_id, project.id);
    assert.equal((await call('/human/decisions', { taskId: a.id, target: 'staging', decision: 'allow' }, key)).status, 401);
    assert.equal((await call('/agent/fake-deploy', { target: 'staging' }, workerKey)).data.status, 'ASK');
    const other = await create(call, env.a);
    assert.equal((await call('/agent/project/runs', { taskId: other.task.id, workspacePath: env.repo, objective: 'wrong Project' }, key)).status, 403);
    writeFileSync(join(env.a, 'only-a.txt'), 'A work');
    await call('/agent/messages', { body: 'A finding', from_run_id: 'forged' }, workerKey);
    await call('/agent/checkpoints', { summary: 'A progress' }, workerKey);
    const state = (await call('/agent/task', undefined, workerKey)).data;
    assert.equal(state.currentGit.workspace_path, env.a); assert.match(state.currentGit.status, /only-a/);
    assert.match(state.checkpoint.git.status, /only-a/);
    await call(`/runs/${s1.id}/stop`, {});
    assert.equal((await call(`/runs/${ra.data.id}`)).data.status, 'running');
    const s2 = (await call(`/tasks/${task.id}/runs`, normal)).data;
    const nextKey = env.workers[3].key;
    assert.notEqual(s2.id, s1.id);
    const board = (await call('/agent/project/board', undefined, nextKey)).data;
    assert.equal(board.resources.unsettled, 3);
    assert.equal(board.tasks.find(t => t.id === a.id).recentMessages[0].from_run_id, ra.data.id);
    const detail = (await call(`/agent/project/board?taskId=${a.id}`, undefined, nextKey)).data;
    assert.equal(detail.checkpoint.summary, 'A progress'); assert.equal(detail.messages.messages[0].body, 'A finding');
    assert.equal((await call(`/agent/project/runs/${ra.data.id}`, undefined, nextKey)).data.currentGit.workspace_path, env.a);
    assert.equal((await call('/agent/project/board', undefined, key)).status, 401);
  } finally { await service.close(); }
});

test('all launch routes share concurrent and durable cumulative limits; invalid workspace starts nothing', async () => {
  const env = setup();
  let service = await startService({ ...env, agentDir: env.home, port: 0, maxParallelRuns: 2, maxRuns: 3 });
  let call = client(service);
  try {
    const { project, task } = await create(call, env.repo);
    const s = (await call(`/tasks/${task.id}/runs`, normal)).data;
    const key = env.workers[0].key;
    const foreign = join(env.home, 'foreign'); git(env.home, 'init', foreign);
    assert.equal((await call(`/tasks/${task.id}/runs`, { ...normal, workspacePath: foreign })).status, 400);
    const attempts = await Promise.all([
      call('/agent/project/runs', { taskId: task.id, workspacePath: env.a, objective: 'First' }, key),
      call(`/tasks/${task.id}/runs`, { ...normal, workspacePath: env.b }),
    ]);
    assert.deepEqual(attempts.map(r => r.status).sort(), [202, 429]);
    assert.equal(env.workers.length, 2);
    await call(`/runs/${s.id}/stop`, {});
    await service.close();
    service = await startService({ ...env, agentDir: env.home, port: 0, maxParallelRuns: 2, maxRuns: 3 }); call = client(service);
    assert.equal((await call(`/tasks/${task.id}/runs`, normal)).status, 202);
    assert.equal((await call(`/tasks/${task.id}/runs`, { ...normal, workspacePath: env.b })).status, 429);
    const board = (await call(`/projects/${project.id}/board`)).data;
    assert.equal(board.resources.started, 3); assert.equal(board.resources.remainingStarts, 0);
  } finally { await service.close(); }
});

test('an unknown exit retains its workspace and a resource slot after restart', async () => {
  const env = setup();
  const store = openStore(join(env.home, 'project.sqlite'));
  const project = store.createProject('Project', env.repo), task = store.createTask(project.id, 'Task', 'Work');
  const run = store.startRun(task.id, 'fixture', 'fixture', null, undefined, env.a);
  store.running(run.id, 'lost-session'); store.close();
  const service = await startService({ ...env, agentDir: env.home, port: 0, maxParallelRuns: 1 });
  const call = client(service);
  try {
    assert.equal((await call(`/tasks/${task.id}/runs`, { ...normal, workspacePath: env.a })).status, 409);
    assert.equal((await call(`/tasks/${task.id}/runs`, normal)).status, 429);
    const board = (await call(`/projects/${project.id}/board`)).data;
    assert.equal(board.tasks[0].status, 'in_progress'); assert.equal(board.tasks[0].unsettledRuns[0].status, 'unknown');
    assert.equal(env.workers.length, 0);
  } finally { await service.close(); }
});
