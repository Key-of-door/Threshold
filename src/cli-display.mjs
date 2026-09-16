import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { format, preview } from './cli-format.mjs';

export function defaultHome(platform = process.platform, env = process.env, userHome = homedir()) {
  const absolute = (value, fallback) => value && isAbsolute(value) ? value : fallback;
  if (platform === 'win32') return join(absolute(env.LOCALAPPDATA, join(userHome, 'AppData', 'Local')), 'Threshold');
  if (platform === 'darwin') return join(userHome, 'Library', 'Application Support', 'Threshold');
  return join(absolute(env.XDG_STATE_HOME, join(userHome, '.local', 'state')), 'threshold');
}

const commands = {
  setup: ['[--agent-dir PATH]', 'Configure a provider/model and a hidden API key in Pi local configuration. Terminal only. Existing settings and other providers are preserved; no model call is made. Stored credentials are local plaintext, not Project data.', 'threshold setup'],
  'service start': ['[--agent-dir PATH] [--port 8765] [--max-parallel-runs 3] [--max-runs 100]', 'Start the local service in the background and return to this terminal. An already running service is reused without changing its options. No login/autostart is installed. Use serve for foreground diagnostics.', 'threshold service start'],
  'service status': ['', 'Inspect service availability without changing it. Distinguishes running, stopped, stale markers, and unconfirmed state. Does not establish old worker exit.', 'threshold service status'],
  serve: ['[--agent-dir PATH] [--port 8765] [--max-parallel-runs 3] [--max-runs 100]', 'Start the foreground local service. Keep this terminal open. Pi config defaults to ~/.pi/agent. Background Runs have a 3-minute limit. Interactive Runs stay alive until stopped, including while waiting for input; max-runs counts all historical starts in this home.', 'threshold serve'],
  'service stop': ['', 'Stop this service and all its managed workers. Does not delete Project data.', 'threshold service stop'],
  'project create': ['[--repo PATH] [--name NAME] [--init-git]', 'Register an existing folder. In a terminal, ask for its absolute path and offer Git initialization when needed. Scripts use --repo and explicitly --init-git for a non-Git folder. An already registered root is returned unchanged.', 'threshold project create --repo "E:/my-project"'],
  'project archive': ['ID | --project ID', 'Hide a Project and its Tasks from the default index and selection menus. Keep files, history and IDs. Active or unresolved Runs must be handled first; this command does not stop workers. Archived Projects cannot start new Tasks or Runs.', 'threshold project archive a1b2'],
  'project restore': ['ID | --project ID', 'Show an archived Project again and allow new work. Preserves its original ID and history. Find archived IDs with status --all --include-archived.', 'threshold project restore a1b2'],
  board: ['[--project ID]', 'Show the current repository Project, Tasks and shared Run limits. Outside a registered repository, a terminal offers Project selection; scripts specify --project.', 'threshold board'],
  'task create': ['[--title TEXT] [--instructions TEXT | --instructions-file PATH] [--project ID]', 'Create a Task. A terminal asks for missing title/instructions and lets you select a Project. Scripts must supply flags.', 'threshold task create'],
  'task update': ['--task ID --status in_progress|done --note TEXT [--project ID]', 'Record your Task assessment. This does not stop a Run or grant a Human Decision.', 'threshold task update --task a1b2 --status done --note "Tests passed; delivery checked"'],
  run: ['[--task ID] [--provider NAME] [--model NAME] [--attach] [--objective TEXT] [--workspace PATH] [--skill PATH] [--extension PATH] [--project ID]', 'Start a fresh Pi session. In a terminal, choose missing Task/provider/model and optional Run-local capability paths. Scripts/--json must supply task/provider/model. Default: background work, return immediately, exit after Pi settles. --attach waits for further input until run stop. Detaching never changes the startup policy. Repeat skill/extension flags to compose; next Run inherits none. Credentials come from Pi config/service environment.', 'threshold run --attach'],
  'run attach': ['ID | --run ID', 'Observe and talk to an existing live Run. Enter sends input; /detach or Ctrl+C leaves the view without stopping the worker. Working input is queued at a Pi tool boundary; idle input starts another round. Does not extend a background Run lifetime. Non-TTY and --json return one public-activity snapshot without consuming stdin. Activity is bounded, in memory only, and unavailable after service restart.', 'threshold run attach c3d4'],
  'run stop': ['ID | --run ID', 'Interrupt one Run. Its exit does not establish descendant or external-effect state. Does not stop the service.', 'threshold run stop c3d4'],
  'run recover': ['FULL_RUN_ID --confirm-reusable --note TEXT', 'Release an unknown Run\'s stale slot/worktree only after you independently checked that the old worker is gone and the workspace is reusable. Requires a full Run ID (or --run FULL_RUN_ID). Records a client confirmation; does not stop a process, restore a conversation, establish external effects or change the unknown outcome. Repeating keeps the original recovery note/time.', 'threshold run recover FULL_RUN_ID --confirm-reusable --note "Checked old worker is gone and workspace is reusable"'],
  status: ['[--task ID | --run ID | --project ID] [--all] [--include-archived]', 'Show the current Project when recognized, otherwise the active Project index. Select Task for its full checkpoint, Run for execution detail. --all shows the global index; --include-archived shows the global index including archived Projects. Direct ID and current-repository inspection still show archived history.', 'threshold status --task a1b2'],
  'message read': ['--task ID [--after 0] [--limit 10] [--project ID]', 'Read persistent Task messages without consuming them. Follow nextAfter when hasMore is true.', 'threshold message read --task a1b2'],
  'message send': ['--task ID (--body TEXT | --body-file PATH) [--project ID]', 'Append a collaboration message. A message is not a Human Decision.', 'threshold message send --task a1b2 --body "Please review the actual diff"'],
  decision: ['--task ID --target staging|preview --value allow|deny [--project ID]', 'Human CLI only: record a decision for the local fake_deploy example. Not a real deployment. Agents must not use this to impersonate Human approval.', 'threshold decision --task a1b2 --target staging --value allow'],
};
export const commandNames = Object.keys(commands);
const groups = [
  ['Start here', [['setup', 'Configure a model and API key'], ['service start', 'Start service in the background'], ['project create', 'Choose a project folder'], ['task create', 'Give the project a task'], ['run --attach', 'Choose a task and start chatting'], ['status', 'See where the work stands']]],
  ['Work together', [['run attach ID', 'See and talk to a live worker'], ['task update', 'Record a work assessment'], ['message read / send', 'Exchange project notes'], ['board', 'See tasks and runs together']]],
  ['Stop something', [['run stop ID', 'One worker'], ['service stop', 'Service and managed workers']]],
  ['When needed', [['project archive/restore', 'Put away or return to a project'], ['service status', 'Inspect service availability'], ['serve', 'Foreground service / diagnostics'], ['run recover ID', 'Release manually checked stale occupancy'], ['decision', 'Human decision for fake_deploy'], ['--json', 'Machine-readable output'], ['--home PATH', 'Choose another data directory'], ['--version', 'Show the installed version']]],
];

