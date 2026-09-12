import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startService } from './service.mjs';
import { connectPi } from '../pi-rpc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const out = join(root, '.local/pi-phase-b', randomUUID());
const cwd = join(out, '项目 work');
mkdirSync(cwd, { recursive: true });
const provider = process.argv[2] ?? 'deepseek';
const model = process.argv[3] ?? 'deepseek-flash';
const redact = text => process.env.DEEPSEEK_API_KEY
  ? text.replaceAll(process.env.DEEPSEEK_API_KEY, '[REDACTED]') : text;
const fileToken = `file-${randomUUID()}`;
writeFileSync(join(cwd, '样例.txt'), fileToken + '\n');
const task = {
  projectId: 'phase-b-demo', id: `task-${randomUUID()}`, status: 'in_progress',
  title: '核对项目样例文件',
  instructions: '用 read 工具读取当前目录的 样例.txt。把本任务 id 和文件中的完整 token 写进 checkpoint summary，并说明这是文件读取观察。不要改变 Task 状态。随后向用户报告观察。',
};
const service = await startService(task);
const report = { startedAt: new Date().toISOString(), provider, model, checks: [],
  sourceSha256: Object.fromEntries(['run.mjs', 'extension.ts', 'service.mjs', '../pi-rpc.mjs'].map(path =>
    [path, createHash('sha256').update(readFileSync(join(here, path))).digest('hex')])),
  limitations: ['in-memory service; no restart persistence', 'loopback only; no caller authentication',
    'checkpoint source=agent is a record type, not authenticated identity',
    'checkpoint does not complete Task', 'reported zero model cost is not billing information'],
};
const rpc = connectPi({
  cli: join(root, 'spikes/pi-phase-a/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'),
  cwd, agentDir: join(root, '.local/pi-agent'), sessionDir: join(out, 'sessions'),
  label: 'phase-b', provider, model, toolNames: ['read', 'read_task', 'save_checkpoint'],
  extensions: [join(here, 'extension.ts')], env: { THRESHOLD_SERVICE_URL: service.url },
  onRecord: record => appendFileSync(join(out, 'runtime.jsonl'),
    redact(JSON.stringify({ at: new Date().toISOString(), ...record })) + '\n'),
});
let serviceClosed = false;
try {
  report.initialRuntime = await rpc.request('get_state');
  assert.equal(report.initialRuntime.model.provider, provider);
  assert.equal(report.initialRuntime.model.id, model);
  // No task contents, ID or file token in this prompt: those come from service/file tool results.
  await rpc.request('prompt', { message: '从 Threshold 读取当前任务，按照任务内容执行这次小工作，保存 checkpoint，然后简短报告。' });
  const end = await rpc.waitFor(e => e.type === 'agent_end');
  const toolEnds = rpc.events.filter(e => e.type === 'tool_execution_end');
  for (const name of ['read_task', 'read', 'save_checkpoint']) {
    const result = toolEnds.find(e => e.toolName === name && !e.isError);
    assert.ok(result, `missing successful real tool result: ${name}`);
    assert.ok(rpc.events.some(e => e.type === 'tool_execution_start' && e.toolCallId === result.toolCallId));
    if (name !== 'read') assert.ok(service.calls.some(c => c.toolCallId === result.toolCallId && c.status === 200), 'missing real HTTP request');
  }
  assert.equal(toolEnds.find(e => e.toolName === 'read_task').details?.task?.id ??
    toolEnds.find(e => e.toolName === 'read_task').result.details.task.id, task.id);
  const snapshot = service.snapshot();
  assert.deepEqual(snapshot.task, task);
  assert.ok(snapshot.checkpoint.summary.includes(task.id));
  assert.ok(snapshot.checkpoint.summary.includes(fileToken));
  assert.equal(snapshot.checkpoint.source, 'agent');
  const finalMessage = end.messages.filter(m => m.role === 'assistant').at(-1);
  assert.equal(finalMessage.stopReason, 'stop');
  assert.ok(JSON.stringify(finalMessage.content).includes(fileToken), 'Agent did not report the observed file token');
  report.checks.push({ name: 'real-agent-read-work-checkpoint', status: 'passed', snapshot,
    agentInterpretation: finalMessage.content, serviceCalls: [...service.calls] });
  console.log('real-agent-read-work-checkpoint: passed');

  // A separate real invocation after service shutdown: technical failure, no approval machinery.
  await service.close(); serviceClosed = true;
  const offset = rpc.events.length;
  await rpc.request('prompt', { message: '现在只调用 read_task 一次，重新读取任务。如果工具发生技术错误，直接报告该错误，不重试，不调用其他工具，也不要请求授权。' });
  const failedEnd = await rpc.waitFor(e => rpc.events.indexOf(e) >= offset && e.type === 'agent_end');
  const subsequent = rpc.events.slice(offset);
  const attempts = subsequent.filter(e => e.type === 'tool_execution_start');
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].toolName, 'read_task');
  const failure = subsequent.find(e => e.type === 'tool_execution_end');
  assert.equal(failure.isError, true);
  assert.match(JSON.stringify(failure.result), /Threshold service technical error/);
  report.checks.push({ name: 'real-agent-service-unavailable', status: 'passed',
    toolResult: failure.result,
    agentInterpretation: failedEnd.messages.filter(m => m.role === 'assistant').at(-1).content });
  report.finalRuntime = await rpc.request('get_state');
  assert.equal(report.finalRuntime.isStreaming, false);
  console.log('real-agent-service-unavailable: passed');
} catch (error) {
  report.error = redact(String(error)); process.exitCode = 1;
  console.error(report.error);
} finally {
  try { await rpc.request('clear_queue'); await rpc.request('abort'); }
  catch (error) { report.shutdownError = redact(String(error)); }
  report.exit = await rpc.close();
  if (!serviceClosed) await service.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(out, 'report.json'), redact(JSON.stringify(report, null, 2)) + '\n');
  console.log(`Report: ${join(out, 'report.json')}`);
}
