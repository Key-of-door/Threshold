import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { git } from '../src/git.mjs';
import { startService } from '../src/service.mjs';

// Real Pi RPC and extension execution against an immediate, deterministic local provider.
test('real Pi interactive Run settles twice, persists explicit checkpoints, and stops cleanly while idle', { timeout: 30000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'threshold-interactive-pi-')), repo = join(home, 'repo');
  mkdirSync(repo); git(home, 'init', repo);
  const requests = [];
  const actions = [
    ['read_task', {}], ['save_checkpoint', { summary: 'first explicit checkpoint' }], null,
    ['read_task', {}], ['save_checkpoint', { summary: 'second explicit checkpoint' }], null,
  ];
  const api = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const index = requests.length; requests.push(JSON.parse(raw));
    const action = actions[index];
    const delta = action ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${index}`, type: 'function', function: { name: action[0], arguments: JSON.stringify(action[1]) } }] }
      : { role: 'assistant', content: `reply-${index}` };
    const chunk = { id: `fixture-${index}`, object: 'chat.completion.chunk', created: 0, model: 'fixture' };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: action ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  writeFileSync(join(home, 'models.json'), JSON.stringify({ providers: { fixture: {
    baseUrl: `http://127.0.0.1:${api.address().port}/v1`, api: 'openai-completions', apiKey: 'local-fixture-only',
    models: [{ id: 'fixture', contextWindow: 64000, maxTokens: 1024, reasoning: false }],
  } } }));
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ shellPath: process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash' }));
  let service;
  try {
    service = await startService({ home: join(home, 'state'), agentDir: home, port: 0 });
    const call = async (path, data) => {
      const response = await fetch(service.url + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
      assert.ok(response.ok, `HTTP ${response.status} for ${path}`); return response.json();
    };
    const wait = async (path, predicate) => {
      for (let i = 0; i < 200; i++) { const value = await call(path); if (predicate(value)) return value; await delay(50); }
      assert.fail(`Timed out waiting for ${path}`);
    };
    const project = await call('/projects', { name: 'Interactive fixture', repoPath: repo });
    const task = await call('/tasks', { projectId: project.id, title: 'Fixture task', instructions: 'Explicit checkpoints only' });
    const run = await call(`/tasks/${task.id}/runs`, { provider: 'fixture', model: 'fixture', interactive: true });
    const livePath = `/runs/${run.id}/live`;
    const first = await wait(livePath, live => live.phase === 'waiting for input');
    assert.equal(first.run.status, 'running');
    assert.equal(first.resources.unsettled, 1);
    assert.ok(first.events.some(event => event.type === 'reply' && event.text === 'reply-2'));
    const initial = await call(`/tasks/${task.id}`);
    assert.equal(initial.checkpoint.summary, 'first explicit checkpoint');
    const accepted = await call(`/runs/${run.id}/input`, { message: 'SECOND_ROUND_PRIVATE_INPUT' });
    assert.equal(accepted.processed, false);
    const second = await wait(livePath, live => live.phase === 'waiting for input' && live.events.some(event => event.type === 'reply' && event.text === 'reply-5'));
    assert.equal(second.run.session_id, first.run.session_id);
    assert.equal(requests.length, 6);
    assert.match(JSON.stringify(requests[3].messages), /SECOND_ROUND_PRIVATE_INPUT/);
    assert.match(JSON.stringify(requests[3].messages), /reply-2/);
    const latest = await call(`/tasks/${task.id}`);
    assert.equal(latest.checkpoint.summary, 'second explicit checkpoint');
    assert.equal(latest.task.status, 'in_progress');
    assert.equal(latest.messageInbox.count, 0);
    assert.deepEqual(latest.controlled.decisions, []);
    await call(`/runs/${run.id}/stop`, {});
    const ended = await wait(`/runs/${run.id}`, value => value.status === 'ended');
    assert.equal(ended.exit_code, 0); assert.equal(ended.error, null);
    assert.equal((await call(livePath)).resources.unsettled, 0);
    assert.equal((await call(`/tasks/${task.id}`)).checkpoint.id, latest.checkpoint.id, 'stop does not create a checkpoint');
  } finally { await service?.close(); await new Promise(resolve => api.close(resolve)); }
});
