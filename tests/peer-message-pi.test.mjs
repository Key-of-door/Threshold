import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { git } from '../src/git.mjs';
import { startService } from '../src/service.mjs';

// This is a deterministic transport/extension test, not a model-behavior experiment.
// Keep replies immediate: pacing previously hid a Windows Node shutdown race.
// Node 24.20+ includes the upstream fix; see docs/runtime-validation.md.
test('real Pi sends an addressed message and a fresh Pi reads it through existing Task tools', async () => {
  const home = mkdtempSync(join(tmpdir(), 'threshold-peer-pi-')), repo = join(home, 'repo');
  mkdirSync(repo); git(home, 'init', repo);
  const requests = [], counters = { sender: 0, receiver: 0 };
  let target;
  const claim = 'Peer claim: completed; evidence reference abc123 is unverified.';
  const api = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const request = JSON.parse(raw); requests.push(request);
    const index = counters[request.model]++;
    const action = request.model === 'sender' && index === 0 ? ['send_message', { taskId: target.id, body: claim }]
      : request.model === 'receiver' && index === 0 ? ['read_task', {}]
      : request.model === 'receiver' && index === 1 ? ['read_messages', {}] : null;
    const delta = action ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${request.model}-${index}`, type: 'function', function: { name: action[0], arguments: JSON.stringify(action[1]) } }] }
      : { role: 'assistant', content: 'Fixture complete. No status update requested.' };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = { id: `fixture-${request.model}-${index}`, object: 'chat.completion.chunk', created: 0, model: request.model };
    res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: action ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  writeFileSync(join(home, 'models.json'), JSON.stringify({ providers: { fixture: {
    baseUrl: `http://127.0.0.1:${api.address().port}/v1`, api: 'openai-completions', apiKey: 'local-fixture-only',
    models: ['sender', 'receiver'].map(id => ({ id, contextWindow: 64000, maxTokens: 1024, reasoning: false })) } } }));
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ shellPath: process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash' }));
  let service;
  try {
    service = await startService({ home: join(home, 'state'), agentDir: home, port: 0 });
    const call = async (path, data) => {
      const r = await fetch(service.url + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
      assert.ok(r.ok, `HTTP ${r.status} for ${path}`); return r.json();
    };
    const wait = async id => {
      for (let i = 0; i < 200; i++) { const run = await call(`/runs/${id}`); if (run.status === 'ended') { assert.equal(run.error, null, `Node ${process.version}, Pi exit=${run.exit_code}: ${run.error}`); return run; } await delay(50); }
      throw new Error('Fixture Run did not end');
    };
    const project = await call('/projects', { name: 'Peer tools', repoPath: repo });
    const source = await call('/tasks', { projectId: project.id, title: 'Review', instructions: 'Local fixture sender' });
    target = await call('/tasks', { projectId: project.id, title: 'Implement', instructions: 'Local fixture receiver' });
    const a = await wait((await call(`/tasks/${source.id}/runs`, { provider: 'fixture', model: 'sender', objective: 'SOURCE_PRIVATE_CONVERSATION_MARKER' })).id);
    const messages = (await call(`/tasks/${target.id}/messages`)).messages;
    assert.equal(messages.length, 1); assert.equal(messages[0].body, claim); assert.equal(messages[0].from_run_id, a.id);
    await service.close(); service = await startService({ home: join(home, 'state'), agentDir: home, port: 0 });
    const b = await wait((await call(`/tasks/${target.id}/runs`, { provider: 'fixture', model: 'receiver' })).id);
    assert.notEqual(a.session_id, b.session_id);
    const receiver = requests.filter(r => r.model === 'receiver');
    assert.equal(receiver.length, 3);
    assert.doesNotMatch(JSON.stringify(receiver), /SOURCE_PRIVATE_CONVERSATION_MARKER/);
    assert.ok(receiver.at(-1).messages.some(m => m.role === 'tool' && JSON.stringify(m.content).includes(claim)));
    const sendTool = requests[0].tools.find(tool => tool.function?.name === 'send_message').function;
    assert.ok(sendTool.parameters.properties.taskId); assert.ok(!sendTool.parameters.required.includes('taskId'));
    const state = await call(`/tasks/${target.id}`);
    assert.equal(state.task.status, 'in_progress'); assert.equal(state.task.status_update, null);
    assert.equal(state.checkpoint, null); assert.deepEqual(state.controlled.decisions, []);
  } finally { await service?.close(); await new Promise(resolve => api.close(resolve)); }
});
