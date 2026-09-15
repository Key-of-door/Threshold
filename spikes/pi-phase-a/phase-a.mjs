// Disposable Phase A probe. This is not a project service or a stable event schema.
import { connectPi } from '../pi-rpc.mjs';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const cli = join(here, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js');
const agentDir = join(root, '.local/pi-agent');
const observationId = randomUUID(); // Probe identity, never called a native Pi run ID.
const out = join(root, '.local/pi-phase-a', observationId);
const cwd = join(out, '工作目录 with spaces');
mkdirSync(cwd, { recursive: true });
mkdirSync(agentDir, { recursive: true });
const pause = ms => new Promise(r => setTimeout(r, ms));
const model = process.argv[2]; // Omit for real-process protocol-only checks.
const provider = process.argv[3] ?? 'openai-codex';
const shellTool = process.argv[4] ?? 'powershell';
assert.ok(['powershell', 'bash'].includes(shellTool), 'supported probe shell: powershell or bash');
const settingsPath = join(agentDir, 'settings.json');
const piSettings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
const redact = text => process.env.DEEPSEEK_API_KEY
  ? text.replaceAll(process.env.DEEPSEEK_API_KEY, '[REDACTED]') : text;
const report = {
  observationId, startedAt: new Date().toISOString(), node: process.version,
  platform: process.platform, piVersion: JSON.parse(readFileSync(join(dirname(dirname(cli)), '../package.json'))).version,
  bridgeSha256: createHash('sha256').update(readFileSync(join(here, '../pi-rpc.mjs'))).digest('hex'),
  sourceSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  mode: model ? 'real-model' : 'protocol-only', provider, model, shellTool,
  configuredBashPath: piSettings.shellPath ?? null, cwd, checks: [],
  nonclaims: ['agent_end is not Task completion', 'exit/error does not prove zero effects',
    'no native runId observed; sessionId, toolCallId and local observationId remain separate',
    'custom catalog has no pricing; zero reported cost is not zero billed cost'],
};

function connect(label) {
  return connectPi({ cli, cwd, agentDir, sessionDir: join(out, 'sessions'), label, provider, model,
    toolNames: ['read', shellTool],
    onRecord: record => appendFileSync(join(out, `${label}.jsonl`),
      redact(JSON.stringify({ at: new Date().toISOString(), ...record })) + '\n'),
  });
}

async function check(name, fn) {
  const started = Date.now();
  try {
    const observation = await fn();
    report.checks.push({ name, status: 'observed', milliseconds: Date.now() - started, observation });
    console.log(`${name}: observed`);
  } catch (error) {
    report.checks.push({ name, status: 'failed', milliseconds: Date.now() - started, error: String(error) });
    throw error;
  }
}

try {
  await check('identity-state-idle-abort-eof', async () => {
    const rpc = connect('protocol');
    try {
      const [initial, models] = await Promise.all([rpc.request('get_state'), rpc.request('get_available_models')]);
      assert.equal(typeof initial.sessionId, 'string');
      assert.equal(initial.isStreaming, false);
      const queue = await rpc.request('clear_queue');
      await rpc.request('abort');
      const after = await rpc.request('get_state');
      assert.equal(after.sessionId, initial.sessionId);
      const exit = await rpc.close();
      assert.equal(exit.code, 0);
      assert.equal(exit.trailingPartialFrame, false);
      return { pid: rpc.child.pid, initial, queue, after, models, exit,
        agentEndCount: rpc.events.filter(e => e.type === 'agent_end').length };
    } finally { await rpc.close(); }
  });
  await check('idle-forced-process-exit', async () => {
    const rpc = connect('forced-idle');
    try {
      const state = await rpc.request('get_state');
      rpc.child.kill();
      const exit = await rpc.done;
      await assert.rejects(rpc.request('get_state'), /closed/);
      return { sessionId: state.sessionId, exit, agentEndCount: rpc.events.filter(e => e.type === 'agent_end').length };
    } finally { await rpc.close(); }
  });
  if (model) {
    const token = `fixture-${randomUUID()}`;
    writeFileSync(join(cwd, '测试 fixture.txt'), token + '\n');
    await check(`model-read-${shellTool}-lifecycle`, async () => {
      const rpc = connect('live-tools');
      try {
        const initial = await rpc.request('get_state');
        assert.equal(initial.model?.provider, provider);
        assert.equal(initial.model?.id, model);
        const shellCommand = shellTool === 'bash'
          ? "set -e; printf 'PHASE_A_SHELL_OK\\n'; pwd; git --version; fd --version; rg --version; node --version; cat '测试 fixture.txt'"
          : 'Write-Output "PHASE_A_SHELL_OK"';
        await rpc.request('prompt', { message: `This is a tiny local runtime integration test. Use read to read 测试 fixture.txt, then use ${shellTool} to run the following command. Do no other work. Reply with the file token and shell output.\nCommand:\n${shellCommand}` });
        const end = await rpc.waitFor(e => e.type === 'agent_end');
        for (const toolName of ['read', shellTool]) {
          const start = rpc.events.find(e => e.type === 'tool_execution_start' && e.toolName === toolName);
          assert.ok(start, `missing ${toolName} start`);
          assert.ok(rpc.events.find(e => e.type === 'tool_execution_end' && e.toolCallId === start.toolCallId && !e.isError), `missing ${toolName} successful end`);
        }
        assert.ok(JSON.stringify(end).includes(token));
        const shellResult = rpc.events.find(e => e.type === 'tool_execution_end' && e.toolName === shellTool);
        assert.ok(JSON.stringify(shellResult.result).includes('PHASE_A_SHELL_OK'));
        if (shellTool === 'bash') {
          assert.ok(JSON.stringify(shellResult.result).includes(token), 'Bash did not read the fixture');
          for (const version of ['git version', 'fd ', 'ripgrep ', process.version])
            assert.ok(JSON.stringify(shellResult.result).includes(version), `missing dependency output: ${version}`);
        }
        const after = await rpc.request('get_state');
        assert.equal(after.isStreaming, false);
        return { initial, after, eventTypes: [...new Set(rpc.events.map(e => e.type))], exit: await rpc.close() };
      } finally { await rpc.close(); }
    });
    for (const stop of ['abort', 'eof', 'kill']) await check(`active-tool-${stop}-child-behavior`, async () => {
      const marker = join(cwd, `child-started-${stop}.json`);
      const later = join(cwd, `child-finished-${stop}.txt`);
      const fixture = join(cwd, `delayed-child-${stop}.mjs`);
      writeFileSync(fixture, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, JSON.stringify({pid:process.pid,parentPid:process.ppid}));\nconsole.log('CHILD_READY');\nsetTimeout(() => { writeFileSync(${JSON.stringify(later)}, 'bounded local effect after delay'); console.log('CHILD_FINISHED'); }, 15000);\n`);
      const psQuote = s => "'" + s.replaceAll("'", "''") + "'";
      const bashQuote = s => "'" + s.replaceAll('\\', '/').replaceAll("'", "'\\''") + "'";
      const command = shellTool === 'bash'
        ? `${bashQuote(process.execPath)} ${bashQuote(fixture)}; status=$?; exit $status`
        : `& ${psQuote(process.execPath)} ${psQuote(fixture)}`;
      const rpc = connect(`live-${stop}`);
      let childPid;
      try {
        await rpc.request('get_state');
        await rpc.request('prompt', { message: `Local cancellation test: call ${shellTool} once with this exact command, timeout 45 seconds, then stop. Do not retry or run any other tool. Command: ${command}` });
        await rpc.waitFor(e => e.type === 'tool_execution_start' && e.toolName === shellTool);
        const deadline = Date.now() + 10000;
        while (!existsSync(marker) && Date.now() < deadline) await pause(50);
        assert.ok(existsSync(marker), 'test child did not start');
        childPid = JSON.parse(readFileSync(marker)).pid;
        const during = await rpc.request('get_state');
        assert.equal(during.isStreaming, true);
        let after, exit;
        if (stop === 'abort') {
          await rpc.request('clear_queue');
          await rpc.request('abort');
          await rpc.waitFor(e => e.type === 'agent_end');
          after = await rpc.request('get_state');
          assert.equal(after.isStreaming, false);
        } else {
          if (stop === 'kill') rpc.child.kill();
          else rpc.child.stdin.end();
          exit = await rpc.close();
        }
        await pause(500);
        let childAlive = true;
        try { process.kill(childPid, 0); } catch (e) { if (e.code === 'ESRCH') childAlive = false; else throw e; }
        if (stop === 'abort') assert.equal(childAlive, false, 'owned test child survived abort');
        // Characterize forced exit; do not turn a surviving child into a false success claim.
        // This fixture self-terminates after 15 s, without any remote side effect.
        if (childAlive) {
          const deadline = Date.now() + 17000;
          while (Date.now() < deadline) {
            try { process.kill(childPid, 0); } catch (e) { if (e.code === 'ESRCH') break; throw e; }
            await pause(100);
          }
          await assert.rejects(async () => process.kill(childPid, 0), /ESRCH/);
        }
        return { during, after, childPid, childAliveAt500ms: childAlive,
          delayedEffectObserved: existsSync(later),
          agentEndCount: rpc.events.filter(e => e.type === 'agent_end').length,
          turnEndReasons: rpc.events.filter(e => e.type === 'turn_end').map(e => ({stopReason: e.message?.stopReason, errorMessage: e.message?.errorMessage})),
          exit: exit ?? await rpc.close() };
      } finally {
        await rpc.close();
        // Only the single child spawned by this test; never scan/kill other workers.
        if (childPid) { try { process.kill(childPid, 0); process.kill(childPid); } catch (e) { if (e.code !== 'ESRCH') throw e; } }
      }
    });
  } else {
    report.remaining = ['real model lifecycle/tools', 'active abort and child cleanup', 'Git Bash execution'];
  }
} catch (error) {
  console.error(redact(String(error)));
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(out, 'report.json'), redact(JSON.stringify(report, null, 2)) + '\n');
  console.log(`Report: ${join(out, 'report.json')}`);
}