export function help(command = '', options = {}) {
  const f = format(options), entry = commands[command];
  const children = commandNames.filter(name => name.startsWith(command + ' '));
  if (command && !entry && !children.length) return `Unknown command: ${f.text('', command)}\nRun threshold --help.`;
  const rows = !command ? [f.logo()+f.title('threshold', options.version), 'Project persists. Agents come and go.',
    ...groups.flatMap(([title, entries]) => ['', f.text('head', title), ...entries.map(([name, description]) =>
      (options.columns ?? 80) < 72 ? `  ${f.text(title === 'Start here' ? 'accent' : '', name)}\n    ${description}` : `  ${f.text(title === 'Start here' ? 'accent' : '', name.padEnd(24))}${description}`)]),
    '', f.text('dim', 'Details and examples: threshold COMMAND --help'), f.command('threshold service start'), f.text('dim', 'Foreground diagnostics: threshold serve')]
    : entry ? [f.title(`threshold ${command}`), f.text('dim', entry[0]), '', entry[1], '', f.text('head', 'Example'), f.command(entry[2])]
      : [f.title(`threshold ${command}`), '', ...children.flatMap(name => [f.command(`threshold ${name} ${commands[name][0]}`), ''])];
  return [...rows, '', f.text('dim', 'Global: --home PATH  --json  --help  --version  --ascii  --no-color'),
    f.pair('Default home', options.home ?? defaultHome()), f.text('dim', 'Home is independent of cwd; no old data is moved.'),
    f.text('dim', 'IDs accept unique prefixes. --project scopes Task/Run lookup.'),
    f.text('dim', '--json is for scripts. --summary is a human-output alias.')].join('\n');
}

