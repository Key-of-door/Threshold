import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
const now = () => new Date().toISOString();

export function openStore(path) {
  const db = new DatabaseSync(path);
  try {
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 9) throw new Error('Database is newer than this service');
  if (version === 0) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, repo_path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, instructions TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'in_progress');
    CREATE TABLE runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), provider TEXT NOT NULL, model TEXT NOT NULL, session_id TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER, error TEXT);
    CREATE TABLE checkpoints (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), run_id TEXT REFERENCES runs(id), summary TEXT NOT NULL, git_json TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX checkpoints_task ON checkpoints(task_id, created_at);
    CREATE TABLE decisions (task_id TEXT NOT NULL REFERENCES tasks(id), target TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('allow','deny')), updated_at TEXT NOT NULL, PRIMARY KEY(task_id,target));
    CREATE TABLE fake_deployments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), target TEXT NOT NULL, created_at TEXT NOT NULL);
    PRAGMA user_version=1; COMMIT;`);
  if (version < 2) db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE runs ADD COLUMN objective TEXT;
    ALTER TABLE tasks ADD COLUMN status_update_json TEXT;
    PRAGMA user_version=2; COMMIT;`);
  if (version < 3) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id), from_run_id TEXT REFERENCES runs(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX messages_task ON messages(task_id,id);
    PRAGMA user_version=3; COMMIT;`);
  if (version < 4) db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE runs ADD COLUMN capabilities_json TEXT;
    PRAGMA user_version=4; COMMIT;`);
  if (version < 5) db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE runs ADD COLUMN workspace_path TEXT;
    ALTER TABLE runs ADD COLUMN started_by_run_id TEXT REFERENCES runs(id);
    UPDATE runs SET workspace_path=(SELECT p.repo_path FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=runs.task_id);
    PRAGMA user_version=5; COMMIT;`);
  if (version < 6) db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE runs ADD COLUMN workspace_recovery_json TEXT;
    PRAGMA user_version=6; COMMIT;`);
  if (version < 7) db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE projects ADD COLUMN archived_at TEXT;
    PRAGMA user_version=7; COMMIT;`);
  if (version < 8) db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE runs ADD COLUMN model_settings_json TEXT;
    PRAGMA user_version=8; COMMIT;`);
  if (version < 9) db.exec(`BEGIN IMMEDIATE;
    ALTER TABLE runs ADD COLUMN execution_json TEXT;
    PRAGMA user_version=9; COMMIT;`);
  const readRun = row => row ? { ...row,
    execution: row.execution_json ? JSON.parse(row.execution_json) : null, execution_json: undefined,
    modelSettings: row.model_settings_json ? JSON.parse(row.model_settings_json) : null, model_settings_json: undefined,
    capabilities: row.capabilities_json ? JSON.parse(row.capabilities_json) : null, capabilities_json: undefined,
    workspace_recovery: row.workspace_recovery_json ? JSON.parse(row.workspace_recovery_json) : null, workspace_recovery_json: undefined } : undefined;
  db.prepare("UPDATE runs SET status='unknown', error='Service restarted without a process exit observation' WHERE status IN ('starting','running')").run();
  const requiredTask = id => {
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
    return { ...task, status_update: task.status_update_json ? JSON.parse(task.status_update_json) : null, status_update_json: undefined };
  };
  const requiredProject = id => {
    const project = db.prepare('SELECT * FROM projects WHERE id=?').get(id);
    if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
    return project;
  };
  const activeProject = id => {
    const project = requiredProject(id);
    if (project.archived_at) throw Object.assign(new Error(`Project is archived. Restore it with threshold project restore ${id} before creating Tasks or Runs.`), { status: 409 });
    return project;
  };
  return {
    db,
    createProject(name, repoPath) {
      const existing = db.prepare('SELECT * FROM projects WHERE repo_path=?').get(repoPath);
      if (existing) return existing;
      const project = { id: randomUUID(), name, repo_path: repoPath, created_at: now(), archived_at: null };
      db.prepare('INSERT INTO projects(id,name,repo_path,created_at) VALUES (?,?,?,?)').run(project.id, name, repoPath, project.created_at);
      return project;
    },
    archiveProject(id) {
      const project = requiredProject(id);
      if (project.archived_at) return project;
      const occupied = db.prepare(`SELECT r.id FROM runs r JOIN tasks t ON t.id=r.task_id WHERE t.project_id=?
        AND (r.status IN ('starting','running') OR (r.status='unknown' AND r.workspace_recovery_json IS NULL)) LIMIT 1`).get(id);
      if (occupied) throw Object.assign(new Error(`Project has an active or unresolved Run (${occupied.id}). Inspect it and stop active work or resolve its existing workspace occupancy before archiving. No worker was stopped.`), { status: 409 });
      db.prepare('UPDATE projects SET archived_at=? WHERE id=?').run(now(), id);
      return requiredProject(id);
    },
    restoreProject(id) {
      requiredProject(id);
      db.prepare('UPDATE projects SET archived_at=NULL WHERE id=?').run(id);
      return requiredProject(id);
    },
    createTask(projectId, title, instructions) {
      activeProject(projectId);
      const task = { id: randomUUID(), project_id: projectId, title, instructions, status: 'in_progress' };
      db.prepare('INSERT INTO tasks(id,project_id,title,instructions,status) VALUES (?,?,?,?,?)').run(task.id, projectId, title, instructions, task.status);
      return requiredTask(task.id);
    },
    task: requiredTask,
    project: id => db.prepare('SELECT * FROM projects WHERE id=?').get(id),
    projects: () => db.prepare('SELECT * FROM projects ORDER BY created_at').all(),
    lookup(kind, prefix, projectId) {
      const queries = {
        project: ['SELECT id, name AS label FROM projects WHERE substr(id,1,?)=? ORDER BY id LIMIT 21', [prefix.length, prefix]],
        task: ['SELECT id, title AS label FROM tasks WHERE substr(id,1,?)=? AND (? IS NULL OR project_id=?) ORDER BY id LIMIT 21', [prefix.length, prefix, projectId ?? null, projectId ?? null]],
        run: ['SELECT r.id, r.objective AS label FROM runs r JOIN tasks t ON t.id=r.task_id WHERE substr(r.id,1,?)=? AND (? IS NULL OR t.project_id=?) ORDER BY r.id LIMIT 21', [prefix.length, prefix, projectId ?? null, projectId ?? null]],
      };
      const [sql, params] = queries[kind];
      const rows = db.prepare(sql).all(...params);
      return { matches: rows.slice(0, 20), hasMore: rows.length > 20 };
    },
    tasks: () => db.prepare('SELECT id FROM tasks').all().map(row => requiredTask(row.id)),
    // Compact index for the bare `status` CLI: no instructions, checkpoints or Run objectives.
    statusIndex(includeArchived = false) {
      return {
        unresolvedRuns: db.prepare("SELECT id,task_id,workspace_path FROM runs WHERE status='unknown' AND workspace_recovery_json IS NULL ORDER BY started_at").all(),
        projects: db.prepare('SELECT id, name, repo_path, archived_at FROM projects WHERE (? OR archived_at IS NULL) ORDER BY created_at').all(Number(includeArchived)),
        tasks: db.prepare(`SELECT t.id,t.project_id,t.title,t.status,t.status_update_json FROM tasks t JOIN projects p ON p.id=t.project_id
          WHERE (? OR p.archived_at IS NULL) ORDER BY t.rowid`).all(Number(includeArchived))
          .map(row => ({ id: row.id, project_id: row.project_id, title: row.title, status: row.status,
            status_update: row.status_update_json ? JSON.parse(row.status_update_json) : null })),
      };
    },
    updateTaskStatus(taskId, status, note, runId = null) {
      requiredTask(taskId);
      const update = { source: runId ? 'agent' : 'client', runId, note, updatedAt: now() };
      db.prepare('UPDATE tasks SET status=?,status_update_json=? WHERE id=?').run(status, JSON.stringify(update), taskId);
      return requiredTask(taskId);
    },
    context(id) {
      const task = requiredTask(id);
      const checkpoint = db.prepare('SELECT * FROM checkpoints WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(id);
      return { task, project: this.project(task.project_id),
        checkpoint: checkpoint ? { ...checkpoint, source: 'agent_summary', git: JSON.parse(checkpoint.git_json), git_json: undefined } : null,
        recentRuns: db.prepare('SELECT * FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 5').all(id).map(readRun),
        messageInbox: { scope: 'task', ...db.prepare('SELECT COUNT(*) AS count, COALESCE(MAX(id),0) AS latestId FROM messages WHERE task_id=?').get(id) } };
    },
    sendMessage(taskId, body, runId = null) {
      const task = requiredTask(taskId);
      if (runId) {
        const run = this.run(runId);
        if (!run || requiredTask(run.task_id).project_id !== task.project_id)
          throw Object.assign(new Error('Sender Run must belong to the target Task Project'), { status: 403 });
      }
      const created_at = now();
      const { lastInsertRowid } = db.prepare('INSERT INTO messages(task_id,from_run_id,body,created_at) VALUES (?,?,?,?)').run(taskId, runId, body, created_at);
      return { id: Number(lastInsertRowid), project_id: task.project_id, task_id: taskId, from_run_id: runId,
        source: runId ? 'agent' : 'client', body, created_at };
    },
    readMessages(taskId, after = 0, limit = 10) {
      const task = requiredTask(taskId);
      const rows = db.prepare('SELECT * FROM messages WHERE task_id=? AND id>? ORDER BY id LIMIT ?').all(taskId, after, limit + 1);
      const messages = rows.slice(0, limit).map(row => ({ ...row, project_id: task.project_id, source: row.from_run_id ? 'agent' : 'client' }));
      return { scope: 'task', taskId, messages, nextAfter: messages.at(-1)?.id ?? after, hasMore: rows.length > limit };
    },
    checkpoint(taskId, runId, summary, git) {
      requiredTask(taskId);
      const checkpoint = { id: randomUUID(), task_id: taskId, run_id: runId, summary, git, created_at: now(), source: 'agent_summary' };
      db.prepare('INSERT INTO checkpoints VALUES (?,?,?,?,?,?)').run(checkpoint.id, taskId, runId, summary, JSON.stringify(git), checkpoint.created_at);
      return checkpoint;
    },
    startRun(taskId, provider, model, objective = null, capabilities = { skills: [], extensions: [] }, workspacePath, startedBy = null, modelSettings = {}, execution = null) {
      const task = requiredTask(taskId);
      activeProject(task.project_id);
      const id = randomUUID();
      db.prepare("INSERT INTO runs(id,task_id,provider,model,status,started_at,objective,capabilities_json,workspace_path,started_by_run_id,model_settings_json,execution_json) VALUES (?,?,?,?,'starting',?,?,?,?,?,?,?)").run(id, taskId, provider, model, now(), objective, JSON.stringify(capabilities), workspacePath ?? this.project(task.project_id).repo_path, startedBy, JSON.stringify({ requested: modelSettings, effective: null }), execution ? JSON.stringify(execution) : null);
      return this.run(id);
    },
    runCount: () => db.prepare('SELECT COUNT(*) AS n FROM runs').get().n,
    unsettledRuns: () => db.prepare("SELECT * FROM runs WHERE status IN ('starting','running') OR (status='unknown' AND workspace_recovery_json IS NULL)").all().map(readRun),
    recoverWorkspace(id, note) {
      // Client confirmation releases occupancy only. The unobserved outcome stays unknown.
      const recovery = { source: 'client', confirmedAt: now(), note };
      db.prepare("UPDATE runs SET workspace_recovery_json=? WHERE id=? AND status='unknown' AND workspace_recovery_json IS NULL")
        .run(JSON.stringify(recovery), id);
      const run = this.run(id);
      if (!run) throw Object.assign(new Error('Run not found'), { status: 404 });
      if (run.status !== 'unknown') throw Object.assign(new Error('Only an unknown Run can have its workspace recovered; use run stop for an active worker'), { status: 409 });
      return run;
    },
    board(projectId) {
      const project = this.project(projectId);
      if (!project) throw Object.assign(new Error('Project not found'), { status: 404 });
      const clip = value => value && value.slice(0, 500);
      return { project, tasks: db.prepare('SELECT id FROM tasks WHERE project_id=? ORDER BY rowid DESC').all(projectId).map(({ id }) => {
        const { task, checkpoint, recentRuns, messageInbox } = this.context(id);
        const messages = db.prepare('SELECT id,from_run_id,body,created_at FROM messages WHERE task_id=? ORDER BY id DESC LIMIT 3').all(id);
        const briefRun = run => ({ id: run.id, status: run.status, objective: clip(run.objective), workspace_path: run.workspace_path,
          started_at: run.started_at, ended_at: run.ended_at, error: run.error, started_by_run_id: run.started_by_run_id,
          workspace_recovery: run.workspace_recovery, execution: run.execution });
        return { id, title: task.title, status: task.status, status_update: task.status_update,
          unsettledRuns: db.prepare("SELECT * FROM runs WHERE task_id=? AND (status IN ('starting','running') OR (status='unknown' AND workspace_recovery_json IS NULL))").all(id).map(readRun).map(briefRun),
          latestRun: recentRuns[0] ? briefRun(recentRuns[0]) : null,
          checkpoint: checkpoint ? { id: checkpoint.id, run_id: checkpoint.run_id, source: checkpoint.source, summary: clip(checkpoint.summary), created_at: checkpoint.created_at } : null,
          messageInbox, recentMessages: messages.map(message => ({ ...message, body: clip(message.body), source: message.from_run_id ? 'agent' : 'client' })) };
      }), summariesTruncatedAt: 500 };
    },
    run: id => readRun(db.prepare('SELECT * FROM runs WHERE id=?').get(id)),
    recordModelSettings(id, effective) {
      const settings = this.run(id).modelSettings;
      db.prepare('UPDATE runs SET model_settings_json=? WHERE id=?').run(JSON.stringify({ ...settings, effective }), id);
    },
    running(id, sessionId) { db.prepare("UPDATE runs SET status='running',session_id=? WHERE id=?").run(sessionId, id); },
    endRun(id, exit, error, stopReason) {
      const execution = this.run(id).execution;
      db.prepare("UPDATE runs SET status='ended',ended_at=?,exit_code=?,error=?,execution_json=? WHERE id=?")
        .run(now(), exit.code, error ?? null, execution ? JSON.stringify({ ...execution, ...(stopReason ? { stopReason } : {}) }) : null, id);
    },
    decide(taskId, target, decision) {
      requiredTask(taskId);
      db.prepare('INSERT INTO decisions VALUES (?,?,?,?) ON CONFLICT(task_id,target) DO UPDATE SET decision=excluded.decision,updated_at=excluded.updated_at').run(taskId, target, decision, now());
      return { action: 'fake_deploy', taskId, target, decision };
    },
    controlledState(taskId) {
      requiredTask(taskId);
      return { decisions: db.prepare('SELECT * FROM decisions WHERE task_id=?').all(taskId), results: db.prepare('SELECT * FROM fake_deployments WHERE task_id=?').all(taskId) };
    },
    fakeDeploy(taskId, target) {
      requiredTask(taskId);
      const operation = { action: 'fake_deploy', taskId, target };
      // The fake effect is a DB row: check and insert share one short local transaction.
      db.exec('BEGIN IMMEDIATE');
      try {
        const decision = db.prepare('SELECT decision FROM decisions WHERE task_id=? AND target=?').get(taskId, target);
        if (!decision || decision.decision === 'deny') {
          db.exec('COMMIT');
          return { status: decision ? 'NO' : 'ASK', operation,
            block: { operation, reason: decision ? 'Human denied this operation' : 'Missing Human decision for this task and target' } };
        }
        const result = { id: randomUUID(), ...operation, effect: 'local SQLite fake deployment record', created_at: now() };
        db.prepare('INSERT INTO fake_deployments VALUES (?,?,?,?)').run(result.id, taskId, target, result.created_at);
        db.exec('COMMIT');
        return { status: 'GO', operation, result };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close: () => db.close(),
  };
  } catch (error) {
    try { if (db.isTransaction) db.exec('ROLLBACK'); } catch { /* Preserve the original initialization failure. */ }
    try { db.close(); } catch { /* Do not hide the migration error. */ }
    throw error;
  }
}
