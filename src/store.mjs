import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
const now = () => new Date().toISOString();

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 3) { db.close(); throw new Error('Database is newer than this service'); }
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
  db.prepare("UPDATE runs SET status='unknown', error='Service restarted without a process exit observation' WHERE status IN ('starting','running')").run();
  const requiredTask = id => {
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if (!task) throw Object.assign(new Error('Task not found'), { status: 404 });
    return { ...task, status_update: task.status_update_json ? JSON.parse(task.status_update_json) : null, status_update_json: undefined };
  };
  return {
    db,
    createProject(name, repoPath) {
      const project = { id: randomUUID(), name, repo_path: repoPath, created_at: now() };
      db.prepare('INSERT INTO projects VALUES (?,?,?,?)').run(project.id, name, repoPath, project.created_at);
      return project;
    },
    createTask(projectId, title, instructions) {
      const task = { id: randomUUID(), project_id: projectId, title, instructions, status: 'in_progress' };
      db.prepare('INSERT INTO tasks(id,project_id,title,instructions,status) VALUES (?,?,?,?,?)').run(task.id, projectId, title, instructions, task.status);
      return requiredTask(task.id);
    },
    task: requiredTask,
    project: id => db.prepare('SELECT * FROM projects WHERE id=?').get(id),
    projects: () => db.prepare('SELECT * FROM projects ORDER BY created_at').all(),
    tasks: () => db.prepare('SELECT id FROM tasks').all().map(row => requiredTask(row.id)),
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
        recentRuns: db.prepare('SELECT * FROM runs WHERE task_id=? ORDER BY rowid DESC LIMIT 5').all(id),
        messageInbox: { scope: 'task', ...db.prepare('SELECT COUNT(*) AS count, COALESCE(MAX(id),0) AS latestId FROM messages WHERE task_id=?').get(id) } };
    },
    sendMessage(taskId, body, runId = null) {
      const task = requiredTask(taskId);
      if (runId && this.run(runId)?.task_id !== taskId) throw Object.assign(new Error('Run belongs to another task'), { status: 403 });
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
    startRun(taskId, provider, model, objective = null) {
      requiredTask(taskId);
      const id = randomUUID();
      db.prepare("INSERT INTO runs(id,task_id,provider,model,status,started_at,objective) VALUES (?,?,?,?,'starting',?,?)").run(id, taskId, provider, model, now(), objective);
      return this.run(id);
    },
    run: id => db.prepare('SELECT * FROM runs WHERE id=?').get(id),
    running(id, sessionId) { db.prepare("UPDATE runs SET status='running',session_id=? WHERE id=?").run(sessionId, id); },
    endRun(id, exit, error) { db.prepare("UPDATE runs SET status='ended',ended_at=?,exit_code=?,error=? WHERE id=?").run(now(), exit.code, error ?? null, id); },
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
}
