import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { visibleWidth } from '@earendil-works/pi-tui';
import { renderLayoutFrame } from '@earendil-works/pi-tui/dist/layout.js';
import { git } from '../src/git.mjs';
import { startService } from '../src/service.mjs';
import { openStore } from '../src/store.mjs';
import { ThresholdTui } from '../src/tui.mjs';
import { serviceClient, runDraft, runPayload, WriteGate, workspaceFile } from '../src/tui-client.mjs';
import { DocumentView, action, actionRow, textBlock, item, fields, columns, bar, section } from '../src/tui-components.mjs';

class Terminal {
  columns = 92; rows = 28; kittyProtocolActive = false; output = '';
  start(input, resize) { this.input = input; this.resize = resize; }
  stop() {} async drainInput() {} write(text) { this.output += text; }
  moveBy() {} hideCursor() {} showCursor() {} clearLine() {} clearFromCursor() {} clearScreen() {} setTitle() {} setProgress() {}
}
async function until(fn) { for (let i = 0; i < 150; i++) { if (fn()) return; await delay(10); } assert.fail('condition not reached'); }

async function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'threshold-tui-')), repo = join(home, 'repo');
  git(home, 'init', repo); git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'seed');
  const workers = [];
  const workerFactory = options => {
    let finish, close; const end = new Promise(r => { finish = r; }), closed = new Promise(r => { close = r; });
    const worker = { ...options, inputs: [], stopped: false, closed,
      request: async (type, data) => { if (type === 'get_state') return { sessionId: 'tui-fixture', thinkingLevel: 'low', model: { id: 'fixture', provider: 'fixture', api: 'openai-completions', reasoning: true, contextWindow: 32000, maxTokens: 4000 } }; if (type === 'prompt') worker.inputs.push(data.message); },
      turn: async () => { options.onEvent({ type: 'agent_start' }); await end; },
      settle: () => { options.onEvent({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '公共回复\n检查 workspace。' }] } }); options.onEvent({ type: 'agent_settled' }); finish(); },
      stop: async () => { worker.stopped = true; finish(); close({ code: 0 }); return { code: 0 }; } };
    workers.push(worker); return worker;
  };
  const service = await startService({ home, agentDir: home, port: 0, workerFactory });
  const call = serviceClient(home);
  const project = await call('/projects', { name: '中文 Project', repoPath: repo });
  const task = await call('/tasks', { projectId: project.id, title: 'TUI target', instructions: '真实说明\nKeep full instructions.' });
  const peer = await call('/tasks', { projectId: project.id, title: 'Peer', instructions: 'Other task' });
  return { home, repo, service, call, project, task, peer, workers };
}

test('TUI write gate blocks concurrent/repeated uncertain writes and keeps explicit retry separate', async () => {
  let release, count = 0;
  const gate = new WriteGate(async () => { count++; await new Promise(r => { release = r; }); throw Object.assign(new Error('lost'), { uncertain: true }); });
  const first = gate.send('message:a', '/tasks/a/messages', { body: 'once' });
  await assert.rejects(gate.send('message:a', '/tasks/a/messages', { body: 'twice' }), /pending/);
  release(); await assert.rejects(first, /lost/);
  await assert.rejects(gate.send('message:a', '/tasks/a/messages', {}), /unconfirmed/);
  assert.equal(count, 1); gate.allowRetry('message:a'); assert.equal(count, 1); assert.equal(gate.uncertain.size, 0);
});

