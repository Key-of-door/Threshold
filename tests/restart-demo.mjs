// Real model test, deliberately separate from npm test. Requires DEEPSEEK_API_KEY.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';

if (!process.env.DEEPSEEK_API_KEY) throw new Error('Set DEEPSEEK_API_KEY for this explicitly requested real-model demo');
const root = resolve(import.meta.dirname, '..');
mkdirSync(join(root, '.local'), { recursive: true });
const dir = mkdtempSync(join(root, '.local', 'restart-demo-'));
const repo = join(dir, 'repo'), home = join(dir, 'service');
mkdirSync(repo);
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { windowsHide: true, encoding: 'utf8' }).trim();
git('init');
writeFileSync(join(repo, 'math.mjs'), 'export function add(a, b) { throw new Error("TODO add"); }\nexport function multiply(a, b) { throw new Error("TODO multiply"); }\n');
writeFileSync(join(repo, 'add.test.mjs'), "import { add } from './math.mjs';\nimport assert from 'node:assert/strict';\nassert.equal(add(2,3),5); assert.equal(add(-4,2),-2); console.log('add checks passed');\n");
writeFileSync(join(repo, 'multiply.test.mjs'), "import { multiply } from './math.mjs';\nimport assert from 'node:assert/strict';\nassert.equal(multiply(3,4),12); assert.equal(multiply(-2,5),-10); console.log('multiply checks passed');\n");
git('add', 'math.mjs', 'add.test.mjs', 'multiply.test.mjs');
git('-c', 'user.name=Threshold local demo', '-c', 'user.email=demo@localhost', 'commit', '-m', 'Seed two small steps');
const originalTests = ['add.test.mjs', 'multiply.test.mjs'].map(file => readFileSync(join(repo, file), 'utf8'));

async function boot() {
  const child = spawn(process.execPath, ['src/cli.mjs', 'serve', '--home', home, '--agent-dir', join(root, '.local/pi-agent'), '--port', '0'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const exited = once(child, 'close');
  child.stdout.resume(); child.stderr.resume();
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const info = JSON.parse(readFileSync(join(home, 'server.json'), 'utf8'));
      if (info.pid === child.pid) return { child, exited, url: info.url };
    } catch {}
    if (child.exitCode !== null) throw new Error('Service exited before listening');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Service startup timed out');
}
let service;
const call = async (path, data) => {
  const response = await fetch(service.url + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error}`);
  return result;
};
async function shutdown() {
  await call('/shutdown', {});
  assert.equal((await service.exited)[0], 0);
  service = undefined;
}
async function run(taskId, label) {
  const started = await call(`/tasks/${taskId}/runs`, { provider: 'deepseek', model: 'deepseek-flash' });
  console.log(JSON.stringify({ stage: label, runId: started.id }));
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const state = await call(`/runs/${started.id}`);
    if (state.status === 'ended') {
      assert.equal(state.exit_code, 0, JSON.stringify(state));
      assert.equal(state.error, null, JSON.stringify(state));
      assert.ok(state.runtimeObservation.toolNames.includes('read_task'));
      assert.ok(state.runtimeObservation.toolNames.includes('save_checkpoint'));
      return state;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`${label} timed out`);
}
try {
  service = await boot();
  // Exercise CLI creation as the Human/client entry point; only the service opens SQLite.
  const cli = (...args) => JSON.parse(execFileSync(process.execPath, ['src/cli.mjs', ...args, '--home', home], { cwd: root, windowsHide: true, encoding: 'utf8' }));
  const project = cli('project', 'create', '--name', 'Persistent two-step project', '--repo', repo);
  const task = cli('task', 'create', '--project', project.id, '--title', 'Implement arithmetic in two separate runs', '--instructions',
    'Work only in this disposable repository. First call read_task and inspect git status, git diff and the source/tests. '
    + 'If there is no checkpoint: implement ONLY add in math.mjs, run node add.test.mjs, and save a checkpoint explicitly asking the next worker to implement multiply. Leave multiply unfinished. '
    + 'If a checkpoint exists: re-observe Git/files, implement multiply without losing add, run node add.test.mjs and node multiply.test.mjs, and save a new checkpoint. '
    + 'Do not alter tests. Do not commit or deploy. A successful turn does not change Task status.');
  const a = await run(task.id, 'Agent A');
  const first = await call(`/tasks/${task.id}`);
  assert.equal(first.checkpoint.run_id, a.id);
  assert.match(readFileSync(join(repo, 'math.mjs'), 'utf8'), /TODO multiply/);
  execFileSync(process.execPath, ['add.test.mjs'], { cwd: repo, windowsHide: true });
  const pidA = service.child.pid;
  await shutdown();
  service = await boot();
  assert.notEqual(service.child.pid, pidA);
  const restored = await call(`/tasks/${task.id}`);
  assert.equal(restored.checkpoint.id, first.checkpoint.id);
  assert.equal(restored.recentRuns[0].status, 'ended');
  const b = await run(task.id, 'Agent B');
  assert.notEqual(a.session_id, b.session_id);
  assert.equal(b.runtimeObservation.checkpointRead, first.checkpoint.id);
  const final = await call(`/tasks/${task.id}`);
  assert.equal(final.checkpoint.run_id, b.id);
  if (final.task.status === 'done') {
    assert.equal(final.task.status_update.source, 'agent');
    assert.equal(final.task.status_update.runId, b.id);
  } else assert.equal(final.task.status, 'in_progress');
  assert.ok(b.runtimeObservation.toolNames.some(name => ['powershell', 'bash'].includes(name)));
  assert.ok(b.runtimeObservation.toolNames.some(name => ['read', 'powershell', 'bash'].includes(name)));
  assert.deepEqual(['add.test.mjs', 'multiply.test.mjs'].map(file => readFileSync(join(repo, file), 'utf8')), originalTests);
  assert.equal(git('diff', '--name-only'), 'math.mjs');
  const tests = ['add.test.mjs', 'multiply.test.mjs'].map(file => execFileSync(process.execPath, [file], { cwd: repo, windowsHide: true, encoding: 'utf8' }).trim());
  const report = { passed: true, servicePids: [pidA, service.child.pid], project, task, firstCheckpoint: first.checkpoint,
    finalCheckpoint: final.checkpoint, runs: [a, b], independentChecks: tests,
    source: { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), dirty: true },
    limitations: ['Normal shutdown/restart only', 'Same provider/model, different native sessions', 'No conversation restored; Pi uses --no-session',
      'Checkpoint test claims are Agent summaries; independent checks above are actual local process results', 'No remote effects or crash-recovery verification'] };
  await shutdown();
  writeFileSync(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, report: join(dir, 'report.json') }));
} finally { if (service) await shutdown(); }
