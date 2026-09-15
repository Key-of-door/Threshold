-- The original persistent service schema, before Run objectives/status attribution.
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, repo_path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), title TEXT NOT NULL, instructions TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'in_progress');
CREATE TABLE runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), provider TEXT NOT NULL, model TEXT NOT NULL, session_id TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, exit_code INTEGER, error TEXT);
CREATE TABLE checkpoints (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), run_id TEXT REFERENCES runs(id), summary TEXT NOT NULL, git_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX checkpoints_task ON checkpoints(task_id, created_at);
CREATE TABLE decisions (task_id TEXT NOT NULL REFERENCES tasks(id), target TEXT NOT NULL, decision TEXT NOT NULL CHECK(decision IN ('allow','deny')), updated_at TEXT NOT NULL, PRIMARY KEY(task_id,target));
CREATE TABLE fake_deployments (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), target TEXT NOT NULL, created_at TEXT NOT NULL);
INSERT INTO projects VALUES ('p','Existing project','/repo','2026-09-13T00:00:00Z');
INSERT INTO tasks VALUES ('t','p','Existing task','Continue work','in_progress');
INSERT INTO runs VALUES ('r','t','test','test','session-before-restart','running','2026-09-13T00:00:00Z',NULL,NULL,NULL);
INSERT INTO checkpoints VALUES ('c','t','r','Parser done; loader pending','{"source":"git_observation","head":"existing-head"}','2026-09-13T00:00:00Z');
INSERT INTO decisions VALUES ('t','staging','deny','2026-09-13T00:00:00Z');
PRAGMA user_version=1;