test('client classifies ambiguous POST outcomes; fresh configuration is Run-local and validates mode/limits', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'threshold-tui-client-'));
  writeFileSync(join(dir, 'server.json'), JSON.stringify({ url: 'http://localhost:1' }));
  const call = serviceClient(dir, { fetchImpl: async () => { throw new Error('network'); } });
  await assert.rejects(call('/status'), e => e.unavailable && !e.uncertain);
  await assert.rejects(call('/tasks/x/messages', { body: 'note' }), e => e.uncertain);
  const d = runDraft({ repo_path: dir }); d.provider = 'fixture'; d.model = 'fixture';
  d.skills = './one\n./two'; d.extensions = './extension.ts';
  const a = runPayload(d, dir); assert.equal(a.interactive, true); assert.equal(a.turnTimeoutSeconds, undefined);
  assert.deepEqual(a.skills, [resolve(dir, 'one'), resolve(dir, 'two')]);
  assert.equal(runDraft({ repo_path: dir }).skills, '');
  d.mode = 'background'; assert.equal(runPayload(d, dir).turnTimeoutSeconds, 1800);
  d.turnTimeoutSeconds = '-1'; assert.throws(() => runPayload(d, dir), /integer/);
  d.mode = 'interactive'; d.contextWindow = '1e6'; assert.throws(() => runPayload(d, dir), /integer/);
});

