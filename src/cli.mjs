#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { homedir } from 'node:os';
import { git } from './git.mjs';
import { defaultHome, display, help, commandNames } from './cli-display.mjs';
import { terminalOptions, displayError } from './cli-format.mjs';

const fullId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
async function main() {
  let args, commands;
  const report = error => console.error(args?.json || (!args && process.argv.includes('--json')) ? String(error.message ?? error)
    : displayError(error, terminalOptions(process.stderr, args)));
  try {
    ({ values: args, positionals: commands } = parseArgs({ allowPositionals: true, options: {
      ...Object.fromEntries(['home', 'agent-dir', 'port', 'name', 'repo', 'project', 'title', 'instructions', 'instructions-file', 'task', 'provider', 'model', 'run', 'target', 'value', 'objective', 'status', 'note', 'body', 'body-file', 'after', 'limit', 'workspace', 'max-parallel-runs', 'max-runs'].map(key => [key, { type: 'string' }])),
      skill: { type: 'string', multiple: true }, extension: { type: 'string', multiple: true },
      ...Object.fromEntries(['summary', 'json', 'all', 'help', 'version', 'ascii', 'no-color', 'attach', 'confirm-reusable'].map(key => [key, { type: 'boolean' }])) } }));
  } catch (error) { report(`${error.message}\nRun threshold --help.`); return 1; }
  if (args.version) { console.log(`threshold ${JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version}`); return 0; }
  const runPosition = commands[0] === 'run' && ['stop', 'attach', 'recover'].includes(commands[1]) && commands.length === 3 ? commands.pop() : undefined;
  const command = commands.join(' ');
  const presentation = { ...terminalOptions(process.stdout, args), version: JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version, home: args.home && resolve(args.home) };
  if (!command || args.help) { console.log(help(command, presentation)); return command && !commandNames.includes(command) && !['project', 'task', 'message', 'service'].includes(command) ? 1 : 0; }
  if (command === 'stop') { report('Choose what to stop: threshold run stop ID, or threshold service stop. No action taken.'); return 1; }
  if (!commandNames.includes(command)) { report(help(command)); return 1; }
  const home = resolve(args.home ?? defaultHome());
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
    catch { throw Object.assign(new Error(`No readable service address at ${home}. Start threshold serve with the same home; use --home PATH for an older data directory.`), { cliHome: home }); }
    const headers = { 'content-type': 'application/json' };
    if (human) {
      try { headers.authorization = `Bearer ${readFileSync(join(home, 'human.key'), 'utf8').trim()}`; }
      catch { throw new Error(`Cannot read Human client credential in ${home}. Check service setup and file access.`); }
    }
    let response;
    try { response = await fetch(new URL(path, info.url), { method: data === undefined ? 'GET' : 'POST', headers,
      body: data === undefined ? undefined : JSON.stringify(data), redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(60000) }); }
    catch { throw new Error(`Could not reach the service for ${home}, or the request timed out. Check the serve terminal. ${data === undefined ? 'No state change was requested.' : 'Outcome is unconfirmed: inspect status before repeating the action.'}`); }
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
    const { projects } = await call('/status');
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
  try {
    if (args.json && args.summary) throw new Error('Choose --json or --summary, not both.');
    if (args.attach && command !== 'run') throw new Error('--attach is a Run startup option. To connect later: threshold run attach ID.');
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
    if (command === 'serve') {
      const port = Number(args.port ?? 8765);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid --port: use 0 through 65535.');
      const { startService } = await import('./service.mjs');
      const service = await startService({ home, port, agentDir: args['agent-dir'] ?? join(homedir(), '.pi', 'agent'),
        maxParallelRuns: Number(args['max-parallel-runs'] ?? 3), maxRuns: Number(args['max-runs'] ?? 100) });
      print({ listening: service.url, home });
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { service.close().catch(() => { process.exitCode = 1; }); });
    } else if (command === 'project create') {
      const repoPath = rootOf(args.repo ?? '.');
      const { projects } = await call('/status');
      const existing = projects.find(p => { try { return realpathSync(p.repo_path) === repoPath; } catch { return false; } });
      print(existing ?? await call('/projects', { name: args.name ?? basename(repoPath), repoPath }));
    } else if (command === 'board') await boardDisplay(await currentProject());
    else if (command === 'task create') {
      const title = required('title'), instructions = textInput('instructions');
      print(await call('/tasks', { projectId: await currentProject(), title, instructions }));
    } else if (command === 'task update') {
      const task = required('task'), status = required('status'), note = required('note');
      print(await call(`/tasks/${await entity('task', task)}/status`, { status, note }));
    } else if (command === 'message send') {
      const task = required('task'), body = textInput('body');
      print(await call(`/tasks/${await entity('task', task)}/messages`, { body }));
    } else if (command === 'message read') print(await call(`/tasks/${await entity('task', required('task'))}/messages?after=${encodeURIComponent(args.after ?? '0')}&limit=${encodeURIComponent(args.limit ?? '10')}`));
    else if (command === 'status') {
      if ((args.task && args.run) || (args.all && (args.task || args.run || args.project))) throw new Error('Choose --task or --run; --all cannot be combined with a selection.');
      if (args.task) print(await call(`/tasks/${await entity('task', args.task)}`));
      else if (args.run) print(await call(`/runs/${await entity('run', args.run)}`));
      else {
        const project = args.all ? undefined : await currentProject(true);
        if (project) await boardDisplay(project); else print(await call('/status'));
      }
    } else if (command === 'run') {
      const task = required('task'), provider = required('provider'), model = required('model');
      const run = await call(`/tasks/${await entity('task', task)}/runs`, { provider, model, objective: args.objective,
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
      if (!fullId.test(selected)) throw new Error('Recovery requires the full Run ID. Inspect threshold status --run ID first.');
      if (!args['confirm-reusable']) throw new Error('No recovery requested. Independently check that the old worker is gone and the workspace is reusable, then use --confirm-reusable --note TEXT. The old outcome and external effects remain unknown.');
      print(await call(`/runs/${await entity('run', selected)}/recover`, { confirmReusable: true, note: required('note') }));
    } else if (command === 'service stop') {
      if (args.run || args.task) throw new Error('service stop stops the whole service. To stop one worker: threshold run stop ID.');
      print(await call('/shutdown', {}));
    } else if (command === 'decision') {
      const task = required('task'), target = required('target'), decision = required('value');
      print(await call('/human/decisions', { taskId: await entity('task', task), target, decision }, true));
    }
  } catch (error) { report(error); return 1; }
  return 0;
}
process.exitCode = await main();
