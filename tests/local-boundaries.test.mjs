import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.mjs';
import { startService } from '../src/service.mjs';
import { serviceState } from '../src/service-process.mjs';
import { display } from '../src/cli-display.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'threshold-local-boundary-'));
test('foreign Host without Origin cannot read or mutate the loopback service; canonical local clients still work', async () => {
  const home = temp(), service = await startService({ home, agentDir: home, port: 0 });
  const port = new URL(service.url).port;
  const call = (host, path = '/status', method = 'GET', extra = {}) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, setHost: false,
      headers: Array.isArray(host) ? host.flatMap(value => ['Host', value]) : { ...(host === undefined ? {} : { host }), ...extra } }, res => {
      let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject); req.end();
  });
  try {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, `LOCALHOST:${port}`]) assert.equal((await call(host)).status, 200);
    for (const host of [`evil.example:${port}`, 'localhost', `127.0.0.1:${Number(port)+1}`, `localhost.evil.example:${port}`, [`localhost:${port}`, `evil.example:${port}`]]) {
      assert.equal((await call(host)).status, 403);
      assert.equal((await call(host, '/projects', 'POST', { 'content-type': 'application/json' })).status, 403);
    }
    assert.ok([400, 403].includes((await call(undefined)).status));
    assert.equal((await call(`evil.example:${port}`, '/status', 'GET', { 'x-forwarded-host': `localhost:${port}` })).status, 403);
    assert.equal((await call(`localhost:${port}`, '/status', 'GET', { origin: 'http://localhost' })).status, 403);
    assert.equal((await call(`localhost:${port}`, 'http://evil.example/status')).status, 400);
    assert.deepEqual(JSON.parse((await call(`localhost:${port}`)).body).projects, []);
  } finally { await service.close(); }
});

test('failed migration rolls back its partial DDL, releases the connection and can be retried after repair', () => {
  const file = join(temp(), 'migration.sqlite');
  let db = new DatabaseSync(file);
  db.exec('CREATE TABLE tasks (sentinel TEXT); INSERT INTO tasks VALUES (\'keep\');'); db.close();
  assert.throws(() => openStore(file), /tasks already exists/);
  db = new DatabaseSync(file);
  try {
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='projects'").get().n, 0, 'first DDL in the failed migration rolled back');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
    assert.equal(db.prepare('SELECT sentinel FROM tasks').get().sentinel, 'keep');
    db.exec('BEGIN IMMEDIATE; ALTER TABLE tasks RENAME TO saved_tasks; COMMIT;');
  } finally { db.close(); }
  const store = openStore(file);
  try { assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 9); assert.equal(store.db.prepare('SELECT sentinel FROM saved_tasks').get().sentinel, 'keep'); }
  finally { store.close(); }
});

test('v8 upgrade retains history and marks old execution settings as unrecorded', () => {
  const file = join(temp(), 'old.sqlite'); let store = openStore(file);
  const project = store.createProject('Old', '/old'), task = store.createTask(project.id, 'Work', 'Keep');
  const run = store.startRun(task.id, 'fixture', 'fixture'); store.endRun(run.id, { code: 0 });
  store.db.exec('ALTER TABLE runs DROP COLUMN execution_json; PRAGMA user_version=8;'); store.close();
  store = openStore(file);
  try { assert.equal(store.run(run.id).execution, null); assert.equal(store.run(run.id).status, 'ended'); assert.equal(store.task(task.id).instructions, 'Keep'); }
  finally { store.close(); }
});

test('service inspection exposes marker paths and PID uncertainty without recovering anything', async () => {
  const home = temp();
  writeFileSync(join(home, 'server.lock'), JSON.stringify({ pid: process.pid }));
  const state = await serviceState(home);
  assert.equal(state.state, 'unconfirmed');
  assert.deepEqual(state.recordedProcesses, [{ pid: process.pid, exists: true }]);
  const shown = display(state);
  assert.match(shown, /identity not verified/); assert.match(shown, /Do not remove markers yet/);
  assert.ok(shown.includes(join(home, 'server.lock')));
});