export function display(value, options = {}) {
  const f = format(options), { text: t, short: id } = f;
  const section = name => '\n'+t('head', name);
  const columns = options.columns ?? 80;
  const excerpt = (value, indent) => preview(value, columns - indent - 1, options.ascii);
  const runRows = (run, compact = false) => [f.run(compact ? { ...run, objective: null } : run),
    ...(options.interactions?.[run.id] ? ['  '+t('accent', options.interactions[run.id])+' '+t('dim', '/ live snapshot')] : []),
    ...(compact && run.objective ? ['  '+t('', excerpt(run.objective, 2))] : []),
    ...(run.error ? ['  '+t('error', run.error)] : []),
    ...(run.workspace_recovery ? ['  '+t('dim', 'Workspace manually confirmed reusable; old outcome unknown.')] : []),
    ...(run.workspace_path ? ['  '+t('dim', run.workspace_path)] : [])];
  const messageRows = message => [f.title(`#${message.id}`, `${message.source}${message.from_run_id ? ' / run '+id(message.from_run_id) : ''}${message.created_at ? ' / '+message.created_at : ''}`), t('', message.body), ''];
  const archiveRows = project => project.archived_at ? [t('dim', 'Archived / history retained'),
    f.command(`threshold project restore ${id(project.id)}`)] : [];
  const gitRows = observation => !observation ? [] : [section('Current Git'),
    ...(observation.error ? [t('warn', observation.error)] : [
      f.pair('Branch', observation.branch || 'Detached HEAD'),
      f.pair('HEAD', observation.head === null ? 'No commits yet' : observation.head, 'dim'),
      t('', observation.status || 'Working tree clean.')]),
    ...(observation.workspace_path ? [f.pair('Workspace', observation.workspace_path, 'dim')] : [])];

  if (value.state && value.home) return [f.title('Service', value.state),
    ...(value.url ? [t('accent', value.url)] : []),
    ...(value.alreadyRunning ? [t('dim', 'Existing service reused; startup options were not changed.')] : []),
    f.pair('Home', value.home, 'dim'), ...(value.agentDir ? [f.pair('Pi config', value.agentDir, 'dim')] : []), '',
    ...(value.state === 'running' ? ['This terminal is free for work. Model connectivity is not verified.', f.command('threshold project create'), f.command('threshold service stop')]
      : value.state === 'stopped' ? [t('dim', 'No service discovered from runtime markers; missing markers do not prove process exit.'), f.command('threshold service start')]
      : [t('warn', value.state === 'stale' ? 'Old runtime markers remain. Check old workers before removing server.lock/server.json; keep project data.'
        : 'Availability is unconfirmed. Inspect the recorded process before restarting.')])].join('\n');
  if (value.listening) return [f.logo()+f.title('threshold', 'local project service'), '',
    t('ok', 'Service listening at '+value.listening), '', f.pair('Home', value.home, 'dim'),
    ...(options.agentDir ? [f.pair('Pi config', options.agentDir, 'dim')] : []),
    t('dim', 'Listening does not verify provider connectivity.'), section('In another terminal'), f.command('threshold status'), '',
    t('dim', 'Keep this terminal open. Stop service + managed workers:'), f.command('threshold service stop')].join('\n');
  if (value.shuttingDown) return [f.title('Service shutdown requested'), 'Managed workers are being stopped. Project data is retained.'].join('\n');
  if (value.resources) return [f.title(value.project.name, 'project '+id(value.project.id)), t('dim', value.project.repo_path),
    ...archiveRows(value.project),
    section(value.tasks.length ? 'Work' : 'No Tasks yet'),
    ...value.tasks.flatMap(task => ['', f.title(task.title, id(task.id)), t('dim', `${task.status} / work assessment`),
      ...(task.latestRun ? runRows(task.latestRun, true) : [t('dim', 'No Runs yet.')]),
      ...(task.unsettledRuns ?? []).filter(run => run.id !== task.latestRun?.id).flatMap(run => runRows(run, true)),
      f.pair('Checkpoint', task.checkpoint ? excerpt(task.checkpoint.summary, columns < 72 ? 2 : 14) : 'Not saved yet.'),
      f.pair('Messages', `${task.messageInbox.count} available`)]),
    section('Service budget'), t('dim', `${value.resources.unsettled} unsettled / ${value.resources.maxParallelRuns} slots`),
    t('dim', `${value.resources.started} / ${value.resources.maxRuns} historical starts; ${value.resources.remainingStarts} remaining`),
    t('dim', 'Across all Projects in this service home.'), '',
    t('dim', value.tasks.length ? 'Checkpoint/objective previews only; inspect a Task for full text.' : value.project.archived_at ? 'Restore this Project to start new work.' : 'Create the first Task in this Project.'),
    ...(value.project.archived_at ? [] : [f.command(value.tasks.length ? 'threshold run --attach' : `threshold task create --project ${id(value.project.id)}`)])].join('\n');
  if (value.task) return [f.title(value.task.title, id(value.task.id)), `${t('', value.task.status)}  ${t('dim', 'work assessment')}`,
    f.pair('Project', `${value.project.name} / ${id(value.project.id)}`), t('dim', value.project.repo_path),
    ...archiveRows(value.project),
    section('Task'), t('', value.task.instructions), section('Checkpoint'),
    ...(value.checkpoint ? [t('dim', `Agent summary / run ${id(value.checkpoint.run_id)}${value.checkpoint.created_at ? ' / '+value.checkpoint.created_at : ''}`), t('', value.checkpoint.summary)] : [t('dim', 'Not saved yet.')]),
    section('Recent Runs'), ...(value.recentRuns.length ? value.recentRuns.flatMap(run => runRows(run)) : [t('dim', 'None yet.')]),
    ...gitRows(value.currentGit),
    section('Messages'), `${value.messageInbox.count} available`, f.command(`threshold message read --task ${id(value.task.id)}`), '',
    t('dim', 'Run ending does not change the Task assessment.')].join('\n');
  if (value.projects) return [
    ...(options.unregisteredRepo ? [f.title('No Project here yet'), t('dim', options.unregisteredRepo), '', f.command('threshold project create'), ''] : []),
    t('head', 'Projects:'), ...(value.projects.length ? value.projects.flatMap(project => [f.title(project.name, `${id(project.id)}${project.archived_at ? ' / archived' : ''}`), '  '+t('dim', project.repo_path)]) : [t('dim', 'No active Projects. Archived history may still exist.')]),
    section('Tasks:'), ...(value.tasks.length ? value.tasks.map(task => f.title(task.title, `${id(task.id)} / ${task.status}`)) : [t('dim', 'None yet.')]), '',
    f.command(value.projects.length === 1 ? `threshold board --project ${id(value.projects[0].id)}` : value.projects.length ? 'threshold board' : 'threshold project create'),
    ...(value.tasks.some(task => value.projects.some(project => project.id === task.project_id && !project.archived_at)) ? [f.command('threshold run --attach')] : []),
    f.command('threshold status --all --include-archived')].join('\n');
  if (value.messages) return [f.title('Messages', 'task '+id(value.taskId)), '', ...value.messages.flatMap(messageRows),
    t('dim', `${value.messages.length} message(s) shown. ${value.hasMore ? 'More available.' : 'No further messages at this observation.'}`),
    ...(value.hasMore ? [f.command(`threshold message read --task ${id(value.taskId)} --after ${value.nextAfter}`)] : []),
    t('dim', 'Messages are collaboration inputs, not decisions.')].join('\n');
  if (value.provider && value.task_id) {
    const rows = [f.title(value.objective ?? 'Run', id(value.id)), f.state(value), f.pair('Task', id(value.task_id)),
      ...(value.error ? [section('What happened'), t('error', value.error), t('dim', 'Inspect the checkpoint and current files before continuing.')] : []),
      ...(value.workspace_recovery ? [section('Workspace recovery'), t('', 'Client manually confirmed workspace reusable; stale occupancy released.'),
        t('dim', 'Old outcome remains unknown. External effects are not established.'),
        f.pair('Confirmed', value.workspace_recovery.confirmedAt), t('', value.workspace_recovery.note)] : []),
      section('Runtime'), f.pair('Model', `${value.provider} / ${value.model}`), f.pair('Workspace', value.workspace_path ?? 'Not recorded', 'dim'),
      f.pair('Started', value.started_at), f.pair('Ended', value.ended_at ?? 'Not recorded'),
      f.pair('Exit code', value.exit_code ?? 'Not observed'), f.pair('Session', value.session_id ?? 'Not recorded', 'dim'),
      section('Capabilities / selected for this Run')];
    if (!value.capabilities) rows.push(t('dim', 'Selection was not recorded.'));
    else for (const [kind, list] of [['Skill', value.capabilities.skills], ['Extension', value.capabilities.extensions]]) {
      if (!list?.length) rows.push(f.pair(kind, 'none'));
      for (const file of list ?? []) {
        const parts = file.path.split(/[\\/]/), name = /^(SKILL\.md|index\.[^.]+)$/i.test(parts.at(-1)) ? parts.at(-2) ?? parts.at(-1) : parts.at(-1);
        rows.push(f.pair(kind, name, 'accent'), '  '+t('dim', file.path), '  '+t('dim', 'sha256 '+file.sha256));
      }
    }
    rows.push(t('dim', 'Path labels, not roles. The next Run inherits no selection.'), section('Runtime observation'));
    const observed = value.runtimeObservation;
    if (!observed) rows.push(t('dim', 'Not held in this service process.'));
    else {
      rows.push(f.pair('Tool calls', observed.toolCalls), t('', (observed.toolNames ?? []).join(', ') || 'No tool names observed.'));
      if (observed.availableSkills) rows.push(t('dim', `Skill catalog observed: ${observed.availableSkills.length} entries. This does not establish execution.`));
    }
    rows.push(t('dim', 'Selection does not establish extension loading or execution.'), ...gitRows(value.currentGit), '', f.pair('Full Run ID', value.id, 'dim'),
      t('dim', 'This is a snapshot.'), f.command(`threshold status --run ${id(value.id)}`), f.command(`threshold status --task ${id(value.task_id)}`));
    if (['starting', 'running'].includes(value.status)) rows.push(f.command(`threshold run stop ${id(value.id)}`));
    if (value.status === 'unknown' && !value.workspace_recovery) rows.push(t('dim', 'Still holds a slot/worktree. Independently check the old worker and workspace before recovery.'), f.command('threshold run recover --help'));
    return rows.join('\n');
  }
  if (value.repo_path) return [f.title(value.name, 'project '+id(value.id)), t('dim', value.repo_path), '',
    ...(value.archived_at ? archiveRows(value) : [f.command(`threshold task create --project ${id(value.id)}`)])].join('\n');
  if (value.title && value.project_id) return [f.title(value.title, id(value.id)), `${t('', value.status)}  ${t('dim', 'work assessment')}`, '',
    f.pair('Full Task ID', value.id, 'dim'), f.command(`threshold run --task ${id(value.id)} --attach`), f.command(`threshold status --task ${id(value.id)}`)].join('\n');
  if (value.body) return [f.title('Message saved'), '', ...messageRows(value)].join('\n');
  if (value.action === 'fake_deploy' && value.decision) return [f.title('Human decision / fake_deploy'), f.pair('Decision', value.decision), f.pair('Target', value.target), f.pair('Task', id(value.taskId)), t('dim', 'Local fake deployment only.')].join('\n');
  return t('', JSON.stringify(value, null, 2));
}
