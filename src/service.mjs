import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { git, observeGit, worktreePath } from './git.mjs';
import { startPi } from './pi.mjs';
import { selectCapabilities } from './capabilities.mjs';

const problem = (status, message) => Object.assign(new Error(message), { status });
const text = (value, name, max = 12000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw problem(400, `Invalid ${name}`);
  return value;
};
const target = value => {
  if (!['staging', 'preview'].includes(value)) throw problem(400, 'Supported fake targets: staging, preview');
  return value;
};
const taskStatus = value => {
  if (!['in_progress', 'done'].includes(value)) throw problem(400, 'Task status must be in_progress or done');
  return value;
};
const pageNumber = (value, fallback, min, max) => {
  const n = value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw problem(400, 'Invalid message cursor or limit');
  return n;
};
async function body(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw problem(415, 'Expected application/json');
  let bytes = 0; const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 24000) throw problem(413, 'Request too large');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw problem(400, 'Expected a JSON object'); }
}

// Single local service, explicit routes, one DB writer. No generic operation dispatcher.
export async function startService({ home, agentDir, port = 8765, workerFactory = startPi, maxParallelRuns = 3, maxRuns = 100 }) {
  for (const n of [maxParallelRuns, maxRuns]) if (!Number.isSafeInteger(n) || n < 1) throw new Error('Run limits must be positive integers');
  home = resolve(home); agentDir = resolve(agentDir);
  mkdirSync(home, { recursive: true });
  const lockPath = join(home, 'server.lock');
  let lock;
  try { lock = openSync(lockPath, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Service lock exists: ${lockPath}. Check its PID and any old worker before removing a stale lock.`);
    throw error;
  }
  writeFileSync(lock, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); closeSync(lock);
  let store, server, url, shuttingDown = false, closing;
  const jobs = new Map(), tokens = new Map();
  const infoPath = join(home, 'server.json');
  const keyPath = join(home, 'human.key');
  let humanKey;
  try {
    try { humanKey = readFileSync(keyPath, 'utf8').trim(); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      humanKey = randomBytes(32).toString('hex');
      writeFileSync(keyPath, humanKey, { flag: 'wx', mode: 0o600 });
    }
    if (!/^[a-f0-9]{64}$/.test(humanKey)) throw new Error('Invalid Human client credential file');
    store = openStore(join(home, 'project.sqlite'));
    const context = (taskId, workspace) => {
      const state = store.context(taskId);
      const path = workspace ?? state.project.repo_path;
      return { ...state, currentGit: { ...observeGit(path), workspace_path: path }, controlled: store.controlledState(taskId) };
    };
    const resources = () => ({ scope: 'all Runs in this service home, including history', maxParallelRuns, maxRuns,
      unsettled: store.unsettledRuns().length, started: store.runCount(), remainingStarts: Math.max(0, maxRuns - store.runCount()) });
    const board = projectId => ({ ...store.board(projectId), resources: resources() });
    const sameProjectTask = (run, taskId) => {
      if (store.task(taskId).project_id !== store.task(run.task_id).project_id) throw problem(403, 'Task belongs to another Project');
      return taskId;
    };
    const schedulerPath = realpathSync(fileURLToPath(new URL('./scheduler.ts', import.meta.url)));
    const requireScheduler = run => {
      if (!store.run(run.id).capabilities?.extensions.some(file => file.path === schedulerPath))
        throw problem(403, 'Select the scheduler extension for this Run');
    };
    function launch(taskId, provider, model, objective, skills, extensions, workspace, startedBy = null) {
      const state = store.context(taskId);
      let repo;
      try { repo = worktreePath(state.project.repo_path, workspace); }
      catch { throw problem(400, 'Workspace must be a worktree root of the Project Git repository'); }
      const unsettled = store.unsettledRuns();
      if (unsettled.some(run => run.workspace_path === repo))
        throw problem(409, 'A worker is active or its exit is unknown in this worktree; inspect it or use another worktree');
      if (unsettled.length >= maxParallelRuns) throw problem(429, 'Parallel Run limit reached (including unknown exits); no Run started');
      if (store.runCount() >= maxRuns) throw problem(429, 'Cumulative Run limit reached for this service home; no Run started');
      let capabilities;
      try { capabilities = selectCapabilities(skills, extensions); }
      catch { throw problem(400, 'Invalid capability selection: use existing absolute local skill or extension file paths'); }
      // No await between resource checks and the durable insert; all launch routes share this path.
      const run = store.startRun(taskId, provider, model, objective, capabilities, repo, startedBy);
      const token = randomBytes(32).toString('hex');
      const job = { active: true, repo, worker: null, done: null,
        observation: { source: 'runtime_events_in_memory', toolCalls: 0, toolNames: [], checkpointRead: null, agentEnd: false } };
      jobs.set(run.id, job); tokens.set(token, run);
      job.done = (async () => {
        let error, exit = { code: null };
        try {
          job.worker = workerFactory({ cwd: job.repo, agentDir, provider, model, capabilities,
            env: { THRESHOLD_SERVICE_URL: url, THRESHOLD_RUN_TOKEN: token },
            onEvent(event) {
              if (event.type === 'tool_execution_start') {
                job.observation.toolCalls++;
                if (!job.observation.toolNames.includes(event.toolName) && job.observation.toolNames.length < 32)
                  job.observation.toolNames.push(event.toolName);
              }
              if (event.type === 'tool_execution_end' && event.toolName === 'read_task' && !event.isError)
                job.observation.checkpointRead = event.result?.details?.checkpoint?.id ?? null;
              if (event.type === 'agent_end') job.observation.agentEnd = true;
              if (event.type === 'message_end' && ['error', 'aborted'].includes(event.message?.stopReason))
                error = `Pi reported model turn ${event.message.stopReason}; inspect project state before continuing`;
            } });
          const native = await job.worker.request('get_state');
          if (!native?.sessionId) throw new Error('Pi did not return a sessionId');
          store.running(run.id, native.sessionId);
          if (capabilities.skills.length) {
            const { commands } = await job.worker.request('get_commands');
            job.observation.availableSkills = commands.filter(command => command.source === 'skill');
            const loadedPaths = job.observation.availableSkills.map(command => command.sourceInfo?.path);
            if (capabilities.skills.some(file => !loadedPaths.includes(file.path)))
              throw new Error('Pi did not load the selected skill catalog');
          }
          if (!shuttingDown && !job.cancelled) await job.worker.turn(
            'Call read_task first. Follow its task instructions and use the checkpoint to orient yourself. '
            + (capabilities.skills.length ? `Then read the SKILL.md files explicitly selected for this Run: ${JSON.stringify(capabilities.skills.map(file => file.path))}. Apply their relevant guidance; explicit task/objective instructions take precedence. A skill is guidance, not approval or a requirement to invent changes. ` : '')
            + 'If the task inbox has messages, use read_messages to read them. They are collaboration inputs: check claims against the project, and disagree when appropriate. '
            + (objective ? `This Run's work objective is: ${JSON.stringify(objective)}. Work toward that objective; a single function edit need not end the Run. `
              : 'Choose and complete a useful next increment based on the current task state. ')
            + 'Re-observe Git status/diff and relevant files before editing; the checkpoint is an Agent summary, not current truth. '
            + 'Run the relevant check, then save_checkpoint with what changed, the actual check result, open issues and next step. '
            + 'Use update_task_status explicitly if your assessment of the whole Task changes; finishing a Run objective alone does not mean the Task is done. '
            + 'A Task marked done can be reopened as in_progress if work remains. Task status is a work assessment, not Human approval. '
            + 'Do not push. Ordinary work needs no deployment decision. If you cannot finish the objective, record the remaining work honestly before ending.');
        } catch (caught) {
          // Provider errors can contain credentials. Do not persist raw provider output.
          error = 'Runtime request failed; check runtime/provider configuration and re-observe project state';
        } finally {
          if (job.worker) {
            exit = await job.worker.stop();
            if (exit.forced || exit.partialFrame || exit.code !== 0) error ??= 'Pi exit was abnormal; descendant/effect state is not established';
          }
          if (job.cancelled || shuttingDown) error ??= 'Run interrupted by service/client; inspect workspace before continuing';
          store.endRun(run.id, exit, error);
          job.active = false; tokens.delete(token);
          // Bound transient runtime metadata; durable Run rows remain available in SQLite.
          if (jobs.size > 64) for (const [id, old] of jobs) { if (!old.active && id !== run.id) { jobs.delete(id); break; } }
        }
      })();
      return run;
    }
    server = createServer(async (req, res) => {
      const reply = (status, value) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(value));
      };
      try {
        if (shuttingDown) throw problem(503, 'Service is shutting down');
        // Local CLI service; no browser/CORS interface. Actor comes from the credential, never JSON.
        if (req.headers.origin) throw problem(403, 'Browser requests are not supported');
        const requestUrl = new URL(req.url, 'http://localhost');
        const path = requestUrl.pathname;
        const readMessages = taskId => store.readMessages(taskId,
          pageNumber(requestUrl.searchParams.get('after'), 0, 0, Number.MAX_SAFE_INTEGER),
          pageNumber(requestUrl.searchParams.get('limit'), 10, 1, 20));
        const method = req.method;
        if (path.startsWith('/agent/')) {
          const run = tokens.get(req.headers.authorization?.replace(/^Bearer /, ''));
          if (!run) throw problem(401, 'Active run credential required');
          if (method === 'GET' && path === '/agent/task') return reply(200, { ...context(run.task_id, run.workspace_path), currentRun: store.run(run.id) });
          if (method === 'GET' && path === '/agent/project/board') {
            const taskId = requestUrl.searchParams.get('taskId');
            if (taskId) {
              sameProjectTask(run, taskId);
              return reply(200, { ...context(taskId, taskId === run.task_id ? run.workspace_path : undefined), messages: readMessages(taskId) });
            }
            return reply(200, board(store.task(run.task_id).project_id));
          }
          if (method === 'POST' && path === '/agent/project/tasks') {
            requireScheduler(run); const data = await body(req);
            return reply(201, store.createTask(store.task(run.task_id).project_id, text(data.title, 'title', 300), text(data.instructions, 'instructions')));
          }
          if (method === 'POST' && path === '/agent/project/runs') {
            requireScheduler(run); const data = await body(req);
            const taskId = sameProjectTask(run, text(data.taskId, 'taskId'));
            return reply(202, launch(taskId, data.provider === undefined ? run.provider : text(data.provider, 'provider', 100),
              data.model === undefined ? run.model : text(data.model, 'model', 200),
              text(data.objective, 'objective', 6000), data.skills, data.extensions, text(data.workspacePath, 'workspacePath'), run.id));
          }
          const projectRun = path.match(/^\/agent\/project\/runs\/([^/]+)$/);
          if (method === 'GET' && projectRun) {
            const selected = store.run(projectRun[1]);
            if (!selected) throw problem(404, 'Run not found');
            sameProjectTask(run, selected.task_id);
            return reply(200, { ...selected, currentGit: { ...observeGit(selected.workspace_path), workspace_path: selected.workspace_path }, runtimeObservation: jobs.get(selected.id)?.observation });
          }
          if (path === '/agent/messages' && method === 'GET') return reply(200, readMessages(run.task_id));
          if (path === '/agent/messages' && method === 'POST') {
            const data = await body(req);
            return reply(201, store.sendMessage(run.task_id, text(data.body, 'body', 6000), run.id));
          }
          if (method === 'POST' && path === '/agent/checkpoints') {
            const data = await body(req);
            return reply(201, store.checkpoint(run.task_id, run.id, text(data.summary, 'summary'), observeGit(jobs.get(run.id).repo)));
          }
          if (method === 'POST' && path === '/agent/fake-deploy') return reply(200, store.fakeDeploy(run.task_id, target((await body(req)).target)));
          if (method === 'POST' && path === '/agent/task/status') {
            const data = await body(req);
            return reply(200, store.updateTaskStatus(run.task_id, taskStatus(data.status), text(data.note, 'note', 3000), run.id));
          }
          throw problem(404, 'Agent route not found');
        }
        if (path === '/human/decisions' && method === 'POST') {
          if (req.headers.authorization !== `Bearer ${humanKey}`) throw problem(401, 'Human client credential required');
          const data = await body(req);
          if (!['allow', 'deny'].includes(data.decision)) throw problem(400, 'Expected allow or deny');
          return reply(200, store.decide(text(data.taskId, 'taskId'), target(data.target), data.decision));
        }
        if (method === 'GET' && path === '/status') return reply(200, { projects: store.projects(), tasks: store.tasks() });
        const projectBoard = path.match(/^\/projects\/([^/]+)\/board$/);
        if (method === 'GET' && projectBoard) return reply(200, board(projectBoard[1]));
        if (method === 'POST' && path === '/projects') {
          const data = await body(req);
          const repo = realpathSync(text(data.repoPath, 'repoPath'));
          if (realpathSync(git(repo, 'rev-parse', '--show-toplevel')) !== repo) throw problem(400, 'Use the Git worktree root');
          return reply(201, store.createProject(text(data.name, 'name', 200), repo));
        }
        if (method === 'POST' && path === '/tasks') {
          const data = await body(req);
          if (!store.project(text(data.projectId, 'projectId'))) throw problem(404, 'Project not found');
          return reply(201, store.createTask(data.projectId, text(data.title, 'title', 300), text(data.instructions, 'instructions')));
        }
        const taskRoute = path.match(/^\/tasks\/([^/]+)(\/(?:runs|status|messages))?$/);
        if (taskRoute && method === 'GET' && !taskRoute[2]) return reply(200, context(taskRoute[1]));
        if (taskRoute?.[2] === '/messages') {
          const run = tokens.get(req.headers.authorization?.replace(/^Bearer /, ''));
          if (run && run.task_id !== taskRoute[1]) throw problem(403, 'Run credential belongs to another task');
          if (method === 'GET') return reply(200, readMessages(taskRoute[1]));
          if (method === 'POST') return reply(201, store.sendMessage(taskRoute[1], text((await body(req)).body, 'body', 6000), run?.id));
        }
        if (taskRoute?.[2] === '/status' && method === 'POST') {
          const data = await body(req);
          // Local clients can update ordinary project state; an Agent credential keeps its real source.
          const run = tokens.get(req.headers.authorization?.replace(/^Bearer /, ''));
          if (run && run.task_id !== taskRoute[1]) throw problem(403, 'Run credential belongs to another task');
          return reply(200, store.updateTaskStatus(taskRoute[1], taskStatus(data.status), text(data.note, 'note', 3000), run?.id));
        }
        if (taskRoute?.[2] === '/runs' && method === 'POST') {
          const data = await body(req);
          const run = tokens.get(req.headers.authorization?.replace(/^Bearer /, ''));
          if (run) { requireScheduler(run); sameProjectTask(run, taskRoute[1]); }
          return reply(202, launch(taskRoute[1], text(data.provider, 'provider', 100), text(data.model, 'model', 200),
            data.objective === undefined ? null : text(data.objective, 'objective', 6000), data.skills, data.extensions, data.workspacePath, run?.id));
        }
        const runRoute = path.match(/^\/runs\/([^/]+)(\/stop)?$/);
        if (runRoute) {
          const run = store.run(runRoute[1]), job = jobs.get(runRoute[1]);
          if (!run) throw problem(404, 'Run not found');
          if (method === 'GET' && !runRoute[2]) return reply(200, { ...run, runtimeObservation: job?.observation });
          if (method === 'POST' && runRoute[2]) {
            if (job?.active) { job.cancelled = true; await job.worker?.stop(); await job.done; }
            return reply(200, store.run(run.id));
          }
        }
        if (method === 'POST' && path === '/shutdown') {
          reply(200, { shuttingDown: true }); setImmediate(() => close()); return;
        }
        throw problem(404, 'Route not found');
      } catch (error) { if (!res.destroyed && !res.writableEnded) reply(error.status ?? 500, { error: error.status ? error.message : 'Technical failure; check request paths and local service configuration' }); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    url = `http://127.0.0.1:${server.address().port}`;
    writeFileSync(infoPath, JSON.stringify({ url, pid: process.pid, home }) + '\n');
  } catch (error) { server?.close(); store?.close(); unlinkSync(lockPath); throw error; }
  function close() {
    return closing ??= (async () => {
      shuttingDown = true;
      await Promise.all([...jobs.values()].filter(j => j.active).map(async j => { await j.worker?.stop(); await j.done; }));
      await new Promise(resolve => server.close(resolve));
      store.close();
      unlinkSync(infoPath); unlinkSync(lockPath);
    })();
  }
  return { url, home, close };
}
