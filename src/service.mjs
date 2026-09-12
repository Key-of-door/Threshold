import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { openStore } from './store.mjs';
import { git, observeGit } from './git.mjs';
import { startPi } from './pi.mjs';

const problem = (status, message) => Object.assign(new Error(message), { status });
const text = (value, name, max = 12000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw problem(400, `Invalid ${name}`);
  return value;
};
const target = value => {
  if (!['staging', 'preview'].includes(value)) throw problem(400, 'Supported fake targets: staging, preview');
  return value;
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
export async function startService({ home, agentDir, port = 8765, workerFactory = startPi }) {
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
    const context = taskId => {
      const state = store.context(taskId);
      return { ...state, currentGit: observeGit(state.project.repo_path), controlled: store.controlledState(taskId) };
    };
    function launch(taskId, provider, model) {
      const state = store.context(taskId);
      if ([...jobs.values()].some(job => job.active && job.repo === state.project.repo_path))
        throw problem(409, 'A worker is already active in this worktree; use another Git worktree for parallel writing');
      const run = store.startRun(taskId, provider, model);
      const token = randomBytes(32).toString('hex');
      const job = { active: true, repo: state.project.repo_path, worker: null, done: null,
        observation: { source: 'runtime_events_in_memory', toolCalls: 0, toolNames: [], checkpointRead: null, agentEnd: false } };
      jobs.set(run.id, job); tokens.set(token, run);
      job.done = (async () => {
        let error, exit = { code: null };
        try {
          job.worker = workerFactory({ cwd: job.repo, agentDir, provider, model,
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
          if (!shuttingDown && !job.cancelled) await job.worker.turn(
            'Call read_task first. Follow its task instructions and latest checkpoint to complete one small next step. '
            + 'Re-observe Git status/diff and relevant files before editing; the checkpoint is an Agent summary, not current truth. '
            + 'Run the relevant check, then save_checkpoint with what changed, the actual check result, open issues and next step. '
            + 'Do not push. Ordinary work needs no deployment decision. Finish this turn after saving the checkpoint.');
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
        const path = new URL(req.url, 'http://localhost').pathname;
        const method = req.method;
        if (path.startsWith('/agent/')) {
          const run = tokens.get(req.headers.authorization?.replace(/^Bearer /, ''));
          if (!run) throw problem(401, 'Active run credential required');
          if (method === 'GET' && path === '/agent/task') return reply(200, context(run.task_id));
          if (method === 'POST' && path === '/agent/checkpoints') {
            const data = await body(req);
            return reply(201, store.checkpoint(run.task_id, run.id, text(data.summary, 'summary'), observeGit(jobs.get(run.id).repo)));
          }
          if (method === 'POST' && path === '/agent/fake-deploy') return reply(200, store.fakeDeploy(run.task_id, target((await body(req)).target)));
          throw problem(404, 'Agent route not found');
        }
        if (path === '/human/decisions' && method === 'POST') {
          if (req.headers.authorization !== `Bearer ${humanKey}`) throw problem(401, 'Human client credential required');
          const data = await body(req);
          if (!['allow', 'deny'].includes(data.decision)) throw problem(400, 'Expected allow or deny');
          return reply(200, store.decide(text(data.taskId, 'taskId'), target(data.target), data.decision));
        }
        if (method === 'GET' && path === '/status') return reply(200, { projects: store.projects(), tasks: store.tasks() });
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
        const taskRoute = path.match(/^\/tasks\/([^/]+)(\/runs)?$/);
        if (taskRoute && method === 'GET' && !taskRoute[2]) return reply(200, context(taskRoute[1]));
        if (taskRoute?.[2] && method === 'POST') {
          const data = await body(req);
          return reply(202, launch(taskRoute[1], text(data.provider, 'provider', 100), text(data.model, 'model', 200)));
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
