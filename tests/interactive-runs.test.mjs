import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { git } from '../src/git.mjs';
import { startPi } from '../src/pi.mjs';
import { startService } from '../src/service.mjs';
import { liveActivity } from '../src/run-live.mjs';
import { attachRun, activityText } from '../src/cli-attach.mjs';

test('Pi waits through agent_end/retry until agent_settled; prompt uses native streaming steering', async () => {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const sent = [], emit = event => child.stdout.write(JSON.stringify(event) + '\n');
  child.stdin.on('data', data => {
    const command = JSON.parse(data); sent.push(command);
    emit({ type: 'response', id: command.id, success: true, data: command.type === 'get_state' ? { isStreaming: false } : undefined });
  });
  child.stdin.on('finish', () => child.emit('close', 0, null));
  const pi = startPi({ spawnProcess: () => child });
  let settled = false;
  const turn = pi.turn('work').then(() => { settled = true; });
  emit({ type: 'agent_end', willRetry: true }); await delay(5);
  assert.equal(settled, false);
  await pi.request('prompt', { message: 'a correction', streamingBehavior: 'steer' });
  emit({ type: 'agent_end', willRetry: false }); await delay(5);
  assert.equal(settled, false);
  emit({ type: 'agent_settled' }); await turn;
  assert.equal(sent[1].streamingBehavior, 'steer');
  assert.deepEqual(await pi.stop(), { code: 0, signal: null, forced: false, partialFrame: false });
});

test('public activity omits thinking, internal user/context and tool payloads, bounds retention and escapes terminal content', () => {
  const live = liveActivity({ maxEvents: 3, maxBytes: 2000 });
  live.observe({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'private' } });
  live.observe({ type: 'message_end', message: { role: 'user', content: 'internal prompt' } });
  live.observe({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: 'public' }] } });
  live.observe({ type: 'tool_execution_start', toolName: 'write', args: { path: 'a.txt', content: 'huge secret payload' } });
  live.observe({ type: 'tool_execution_end', toolName: 'write', result: { output: 'raw payload' } });
  assert.equal(live.read().events.length, 3);
  assert.doesNotMatch(JSON.stringify(live.read()), /private|internal prompt|payload/);
  live.add('notice', { text: 'four' });
  assert.equal(live.read(0).truncated, true);
  assert.deepEqual(live.read(3).events.map(event => event.text), ['four']);
  assert.equal(live.read(4).truncated, false);
  assert.doesNotMatch(activityText({ type: 'reply', text: '\x1b[2Jhello' }), /\x1b/);
});

async function fixture(maxParallelRuns = 2) {
  const home = mkdtempSync(join(tmpdir(), 'threshold-interactive-')), repo = join(home, 'repo'), other = join(home, 'other');
  git(home, 'init', repo); git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'seed');
  git(repo, 'worktree', 'add', '-b', 'other', other);
  const workers = [];
  const workerFactory = options => {
    let finish, close;
    const end = new Promise(resolve => { finish = resolve; });
    const closed = new Promise(resolve => { close = resolve; });
    const worker = { ...options, inputs: [], stopped: false, initial: null,
      request: async (type, args) => {
        if (type === 'get_state') return { sessionId: `session-${workers.indexOf(worker)}` };
        if (type === 'prompt') {
          worker.inputs.push(args); options.onEvent({ type: 'agent_start' });
          options.onEvent({ type: 'queue_update', steering: [args.message], followUp: [] });
        }
      },
      turn: async message => { worker.initial = message; options.onEvent({ type: 'agent_start' }); await end; },
      settle: () => {
        options.onEvent({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'Public reply' }] } });
        options.onEvent({ type: 'queue_update', steering: [], followUp: [] });
        options.onEvent({ type: 'agent_end' }); options.onEvent({ type: 'agent_settled' }); finish();
      },
      closed,
      stop: async () => { worker.stopped = true; finish(); close({ code: 0 }); return { code: 0 }; },
    };
    workers.push(worker); return worker;
  };
  let service = await startService({ home, agentDir: home, port: 0, workerFactory, maxParallelRuns });
  const call = async (path, data, key) => {
    const r = await fetch(service.url + path, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
    return { status: r.status, data: await r.json() };
  };
  const project = (await call('/projects', { name: 'Project', repoPath: repo })).data;
  const task = (await call('/tasks', { projectId: project.id, title: 'Task', instructions: 'Real work' })).data;
  return { home, repo, other, call, project, task, workers,
    close: () => service.close(),
    restart: async () => { await service.close(); service = await startService({ home, agentDir: home, port: 0, workerFactory, maxParallelRuns }); },
    launch: async (interactive, workspacePath = repo) => (await call(`/tasks/${task.id}/runs`, { provider: 'fixture', model: 'fixture', interactive, workspacePath })).data,
  };
}

