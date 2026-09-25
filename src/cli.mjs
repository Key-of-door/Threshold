#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, join, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { homedir } from 'node:os';
import { git } from './git.mjs';
import { defaultHome, display, help, commandNames } from './cli-display.mjs';
import { terminalOptions, displayError } from './cli-format.mjs';
import { prompts } from './cli-input.mjs';
import { readServiceInfo, serviceState, startBackground } from './service-process.mjs';
import { runSettings } from './run-settings.mjs';
import { executionSettings } from './execution.mjs';

const fullId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
async function main() {
  let args, commands;
  const report = error => {
    console.error(args?.json || (!args && process.argv.includes('--json')) ? String(error.message ?? error)
      : displayError(error, terminalOptions(process.stderr, args)));
    if (process.connected) process.send({ error: String(error.message ?? error) }, () => {});
  };
  try {
    ({ values: args, positionals: commands } = parseArgs({ allowPositionals: true, options: {
      ...Object.fromEntries(['home', 'agent-dir', 'port', 'name', 'repo', 'project', 'title', 'instructions', 'instructions-file', 'task', 'provider', 'model', 'run', 'target', 'value', 'objective', 'status', 'note', 'body', 'body-file', 'after', 'limit', 'workspace', 'max-parallel-runs', 'max-runs', 'thinking', 'context-window', 'max-output-tokens', 'turn-timeout'].map(key => [key, { type: 'string' }])),
      skill: { type: 'string', multiple: true }, extension: { type: 'string', multiple: true },
      ...Object.fromEntries(['summary', 'json', 'all', 'include-archived', 'help', 'version', 'ascii', 'no-color', 'attach', 'confirm-reusable', 'init-git'].map(key => [key, { type: 'boolean' }])) } }));
  } catch (error) { report(`${error.message}\nRun threshold --help.`); return 1; }
  if (args.version) { console.log(`threshold ${JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version}`); return 0; }
  const runPosition = commands[0] === 'run' && ['stop', 'attach', 'recover'].includes(commands[1]) && commands.length === 3 ? commands.pop() : undefined;
  const projectPosition = commands[0] === 'project' && ['archive', 'restore'].includes(commands[1]) && commands.length === 3 ? commands.pop() : undefined;
  const command = commands.join(' ');
  let turnTimeoutSeconds;
  if (args['turn-timeout'] !== undefined) {
    try {
      if (command !== 'run') throw new Error('--turn-timeout applies only to a new background Run: threshold run.');
      if (!/^(0|[1-9][0-9]*)$/.test(args['turn-timeout'])) throw new Error('--turn-timeout requires integer seconds (0 disables the deadline)');
      turnTimeoutSeconds = Number(args['turn-timeout']);
      executionSettings(Boolean(args.attach), turnTimeoutSeconds);
    } catch (error) { report(error); return 1; }
  }
  let modelSettings;
  if (['thinking', 'context-window', 'max-output-tokens'].some(key => args[key] !== undefined)) {
    if (command !== 'run') { report('Model settings apply only to a new Run: threshold run.'); return 1; }
    try {
      const number = key => {
        if (args[key] === undefined) return undefined;
        if (!/^[1-9][0-9]*$/.test(args[key])) throw new Error(`--${key} requires a positive integer token count`);
        return Number(args[key]);
      };
      modelSettings = runSettings({ thinking: args.thinking, contextWindow: number('context-window'), maxOutputTokens: number('max-output-tokens') });
    } catch (error) { report(error); return 1; }
  }
  const presentation = { ...terminalOptions(process.stdout, args), version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version, home: args.home && resolve(args.home) };
  if (!command || args.help) { console.log(help(command, presentation)); return command && !commandNames.includes(command) && !['project', 'task', 'message', 'service'].includes(command) ? 1 : 0; }
  if (command === 'stop') { report('Choose what to stop: threshold run stop ID, or threshold service stop. No action taken.'); return 1; }
  if (!commandNames.includes(command)) { report(help(command)); return 1; }
  const home = resolve(args.home ?? defaultHome());
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY && !args.json);
  const ui = () => prompts();
  const agentDir = () => resolve(args['agent-dir'] ?? readServiceInfo(home)?.agentDir ?? join(homedir(), '.pi', 'agent'));
  let unregisteredRepo;
  const print = value => console.log(args.json ? JSON.stringify(value, null, 2) : display(value, { ...presentation, unregisteredRepo,
    agentDir: args['agent-dir'] ?? join(homedir(), '.pi', 'agent') }));
  const required = key => { if (!args[key]?.trim()) throw new Error(`Missing --${key}. Run threshold ${command} --help.`); return args[key]; };
  const textInput = key => {
    if (args[key] !== undefined && args[`${key}-file`] !== undefined) throw new Error(`Choose --${key} or --${key}-file, not both.`);
    if (!args[`${key}-file`]) return required(key);
    try { return readFileSync(resolve(args[`${key}-file`]), 'utf8'); }
    catch { throw new Error(`Cannot read --${key}-file: ${resolve(args[`${key}-file`])}. Check the path and permissions.`); }
  };
  async function call(path, data, human = false, signal) {
    let info;
    try { info = JSON.parse(readFileSync(join(home, 'server.json'), 'utf8')); }
    catch { throw Object.assign(new Error(`No readable service address at ${home}. Start threshold service start (background) or threshold serve (foreground) with the same home.`), { cliHome: home }); }
    const headers = { 'content-type': 'application/json' };
    if (human) {
      try { headers.authorization = `Bearer ${readFileSync(join(home, 'human.key'), 'utf8').trim()}`; }
      catch { throw new Error(`Cannot read Human client credential in ${home}. Check service setup and file access.`); }
    }
    let response;
    try { response = await fetch(new URL(path, info.url), { method: data === undefined ? 'GET' : 'POST', headers,
      body: data === undefined ? undefined : JSON.stringify(data), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(60000) }); }
    catch { throw new Error(`Could not reach the service for ${home}, or the request timed out. Run threshold service status. ${data === undefined ? 'No state change was requested.' : 'Outcome is unconfirmed: inspect status before repeating the action.'}`); }
    let result;
    try { result = await response.json(); } catch { throw new Error('Service returned an unreadable response. Inspect status before repeating a write.'); }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error}`);
    return result;
  }
  async function lookup(kind, value, projectId) {
    if (typeof value !== 'string' || !/^[0-9a-f-]{1,36}$/i.test(value)) throw new Error(`Provide a ${kind} ID or hexadecimal prefix; see threshold status --all.`);
    const query = new URLSearchParams({ kind, prefix: value.toLowerCase(), ...(projectId ? { projectId } : {}) });
    const { matches, hasMore } = await call(`/lookup?${query}`);
    if (matches.length === 1 && !hasMore) return matches[0].id;
    if (!matches.length) throw new Error(`No ${kind} matches '${value}'${projectId ? ' in the selected Project' : ''}. Use threshold status --all to check IDs.`);
    throw new Error(`Ambiguous ${kind} '${value}'. Use more of the ID:\n${matches.map(row => `  ${row.id}  ${row.label ?? ''}`).join('\n')}${hasMore ? '\n  More matches exist.' : ''}`);
  }
  let projectSelection;
  const explicitProject = () => projectSelection ??= args.project ? lookup('project', args.project) : Promise.resolve(undefined);
  async function entity(kind, value) {
    const scope = await explicitProject();
    if (fullId.test(value ?? '') && !scope) return value.toLowerCase();
    return lookup(kind, value, scope);
  }
  const rootOf = path => {
    try { return realpathSync(git(resolve(path), 'rev-parse', '--show-toplevel')); }
    catch { throw new Error(`Not a readable Git repository: ${resolve(path)}. Enter a Git repository or use --repo PATH.`); }
  };
  async function currentProject(optional = false) {
    const explicit = await explicitProject(); if (explicit) return explicit;
    let root;
    try { root = rootOf('.'); } catch (error) { if (optional) return undefined; throw error; }
    const { projects } = await call('/status?includeArchived=true');
    const matches = projects.filter(project => {
      try { return realpathSync(project.repo_path) === root; } catch { return false; }
    });
    if (!matches.length) {
      const common = git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir');
      for (const project of projects) {
        try { if (realpathSync(git(project.repo_path, 'rev-parse', '--path-format=absolute', '--git-common-dir')) === realpathSync(common)) matches.push(project); } catch {}
      }
    }
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) throw new Error(`Multiple Projects match this repository. Use --project ID:\n${matches.map(p => `  ${p.id}  ${p.name}`).join('\n')}`);
    if (optional) { unregisteredRepo = root; return undefined; }
    throw new Error(`No Project registered for ${root}. Run threshold project create.`);
  }
  async function chooseProject(activeOnly = false) {
    const current = await currentProject(true); if (current && !activeOnly) return current;
    const { projects } = await call('/status');
    if (current) {
      if (!projects.some(p => p.id === current)) throw new Error(`Project is archived. Run threshold project restore ${current} before starting new work.`);
      return current;
    }
    if (!projects.length) throw new Error('No active Projects. Use threshold status --all --include-archived to find archived history, or threshold project create --repo "ABSOLUTE_PATH" to register a folder.');
    return ui().choose('Project', projects.map(p => ({ id: p.id, label: `${p.name} / ${p.repo_path}` })));
  }
  try {
    if (args.json && args.summary) throw new Error('Choose --json or --summary, not both.');
    if (args.attach && command !== 'run') throw new Error('--attach is a Run startup option. To connect later: threshold run attach ID.');
    if (args['include-archived'] && command !== 'status') throw new Error('--include-archived is a status option. Use threshold status --all --include-archived.');
    const attach = async id => {
      const { attachRun } = await import('./cli-attach.mjs');
      return attachRun({ id, call, options: { ...presentation, json: args.json,
        redraw: presentation.tty && process.env.TERM !== 'dumb' } });
    };
    const boardDisplay = async project => {
      const value = await call(`/projects/${project}/board`);
      const interactions = {};
      if (!args.json) for (const task of value.tasks) for (const run of task.unsettledRuns ?? []) {
        try { const live = await call(`/runs/${run.id}/live`); if (live.active) interactions[run.id] = live.phase; } catch {}
      }
      if (args.json) print(value);
      else console.log(display(value, { ...presentation, interactions }));
    };
    if (command === 'setup') {
      if (!interactive) throw new Error('threshold setup requires an interactive terminal; it never reads API keys from flags or pipes. Existing Pi configuration and environment variables remain supported.');
      const { setupModels } = await import('./pi-config.mjs');
      await setupModels(agentDir(), ui());
      console.log(`\nNext: threshold service start${agentDir() !== join(homedir(), '.pi', 'agent') ? ` --agent-dir "${agentDir()}"` : ''}${args.home ? ` --home "${home}"` : ''}`);
    } else if (command === 'service start') {
      const forwarded = ['--home', home];
      for (const key of ['agent-dir', 'port', 'max-parallel-runs', 'max-runs']) if (args[key] !== undefined) forwarded.push(`--${key}`, args[key]);
      const state = await startBackground(fileURLToPath(import.meta.url), forwarded, home);
      print(state);
    } else if (command === 'service status') {
      const state = await serviceState(home);
      print(state);
    } else if (command === 'serve') {
      const port = Number(args.port ?? 8765);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid --port: use 0 through 65535.');
      const { startService } = await import('./service.mjs');
      const service = await startService({ home, port, agentDir: args['agent-dir'] ?? join(homedir(), '.pi', 'agent'),
        maxParallelRuns: Number(args['max-parallel-runs'] ?? 3), maxRuns: Number(args['max-runs'] ?? 100) });
      print({ listening: service.url, home });
      if (process.connected) process.send({ ready: { url: service.url, agentDir: service.agentDir, pid: process.pid } }, () => {});
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { service.close().catch(() => { process.exitCode = 1; }); });
    } else if (command === 'project create') {
      let requested = args.repo;
      if (!requested && interactive) requested = await ui().ask('Project folder (absolute path)', { fallback: process.cwd(), required: true });
      if (requested && !args.repo && !isAbsolute(requested)) throw new Error('Enter an absolute project folder path.');
      const folder = resolve(requested ?? '.');
      try { if (!statSync(folder).isDirectory()) throw new Error(); }
      catch { throw new Error(`Project folder does not exist or is not a directory: ${folder}. Create the folder first.`); }
      let repoPath;
      try { repoPath = rootOf(folder); }
      catch {
        // Check Git itself before offering initialization; never turn missing Git into a misleading question.
        try { git(folder, '--version'); } catch { throw new Error('Git is not available. Install Git, then retry project creation.'); }
        if (!(args['init-git'] || (interactive && await ui().confirm(`Initialize Git in ${folder}?`))))
          throw new Error(`No Git repository in ${folder}. Use git init there, or project create --repo "${folder}" --init-git.`);
        git(folder, 'init'); repoPath = rootOf(folder);
      }
      if (requested && repoPath !== realpathSync(folder)) throw new Error(`This folder belongs to the parent Git repository ${repoPath}. Select that root explicitly; no Project was created.`);
      const { projects } = await call('/status?includeArchived=true');
      const existing = projects.find(p => { try { return realpathSync(p.repo_path) === repoPath; } catch { return false; } });
      print(existing ?? await call('/projects', { name: args.name ?? basename(repoPath), repoPath }));
    } else if (command === 'project archive' || command === 'project restore') {
      if (projectPosition && args.project) throw new Error(`Specify the Project once: threshold ${command} ID or --project ID.`);
      const project = await lookup('project', projectPosition ?? required('project'));
      print(await call(`/projects/${project}/${command.split(' ')[1]}`, {}));
    } else if (command === 'board') await boardDisplay(interactive ? await chooseProject() : await currentProject());
    else if (command === 'task create') {
      if (interactive) {
        args.title ??= await ui().ask('Task title', { required: true });
        if (args.instructions === undefined && args['instructions-file'] === undefined) args.instructions = await ui().ask('What should this task accomplish?', { required: true });
      }
      const title = required('title'), instructions = textInput('instructions');
      print(await call('/tasks', { projectId: interactive ? await chooseProject(true) : await currentProject(), title, instructions }));
    } else if (command === 'task update') {
      const task = required('task'), status = required('status'), note = required('note');
      print(await call(`/tasks/${await entity('task', task)}/status`, { status, note }));
    } else if (command === 'message send') {
      const task = required('task'), body = textInput('body');
      print(await call(`/tasks/${await entity('task', task)}/messages`, { body }));
    } else if (command === 'message read') print(await call(`/tasks/${await entity('task', required('task'))}/messages?after=${encodeURIComponent(args.after ?? '0')}&limit=${encodeURIComponent(args.limit ?? '10')}`));
    else if (command === 'status') {
      if ((args.task && args.run) || (args.all && (args.task || args.run || args.project))) throw new Error('Choose --task or --run; --all cannot be combined with a selection.');
      if (args['include-archived'] && (args.task || args.run || args.project)) throw new Error('--include-archived is for the Project index. Selected IDs already include archived history.');
      if (args.task) print(await call(`/tasks/${await entity('task', args.task)}`));
      else if (args.run) print(await call(`/runs/${await entity('run', args.run)}`));
      else {
        const project = args.all || args['include-archived'] ? undefined : await currentProject(true);
        if (project) await boardDisplay(project); else print(await call(args['include-archived'] ? '/status?includeArchived=true' : '/status'));
      }
    } else if (command === 'run') {
      const guided = interactive && (!args.task || !args.provider || !args.model);
      if (!args.task && interactive) {
        const project = await chooseProject(true);
        const { tasks } = await call('/status');
        const choices = tasks.filter(t => t.project_id === project);
        if (!choices.length) throw new Error('No Tasks in this Project. Run threshold task create first.');
        args.task = await ui().choose('Task', choices.map(t => ({ id: t.id, label: `${t.title} / ${t.status} / ${t.id.slice(0, 8)}` })));
      }
      required('task'); // Keep non-interactive missing-flag behavior; no hidden prompts or inference.
      if (interactive && (!args.provider || !args.model)) {
        let catalog;
        try { catalog = await call('/models'); }
        catch (error) {
          if (/^HTTP 404:/.test(error.message)) throw new Error('The running service is older than this model chooser. Finish or stop its workers, then stop the service and start it using the updated CLI. Project data is retained.');
          throw error;
        }
        const providers = [...new Set(catalog.models.map(m => m.provider))].sort();
        const configured = providers.filter(p => catalog.models.some(m => m.provider === p && m.configured));
        args.provider ??= await ui().choose('Provider', configured.length
          ? [...configured.map(id => ({ id, label: id })), { id: '__other__', label: 'Another provider (enter its Pi provider name)' }]
          : providers.map(id => ({ id, label: id })), catalog.defaultProvider);
        if (args.provider === '__other__') args.provider = await ui().ask('Pi provider name', { required: true });
        args.model ??= await ui().choose('Model', catalog.models.filter(m => m.provider === args.provider).map(m => ({ id: m.id,
          label: `${m.id}${m.configured === false ? ' / credential missing' : m.configured === null ? ' / credential checked at start' : ''}` })), catalog.defaultProvider === args.provider ? catalog.defaultModel : undefined);
      }
      if (guided) {
        args.objective ??= await ui().ask('This Run objective (optional)');
        if (!args.skill) { const path = await ui().ask('Skill path (optional; Enter for none)'); if (path) args.skill = [path]; }
        if (!args.extension) { const path = await ui().ask('Extension path (optional; Enter for none)'); if (path) args.extension = [path]; }
      }
      const task = required('task'), provider = required('provider'), model = required('model');
      const run = await call(`/tasks/${await entity('task', task)}/runs`, { provider, model, objective: args.objective,
        modelSettings, turnTimeoutSeconds,
        interactive: Boolean(args.attach), workspacePath: args.workspace && resolve(args.workspace), skills: args.skill?.map(path => resolve(path)), extensions: args.extension?.map(path => resolve(path)) });
      if (args.attach) await attach(run.id); else print(run);
    } else if (command === 'run attach') {
      if (runPosition && args.run) throw new Error('Specify the Run once: run attach ID or run attach --run ID.');
      await attach(await entity('run', runPosition ?? required('run')));
    } else if (command === 'run stop') {
      if (runPosition && args.run) throw new Error('Specify the Run once: run stop ID or run stop --run ID.');
      print(await call(`/runs/${await entity('run', runPosition ?? required('run'))}/stop`, {}));
    } else if (command === 'run recover') {
      if (runPosition && args.run) throw new Error('Specify the Run once: run recover ID or run recover --run ID.');
      const selected = runPosition ?? required('run');
      if (!args['confirm-reusable']) throw new Error('No recovery requested. Independently check that the old worker is gone and the workspace is reusable, then use --confirm-reusable --note TEXT. The old outcome and external effects remain unknown.');
      const resolved = await entity('run', selected);
      if (!args.json) console.log(`Recovery target: ${resolved}`);
      print(await call(`/runs/${resolved}/recover`, { confirmReusable: true, note: required('note') }));
    } else if (command === 'service stop') {
      if (args.run || args.task) throw new Error('service stop stops the whole service. To stop one worker: threshold run stop ID.');
      const state = await serviceState(home);
      if (state.state === 'stopped' || state.state === 'stale') {
        if (args.json) print({ shuttingDown: false, state: state.state, home });
        else console.log(`Service is not running. Project data is retained.${state.state === 'stale' ? '\nOld runtime markers remain; inspect threshold service status before restarting.' : ''}`);
      } else {
        const result = await call('/shutdown', {});
        // Normal stop/start in one terminal should not accidentally reuse a closing service.
        const deadline = Date.now() + 15000;
        while (state.pid && readServiceInfo(home)?.pid === state.pid && Date.now() < deadline) await delay(50);
        print(result);
      }
    } else if (command === 'decision') {
      const task = required('task'), target = required('target'), decision = required('value');
      print(await call('/human/decisions', { taskId: await entity('task', task), target, decision }, true));
    }
  } catch (error) { report(error); return 1; }
  return 0;
}
process.exitCode = await main();
