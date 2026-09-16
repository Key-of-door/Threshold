import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { git } from '../src/git.mjs';
import { openStore } from '../src/store.mjs';
import { startService } from '../src/service.mjs';
import { display } from '../src/cli-display.mjs';

const exec = promisify(execFile), cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
test('restart UNKNOWN retains occupancy until explicit client recovery, without rewriting history or stopping a new worker', async () => {
  const home = mkdtempSync(join(tmpdir(), 'threshold-recovery-'));
  git(home, 'init', join(home, 'repo'));
  const repo = realpathSync(join(home, 'repo'));
  const store = openStore(join(home, 'project.sqlite'));
  const project = store.createProject('Recovery', repo), task = store.createTask(project.id, 'Continue', 'Inspect files');
  const old = store.startRun(task.id, 'fixture', 'fixture', 'Old work', undefined, repo);
  store.running(old.id, 'old-session');
  // Persist exactly the pre-release v5 layout, exercising the additive migration on restart.
  store.db.exec('ALTER TABLE runs DROP COLUMN workspace_recovery_json; ALTER TABLE projects DROP COLUMN archived_at; PRAGMA user_version=5;');
  store.close();
  let starts = 0, stops = 0;
  const workerFactory = () => {
    starts++;
    let finish;
    const ended = new Promise(resolve => { finish = resolve; });
    return { request: async () => ({ sessionId: 'new-session' }), turn: () => ended,
      stop: async () => { stops++; finish(); return { code: 0 }; } };
  };
  const options = { home, agentDir: home, port: 0, maxParallelRuns: 1, maxRuns: 4, workerFactory };
  let service = await startService(options);
  const call = async (path, data) => {
    const r = await fetch(service.url + path, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: r.status, body: await r.json() };
  };
  const command = args => exec(process.execPath, [cli, ...args, '--home', home, '--json'], { windowsHide: true });
  const runPath = `/runs/${old.id}`, boardPath = `/projects/${project.id}/board`;
  const launch = () => call(`/tasks/${task.id}/runs`, { provider: 'fixture', model: 'fixture' });
  try {
    const unknown = (await call(runPath)).body;
    assert.equal(unknown.status, 'unknown'); assert.equal(unknown.workspace_recovery, null);
    assert.equal(unknown.session_id, 'old-session'); assert.equal(unknown.exit_code, null); assert.equal(unknown.ended_at, null);
    assert.match(unknown.error, /without a process exit observation/);
    assert.equal((await call(`${runPath}/stop`, {})).body.status, 'unknown');
    assert.equal(stops, 0);
    assert.equal((await launch()).status, 409);
    let board = (await call(boardPath)).body;
    assert.equal(board.resources.unsettled, 1); assert.equal(board.tasks[0].unsettledRuns.length, 1);
    assert.match(display(unknown), /Still holds a slot\/worktree/);
    assert.doesNotMatch(display(unknown), /threshold run stop/);

    const note = 'Checked old worker is gone and workspace is reusable';
    assert.equal((await call(`${runPath}/recover`, { note })).status, 400);
    assert.equal((await call(`${runPath}/recover`, { confirmReusable: true })).status, 400);
    await assert.rejects(command(['run', 'recover', old.id, '--note', note]), error => /No recovery requested/.test(error.stderr));
    await assert.rejects(command(['run', 'recover', '--confirm-reusable', '--note', note]), error => /Missing --run/.test(error.stderr));
    await assert.rejects(command(['run', 'recover', old.id.slice(0, 8), '--confirm-reusable', '--note', note]), error => /full Run ID/.test(error.stderr));
    assert.equal((await launch()).status, 409); assert.equal(starts, 0);

    const recovered = JSON.parse((await command(['run', 'recover', old.id, '--confirm-reusable', '--note', note])).stdout);
    assert.equal(recovered.workspace_recovery.source, 'client'); assert.equal(recovered.workspace_recovery.note, note);
    assert.ok(Number.isFinite(Date.parse(recovered.workspace_recovery.confirmedAt)));
    assert.deepEqual({ ...recovered, workspace_recovery: null }, unknown);
    assert.match(display(recovered), /manually confirmed workspace reusable/);
    assert.match(display(recovered), /Old outcome remains unknown/);
    assert.match(display(recovered), /Exit code\s+Not observed/);
    board = (await call(boardPath)).body;
    assert.equal(board.resources.unsettled, 0); assert.equal(board.resources.started, 1); assert.equal(board.resources.remainingStarts, 3);
    assert.equal(board.tasks[0].unsettledRuns.length, 0); assert.equal(board.tasks[0].status, 'in_progress');
    assert.deepEqual(board.tasks[0].latestRun.workspace_recovery, recovered.workspace_recovery);
    assert.match(display(board), /Workspace manually confirmed reusable; old outcome unknown/);

    await service.close(); service = await startService(options);
    assert.deepEqual((await call(runPath)).body, recovered);
    assert.equal((await call(boardPath)).body.resources.unsettled, 0);
    const next = await launch(); assert.equal(next.status, 202); assert.equal(starts, 1);
    assert.notEqual(next.body.id, old.id);
    assert.equal((await call(`/runs/${next.body.id}/recover`, { confirmReusable: true, note })).status, 409);
    assert.deepEqual((await call(`${runPath}/recover`, { confirmReusable: true, note: 'A repeated request' })).body, recovered);
    assert.equal((await call(boardPath)).body.resources.unsettled, 1); assert.equal((await launch()).status, 409);
    assert.equal(stops, 0);
    // Normal active-Run stop still observes exit and releases only its own occupancy.
    const stopped = (await call(`/runs/${next.body.id}/stop`, {})).body;
    assert.equal(stopped.status, 'ended'); assert.equal(stopped.exit_code, 0); assert.ok(stopped.ended_at);
    assert.equal(stopped.workspace_recovery, null); assert.ok(stops > 0);
    assert.equal((await call(`/runs/${next.body.id}/recover`, { confirmReusable: true, note })).status, 409);
    assert.equal((await call(boardPath)).body.resources.unsettled, 0);
    assert.deepEqual((await call(runPath)).body, recovered);
    assert.equal((await call(`/tasks/${task.id}`)).body.recentRuns.find(run => run.id === old.id).status, 'unknown');
  } finally { await service.close(); }
});
