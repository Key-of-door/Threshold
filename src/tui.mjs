import { resolve, basename } from 'node:path';
import { realpath, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ProcessTerminal, TuiAltScreen, Editor, VStack, ScrollView, matchesKey, isKeyRelease,
  KeybindingsManager, TUI_KEYBINDINGS, getKeybindings, setKeybindings, Text } from '@earendil-works/pi-tui';
import { display } from './cli-display.mjs';
import { format, readable } from './cli-format.mjs';
import { executionLabel } from './execution.mjs';
import { serviceState, startBackground } from './service-process.mjs';
import { serviceClient, resolveId, projectAtCwd, runDraft, runPayload, gitRead, workspaceObservation, workspaceFile, WriteGate } from './tui-client.mjs';
import { DocumentView, textBlock as T, action as A, actionRow as R, item, section, heading, fields, tabs, bar, columns, rule } from './tui-components.mjs';

const short = id => id?.slice(0, 8) ?? '?';
const active = run => ['starting', 'running'].includes(run?.status);
const unresolved = run => active(run) || run?.status === 'unknown' && !run.workspace_recovery;
const two = n => String(n).padStart(2, '0');
// Compact local display; record details and Run Inspect retain the exact recorded instant.
const when = iso => {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return iso ? String(iso) : 'not recorded';
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())} local`;
};
const clock = iso => iso ? when(iso).slice(11, 19) : 'none';
const zone = (name, ...blocks) => blocks.filter(Boolean).map(b => ({ ...b, zone: name }));
const fieldLabels = { provider: 'Provider', model: 'Model', thinking: 'Thinking', contextWindow: 'Context window (empty = Pi default)',
  maxOutputTokens: 'Output ceiling (empty = Pi default)', mode: 'Execution mode', turnTimeoutSeconds: 'Background timeout / seconds (0 disables)',
  objective: 'This Run objective', workspacePath: 'Workspace / existing Git worktree', skills: 'Skill paths / one per line', extensions: 'Extension entry paths / one per line' };
const unicode = { pointer: '❯', rule: '─', crumb: ' › ', ellipsis: '…', user: '›', agent: '●', start: '▸', end: '◂' };
const ascii = { pointer: '>', rule: '-', crumb: ' > ', ellipsis: '...', user: '>', agent: '*', start: '>', end: '<' };

export class ThresholdTui {
  constructor({ home, cwd = process.cwd(), args = {}, options = {}, call, terminal = new ProcessTerminal() }) {
    this.home = home; this.cwd = cwd; this.args = args; this.options = options; this.terminal = terminal;
    this.abort = new AbortController(); this.call = call ?? serviceClient(home, { signal: this.abort.signal }); this.gate = new WriteGate(this.call);
    this.page = 'projects'; this.tab = 'overview'; this.index = { projects: [], tasks: [] }; this.board = null; this.task = null; this.run = null;
    this.project = null; this.live = null; this.messages = null; this.messageAfter = 0; this.messageHistory = [];
    this.connected = false; this.lastRead = null; this.error = ''; this.notice = ''; this.route = 0; this.closed = false;
    this.drafts = new Map(); this.form = null; this.edit = null; this.pendingRead = false; this.service = null; this.git = null; this.catalog = null;
    this.scrolls = new Map(); this.selections = new Map(); this.currentKey = null; this.restoreSelection = null; this.focusReset = true;
    this.boardSnapshots = new Map(); this.expandedTimes = new Set();
    this.glyphs = options.ascii ? ascii : unicode; this.dot = options.ascii ? ' / ' : ' · ';
    const f = format(options);
    this.style = (tone, text) => {
      if (tone === 'selected') return options.color ? `\x1b[7m${readable(text)}\x1b[27m` : `>${readable(text).slice(1)}`;
      if (tone === 'focus') return options.color ? `\x1b[1m${f.text('accent', text)}` : readable(text);
      if (tone === 'current') {
        const lead = readable(text).match(/^\s*/)[0];
        return options.color ? `${lead}\x1b[1;4m${f.text('accent', readable(text).slice(lead.length))}` : `*${readable(text).slice(1)}`;
      }
      if (tone === 'strong') return options.color && readable(text) ? `\x1b[1m${readable(text)}\x1b[22m` : readable(text);
      return f.text(tone, text);
    };
    this.tui = new TuiAltScreen(terminal, true, undefined, { mouse: !args['no-mouse'], copyOnSelect: true,
      scrollToEndIndicator: () => this.style('accent', '[ New activity / click to return to end ]'),
      copySelection: process.platform === 'win32' ? text => this.copyText(text) : undefined });
    const view = () => new DocumentView(this.style, fn => this.invoke(fn), { glyphs: this.glyphs });
    this.bar = view(); this.top = view(); this.doc = view(); this.bottom = view(); this.footer = view(); this.editorHead = view(); this.measure = view();
    for (const z of [this.top, this.doc, this.bottom]) { z.onBoundary = step => this.focusStep(z, step); z.onFocus = () => this.tui.setFocus(z); }
    this.doc.onMove = y => {
      if (y < this.scroll.scrollTop) this.scroll.scrollTo(y);
      else if (y >= this.scroll.scrollTop + this.scroll.viewportHeight) this.scroll.scrollTo(y - this.scroll.viewportHeight + 1);
      this.tui.requestRender();
    };
    this.scroll = new ScrollView(this.doc, { primary: true, follow: 'none', scrollbar: 'auto' });
    this.editor = new Editor(this.tui, { borderColor: text => this.style('accent', text),
      selectList: { selectedPrefix: t => t, selectedText: t => t, description: t => t, scrollInfo: t => t, noMatch: t => t } });
    this.editor.disableSubmit = true;
    this.editor.onChange = () => { if (this.edit) this.drafts.set(this.edit.key, this.editor.getExpandedText()); };
    this.editorActions = view();
    this.tui.addInputListener(data => this.input(data));
  }
  async copyText(text) {
    // Pipe text as data; never interpolate clipboard content into shell code.
    const { spawn } = await import('node:child_process');
    return new Promise(resolveCopy => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Console]::InputEncoding = [Text.UTF8Encoding]::new(); $text = [Console]::In.ReadToEnd(); Set-Clipboard -Value $text'],
        { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
      const timer = setTimeout(() => { child.kill(); resolveCopy(false); }, 3000);
      child.once('error', () => { clearTimeout(timer); resolveCopy(false); });
      child.once('exit', code => { clearTimeout(timer); resolveCopy(code === 0); });
      child.stdin.on('error', () => {}); child.stdin.end(text, 'utf8');
    });
  }
  async invoke(fn) {
    if (this.closed || this.gate.pending || this.actionPending) return;
    this.actionPending = true;
    try { await fn(); } catch (error) { this.error = error.message; if (error.unavailable) this.connected = false; }
    finally { this.actionPending = false; }
    if (!this.closed) this.render();
  }
  async initialize() {
    this.index = await this.call('/status?includeArchived=true'); this.connected = true; this.lastRead = new Date().toISOString();
    let projectId = this.args.project ? await resolveId(this.call, 'project', this.args.project) : undefined;
    if (this.args.run && this.args.task) throw new Error('Choose --run or --task, not both.');
    if (this.args.run) {
      const id = await resolveId(this.call, 'run', this.args.run, projectId); await this.openRun(id); return;
    }
    if (this.args.task) { const id = await resolveId(this.call, 'task', this.args.task, projectId); await this.openTask(id); return; }
    this.project = projectId ? this.index.projects.find(p => p.id === projectId) : await projectAtCwd(this.index.projects, this.cwd);
    if (this.project) await this.openBoard(this.project.id);
  }
  async start() {
    const previousKeys = getKeybindings();
    setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS, { 'tui.input.newLine': ['enter', 'shift+enter', 'alt+enter'], 'tui.input.submit': [] }));
    this.done = new Promise(resolveDone => { this.resolveDone = resolveDone; });
    this.onSignal = () => this.close(); process.on('SIGINT', this.onSignal); process.on('SIGTERM', this.onSignal);
    this.onResize = () => { if (!this.closed) this.render(); }; process.stdout.on('resize', this.onResize);
    try {
      this.render(); this.tui.start(); await this.invoke(() => this.initialize());
      this.timer = setInterval(() => { if (!this.edit && !this.form) this.refresh().catch(error => { this.error = error.message; this.render(); }); }, 1500);
      await this.done;
    } finally {
      this.closed = true; clearInterval(this.timer); this.abort.abort();
      try {
        await this.terminal.drainInput(200, 30);
      } finally {
        this.tui.setLayoutRoot(new Text('Threshold TUI closed. Closing the view did not stop any worker or service.'+
          (this.writePendingAtClose ? '\nA write was pending at exit. Delivery is unconfirmed; inspect before repeating it.' : ''), 0, 0));
        this.tui.stop(); setKeybindings(previousKeys);
        process.off('SIGINT', this.onSignal); process.off('SIGTERM', this.onSignal); process.stdout.off('resize', this.onResize);
      }
    }
  }
  close() { this.writePendingAtClose ||= this.gate.pending; this.closed = true; clearInterval(this.timer); this.abort.abort(); this.resolveDone?.(); }
  routeKey(page = this.page) {
    return [page, ['board', 'projects'].includes(page) ? this.project?.id : '', page === 'task' ? this.task?.task.id : '',
      ['run', 'inspect'].includes(page) ? this.run?.id : ''].join(':');
  }
  // Each route keeps its own scroll position and selected action, so Back returns to where reading stopped.
  setPage(page) {
    if (this.currentKey) this.selections.set(this.currentKey, this.doc.selected);
    this.page = page; this.route++; this.error = ''; this.notice = ''; this.edit = null; this.form = null;
    this.currentKey = this.routeKey();
    let scroll = this.scrolls.get(this.currentKey);
    if (scroll) this.scrolls.delete(this.currentKey);
    else scroll = new ScrollView(this.doc, { primary: true, follow: page === 'run' ? 'end' : 'none', scrollbar: 'auto' });
    this.scrolls.set(this.currentKey, scroll);
    if (this.scrolls.size > 40) this.scrolls.delete(this.scrolls.keys().next().value);
    this.scroll = scroll; this.restoreSelection = this.selections.get(this.currentKey) ?? null; this.focusReset = true;
    this.tui.setFocus(this.doc); this.render();
  }
  async openBoard(id) {
    this.project = this.index.projects.find(p => p.id === id) ?? this.project;
    // Keep this Project's last observed content while refreshing. A one-line Loading frame
    // would clamp the cached ScrollView to zero before the full Board arrives.
    this.board = this.boardSnapshots.get(id) ?? null;
    this.task = null; this.run = null; this.live = null; this.setPage('board'); await this.refresh();
  }
  async openTask(id, tab = 'overview') {
    if (id !== this.task?.task.id) { this.task = { task: { id } }; this.messageAfter = 0; this.messageHistory = []; this.messages = null; this.git = null; }
    this.tab = tab; this.run = null; this.live = null; this.setPage('task'); await this.refresh();
  }
  async openRun(id, inspect = false) {
    if (id !== this.run?.id) { this.run = { id }; this.live = null; }
    this.setPage(inspect ? 'inspect' : 'run'); await this.refresh();
  }
  async switchTab(tab) {
    this.tab = tab; this.route++; this.scroll.scrollToStart();
    if (tab === 'git' && !this.git) await this.showGit(this.task.project.repo_path); else await this.refresh();
  }
  async refresh() {
    const route = this.route, page = this.page, taskId = this.task?.task.id, runId = this.run?.id, projectId = this.project?.id;
    // Only the same route is deduplicated. Navigating starts a new, independently guarded read.
    if (this.readRoute === route) return;
    this.readRoute = route;
    try {
      let data;
      if (page === 'projects') data = await this.call('/status?includeArchived=true');
      else if (page === 'board' && projectId) {
        data = await this.call(`/projects/${projectId}/board`);
        const ids = [...new Set(data.tasks.flatMap(t => t.unsettledRuns ?? []).filter(active).map(r => r.id))];
        data.interactions = Object.fromEntries(await Promise.all(ids.map(async id => {
          try { const live = await this.call(`/runs/${id}/live`); return [id, live.active ? live.phase : 'no active live observation']; }
          catch { return [id, 'live observation unavailable']; }
        })));
      }
      else if (page === 'task' && taskId) {
        const context = await this.call(`/tasks/${taskId}`);
        const board = await this.call(`/projects/${context.project.id}/board`);
        const messages = this.tab === 'messages' ? await this.call(`/tasks/${taskId}/messages?after=${this.messageAfter}&limit=10`) : undefined;
        data = { context, board, messages };
      } else if (['run', 'inspect'].includes(page) && runId) {
        const run = await this.call(`/runs/${runId}`);
        const context = await this.call(`/tasks/${run.task_id}`);
        const live = await this.call(`/runs/${runId}/live?after=0`);
        data = { run, context, live };
      } else if (page === 'service') data = { service: await serviceState(this.home), index: await this.call('/status?includeArchived=true').catch(() => null) };
      else return;
      if (route !== this.route || this.closed) return;
      if (page === 'projects') this.index = data;
      if (page === 'board') { this.board = data; this.project = data.project; }
      if (page === 'task') { this.task = data.context; this.project = data.context.project; this.board = data.board; if (data.messages) this.messages = data.messages; }
      if (['board', 'task'].includes(page)) {
        this.boardSnapshots.delete(this.board.project.id);
        this.boardSnapshots.set(this.board.project.id, this.board);
        if (this.boardSnapshots.size > 40) this.boardSnapshots.delete(this.boardSnapshots.keys().next().value);
      }
      if (['run', 'inspect'].includes(page)) {
        if (this.task?.task.id !== data.context.task.id) { this.messageAfter = 0; this.messageHistory = []; this.messages = null; this.git = null; }
        this.run = data.run; this.live = data.live; this.task = data.context; this.project = data.context.project;
      }
      if (page === 'service') { this.service = data.service; if (data.index) this.index = data.index; }
      this.connected = page === 'service' ? data.service.state === 'running' : true;
      this.lastRead = new Date().toISOString(); if (this.readError) { this.error = ''; this.readError = false; }
    } catch (error) {
      if (route !== this.route || this.closed) return;
      this.connected = false; this.error = error.message; this.readError = true;
    } finally {
      if (this.readRoute === route) this.readRoute = null;
      if (!this.closed && route === this.route) this.render();
    }
  }
  async write(key, path, data) {
    if (!this.connected) throw new Error('Writes paused while disconnected. Refresh and inspect first.');
    const pending = this.gate.send(key, path, data); this.render();
    try { return await pending; }
    finally { if (!this.closed) this.render(); }
  }
  retryControls(key) {
    if (!this.gate.uncertain.has(key)) return [];
    return [T('Previous write outcome unconfirmed. Inspect destination before retrying.', 'warn'), R(A(`retry:${key}`, 'I inspected; unlock explicit retry', () => {
      this.gate.allowRetry(key); this.notice = 'Retry unlocked. Nothing resent; another explicit submission may duplicate the prior write.';
    }))];
  }
  editText(key, title, value, save, { submitLabel = 'Save value', send = false } = {}) {
    this.edit = { key, title, save, submitLabel, send };
    this.editor.setText(this.drafts.has(key) ? this.drafts.get(key) : value ?? '');
    this.tui.setFocus(this.editor); this.render();
  }
  async saveEdit() {
    const edit = this.edit; if (!edit) return;
    const value = this.editor.getExpandedText(); this.drafts.set(edit.key, value);
    await edit.save(value);
    if (this.edit === edit) { this.edit = null; this.drafts.delete(edit.key); this.focusReset = true; this.tui.setFocus(this.doc); }
    this.render();
  }
  async newRun() {
    if (!this.task?.project) throw new Error('Select a Task first.');
    if (this.task.project.archived_at) throw new Error('Restore this Project before starting new work.');
    try { this.catalog = await this.call('/models'); } catch (error) { this.notice = `Model catalog unavailable: ${error.message}. Enter provider/model explicitly.`; }
    const key = `new:${this.task.task.id}`;
    const draft = this.drafts.get(key) ?? runDraft(this.task.project, this.catalog ?? {}, this.board?.resources.defaultTurnTimeoutSeconds ?? 1800);
    this.drafts.set(key, draft); this.form = { kind: 'run', key, taskId: this.task.task.id, draft }; this.focusReset = true; this.scroll.scrollToStart(); this.render();
  }
  formBlocks() {
    const form = this.form;
    const blocks = zone('top', heading(form.title ?? `New Run / ${this.task?.task.title}`));
    const field = (key, label, value, empty, run, labelWidth) => item(`field:${key}`, label, run, { value: value || empty, valueTone: value ? 'strong' : 'dim', labelWidth });
    if (form.kind === 'run') {
      blocks.push(...zone('top', T('Startup draft only. Current Runs unchanged. Paths resolve from '+this.cwd, 'dim')), section('Startup configuration', 'this Run only'));
      for (const [key, label] of Object.entries(fieldLabels)) {
        if (key === 'turnTimeoutSeconds' && form.draft.mode === 'interactive') continue;
        const value = form.draft[key];
        blocks.push(field(key, label, value, '(none / default)', () => {
          if (key === 'mode') { form.draft.mode = value === 'interactive' ? 'background' : 'interactive'; return; }
          this.editText(`${form.key}:${key}`, label, value, text => { form.draft[key] = key === 'objective' ? text : text.trim(); });
        }, 38));
      }
      if (form.draft.mode === 'interactive') blocks.push(T('Interactive / no turn deadline. Waiting still occupies a slot.', 'dim', { indent: 4 }));
      blocks.push(R(A('models', 'Choose configured model', () => this.chooseModel(form)), A('worktrees', 'Choose existing worktree', () => this.chooseWorktree(form))));
      blocks.push(T('Capabilities default to none on a fresh draft; selected paths do not prove loading or execution.\nContext/output are ceilings, not usage or a total Run budget.', 'dim'));
      blocks.push(...zone('bottom', ...this.retryControls(form.key), R(A('start', 'Start Run', async () => {
        const value = await this.write(form.key, `/tasks/${form.taskId}/runs`, runPayload(form.draft, this.cwd));
        this.drafts.delete(form.key); this.form = null;
        if (!this.closed) await this.openRun(value.id);
      }, !this.connected || this.gate.uncertain.has(form.key)), A('cancel', 'Back / keep draft', () => { this.form = null; this.focusReset = true; }))));
    } else if (form.kind === 'choices') {
      blocks.push(section('Choices', `${form.choices.length}`), ...form.choices.map(c => item(c.id, c.label, () => { form.pick(c); this.form = form.parent; this.focusReset = true; })));
      blocks.push(...zone('bottom', R(A('cancel', 'Back', () => { this.form = form.parent; this.focusReset = true; }))));
    } else {
      if (form.description) blocks.push(...zone('top', T(form.description, 'dim')));
      const width = Math.max(...Object.values(form.fields).map(l => l.length));
      for (const [key, label] of Object.entries(form.fields)) blocks.push(field(key, label, form.draft[key], '(empty)', () => {
        this.editText(`${form.key}:${key}`, label, form.draft[key], text => { form.draft[key] = text; });
      }, width));
      if (form.kind === 'recovery') blocks.push(item('confirm', `${form.draft.confirm ? '[x]' : '[ ]'} Old worker checked gone; workspace reusable`, () => { form.draft.confirm = !form.draft.confirm; }));
      blocks.push(...zone('bottom', ...this.retryControls(form.key), R(A('submit', form.submitLabel ?? 'Save', async () => { await form.submit(form.draft); }, !this.connected && form.write !== false || this.gate.uncertain.has(form.key)),
        A('cancel', 'Back / keep draft', () => { this.form = null; this.focusReset = true; }))));
    }
    return blocks;
  }
  async chooseModel(parent) {
    const catalog = this.catalog ?? await this.call('/models');
    const models = catalog.models.filter(m => m.configured !== null);
    const choices = (models.length ? models : catalog.models).map(m => ({ id: `${m.provider}/${m.id}`, label: `${m.provider} / ${m.id}${m.configured === false ? ' / credential missing' : m.configured === null ? ' / credential checked at start' : ''}`, model: m }));
    this.form = { kind: 'choices', title: 'Local model catalog / connectivity not verified', parent, choices, pick: c => { parent.draft.provider = c.model.provider; parent.draft.model = c.model.id; } };
    this.focusReset = true;
  }
  async chooseWorktree(parent) {
    const text = await gitRead(this.project.repo_path, 'worktree', 'list', '--porcelain');
    const paths = text.split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice(9));
    this.form = { kind: 'choices', title: 'Existing worktrees / occupancy checked at Run start', parent,
      choices: paths.map(p => ({ id: p, label: p })), pick: c => { parent.draft.workspacePath = c.id; } };
    this.focusReset = true;
  }
  simpleForm(kind, title, fields, defaults, submit, options = {}) {
    const key = options.key ?? `${kind}:${this.task?.task.id ?? this.project?.id ?? this.home}`;
    const draft = this.drafts.get(key) ?? { ...defaults }; this.drafts.set(key, draft);
    this.form = { kind, title, key, fields, draft, ...options, submit: async values => { await submit(values, key); this.drafts.delete(key); if (!this.closed) { this.form = null; this.focusReset = true; await this.refresh(); } } };
    this.focusReset = true; this.scroll.scrollToStart();
  }
  messageEditor() {
    const taskId = this.task.task.id, key = `message:${taskId}`;
    this.editText(key, `Write to Task inbox / ${this.project.name} / ${this.task.task.title}`, '', async text => {
      if (!text.trim()) throw new Error('Message body is required.');
      await this.write(key, `/tasks/${taskId}/messages`, { body: text });
      this.notice = 'Message stored as client. No Run was launched or notified.'; await this.refresh();
    }, { submitLabel: 'Write to Task inbox', send: true });
  }
  runEditor() {
    const id = this.run.id, key = `input:${id}`;
    this.editText(key, `Send to Run / ${this.project.name} / ${this.task.task.title} / ${id}`, '', async text => {
      if (!text.trim()) throw new Error('Input is required.');
      if (!this.live?.active || !active(this.run) || this.live.phase === 'stopping') throw new Error('Run is not accepting input. Draft retained.');
      await this.write(key, `/runs/${id}/input`, { message: text });
      this.notice = 'Pi accepted the input; processing is not established.'; await this.refresh();
    }, { submitLabel: 'Send to this Run', send: true });
  }
  async showGit(workspace, kind = 'status') {
    this.git = await workspaceObservation(workspace, kind); this.gitKind = kind; this.tab = 'git'; this.setPage('task'); this.scroll.scrollToStart();
  }
  fmt() { return format({ ...this.options, columns: this.terminal.columns }); }
  runItem(run, { indent = 0, live, compact = false } = {}) {
    const lines = [live && { text: `${live}${this.dot}live snapshot`, tone: 'accent' },
      run.error && { text: run.error, tone: 'error' },
      run.status === 'unknown' && { text: run.workspace_recovery ? 'Workspace confirmed reusable; old outcome unknown.' : 'Unresolved exit holds a slot and workspace.', tone: 'warn' },
      run.objective && { text: run.objective, tone: '', clip: true },
      run.workspace_path && { text: run.workspace_path, tone: 'dim', clip: compact }].filter(Boolean);
    return item(`run:${run.id}`, short(run.id), () => this.openRun(run.id), { indent, lead: this.fmt().state(run),
      right: { text: compact ? run.execution?.mode ?? 'mode not recorded' : executionLabel(run.execution), tone: 'dim' }, lines });
  }
  // /status lists only unknown, unrecovered Runs; its rows carry no status column.
  unresolvedItem(r, note) {
    return item(`run:${r.id}`, short(r.id), () => this.openRun(r.id), { lead: this.fmt().state({ ...r, status: 'unknown' }), right: `task ${short(r.task_id)}`,
      lines: [r.workspace_path, { text: note, tone: 'warn' }] });
  }
  projectBlocks() {
    const projects = this.index.projects, runs = this.index.unresolvedRuns ?? [];
    const blocks = zone('top', heading('Projects', { right: { text: `${projects.length} registered${this.dot}archived included`, tone: 'dim' } }),
      T(`Home  ${this.home}`, 'dim'), R(A('register', 'Register Project', () => this.registerProject(), !this.connected)));
    blocks.push(...projects.map(p => item(`project:${p.id}`, p.name, () => this.openBoard(p.id), {
      right: { text: `${p.archived_at ? `archived${this.dot}` : ''}${short(p.id)}`, tone: p.archived_at ? 'warn' : 'dim' }, lines: [p.repo_path] })));
    if (!projects.length) blocks.push(T('No Projects loaded. Inspect Service or register a repository.'));
    if (runs.length) blocks.push(section('Unresolved Runs', { text: 'service slots held in this home', tone: 'warn' }),
      ...runs.map(r => this.unresolvedItem(r, 'Inspect the old worker and workspace before recovery. Outcome remains unknown.')));
    return blocks;
  }
  boardBlocks() {
    const b = this.board; if (!b) return [T('Loading Project Board…', 'dim')];
    const r = b.resources, full = r.unsettled >= r.maxParallelRuns;
    const blocks = zone('top', heading(b.project.name, { right: { text: `project ${b.project.id}`, tone: 'dim' } }), T(b.project.repo_path, 'dim'),
      b.project.archived_at && T('Archived / history retained', 'warn'),
      T(`Home capacity ${r.unsettled}/${r.maxParallelRuns} slots unsettled${this.dot}${r.started}/${r.maxRuns} starts (${r.remainingStarts} left)${this.dot}background default ${r.defaultTurnTimeoutSeconds ?? 'not recorded'}s${this.dot}shared by all Projects in this home`, full ? 'warn' : 'dim'),
      R(A('create-task', 'Create Task', () => this.createTask(), Boolean(b.project.archived_at)), A('archive', b.project.archived_at ? 'Restore Project' : 'Archive Project', () => this.archiveProject())));
    blocks.push(section('Work', `${b.tasks.length} Task${b.tasks.length === 1 ? '' : 's'}${this.dot}previews; open a Task for full text`));
    b.tasks.forEach((task, i) => {
      if (i) blocks.push(T(''));
      blocks.push(item(`task:${task.id}`, task.title, () => this.openTask(task.id), { right: { text: `${task.status}${this.dot}${short(task.id)}`, tone: task.status === 'done' ? 'ok' : 'dim' } }));
      const runs = [task.latestRun, ...(task.unsettledRuns ?? [])].filter((run, i, all) => run && all.findIndex(r => r?.id === run.id) === i);
      blocks.push(...runs.map(run => this.runItem(run, { indent: 2, live: b.interactions?.[run.id] })));
      if (!runs.length) blocks.push(T('No Runs yet.', 'dim', { indent: 4 }));
      blocks.push(fields([['Checkpoint', task.checkpoint?.summary ?? 'Not saved yet.', task.checkpoint ? '' : 'dim'], ['Messages', `${task.messageInbox.count} available`]], { indent: 4, clip: true }));
    });
    if (!b.tasks.length) blocks.push(T('No Tasks yet.'));
    return blocks;
  }
  gitBlocks(git, fallbackWorkspace) {
    if (!git) return [section('Current Git'), T(`Not observed for ${fallbackWorkspace}.`, 'dim')];
    return [section('Current Git', { text: `observed ${when(git.observedAt)}`, tone: 'dim' }),
      fields([['Workspace', git.workspace_path ?? fallbackWorkspace, 'dim'], ...(git.error ? [] : [['Branch', git.branch || 'Detached HEAD'], ['HEAD', git.head === null ? 'No commits yet' : git.head ?? 'not recorded', 'dim']])]),
      git.error ? T(git.error, 'warn') : T(git.status || 'Working tree clean.')];
  }
  timestampDetails(key, iso) {
    const expanded = this.expandedTimes.has(key);
    return [R(A(`time:${key}`, expanded ? 'Hide recorded time' : 'Show recorded time', () => {
      if (expanded) this.expandedTimes.delete(key); else this.expandedTimes.add(key);
    })), ...(expanded ? [fields([['Recorded ISO', iso ?? 'not recorded', 'dim']])] : [])];
  }
  taskBlocks() {
    const v = this.task; if (!v?.project) return [T('Loading Task…', 'dim')];
    const u = v.task.status_update;
    const attribution = u ? `${u.source}${u.runId ? `${this.dot}run ${short(u.runId)}` : ''}${this.dot}${when(u.updatedAt)}` : 'no assessment recorded';
    const blocks = zone('top', heading(v.task.title, { right: { text: v.task.status, tone: v.task.status === 'done' ? 'ok' : 'accent' } }),
      T(`work assessment${this.dot}${attribution}`, 'dim'), v.project.archived_at && T('Archived Project / historical inspection', 'warn'),
      tabs(['overview', 'checkpoint', 'messages', 'git'].map(tab => A(`tab:${tab}`, `${tab[0].toUpperCase()}${tab.slice(1)}${tab === 'messages' ? ' '+v.messageInbox.count : ''}`, () => this.switchTab(tab))), `tab:${this.tab}`),
      R(A('new-run', 'Start fresh Run', () => this.newRun(), Boolean(v.project.archived_at)), A('assess', 'Update work assessment', () => this.assessTask())));
    if (this.tab === 'overview') {
      const runs = [...v.recentRuns, ...(this.board?.tasks.find(t => t.id === v.task.id)?.unsettledRuns ?? [])].filter((r, i, all) => all.findIndex(x => x.id === r.id) === i);
      blocks.push(columns([
        section('Instructions'), T(v.task.instructions),
        section('Checkpoint', v.checkpoint ? { text: `agent summary${this.dot}run ${short(v.checkpoint.run_id)}${this.dot}${when(v.checkpoint.created_at)}`, tone: 'dim' } : null),
        v.checkpoint ? T(v.checkpoint.summary) : T('Not saved yet.', 'dim'),
        ...this.gitBlocks(v.currentGit, v.project.repo_path),
        T(''), T('Run ending does not change the Task assessment. A checkpoint is an Agent summary, not a test observation.', 'dim'),
      ], [
        section('Task'),
        fields([['Status', v.task.status], ['Assessed by', u ? `${u.source}${u.runId ? `${this.dot}run ${u.runId}` : ''}${this.dot}${when(u.updatedAt)}` : attribution, 'dim'], u?.note && ['Note', u.note], ['Task ID', v.task.id, 'dim'],
          ['Project', `${v.project.name}${this.dot}${short(v.project.id)}`], ['Repository', v.project.repo_path, 'dim']], { labelWidth: 11 }),
        section('Runs', `recent ${v.recentRuns.length} + unresolved`), ...runs.map(r => this.runItem(r, { compact: true })), ...(!runs.length ? [T('None yet.', 'dim')] : []),
        section('More'), R(A('open-messages', `Messages / ${v.messageInbox.count}`, () => this.switchTab('messages'))),
        R(A('controlled', 'fake_deploy decision details', () => { this.detail = JSON.stringify(v.controlled, null, 2)+'\n\nHuman CLI only: threshold decision --task '+v.task.id+' --target preview --value allow\nLocal fake deployment only; not general tool approval.'; this.setPage('detail'); })),
      ], { rightWidth: 50 }));
    } else if (this.tab === 'checkpoint') {
      const c = v.checkpoint;
      if (!c) blocks.push(T('Not saved yet.', 'dim'));
      else blocks.push(fields([['Source', `agent summary${this.dot}run ${c.run_id}`], ['Saved', when(c.created_at)]]),
        ...this.timestampDetails(`checkpoint:${v.task.id}:${c.created_at}`, c.created_at),
        R(A('checkpoint-run', 'Inspect source Run', () => this.openRun(c.run_id, true))), section('Summary'), T(c.summary),
        section('Git at checkpoint', 'historical, not current'),
        fields(Object.entries(c.git ?? {}).map(([k, val]) => [k, val === null || val === undefined ? 'not recorded' : val === '' ? '(empty)' : typeof val === 'object' ? JSON.stringify(val) : String(val)])),
        T('Use the Git tab for a fresh observation of a chosen workspace.', 'dim'));
    } else if (this.tab === 'messages') {
      blocks.push(section('Task inbox', `${v.messageInbox.count} records${this.dot}count is not unread`), T('Reads do not consume messages. Writing here does not launch or notify a Run.', 'dim'),
        ...this.retryControls(`message:${v.task.id}`),
        R(A('write-message', 'Write to Task inbox', () => this.messageEditor(), !this.connected || this.gate.uncertain.has(`message:${v.task.id}`))));
      for (const m of this.messages?.messages ?? []) {
        blocks.push(section(`#${m.id}`, { text: `${m.source}${m.from_run_id ? `${this.dot}run ${short(m.from_run_id)}` : ''}${this.dot}${when(m.created_at)}`, tone: 'dim' }), T(m.body, '', { indent: 2 }));
        blocks.push(...this.timestampDetails(`message:${v.task.id}:${m.id}`, m.created_at));
        if (m.from_run_id) blocks.push(R(A(`source:${m.id}`, 'Inspect sender Run / source Task', () => this.openRun(m.from_run_id, true))));
      }
      blocks.push(T(''), T(this.messages?.hasMore ? 'More messages available.' : 'No further messages at this observation.', 'dim'), R(
        A('messages-prev', 'Previous page', async () => { this.messageAfter = this.messageHistory.pop() ?? 0; await this.refresh(); }, !this.messageHistory.length),
        A('messages-next', 'Next page', async () => { this.messageHistory.push(this.messageAfter); this.messageAfter = this.messages.nextAfter; await this.refresh(); }, !this.messages?.hasMore)));
    } else if (this.tab === 'git') {
      const workspace = this.git?.workspace ?? v.project.repo_path;
      blocks.push(fields([['Workspace', workspace], ['Observed', this.git ? when(this.git.observedAt) : 'not observed yet', 'dim']]),
        R(A('git-root', 'Project root', () => this.showGit(v.project.repo_path)), A('git-refresh', 'Refresh selected workspace', () => this.showGit(workspace, this.gitKind)),
          A('git-diff', 'Tracked diff / staged + unstaged', () => this.showGit(workspace, 'diff')), A('git-file', 'Read file', () => {
            this.editText(`file:${workspace}`, `Read text file within ${workspace}`, '', async filename => { this.git = await workspaceFile(workspace, filename.trim()); }, { submitLabel: 'Read file' });
          })));
      const runWorkspaces = v.recentRuns.filter(r => r.workspace_path);
      if (runWorkspaces.length) blocks.push(R(...runWorkspaces.map(r => A(`git-run:${r.id}`, `Run ${short(r.id)} workspace`, () => this.showGit(r.workspace_path)))));
      blocks.push(section(this.gitKind === 'diff' ? 'Tracked diff' : 'Observation'), T(this.git ? this.git.text : 'No Git observation yet.', this.git ? '' : 'dim'),
        T(''), T('No test result observation is inferred from messages, checkpoints or exit codes.', 'dim'));
    }
    return blocks;
  }
  activityBlocks(live) {
    const g = this.glyphs;
    if (!live?.available) return [T('Live activity is unavailable in this service process. Inspect Task, checkpoint and Git.', 'warn')];
    const blocks = [];
    if (live.truncated) blocks.push(T('Earlier live activity is no longer available. This is a bounded public window.', 'warn'));
    for (const e of live.events) {
      if (e.type === 'input') blocks.push(T(''), T(`${g.user} you${this.dot}submitted input`, 'accent'), T(e.text, '', { indent: 2 }));
      else if (e.type === 'reply') blocks.push(T(''), T(`${g.agent} agent${this.dot}completed public reply`, 'strong'), T(e.text, '', { indent: 2 }));
      else if (e.type === 'tool_start') blocks.push(T(`${g.start} ${e.name}${e.context ? '  '+e.context : ''}`, 'dim', { indent: 2 }));
      else if (e.type === 'tool_end') blocks.push(T(`${g.end} ${e.name}${this.dot}${e.failed ? 'error' : 'finished'}`, e.failed ? 'error' : 'dim', { indent: 2 }));
      else blocks.push(T(e.text, e.type === 'error' ? 'error' : 'dim', { indent: 2 }));
    }
    if (!live.events.length) blocks.push(T('No public activity in the current window yet.', 'dim'));
    blocks.push(T(''), T(`${g.start} tool start${this.dot}${g.end} tool end: summaries only. Completed public replies only; no full tool results or durable transcript.`, 'dim'));
    return blocks;
  }
  runBlocks() {
    const r = this.run, live = this.live; if (!r?.task_id) return [T('Loading Run…', 'dim')];
    const phase = live?.available ? live.active ? live.phase ?? 'unavailable' : 'inactive' : null;
    const blocks = zone('top',
      heading(`${this.dot.trimStart()}${phase ? `${phase}${this.dot}live snapshot` : 'live activity unavailable'}`, { lead: this.fmt().state(r), tone: phase && live.active ? 'accent' : 'dim', right: { text: executionLabel(r.execution), tone: 'dim' } }),
      T(`${r.provider} / ${r.model} ${this.dot} ${r.workspace_path ?? 'workspace not recorded'}`, 'dim'),
      T(`Run ${r.id}${live?.available ? `${this.dot}queued ${live.queued}${this.dot}${live.resources.unsettled}/${live.resources.maxParallelRuns} home slots` : ''}`, 'dim'),
      r.error && T(r.error, 'error'),
      typeof r.exit_code === 'number' && T(`Observed exit code: ${r.exit_code}`, r.exit_code === 0 ? 'dim' : 'error'),
      r.execution?.stopReason && T(`Stop reason: ${r.execution.stopReason}`, 'dim'),
      R(A('inspect', this.page === 'inspect' ? 'Public activity' : 'Inspect / configuration', () => { this.setPage(this.page === 'inspect' ? 'run' : 'inspect'); return this.refresh(); }),
        A('detach', 'Back to Task', () => this.openTask(r.task_id)), A('new-run', 'Start fresh Run', () => this.newRun(), Boolean(this.project?.archived_at)),
        ...(active(r) ? [A('stop-run', 'Stop this Run', async () => { await this.write(`stop:${r.id}`, `/runs/${r.id}/stop`, {}); this.notice = 'Stop requested. Await exit observation; Task state unchanged.'; await this.refresh(); }, !this.connected || live?.phase === 'stopping', { tone: 'warn' })] : [])),
      ...(active(r) ? this.retryControls(`stop:${r.id}`) : []));
    if (this.page === 'inspect') blocks.push(T(display(r, { ascii: this.options.ascii, columns: this.terminal.columns })), R(A('run-git', 'Observe this Run workspace', () => this.showGit(r.workspace_path))));
    else blocks.push(...this.activityBlocks(live));
    if (active(r)) {
      const accepting = this.connected && live?.active && live.phase !== 'stopping';
      blocks.push(...zone('bottom', ...this.retryControls(`input:${r.id}`),
        T(accepting ? `Input goes to run ${short(r.id)} only${this.dot}not the Task inbox` : 'Not accepting input now (disconnected, stopping or no active live observation). Drafts are kept.', accepting ? 'dim' : 'warn'),
        R(A('input', 'Send input to this Run', () => this.runEditor(), !accepting || this.gate.uncertain.has(`input:${r.id}`), { tone: 'accent' }))));
    } else if (r.status === 'unknown') {
      blocks.push(...zone('bottom', T(r.workspace_recovery ? 'Workspace confirmed reusable; old outcome remains unknown.' : 'Unresolved exit holds a slot and workspace. Independently check the old worker.', 'warn'),
        !r.workspace_recovery && R(A('recover', 'Recover workspace occupancy', () => this.recoverRun()))));
    } else blocks.push(...zone('bottom', T(`Run ended. Task remains ${this.task.task.status}. ${this.task.checkpoint?.run_id === r.id ? 'Checkpoint saved '+when(this.task.checkpoint.created_at) : 'No latest checkpoint from this Run. Latest: '+(this.task.checkpoint ? when(this.task.checkpoint.created_at)+' / run '+short(this.task.checkpoint.run_id) : 'not saved')}`, 'dim')));
    return blocks;
  }
  createTask() {
    const projectId = this.project.id;
    this.simpleForm('task-create', 'Create Task / '+this.project.name, { title: 'Title', instructions: 'Task instructions' }, { title: '', instructions: '' }, async (d, key) => {
      if (!d.title.trim() || !d.instructions.trim()) throw new Error('Title and instructions are required.');
      const value = await this.write(key, '/tasks', { projectId, title: d.title, instructions: d.instructions }); await this.openTask(value.id);
    });
  }
  assessTask() {
    const id = this.task.task.id;
    this.simpleForm('assessment', 'Task work assessment', { status: 'in_progress or done', note: 'Assessment note' }, { status: this.task.task.status, note: '' }, async (d, key) => {
      if (!['in_progress', 'done'].includes(d.status.trim()) || !d.note.trim()) throw new Error('Use in_progress or done and a nonempty note.');
      await this.write(key, `/tasks/${id}/status`, { status: d.status.trim(), note: d.note }); this.notice = 'Work assessment recorded. No Run stopped; not a Human Decision.';
    });
  }
  recoverRun() {
    const run = this.run;
    this.simpleForm('recovery', 'Recover workspace occupancy', { note: 'Independent check evidence' }, { note: '', confirm: false }, async (d, key) => {
      if (!d.confirm || !d.note.trim()) throw new Error('Independent worker/workspace confirmation and a nonempty note are required.');
      await this.write(key, `/runs/${run.id}/recover`, { confirmReusable: true, note: d.note }); this.notice = 'Old occupancy released. Outcome remains unknown.';
    }, { key: `recover:${run.id}`, description: `Full Run ID: ${run.id}\nWorkspace: ${run.workspace_path}\nThis does not stop an old process or establish external effects.`, submitLabel: 'Record confirmation / release old occupancy' });
  }
  archiveProject() {
    const p = this.project, verb = p.archived_at ? 'restore' : 'archive';
    this.simpleForm('archive', `${verb} Project / ${p.name}`, { confirm: `Type ${verb}` }, { confirm: '' }, async (d, key) => {
      if (d.confirm.trim() !== verb) throw new Error(`Type ${verb} to select this operation.`);
      await this.write(key, `/projects/${p.id}/${verb}`, {}); this.notice = 'Project '+verb+' recorded. Files and history retained.';
    }, { description: 'Archive keeps history and files. Active/unresolved Runs must be handled first; this action does not stop them.' });
  }
  registerProject() {
    this.simpleForm('register', 'Register an existing Git root', { path: 'Absolute existing folder', name: 'Project name', init: 'Initialize if not Git? type yes (otherwise blank)' }, { path: this.cwd, name: basename(this.cwd), init: '' }, async (d, key) => {
      const folder = await realpath(resolve(this.cwd, d.path)); if (!(await stat(folder)).isDirectory()) throw new Error('Choose an existing folder.');
      if (!d.name.trim()) throw new Error('Project name is required.');
      let root;
      try { root = await realpath(await gitRead(folder, 'rev-parse', '--show-toplevel')); }
      catch { if (d.init.trim() !== 'yes') throw new Error('Not a Git root. Explicitly set initialization to yes if intended.'); await gitRead(folder, 'init'); root = await realpath(await gitRead(folder, 'rev-parse', '--show-toplevel')); }
      if (root !== folder) throw new Error(`Select repository root explicitly: ${root}`);
      const index = await this.call('/status?includeArchived=true');
      for (const p of index.projects) { if (await realpath(p.repo_path).catch(() => null) === root) { this.index = index; await this.openBoard(p.id); return; } }
      const project = await this.write(key, '/projects', { repoPath: root, name: d.name }); this.index.projects.push(project); await this.openBoard(project.id);
    });
  }
  serviceBlocks() {
    const s = this.service;
    const blocks = [...zone('top', heading('Service', { right: { text: s?.state ?? 'inspecting', tone: s?.state === 'running' ? 'ok' : 'warn' } }),
      T('Service actions affect every Project in this home. Exiting the TUI never stops workers.', 'dim'),
      R(A('service-start', 'Start service if stopped', async () => {
        const args = ['--home', this.home]; if (this.args['agent-dir']) args.push('--agent-dir', resolve(this.args['agent-dir']));
        this.notice = 'Starting service…'; this.render();
        await startBackground(fileURLToPath(new URL('./cli.mjs', import.meta.url)), args, this.home); await this.refresh();
      }, s?.state !== 'stopped'), A('service-stop', 'Stop service + managed workers', () => {
        this.simpleForm('service-stop', 'Stop service and ALL managed workers', { confirm: 'Type stop service' }, { confirm: '' }, async (d, key) => {
          if (d.confirm.trim() !== 'stop service') throw new Error('Type stop service to confirm the scope.');
          await this.write(key, '/shutdown', {}); this.notice = 'Service shutdown requested. Project data retained.';
        }, { description: `Home: ${this.home}\nThis affects all Projects in this service home.` });
      }, !this.connected, { tone: 'warn' }))),
      T(s ? display(s, { home: this.home, ascii: this.options.ascii }) : 'Inspect service…')];
    const runs = this.index.unresolvedRuns ?? [];
    if (runs.length) blocks.push(section('Unresolved Runs', { text: 'service slots held', tone: 'warn' }),
      ...runs.map(r => this.unresolvedItem(r, 'Unresolved workspace; holds a service slot.')));
    return blocks;
  }
  commandBlocks() {
    const target = this.task?.project ? `${this.task.project.name} / ${this.task.task.title}` : null;
    return [...zone('top', heading('Commands', { right: { text: 'explicit targets', tone: 'dim' } })),
      item('projects', 'Projects', () => { this.setPage('projects'); return this.refresh(); }, { lines: ['All Projects in this home, including archived.'] }),
      item('lookup', 'Open Task or Run by ID', () => this.simpleForm('lookup', 'Open by unique ID prefix', { kind: 'task or run', id: 'ID / unique prefix' }, { kind: 'run', id: '' }, async d => {
        if (!['run', 'task'].includes(d.kind.trim())) throw new Error('Choose task or run.');
        const id = await resolveId(this.call, d.kind.trim(), d.id.trim(), this.project?.id);
        if (d.kind.trim() === 'run') await this.openRun(id); else await this.openTask(id);
      }, { write: false, submitLabel: 'Open' }), { lines: ['Unique hexadecimal prefix; scoped to the current Project when one is selected.'] }),
      item('new', 'Start fresh Run', () => this.newRun(), { disabled: !this.task?.project || Boolean(this.project?.archived_at), lines: [target ? `Target Task: ${target}` : 'Select a Task first.'] }),
      item('service', 'Service', () => { this.setPage('service'); return this.refresh(); }, { lines: ['Home, address, capacity, unresolved occupancy; explicit start / stop.'] }),
      item('help', 'Keyboard / mouse / limitations', () => { this.detail = 'Tab / Shift+Tab or arrows: select; Tab at the edge of an area moves to the next area. Enter: activate.\nMouse: click actions, wheel to scroll, drag prose to select/copy.\nCtrl+P or / outside editors: commands. Ctrl+R: refresh. Esc: back.\nEditor: Enter inserts newline; Ctrl+S or explicit button submits; Ctrl+Enter where supported. Tab moves to buttons; Esc keeps draft.\nCtrl+C / Quit: leave UI only; never stop Run/service.\nPageUp/PageDown scroll. Ctrl+Shift+F searches the scrolling document (fixed header/footer areas are not searched).\n--no-mouse disables mouse capture; --no-color and --ascii supported.\n\nDrafts are in this TUI process only; exiting loses unsent drafts.\nLive window is bounded and unavailable after service restart.\nNo token streaming, full tool output, automatic test verification or durable transcript.\nGit/file reads are on demand and tied to a workspace.\nTimes are local wall-clock renderings; raw ISO values remain in Inspect and CLI --json.\nProvider setup remains threshold setup; no credentials are shown here.'; this.setPage('detail'); }),
      item('quit', 'Quit view', () => this.close(), { lines: ['Leaves the UI only. Workers and the service keep running.'] })];
  }
  blocks() {
    if (this.form) return this.formBlocks();
    if (this.page === 'board') return this.boardBlocks();
    if (this.page === 'task') return this.taskBlocks();
    if (['run', 'inspect'].includes(this.page)) return this.runBlocks();
    if (this.page === 'service') return this.serviceBlocks();
    if (this.page === 'commands') return this.commandBlocks();
    if (this.page === 'detail') return [T(this.detail ?? ''), R(A('back', 'Back to Task / Board', () => this.back()))];
    return this.projectBlocks();
  }
  crumbs() {
    const p = this.project, t = this.task?.task, strong = text => ({ text, tone: 'strong' });
    const toProjects = { ...A('crumb:projects', 'Projects', () => { this.setPage('projects'); return this.refresh(); }) };
    const toBoard = p && A('crumb:board', p.name, () => this.openBoard(p.id)), toTask = t?.title && A('crumb:task', t.title, () => this.openTask(t.id));
    if (this.page === 'board') return [toProjects, strong(p?.name ?? 'Board')];
    if (this.page === 'task') return [toProjects, toBoard, strong(t?.title ?? 'Task')].filter(Boolean);
    if (['run', 'inspect'].includes(this.page)) return [toProjects, toBoard, toTask, strong(`run ${short(this.run?.id)}${this.page === 'inspect' ? `${this.dot}inspect` : ''}`)].filter(Boolean);
    if (this.page === 'detail') return [toProjects, toBoard, toTask, strong('Detail')].filter(Boolean);
    return [strong({ service: 'Service', commands: 'Commands' }[this.page] ?? 'Projects')];
  }
  hints() {
    const hints = this.edit ? [`ctrl+s ${this.edit.submitLabel.toLowerCase()}`, 'enter newline', 'tab buttons', 'esc keep draft', 'ctrl+c quit UI']
      : ['enter open', 'esc back', this.options.ascii ? 'tab/arrows select' : 'tab/↑↓ select', '/ commands', 'ctrl+r refresh', 'ctrl+c quit UI'];
    return hints.join(this.options.ascii ? '  ' : this.dot);
  }
  preferredZone(zones) {
    if (!this.form && this.page === 'run' && zones.includes(this.bottom)) return this.bottom;
    if (!this.form && this.page === 'task' && zones.includes(this.top)) return this.top;
    return [this.doc, this.top, this.bottom].find(z => zones.includes(z));
  }
  focusStep(from, step) {
    const zones = this.zones ?? [];
    if (zones.length < 2 || !zones.includes(from)) return false;
    const next = zones[(zones.indexOf(from) + step + zones.length) % zones.length];
    next.selected = step > 0 ? next.actions[0].id : next.actions.at(-1).id;
    this.tui.setFocus(next); next.onMove?.(next.hits.find(h => h.action.id === next.selected)?.y ?? 0); this.tui.requestRender();
    return true;
  }
  render() {
    if (this.closed) return;
    const columns = this.terminal.columns || 80, rows = this.terminal.rows || 24;
    const connection = this.page === 'service' && this.service ? { text: `service ${this.service.state}${this.dot}read ${clock(this.lastRead)}`, short: this.service.state, tone: this.service.state === 'running' ? 'dim' : 'warn' }
      : this.connected ? { text: `connected${this.dot}read ${clock(this.lastRead)}`, short: clock(this.lastRead), tone: 'dim' } : { text: `! offline${this.dot}last read ${clock(this.lastRead)}`, short: '! offline', tone: 'warn' };
    this.bar.setBlocks([bar([{ text: 'threshold', tone: 'focus' }, ...this.crumbs()], [connection])]);
    this.bar.inert = Boolean(this.edit);
    const resources = this.board?.resources ?? (this.live?.available ? this.live.resources : null);
    this.footer.setBlocks([bar([{ text: this.hints(), tone: 'dim' }], resources ? [{ text: `home slots ${resources.unsettled}/${resources.maxParallelRuns}`, tone: resources.unsettled >= resources.maxParallelRuns ? 'warn' : 'dim' }] : [])]);
    const notes = [this.gate.pending && T('Submitting one write… do not repeat. Closing may leave the result unconfirmed.', 'warn'),
      this.error && T(this.error, 'error'), this.notice && T(this.notice, 'accent')].filter(Boolean);
    const all = this.blocks();
    let top = all.filter(b => b.zone === 'top'), main = all.filter(b => !b.zone), bottom = all.filter(b => b.zone === 'bottom');
    // While editing, the page stays visible as inert context; its own composer controls would duplicate the editor.
    if (this.edit) { main = [...top, ...main]; top = []; bottom = []; }
    else top.push(...notes);
    // Fixed areas keep identity and targets visible; on short or narrow terminals they scroll with the page instead.
    const height = blocks => { if (!blocks.length) return 0; this.measure.setBlocks(blocks); return this.measure.render(columns).length + 1; };
    if (height(top) + height(bottom) > Math.max(4, Math.floor(rows * 0.4))) { main = [...top, ...main, ...bottom]; top = []; bottom = []; }
    this.top.setBlocks(top.length ? [...top, rule()] : []);
    this.bottom.setBlocks(bottom.length ? [rule(), ...bottom] : []);
    this.doc.inert = Boolean(this.edit);
    this.doc.setBlocks(main.length ? main : [T('')]);
    if (this.restoreSelection && this.doc.has(this.restoreSelection)) { this.doc.selected = this.restoreSelection; this.restoreSelection = null; }
    const entries = [{ component: this.bar, basis: 'auto', maxSize: 2 }];
    if (top.length) entries.push({ component: this.top, basis: 'auto' });
    entries.push({ component: this.scroll, basis: 0, grow: 1, minSize: 2 });
    if (this.edit) {
      this.editorHead.setBlocks([rule(), T(this.edit.title, 'accent'), ...notes]);
      this.editorActions.setBlocks([...this.retryControls(this.edit.key), R(A('edit:save', this.edit.submitLabel, () => this.saveEdit(), this.edit.send && (!this.connected || this.gate.uncertain.has(this.edit.key))),
        A('edit:cancel', 'Back / keep draft', () => { this.edit = null; this.focusReset = true; this.tui.setFocus(this.doc); }))]);
      entries.push({ component: this.editorHead, basis: 'auto', maxSize: 6 }, { component: this.editor, basis: 'auto', minSize: 3, maxSize: Math.max(5, Math.floor(rows * 0.45)) },
        { component: this.editorActions, basis: 'auto', minSize: 1 });
    } else if (bottom.length) entries.push({ component: this.bottom, basis: 'auto' });
    entries.push({ component: this.footer, basis: 'auto', maxSize: 1 });
    this.tui.setLayoutRoot(new VStack(entries));
    if (!this.edit) {
      this.zones = [top.length && this.top, this.doc, bottom.length && this.bottom].filter(z => z && z.actions.length);
      const focused = this.tui.getFocusedComponent();
      if (this.focusReset || !this.zones.includes(focused)) {
        const preferred = this.preferredZone(this.zones);
        if (preferred) { if (focused !== preferred) this.tui.setFocus(preferred); this.focusReset = false; }
        else if (focused !== this.doc) this.tui.setFocus(this.doc);
      }
    }
    this.tui.requestRender();
  }
  async back() {
    if (this.edit) { this.edit = null; this.focusReset = true; this.tui.setFocus(this.doc); return; }
    if (this.form) { this.form = this.form.parent ?? null; this.focusReset = true; return; }
    if (['run', 'inspect', 'detail'].includes(this.page) && this.task?.project) await this.openTask(this.task.task.id);
    else if (this.project && this.page !== 'board') await this.openBoard(this.project.id);
    else { this.setPage('projects'); await this.refresh(); }
  }
  input(data) {
    if (isKeyRelease(data)) return { consume: true };
    if (matchesKey(data, 'ctrl+c')) { this.close(); return { consume: true }; }
    if (this.gate.pending || this.actionPending) return { consume: true };
    if (matchesKey(data, 'escape')) { this.invoke(() => this.back()); return { consume: true }; }
    if (this.edit) {
      if (matchesKey(data, 'ctrl+s') || matchesKey(data, 'ctrl+enter')) { this.invoke(() => this.saveEdit()); return { consume: true }; }
      if (matchesKey(data, 'tab') || matchesKey(data, 'shift+tab')) {
        const focus = this.tui.getFocusedComponent();
        if (focus === this.editor) this.tui.setFocus(this.editorActions);
        else if (focus === this.editorActions && this.editorActions.selected === this.editorActions.actions.at(-1)?.id) this.tui.setFocus(this.editor);
        else this.editorActions.handleInput(data);
        this.render(); return { consume: true };
      }
      return;
    }
    if (matchesKey(data, 'ctrl+p') || data === '/') { this.setPage('commands'); return { consume: true }; }
    if (matchesKey(data, 'ctrl+r')) { this.invoke(() => this.refresh()); return { consume: true }; }
    return;
  }
}

export async function startTui(options) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || options.args?.json || process.env.TERM === 'dumb')
    throw new Error('threshold tui requires an interactive VT terminal (not --json / TERM=dumb). Use threshold status or board for scripts.');
  await new ThresholdTui(options).start();
}
