import test from 'node:test';
import assert from 'node:assert/strict';
import { startService } from './service.mjs';

const task = { projectId: 'demo', id: 'task-1', title: 'Check a fixture', status: 'in_progress' };
test('read task and save an agent checkpoint without completing the task', async t => {
  const service = await startService(task);
  t.after(() => service.close());
  assert.deepEqual(await (await fetch(service.url + '/task')).json(), { task, checkpoint: null });
  const response = await fetch(service.url + '/checkpoint', {
    method: 'PUT', headers: { 'content-type': 'application/json', 'x-pi-tool-call-id': 'test-call' },
    body: JSON.stringify({ summary: 'Fixture reviewed', status: 'completed', source: 'human' }),
  });
  assert.equal(response.status, 200);
  const current = await (await fetch(service.url + '/task')).json();
  assert.deepEqual(current.task, task);
  assert.equal(current.checkpoint.summary, 'Fixture reviewed');
  assert.equal(current.checkpoint.source, 'agent');
  assert.ok(current.checkpoint.recordedAt);
  assert.equal(service.calls.find(c => c.method === 'PUT').toolCallId, 'test-call');
});

test('malformed and oversized checkpoint requests return ordinary errors and leave state unchanged', async t => {
  const service = await startService(task);
  t.after(() => service.close());
  for (const [body, status] of [['{', 400], ['{"summary":"  "}', 400], [JSON.stringify({ summary: 'x'.repeat(9000) }), 413]]) {
    const response = await fetch(service.url + '/checkpoint', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body,
    });
    assert.equal(response.status, status);
    assert.equal(typeof (await response.json()).error, 'string');
    assert.equal(service.snapshot().checkpoint, null);
  }
});
