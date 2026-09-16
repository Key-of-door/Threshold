import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { openStore } from '../src/store.mjs';
import { startService } from '../src/service.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'threshold-status-'));

test('store statusIndex is a compact project/task index without full Task detail', () => {
  const store = openStore(join(temp(), 'state.sqlite'));
  try {
    const project = store.createProject('Index project', '/repo/index');
    const task = store.createTask(project.id, 'Compact me', 'x'.repeat(2000));
    store.startRun(task.id, 'test', 'test', 'Run objective that must not appear in the index');
    store.updateTaskStatus(task.id, 'done', 'Finished the increment');

    const index = store.statusIndex();
    assert.equal(index.projects.length, 1);
    assert.equal(index.projects[0].id, project.id);
    assert.equal(index.projects[0].name, 'Index project');
    assert.equal(index.projects[0].repo_path, '/repo/index');
    assert.deepEqual(Object.keys(index.projects[0]).sort(), ['archived_at', 'id', 'name', 'repo_path']);
    assert.equal(index.projects[0].archived_at, null);
    assert.equal(index.tasks.length, 1);
    const entry = index.tasks[0];
    assert.deepEqual(Object.keys(entry).sort(), ['id', 'project_id', 'status', 'status_update', 'title']);
    assert.equal(entry.id, task.id);
    assert.equal(entry.project_id, project.id);
    assert.equal(entry.status, 'done');
    assert.equal(entry.status_update.note, 'Finished the increment');
    assert.equal('instructions' in entry, false);
    assert.equal('checkpoint' in entry, false);
    assert.equal('recentRuns' in entry, false);
    assert.equal('objective' in entry, false);
  } finally { store.close(); }
});

test('GET /status returns a compact index while GET /tasks/:id keeps full detail', async () => {
  const home = temp(), repo = temp();
  execFileSync('git', ['init', repo], { windowsHide: true, stdio: 'ignore' });
  const service = await startService({ home, agentDir: home, port: 0 });
  const call = async (path, data) => {
    const response = await fetch(service.url + path, { method: data === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data) });
    assert.ok(response.ok, `HTTP ${response.status} for ${path}`);
    return response.json();
  };
  try {
    const project = await call('/projects', { name: 'Index', repoPath: repo });
    const task = await call('/tasks', { projectId: project.id, title: 'Compact',
      instructions: 'Long detailed instructions that only Task detail should return' });
    await call(`/tasks/${task.id}/status`, { status: 'done', note: 'Index summary' });

    const index = await call('/status');
    assert.deepEqual(index.projects, [{ id: project.id, name: 'Index', repo_path: project.repo_path, archived_at: null }]);
    assert.equal(index.tasks.length, 1);
    assert.deepEqual(Object.keys(index.tasks[0]).sort(), ['id', 'project_id', 'status', 'status_update', 'title']);
    assert.equal(index.tasks[0].status_update.note, 'Index summary');
    assert.equal(index.tasks[0].instructions, undefined);

    const detail = await call(`/tasks/${task.id}`);
    assert.equal(detail.task.instructions, 'Long detailed instructions that only Task detail should return');
    assert.equal(detail.task.status, 'done');
    assert.ok(Array.isArray(detail.recentRuns));
    assert.ok(detail.messageInbox);
  } finally { await service.close(); }
});
