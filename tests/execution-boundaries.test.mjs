import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { git } from '../src/git.mjs';
import { startPi } from '../src/pi.mjs';
import { startService } from '../src/service.mjs';
import { openStore } from '../src/store.mjs';

const exec = promisify(execFile), cli = resolve('src/cli.mjs');
async function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'threshold-execution-')), repo = join(home, 'repo');
  git(home, 'init', repo);
  const workers = [];
  const workerFactory = options => {
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    const worker = { streaming: false, exitCode: 0, forced: false, prompts: 0, aborted: 0 };
    const emit = event => child.stdout.write(JSON.stringify(event) + '\n');
    worker.settle = () => { worker.streaming = false; emit({ type: 'agent_settled' }); };
    worker.error = () => emit({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: '401 private payload' } });
    worker.queue = () => emit({ type: 'queue_update', steering: ['pending'], followUp: [] });
    child.stdin.on('data', data => {
      const command = JSON.parse(data);
      if (command.type === 'prompt') { worker.prompts++; worker.streaming = true; emit({ type: 'agent_start' }); }
      if (command.type === 'abort') {
        worker.aborted++;
        // Cleanup emits aborted even when nothing was active; do not overwrite the initiating reason.
        emit({ type: 'message_end', message: { role: 'assistant', stopReason: 'aborted', errorMessage: 'cleanup payload' } }); worker.settle();
      }
      emit({ type: 'response', id: command.id, success: true,
        data: command.type === 'get_state' ? { sessionId: 'fixture-session', isStreaming: worker.streaming } : undefined });
    });
    child.stdin.on('finish', () => child.emit('close', worker.exitCode, null));
    child.kill = () => child.emit('close', null, 'SIGTERM');
    workers.push(worker);
    return startPi({ ...options, spawnProcess: () => child });
  };
  let service = await startService({ home, agentDir: home, port: 0, workerFactory });
  const call = async (path, data, key) => {
    const r = await fetch(service.url + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: r.status, data: await r.json() };
  };
  const p = (await call('/projects', { name: 'Execution', repoPath: repo })).data;
  const t = (await call('/tasks', { projectId: p.id, title: 'Work', instructions: 'Fixture' })).data;
  const launch = async options => {
    const r = await call(`/tasks/${t.id}/runs`, { provider: 'fixture', model: 'fixture', ...options });
    assert.equal(r.status, 202); return r.data;
  };
  const wait = async id => {
    for (let i = 0; i < 100; i++) { const r = (await call(`/runs/${id}`)).data; if (r.status === 'ended') return r; await delay(25); }
    throw new Error('Run did not end');
  };
  return { home, t, p, call, launch, wait, workers, close: () => service.close(),
    restart: async () => { await service.close(); service = await startService({ home, agentDir: home, port: 0, workerFactory }); } };
}

test('CLI deadline reaches Pi, persists on restart and survives abort cleanup without a finalization prompt', async () => {
  const f = await fixture();
  try {
    const r = JSON.parse((await exec(process.execPath, [cli, 'run', '--home', f.home, '--task', f.t.id, '--provider', 'fixture', '--model', 'fixture', '--turn-timeout', '1', '--json'], { windowsHide: true })).stdout);
    const ended = await f.wait(r.id);
    assert.match(ended.error, /Background turn deadline reached \(1s\)/);
    assert.doesNotMatch(ended.error, /aborted|cleanup payload|configuration/);
    assert.deepEqual(ended.execution, { mode: 'background', turnTimeoutSeconds: 1, stopReason: 'timeout' });
    assert.equal(f.workers[0].prompts, 1); assert.ok(f.workers[0].aborted > 0);
    assert.equal((await f.call(`/tasks/${f.t.id}`)).data.checkpoint, null);
    assert.equal((await f.call(`/projects/${f.p.id}/board`)).data.tasks[0].latestRun.execution.stopReason, 'timeout');
    await f.restart(); assert.deepEqual((await f.call(`/runs/${r.id}`)).data.execution, ended.execution);
    const next = await f.launch({}); assert.equal(next.execution.turnTimeoutSeconds, 1800);
    f.workers[1].settle(); assert.equal((await f.wait(next.id)).error, null);
    const unlimited = await f.launch({ turnTimeoutSeconds: 0 });
    await delay(1100); assert.equal((await f.call(`/runs/${unlimited.id}`)).data.status, 'running');
    f.workers[2].settle(); assert.equal((await f.wait(unlimited.id)).error, null);
  } finally { await f.close(); }
});

test('idle stop is neutral; working, queued work, abnormal exits and prior model errors stay explicit', async () => {
  const f = await fixture();
  try {
    for (const mode of ['idle', 'working', 'queued', 'abnormal', 'error']) {
      const run = await f.launch({ interactive: true }), worker = f.workers.at(-1);
      if (mode === 'error') worker.error();
      if (mode !== 'working') worker.settle();
      if (mode === 'queued') worker.queue();
      if (mode === 'abnormal') worker.exitCode = 255;
      await delay(5);
      const stopped = (await f.call(`/runs/${run.id}/stop`, {})).data;
      assert.equal(stopped.status, 'ended');
      if (mode === 'idle') {
        assert.equal(stopped.error, null); assert.equal(stopped.exit_code, 0); assert.equal(stopped.execution.stopReason, 'client_stop_idle');
        assert.equal((await f.call(`/runs/${run.id}/live`)).data.events.filter(e => e.type === 'error').length, 0);
      }
      if (mode === 'working' || mode === 'queued') assert.match(stopped.error, /client stop while not idle/);
      if (mode === 'abnormal') assert.match(stopped.error, /exit was abnormal/);
      if (mode === 'error') { assert.match(stopped.error, /HTTP 401/); assert.doesNotMatch(stopped.error, /private payload|aborted/); }
      assert.equal((await f.call(`/tasks/${f.t.id}`)).data.task.status, 'in_progress');
    }
    const idle = await f.launch({ interactive: true }); f.workers.at(-1).settle(); await delay(5);
    await f.close();
    const store = openStore(join(f.home, 'project.sqlite'));
    try { assert.equal(store.run(idle.id).execution.stopReason, 'service_stop_idle'); assert.equal(store.run(idle.id).error, null); }
    finally { store.close(); }
  } finally { await f.close(); }
});

test('invalid deadlines and attaching a deadline reject before a Run is allocated', async () => {
  const f = await fixture();
  try {
    for (const value of [-1, 0.5, '30', null, 2147484]) assert.equal((await f.call(`/tasks/${f.t.id}/runs`, { provider: 'fixture', model: 'fixture', turnTimeoutSeconds: value })).status, 400);
    assert.equal((await f.call(`/tasks/${f.t.id}/runs`, { provider: 'fixture', model: 'fixture', interactive: true, turnTimeoutSeconds: 0 })).status, 400);
    for (const args of [['run', '--attach', '--turn-timeout', '1'], ['run', '--turn-timeout', '-1'], ['status', '--turn-timeout', '1']])
      await assert.rejects(exec(process.execPath, [cli, ...args, '--home', f.home, '--json'], { windowsHide: true }), error => error.code === 1);
    assert.equal((await f.call(`/tasks/${f.t.id}`)).data.recentRuns.length, 0);
    assert.equal(f.workers.length, 0);
  } finally { await f.close(); }
});
