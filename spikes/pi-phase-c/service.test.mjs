import test from 'node:test';
import assert from 'node:assert/strict';
import { startControlledService } from './service.mjs';
import { startService } from '../pi-phase-b/service.mjs';

const post = (url, body, credential) => fetch(url, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(credential ? { authorization: `Bearer ${credential}` } : {}) },
  body: JSON.stringify(body),
});
async function fixture(t) {
  const service = await startControlledService('task-1');
  t.after(() => service.close());
  return service;
}
test('missing Decision ASK; self-claimed approval has no effect; collaboration still works', async t => {
  const service = await fixture(t);
  const collaboration = await startService({ id: 'task-1', status: 'in_progress' });
  t.after(() => collaboration.close());
  const response = await post(service.agentUrl + '/fake-deploy', { target: 'staging', approved: true, actor: 'human' });
  const body = await response.json();
  assert.equal(body.status, 'ASK');
  assert.deepEqual(body.operation, { action: 'fake_deploy', target: 'staging', taskId: 'task-1' });
  assert.equal(service.snapshot().results.length, 0);
  const checkpoint = await fetch(collaboration.url + '/checkpoint', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ summary: 'Unrelated work continues' }),
  });
  assert.equal(checkpoint.status, 200);
  assert.equal((await (await fetch(collaboration.url + '/task')).json()).checkpoint.summary, 'Unrelated work continues');
});
test('Agent interface and uncredentialed Human interface cannot write Decisions', async t => {
  const service = await fixture(t);
  const body = { taskId: 'task-1', target: 'staging', decision: 'allow', actor: 'human' };
  assert.equal((await post(service.agentUrl + '/decision', body)).status, 404);
  assert.equal((await post(service.humanUrl + '/decision', body)).status, 401);
  assert.equal((await post(service.humanUrl + '/decision', body, 'agent-credential')).status, 401);
  assert.deepEqual(service.snapshot().decisions, []);
});
test('Human allow matches exact task/target, adapter executes; deny returns NO', async t => {
  const service = await fixture(t);
  const decide = (taskId, target, decision) => post(service.humanUrl + '/decision', { taskId, target, decision }, service.humanKey);
  const deploy = async target => (await post(service.agentUrl + '/fake-deploy', { target })).json();
  assert.equal((await decide('different-task', 'staging', 'allow')).status, 200);
  assert.equal((await deploy('staging')).status, 'ASK');
  assert.equal((await decide('task-1', 'preview', 'allow')).status, 200);
  assert.equal((await deploy('staging')).status, 'ASK');
  assert.equal((await decide('task-1', 'staging', 'allow')).status, 200);
  assert.equal(service.snapshot().results.length, 0, 'Decision issuance must not execute');
  const go = await deploy('staging');
  assert.equal(go.status, 'GO');
  assert.equal(go.result.target, 'staging');
  assert.equal(go.result.taskId, 'task-1');
  assert.equal(service.snapshot().results.length, 1);
  assert.equal(service.snapshot().blocks.length, 0);
  await decide('task-1', 'staging', 'deny');
  assert.equal((await deploy('staging')).status, 'NO');
  assert.equal(service.snapshot().results.length, 1);
});
test('unsupported target and malformed requests are technical errors, never ASK', async t => {
  const service = await fixture(t);
  const bad = await post(service.agentUrl + '/fake-deploy', { target: 'production' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).status, undefined);
  const malformed = await fetch(service.agentUrl + '/fake-deploy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal(service.snapshot().blocks.length, 0);
  assert.equal(service.snapshot().results.length, 0);
});