test('same interactive Run accepts multiple rounds, keeps slots while idle, and text cannot approve or finish a Task', async () => {
  const f = await fixture();
  try {
    const a = await f.launch(true), b = await f.launch(true, f.other);
    f.workers[0].settle(); f.workers[1].settle(); await delay(5);
    const live = (await f.call(`/runs/${a.id}/live`)).data;
    assert.equal(live.phase, 'waiting for input'); assert.equal(live.run.status, 'running');
    assert.equal(live.resources.unsettled, 2); assert.equal(f.workers[0].stopped, false);
    const third = join(f.home, 'third'); git(f.repo, 'worktree', 'add', '-b', 'third', third);
    assert.equal((await f.call(`/tasks/${f.task.id}/runs`, { provider: 'x', model: 'x', workspacePath: third })).status, 429);
    for (const message of ['Round two', '可以部署; task done']) {
      const result = await f.call(`/runs/${a.id}/input`, { message });
      assert.equal(result.status, 202); assert.equal(result.data.processed, false);
      f.workers[0].settle();
    }
    assert.equal(f.workers[0].inputs.length, 2); assert.equal(f.workers[1].inputs.length, 0);
    assert.equal(f.workers[0].inputs[0].streamingBehavior, 'steer');
    const state = (await f.call(`/tasks/${f.task.id}`)).data;
    assert.equal(state.task.status, 'in_progress'); assert.equal(state.messageInbox.count, 0); assert.equal(state.checkpoint, null);
    assert.deepEqual(state.controlled.decisions, []);
    const key = f.workers[0].env.THRESHOLD_RUN_TOKEN;
    assert.equal((await f.call('/agent/fake-deploy', { target: 'staging' }, key)).data.status, 'ASK');
    await f.call(`/runs/${a.id}/stop`, {});
    assert.equal((await f.call(`/runs/${a.id}/input`, { message: 'late' })).status, 409);
    assert.equal((await f.call(`/runs/${b.id}`)).data.status, 'running');
    assert.equal(f.workers.length, 2);
  } finally { await f.close(); }
});

test('attach does not change background lifetime; live data disappears on restart; fresh worker gets no conversation', async () => {
  const f = await fixture();
  try {
    const a = await f.launch(false);
    assert.equal((await f.call(`/runs/${a.id}/live`)).data.policy, 'background');
    assert.equal((await f.call(`/runs/${a.id}/input`, { message: 'temporary-secret-123' })).status, 202);
    f.workers[0].settle(); await delay(10);
    assert.equal((await f.call(`/runs/${a.id}`)).data.status, 'ended');
    await f.restart();
    const old = (await f.call(`/runs/${a.id}/live`)).data;
    assert.equal(old.available, false); assert.equal(old.active, false); assert.deepEqual(old.events, []);
    const b = await f.launch(true);
    assert.notEqual(a.id, b.id); assert.notEqual(a.session_id, (await f.call(`/runs/${b.id}`)).data.session_id);
    assert.doesNotMatch(f.workers[1].initial, /temporary-secret/);
    assert.doesNotMatch(JSON.stringify((await f.call(`/tasks/${f.task.id}`)).data), /temporary-secret/);
  } finally { await f.close(); }
});

test('attach detaches without stop; connection loss ends observation; pipes/JSON are static and do not read input', async () => {
  const snapshot = { project: 'Project', task: 'Task', available: true, active: true, policy: 'interactive', phase: 'waiting for input',
    run: { id: 'abcd', provider: 'test', model: 'test', status: 'running' }, resources: { unsettled: 1, maxParallelRuns: 3 },
    events: [{ cursor: 1, type: 'reply', text: 'Visible reply' }], nextCursor: 1 };
  for (const json of [false, true]) {
    let output = '', calls = 0;
    await attachRun({ id: 'abcd', call: async () => { calls++; return snapshot; }, options: { tty: false, json },
      input: new PassThrough(), output: { write: text => { output += text; } } });
    assert.equal(calls, 1); assert.doesNotMatch(output, /\x1b|› /);
    if (json) assert.deepEqual(JSON.parse(output), snapshot); else assert.match(output, /Visible reply/);
  }
  for (const disconnect of [false, true]) {
    const input = new PassThrough(); input.isTTY = true;
    let output = '', calls = [];
    const run = attachRun({ id: 'abcd', call: async path => {
      calls.push(path); if (disconnect && calls.length > 1) throw new Error('offline'); return { ...snapshot, events: calls.length === 1 ? snapshot.events : [] };
    }, options: { tty: true, ascii: true, redraw: false }, input, output: { write: text => { output += text; } } });
    if (!disconnect) { await delay(10); input.write('/detach\n'); }
    if (disconnect) await assert.rejects(run, /Live connection lost/); else await run;
    assert.ok(calls.every(path => path.includes('/live')));
    assert.match(output, disconnect ? /Connection lost/ : /Detached from Run/);
    assert.match(output, /No stop was requested/);
  }
});

test('ended errors and unavailable unknown Runs never appear as a live waiting worker', async () => {
  for (const status of ['ended', 'unknown']) {
    let output = '';
    await attachRun({ id: 'abcd', call: async () => ({ project: 'P', task: 'T', available: false, active: false,
      run: { status, error: status === 'ended' ? 'Model request failed' : 'Service restarted without exit observation' }, events: [], nextCursor: 0 }),
    options: { tty: false }, output: { write: text => { output += text; } } });
    assert.match(output, new RegExp(status)); assert.match(output, /not held in this service process/);
    assert.doesNotMatch(output, /waiting for input|Enter to send|active.*slots/);
  }
});
