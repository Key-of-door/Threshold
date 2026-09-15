import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { startService } from '../src/service.mjs';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const runCli = (...args) => promisify(execFile)(process.execPath, [cli, ...args], { windowsHide: true });

test('default Task detail and Board overview stay readable; explicit JSON preserves data', async () => {
  const home = mkdtempSync(join(tmpdir(), 'threshold-summary-')), repo = join(home, 'repo');
  execFileSync('git', ['init', repo], { windowsHide: true, stdio: 'ignore' });
  execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'seed'],
    { windowsHide: true, stdio: 'ignore' });
  let finish, token;
  const workerFactory = options => {
    token = options.env.THRESHOLD_RUN_TOKEN;
    const ended = new Promise(resolve => { finish = resolve; });
    return { request: async () => ({ sessionId: 'summary-session' }), turn: () => ended,
      stop: async () => { finish(); return { code: 0 }; } };
  };
  const service = await startService({ home, agentDir: home, port: 0, workerFactory });
  const call = async (path, data, key) => {
    const response = await fetch(service.url + path, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const project = (await call('/projects', { name: 'Summary project', repoPath: repo })).body;
    const task = (await call('/tasks', { projectId: project.id, title: 'Compact status', instructions: 'Work' })).body;
    const run = (await call(`/tasks/${task.id}/runs`, { provider: 'fixture', model: 'fixture', objective: 'First objective line\nhidden objective line' })).body;
    assert.ok(token, 'worker received the Run token');
    assert.equal((await call('/agent/checkpoints', { summary: 'First checkpoint line\nsecond checkpoint line' }, token)).status, 201);

    const human = await runCli('status', '--task', task.id, '--home', home);
    assert.equal(human.stderr, '');
    assert.equal(human.stdout.split('\n')[0], `Compact status  ${task.id.slice(0, 8)}`);
    assert.match(human.stdout, /in_progress  work assessment/);
    assert.match(human.stdout, new RegExp(`Summary project / ${project.id.slice(0, 8)}`));
    assert.match(human.stdout, /Checkpoint\nAgent summary/);
    assert.ok(human.stdout.includes('second checkpoint line'), 'Task detail must expose the actual handoff, not only its first line');
    assert.ok(!human.stdout.includes('"task"'), 'summary must not be JSON');
    assert.match(human.stdout, new RegExp(run.id.slice(0, 8)));
    assert.match(human.stdout, /running/);
    assert.match(human.stdout, /Messages\n0 available/);

    const json = await runCli('status', '--task', task.id, '--home', home, '--json');
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.task.id, task.id);
    assert.equal(parsed.checkpoint.summary, 'First checkpoint line\nsecond checkpoint line');
    assert.equal(parsed.recentRuns[0].id, run.id);
    // Every request re-observes Git; its observation time must remain fresh.
    const withoutObservationTime = value => {
      assert.ok(Number.isFinite(Date.parse(value.currentGit.observedAt)));
      const copy = structuredClone(value); delete copy.currentGit.observedAt; return copy;
    };
    assert.deepEqual(withoutObservationTime(parsed), withoutObservationTime((await call(`/tasks/${task.id}`)).body));
    const plainJson = await runCli('status', '--task', task.id, '--home', home, '--json', '--ascii', '--no-color');
    assert.deepEqual(withoutObservationTime(JSON.parse(plainJson.stdout)), withoutObservationTime(parsed), 'presentation flags cannot change JSON data');
    assert.equal(plainJson.stdout, JSON.stringify(JSON.parse(plainJson.stdout), null, 2)+'\n');

    const board = await runCli('board', '--project', project.id, '--home', home, '--summary');
    assert.equal(board.stdout.split('\n')[0], `Summary project  project ${project.id.slice(0, 8)}`);
    assert.match(board.stdout, new RegExp(`running  ${run.id.slice(0, 8)}`));
    assert.match(board.stdout, /First checkpoint line/);
    assert.ok(!board.stdout.includes('second checkpoint line'), 'board summary must only show the first checkpoint line');
    const boardJson = await runCli('board', '--project', project.id, '--home', home, '--json');
    assert.equal(boardJson.stdout, JSON.stringify((await call(`/projects/${project.id}/board`)).body, null, 2)+'\n');
    assert.equal(JSON.parse(boardJson.stdout).tasks[0].latestRun.objective, 'First objective line\nhidden objective line');
  } finally {
    await service.close();
  }
});