test('terminal actions are mouse hit-tested, keyboard reachable, width-safe and sanitize project controls', () => {
  let clicks = 0;
  const doc = new DocumentView((_tone, text) => text, fn => fn());
  doc.setBlocks([textBlock('中文 👩🏽‍💻 é\n\x1b[2Jdo not clear'), actionRow(action('a', 'Open 中文 Task', () => clicks++)), textBlock('long'.repeat(100))]);
  for (const width of [12, 32, 80]) { const lines = doc.render(width); assert.ok(lines.every(l => visibleWidth(l) <= width)); assert.doesNotMatch(lines.join('\n'), /\x1b\[2J/); }
  const hit = doc.hits[0]; doc.handleMouse({ type: 'click', button: 'left', x: hit.x, y: hit.y });
  doc.handleInput('\r'); assert.equal(clicks, 2);
  assert.equal(doc.handleMouse({ type: 'click', button: 'left', x: 0, y: 0 }), undefined, 'prose remains selectable');
});

test('layout blocks stay width-safe with CJK text and keep click targets on items, columns and breadcrumbs', () => {
  const opened = [];
  const doc = new DocumentView((_tone, text) => text, fn => fn());
  const open = id => () => opened.push(id);
  doc.setBlocks([bar([{ text: 'threshold' }, action('crumb', '中文 Project', open('crumb')), { text: '很长的任务标题 very long task title' }], [{ text: 'connected · read 10:00:00', short: '10:00:00' }]),
    section('Work', '3 Tasks'),
    item('task', '中文 Task 👩🏽‍💻 with a long title', open('task'), { right: 'in_progress · abcdef12', lines: [{ text: 'objective '.repeat(20), clip: true }, 'C:\\path\\to\\workspace'] }),
    fields([['Checkpoint', '第一行\nsecond line'], ['Messages', '2 available']], { indent: 4, clip: true }),
    columns([textBlock('main '.repeat(40))], [item('side', 'Side run', open('side'), { right: 'interactive' })], { rightWidth: 30, minWidth: 100 })]);
  for (const width of [12, 32, 80, 130]) {
    const lines = doc.render(width);
    assert.ok(lines.every(l => visibleWidth(l) <= width), `width ${width}`);
    for (const id of ['task', 'side']) {
      const hit = doc.hits.find(h => h.action.id === id); assert.ok(hit && hit.x + hit.width <= width);
      doc.handleMouse({ type: 'click', button: 'left', x: hit.x, y: hit.y });
    }
  }
  assert.deepEqual(opened, ['task', 'side', 'task', 'side', 'task', 'side', 'task', 'side']);
  doc.render(130); assert.ok(doc.hits.find(h => h.action.id === 'side').x >= 100 - 30, 'wide layout places side column on the right');
  assert.match(doc.render(40)[0], /abcdef|10:00:00/, 'narrow bar keeps the short right label');
});

test('frame: location matches the page, Back restores reading position/selection, Tab crosses areas, edits keep the page inert', async () => {
  const f = await fixture(); const terminal = new Terminal(); terminal.columns = 100; terminal.rows = 30;
  const app = new ThresholdTui({ home: f.home, cwd: f.repo, terminal, options: { ascii: true } });
  try {
    await app.initialize(); assert.equal(app.page, 'board');
    const location = () => app.bar.render(terminal.columns).join('\n');
    assert.match(location(), /中文 Project/);
    app.setPage('projects'); await app.refresh();
    assert.doesNotMatch(location(), /中文 Project/, 'Projects page must not present the previous Project as the current location');
    await app.openBoard(f.project.id);
    const boardScroll = app.scroll; app.doc.selected = `task:${f.task.id}`;
    await app.openTask(f.task.id); assert.notEqual(app.scroll, boardScroll); assert.match(location(), /TUI target/);
    await app.back(); assert.equal(app.page, 'board');
    assert.equal(app.scroll, boardScroll, 'Board keeps its own scroll view'); assert.equal(app.doc.selected, `task:${f.task.id}`);
    assert.equal(app.tui.getFocusedComponent(), app.doc);
    app.doc.selected = app.doc.actions[0].id; app.doc.handleInput('\x1b[Z');
    assert.equal(app.tui.getFocusedComponent(), app.top, 'Shift+Tab at the first item moves into the fixed header area');
    assert.equal(app.top.selected, 'archive'); app.top.handleInput('\t');
    assert.equal(app.tui.getFocusedComponent(), app.doc);
    terminal.rows = 12; app.render();
    assert.equal(app.top.actions.length, 0); assert.ok(app.doc.has('create-task'), 'short terminals scroll the header with the page');
    terminal.rows = 30;
    const run = await f.call(`/tasks/${f.task.id}/runs`, { provider: 'fixture', model: 'fixture', interactive: true });
    f.workers[0].settle(); await delay(10); await app.openRun(run.id);
    assert.equal(app.tui.getFocusedComponent(), app.bottom, 'Run view focuses the explicit input target');
    app.runEditor(); app.render();
    assert.match(app.editorHead.render(100).join('\n'), new RegExp(`Send to Run / .*${run.id}`));
    assert.equal(app.doc.inert, true); app.doc.render(100);
    const hit = app.doc.hits.find(h => h.action.id === 'stop-run');
    assert.ok(hit); assert.equal(app.doc.handleMouse({ type: 'click', button: 'left', x: hit.x, y: hit.y }), undefined, 'page behind the editor is not clickable');
    app.editor.setText('Keep editing this Run'); app.bar.render(100);
    for (const crumb of app.bar.hits) {
      assert.equal(app.bar.handleMouse({ type: 'click', button: 'left', x: crumb.x, y: crumb.y }), undefined);
      app.bar.selected = crumb.action.id; app.bar.handleInput('\r');
    }
    assert.equal(app.page, 'run'); assert.ok(app.edit);
    assert.equal(app.editor.getExpandedText(), 'Keep editing this Run');
    assert.equal(app.tui.getFocusedComponent(), app.editor);
    assert.equal(f.workers[0].stopped, false);
    await app.saveEdit(); assert.deepEqual(f.workers[0].inputs, ['Keep editing this Run']);
    app.bar.render(100);
    const projects = app.bar.hits.find(h => h.action.id === 'crumb:projects');
    app.bar.handleMouse({ type: 'click', button: 'left', x: projects.x, y: projects.y });
    await until(() => app.page === 'projects' && !app.actionPending);
  } finally { app.close(); app.tui.stop(); await f.service.close(); }
});

test('Board return preserves a nonzero reading position across pending frames and Project switches', async () => {
  const terminal = new Terminal(); terminal.columns = 100; terminal.rows = 30;
  const project = { id: 'project-a', name: 'Project A', repo_path: 'E:\\fixture-a' };
  const other = { id: 'project-b', name: 'Project B', repo_path: 'E:\\fixture-b' };
  const resources = { unsettled: 0, maxParallelRuns: 3, started: 0, maxRuns: 100, remainingStarts: 100, defaultTurnTimeoutSeconds: 1800 };
  const tasks = Array.from({ length: 40 }, (_, i) => ({ id: `task-${i}`, title: `A work ${i}`, status: 'in_progress', messageInbox: { count: 0 }, unsettledRuns: [] }));
  const board = { project, resources, tasks };
  let boardRead, release;
  const app = new ThresholdTui({ home: 'unused', terminal, options: { ascii: true }, call: async path => {
    if (path === '/projects/project-a/board') { if (boardRead) await boardRead; return board; }
    if (path === '/projects/project-b/board') return { project: other, resources, tasks: [] };
    if (path.startsWith('/tasks/')) return { project, task: { ...tasks[20], instructions: 'Read this task' }, recentRuns: [], messageInbox: { count: 0 } };
    throw new Error(path);
  } });
  let root;
  const setRoot = app.tui.setLayoutRoot.bind(app.tui);
  app.tui.setLayoutRoot = component => { root = component; setRoot(component); };
  const frame = () => renderLayoutFrame(root, terminal.columns, terminal.rows, () => {});
  app.index = { projects: [project, other] };
  try {
    await app.openBoard(project.id); frame(); app.scroll.scrollTo(50); frame();
    app.doc.selected = 'task:task-20';
    await app.openTask('task-20'); frame();
    boardRead = new Promise(resolve => { release = resolve; });
    const returning = app.back();
    const pendingFrame = frame();
    assert.equal(app.scroll.scrollTop, 50, 'pending GET must not render a short placeholder over saved content');
    assert.ok(pendingFrame.lines.some(line => line.includes('A work')));
    release(); await returning; frame();
    assert.equal(app.scroll.scrollTop, 50); assert.equal(app.doc.selected, 'task:task-20');
    const switching = app.openBoard(other.id);
    assert.ok(!frame().lines.some(line => line.includes('A work')), 'never reuse a different Project snapshot');
    await switching; frame();
    boardRead = new Promise(resolve => { release = resolve; });
    const returningAgain = app.openBoard(project.id); frame();
    assert.equal(app.scroll.scrollTop, 50, 'returning from another Project also retains the prior reading position');
    release(); await returningAgain; frame(); assert.equal(app.scroll.scrollTop, 50);
  } finally { release?.(); app.close(); app.tui.stop(); }
});

test('Message and checkpoint timestamps retain exact ISO values inside the narrow TUI', async () => {
  const terminal = new Terminal(); terminal.columns = 40; terminal.rows = 20;
  const app = new ThresholdTui({ home: 'unused', terminal, options: { ascii: true } });
  const first = '2026-09-26T10:57:54.123Z', second = '2026-09-26T10:57:54.987Z';
  app.project = { id: 'project', name: 'Project', repo_path: 'E:\\fixture' };
  app.task = { project: app.project, task: { id: 'task', title: 'Task', status: 'in_progress' }, messageInbox: { count: 2 },
    checkpoint: { run_id: 'source-run', created_at: first, summary: 'Summary', git: {} } };
  app.messages = { messages: [{ id: 1, source: 'client', body: 'First record', created_at: first }, { id: 2, source: 'client', body: 'Second record', created_at: second }] };
  app.page = 'task'; app.tab = 'messages';
  try {
    app.render();
    const compact = app.doc.render(40).join('\n');
    assert.match(compact, /:54 local/, 'narrow metadata wraps rather than dropping seconds/local marker');
    assert.ok(!compact.includes(first), 'exact timestamps stay behind an explicit disclosure');
    const open = async id => { app.doc.selected = id; app.doc.handleInput('\r'); await until(() => !app.actionPending); };
    await open('time:message:task:1'); await open('time:message:task:2');
    const messages = app.doc.render(40);
    assert.ok(messages.every(line => visibleWidth(line) <= 40));
    assert.ok(messages.join('\n').includes(first)); assert.ok(messages.join('\n').includes(second));
    app.tab = 'checkpoint'; app.render();
    await open(`time:checkpoint:task:${first}`);
    const checkpoint = app.doc.render(40);
    assert.ok(checkpoint.every(line => visibleWidth(line) <= 40));
    assert.ok(checkpoint.join('\n').includes(first));
    await open(`time:checkpoint:task:${first}`);
    assert.ok(!app.doc.render(40).join('\n').includes(first));
  } finally { app.close(); app.tui.stop(); }
});

test('real service: TUI inbox/run inputs stay separate, navigation and exit do not stop worker, no auto checkpoint', async () => {
  const f = await fixture(); const terminal = new Terminal();
  const app = new ThresholdTui({ home: f.home, cwd: f.repo, terminal, options: { ascii: true } });
  try {
    await app.initialize(); assert.equal(app.page, 'board');
    await app.openTask(f.task.id, 'messages');
    app.messageEditor(); app.editor.setText('client note'); await app.saveEdit();
    let context = await f.call(`/tasks/${f.task.id}`); assert.equal(context.messageInbox.count, 1); assert.equal(f.workers.length, 0);
    const record = (await f.call(`/tasks/${f.task.id}/messages`)).messages[0]; assert.equal(record.source, 'client');
    const run = await f.call(`/tasks/${f.task.id}/runs`, { provider: 'fixture', model: 'fixture', interactive: true });
    f.workers[0].settle(); await delay(10); await app.openBoard(f.project.id);
    assert.equal(app.board.interactions[run.id], 'waiting for input');
    app.render(); assert.match(app.doc.render(100).join('\n'), /waiting for input \/ live snapshot/);
    await app.openRun(run.id);
    app.runEditor(); app.editor.setText('input to actual Run'); await app.saveEdit();
    assert.deepEqual(f.workers[0].inputs, ['input to actual Run']);
    context = await f.call(`/tasks/${f.task.id}`); assert.equal(context.messageInbox.count, 1);
    assert.equal(context.task.status, 'in_progress'); assert.equal(context.checkpoint, null);
    await app.openTask(f.task.id); assert.equal(f.workers[0].stopped, false);
    await app.openRun(run.id); assert.equal(app.run.execution.mode, 'interactive');
    app.messageAfter = 99; const peerRun = await f.call(`/tasks/${f.peer.id}/runs`, { provider: 'fixture', model: 'fixture', interactive: true, workspacePath: (() => { const other = join(f.home, 'peer'); git(f.repo, 'worktree', 'add', '-b', 'peer', other); return other; })() });
    await app.openRun(peerRun.id, true); assert.equal(app.messageAfter, 0);
    app.close(); assert.equal(f.workers[0].stopped, false); assert.equal(f.workers[1].stopped, false);
  } finally { app.close(); app.tui.stop(); await f.service.close(); }
});

test('TUI drops stale route reads and keeps offline snapshots without inventing Run unknown', async () => {
  const f = await fixture(); const app = new ThresholdTui({ home: f.home, cwd: f.repo, terminal: new Terminal() });
  try {
    await app.initialize(); await app.openTask(f.task.id);
    const real = app.call; let release;
    app.call = async path => { if (path.startsWith('/tasks/')) await new Promise(r => { release = r; }); return real(path); };
    const read = app.refresh(); await until(() => release);
    app.setPage('projects'); await app.refresh(); release(); await read;
    assert.equal(app.page, 'projects');
    app.call = real; const run = await f.call(`/tasks/${f.task.id}/runs`, { provider: 'fixture', model: 'fixture', interactive: true }); await app.openRun(run.id);
    app.call = async () => { throw new Error('offline'); }; await app.refresh();
    assert.equal(app.connected, false); assert.equal(app.run.status, 'running'); assert.equal(app.live.active, true);
    await assert.rejects(app.write('input:'+run.id, `/runs/${run.id}/input`, { message: 'no' }), /paused/);
  } finally { app.close(); app.tui.stop(); await f.service.close(); }
});

test('new Run form uses existing launch semantics, preserves rejected draft, and fresh selection defaults empty', async () => {
  const f = await fixture();
  const call = (path, data) => path === '/models' ? Promise.resolve({ defaultProvider: 'fixture', defaultModel: 'fixture', models: [{ provider: 'fixture', id: 'fixture', configured: true }] }) : f.call(path, data);
  const app = new ThresholdTui({ home: f.home, cwd: f.repo, call, terminal: new Terminal() });
  try {
    await app.initialize(); await app.openTask(f.task.id); await app.newRun();
    app.form.draft.mode = 'background'; app.form.draft.turnTimeoutSeconds = '0'; app.form.draft.objective = 'Independent objective';
    const start = () => app.formBlocks().flatMap(b => b.actions ?? []).find(a => a.id === 'start').run();
    await start(); assert.equal(app.page, 'run'); assert.equal(app.run.execution.mode, 'background'); assert.equal(app.run.execution.turnTimeoutSeconds, 0);
    const firstId = app.run.id; assert.equal((await f.call(`/tasks/${f.task.id}`)).task.instructions, '真实说明\nKeep full instructions.');
    await app.newRun(); assert.equal(app.form.draft.skills, ''); assert.equal(app.form.draft.extensions, '');
    app.form.draft.objective = 'Keep this draft after busy workspace error';
    await assert.rejects(start(), /worktree/); assert.equal(app.form.draft.objective, 'Keep this draft after busy workspace error');
    app.form = null; await app.openRun(firstId); assert.equal(app.run.execution.mode, 'background');
    f.workers[0].settle(); await until(() => f.workers[0].stopped); await app.refresh();
    assert.equal(app.run.status, 'ended'); assert.equal(app.task.task.status, 'in_progress'); assert.equal(app.task.checkpoint, null);
  } finally { app.close(); app.tui.stop(); await f.service.close(); }
});

test('unknown occupancy recovery keeps unknown outcome; file preview binds to selected workspace', async () => {
  const f = await fixture(); const app = new ThresholdTui({ home: f.home, cwd: f.repo, terminal: new Terminal() });
  try {
    const store = openStore(join(f.home, 'project.sqlite'));
    const run = store.startRun(f.task.id, 'fixture', 'fixture'); store.db.prepare("UPDATE runs SET status='unknown' WHERE id=?").run(run.id); store.close();
    await app.initialize(); await app.openRun(run.id); app.recoverRun();
    await assert.rejects(app.form.submit(app.form.draft), /confirmation/);
    app.form.draft.confirm = true; app.form.draft.note = 'Checked old worker and worktree'; await app.form.submit(app.form.draft);
    assert.equal(app.run.status, 'unknown'); assert.ok(app.run.workspace_recovery);
    writeFileSync(join(f.repo, 'note.txt'), 'current file'); assert.match((await workspaceFile(f.repo, 'note.txt')).text, /current file/);
    await assert.rejects(workspaceFile(f.repo, '../server.json'), /within/);
  } finally { app.close(); app.tui.stop(); await f.service.close(); }
});

test('native renderer input/paste/resize lifecycle restores terminal and never submits on Enter', async () => {
  const f = await fixture(); const terminal = new Terminal(); const app = new ThresholdTui({ home: f.home, cwd: f.repo, terminal, options: { color: false } });
  const running = app.start();
  try {
    await until(() => app.board && !app.actionPending);
    await app.openTask(f.task.id, 'messages'); app.messageEditor();
    terminal.input('\x1b[200~中文 first\nsecond\x1b[201~'); terminal.input('\r');
    assert.match(app.editor.getExpandedText(), /中文 first\nsecond\n/);
    assert.equal((await f.call(`/tasks/${f.task.id}`)).messageInbox.count, 0);
    terminal.columns = 35; terminal.rows = 15; terminal.resize(); app.tui.renderNow();
    assert.ok(terminal.output.includes('\x1b[?1049h'));
    terminal.input('\x13'); await until(() => !app.edit && !app.actionPending);
    assert.equal((await f.call(`/tasks/${f.task.id}`)).messageInbox.count, 1);
    terminal.input('\x03'); await running;
    assert.ok(terminal.output.includes('\x1b[?1049l')); assert.ok(terminal.output.includes('\x1b[?1006l'));
  } finally { app.close(); await running; await f.service.close(); }
});
