import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { selectCapabilities } from '../src/capabilities.mjs';
import { loadMcpSelection } from '../src/mcp-config.mjs';
import { startPi } from '../src/pi.mjs';
import { startService } from '../src/service.mjs';
import { git } from '../src/git.mjs';
import { display, help } from '../src/cli-display.mjs';

const fixtureServer = resolve('tests/fixtures/mcp-server.mjs');
const probe = resolve('tests/fixtures/capability-probe.ts');
const save = (path, value) => writeFileSync(path, JSON.stringify(value));
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'threshold-mcp-'));
  const repo = join(home, 'repo'); mkdirSync(repo); mkdirSync(join(repo, '.pi'));
  save(join(home, 'models.json'), { providers: { fixture: { baseUrl: 'http://127.0.0.1:1/v1', api: 'openai-completions',
    apiKey: 'local-fixture-only', models: [{ id: 'fixture' }] } } });
  const config = (name, exposure = 'direct') => ({ command: process.execPath, args: [fixtureServer, join(home, name + '.log')], exposure });
  save(join(home, 'mcp.json'), { mcpServers: { global: config('global'), chosen: config('global-override') } });
  save(join(repo, '.pi', 'mcp.json'), { mcpServers: { project: config('project'), chosen: config('project-override') } });
  const path = join(home, 'selected 中文.json');
  save(path, { mcpServers: { chosen: config('chosen') } });
  return { home, repo, path, config };
}
async function until(predicate) {
  for (let i = 0; i < 300; i++) { if (await predicate()) return; await delay(20); }
  assert.fail('MCP fixture observation timed out');
}

test('MCP selection validates files, composes without collisions, records no configuration secrets, and detects changed bytes', () => {
  const { home, path, config } = fixture();
  const second = join(home, 'second.json');
  save(second, { mcpServers: { docs: { url: 'http://127.0.0.1:1/mcp?secret=DO_NOT_RECORD', headers: { Authorization: 'DO_NOT_RECORD' }, enabled: false } } });
  const selected = selectCapabilities([], [], [path, second, path]);
  assert.equal(selected.mcp.length, 2);
  assert.doesNotMatch(JSON.stringify(selected), /DO_NOT_RECORD|Authorization/);
  assert.equal(loadMcpSelection(selected.mcp).servers.length, 2);
  save(second, { mcpServers: { chosen: config('collision') } });
  assert.throws(() => selectCapabilities([], [], [path, second]), /Duplicate/);
  save(second, { mcpServers: { 'a-b': config('a'), a_b: config('b') } });
  assert.throws(() => selectCapabilities([], [], [second]), /namespace/);
  for (const value of [{}, [], { mcpServers: { bad: { type: 'sse', url: 'http://localhost' } } }]) {
    save(second, value); assert.throws(() => selectCapabilities([], [], [second]));
  }
  writeFileSync(second, '{"password":"SECRET_PARSE_ERROR",');
  assert.throws(() => selectCapabilities([], [], [second]), e => !e.message.includes('SECRET_PARSE_ERROR'));
  assert.throws(() => selectCapabilities([], [], ['relative.json']), /absolute/);
  assert.throws(() => selectCapabilities([], [], 'not-array'));
  save(path, { mcpServers: { changed: config('changed') } });
  assert.throws(() => loadMcpSelection(selected.mcp), /changed/);
});

test('real Pi: selected MCP alone connects; concurrent Run stays empty; startup discovery and shutdown are observed', { timeout: 30000 }, async () => {
  const { home, repo, path } = fixture(), events = [];
  const base = { cwd: repo, agentDir: home, provider: 'fixture', model: 'fixture' };
  const selected = selectCapabilities([], [probe], [path]);
  const before = [path, join(home, 'mcp.json'), join(repo, '.pi', 'mcp.json')].map(p => readFileSync(p, 'utf8'));
  let stderr = '';
  const pi = startPi({ ...base, capabilities: selected, onEvent: e => events.push(e), spawnProcess: (...args) => {
    const child = spawn(...args); child.stderr.on('data', data => { stderr += data; }); return child;
  } });
  const empty = startPi({ ...base, capabilities: selectCapabilities([], [probe]) });
  try {
    await pi.request('get_state'); await empty.request('get_state');
    await until(() => events.some(e => e.type === 'threshold_mcp' && e.state === 'tools_discovered')).catch(error => {
      assert.fail(`${error.message}: ${stderr} ${JSON.stringify(events.filter(e => ['threshold_mcp', 'extension_error', 'extension_ui_request'].includes(e.type)))}`);
    });
    for (const [worker, expected] of [[pi, true], [empty, false]]) {
      await worker.request('prompt', { message: '/capability-probe' });
      const { messages } = await worker.request('get_messages');
      const observed = JSON.parse(messages.find(m => m.customType === 'capability-probe').content);
      assert.equal(observed.tools.includes('mcp__chosen__echo'), expected);
      assert.ok(!observed.tools.some(name => /mcp__(global|project)/.test(name)));
    }
    assert.deepEqual([path, join(home, 'mcp.json'), join(repo, '.pi', 'mcp.json')].map(p => readFileSync(p, 'utf8')), before);
  } finally {
    assert.equal((await pi.stop()).code, 0); assert.equal((await empty.stop()).code, 0);
  }
  assert.ok(events.some(e => e.type === 'threshold_mcp' && e.state === 'closed'));
  assert.match(readFileSync(join(home, 'chosen.log'), 'utf8'), /"event":"closed"/);
  for (const name of ['global', 'project', 'global-override', 'project-override']) assert.equal(existsSync(join(home, name + '.log')), false);
});

test('CLI -> service -> real Pi executes stdio/HTTP MCP tools, keeps metadata on restart and fresh Runs empty', { timeout: 45000 }, async () => {
  const { home, repo, path, config } = fixture(); git(home, 'init', repo);
  let actions = [], requests = [];
  const httpCalls = [];
  const remote = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(req.method === 'DELETE' ? 204 : 405); res.end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const message = JSON.parse(raw);
    if (message.id === undefined) { res.writeHead(202); res.end(); return; }
    let result = {};
    if (message.method === 'initialize') result = { protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} }, serverInfo: { name: 'local-http-fixture', version: '1' } };
    if (message.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'Echo fixture', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] };
    if (message.method === 'tools/call') { httpCalls.push(message.params); result = { content: [{ type: 'text', text: 'HTTP:' + message.params.arguments.text }] }; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  const api = createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    const action = actions.shift();
    const delta = action ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call-' + requests.length,
      type: 'function', function: { name: action[0], arguments: JSON.stringify(action[1]) } }] } : { role: 'assistant', content: 'Fixture complete' };
    const chunk = { id: 'fixture', object: 'chat.completion.chunk', created: 0, model: 'fixture' };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: action ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  for (const server of [remote, api]) await new Promise(r => server.listen(0, '127.0.0.1', r));
  save(join(home, 'models.json'), { providers: { fixture: { baseUrl: `http://127.0.0.1:${api.address().port}/v1`,
    api: 'openai-completions', apiKey: 'fixture', models: [{ id: 'fixture', contextWindow: 64000, maxTokens: 1024 }] } } });
  const second = join(home, 'http.json');
  save(second, { mcpServers: { http: { url: `http://127.0.0.1:${remote.address().port}/mcp`, exposure: 'direct', headers: { Authorization: 'PRIVATE_CONFIG_VALUE' } } } });
  const stateHome = join(home, 'state');
  let service = await startService({ home: stateHome, agentDir: home, port: 0 });
  const call = async (path, data) => {
    const r = await fetch(service.url + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
    const result = await r.json(); assert.ok(r.ok, JSON.stringify(result)); return result;
  };
  try {
    const p = await call('/projects', { name: 'MCP test', repoPath: repo });
    const t = await call('/tasks', { projectId: p.id, title: 'MCP test', instructions: 'Local fixture' });
    actions = [['mcp__chosen__echo', { text: 'stdio-check' }], ['mcp__http__echo', { text: 'http-check' }]];
    const { stdout } = await promisify(execFile)(process.execPath, [resolve('src/cli.mjs'), 'run', '--home', stateHome, '--json',
      '--task', t.id, '--provider', 'fixture', '--model', 'fixture', '--mcp', path, '--mcp', second], { windowsHide: true });
    const run = JSON.parse(stdout); let ended;
    await until(async () => { ended = await call(`/runs/${run.id}`); return ended.status === 'ended'; });
    assert.equal(ended.error, null); assert.equal(ended.exit_code, 0);
    assert.equal(httpCalls.length, 1); assert.equal(httpCalls[0].arguments.text, 'http-check');
    assert.match(readFileSync(join(home, 'chosen.log'), 'utf8'), /stdio-check/);
    assert.match(JSON.stringify(requests), /MCP:stdio-check/); assert.match(JSON.stringify(requests), /HTTP:http-check/);
    assert.equal(ended.runtimeObservation.mcp.chosen.state, 'closed');
    assert.equal(ended.runtimeObservation.mcp.http.toolCount, 1);
    assert.doesNotMatch(JSON.stringify(ended), /PRIVATE_CONFIG_VALUE|Authorization/);
    assert.match(display(ended), /MCP chosen/);
    assert.match(help('run'), /--mcp/);
    const caps = ended.capabilities;
    await service.close(); service = await startService({ home: stateHome, agentDir: home, port: 0 });
    const historical = await call(`/runs/${run.id}`);
    assert.deepEqual(historical.capabilities, caps); assert.equal(historical.runtimeObservation, undefined);
    // Default codemode exposure uses Pi discovery/execution without a global setup.
    save(path, { mcpServers: { chosen: config('codemode', 'codemode') } });
    actions = [['codemode', { code: 'const r = await tools.mcp__chosen__echo({text:"codemode-check"}); for (const c of r.content ?? []) if (c.type === "text") text(c.text);' }]];
    const coded = await call(`/tasks/${t.id}/runs`, { provider: 'fixture', model: 'fixture', mcp: [path] });
    await until(async () => { ended = await call(`/runs/${coded.id}`); return ended.status === 'ended'; });
    assert.equal(ended.error, null); assert.match(readFileSync(join(home, 'codemode.log'), 'utf8'), /codemode-check/);
    assert.match(JSON.stringify(requests), /MCP:codemode-check/);
    save(path, { mcpServers: { chosen: config('deferred', 'deferred') } });
    actions = [['tool_search', { query: 'echo' }], ['mcp__chosen__echo', { text: 'deferred-check' }]];
    const deferred = await call(`/tasks/${t.id}/runs`, { provider: 'fixture', model: 'fixture', mcp: [path] });
    await until(async () => { ended = await call(`/runs/${deferred.id}`); return ended.status === 'ended'; });
    assert.equal(ended.error, null); assert.match(readFileSync(join(home, 'deferred.log'), 'utf8'), /deferred-check/);
    assert.match(JSON.stringify(requests), /MCP:deferred-check/);
    requests = [];
    const fresh = await call(`/tasks/${t.id}/runs`, { provider: 'fixture', model: 'fixture' });
    await until(async () => { ended = await call(`/runs/${fresh.id}`); return ended.status === 'ended'; });
    assert.deepEqual(fresh.capabilities.mcp, []);
    assert.ok(!requests[0].tools.some(tool => tool.function.name.startsWith('mcp__')));
    assert.equal((await call(`/tasks/${t.id}`)).task.status, 'in_progress');
    for (const name of ['global', 'project', 'global-override', 'project-override']) assert.equal(existsSync(join(home, name + '.log')), false);
  } finally {
    await service.close();
    for (const server of [api, remote]) await new Promise(r => server.close(r));
  }
});

test('guided CLI accepts an absolute MCP file path and Enter leaves the next selection empty', { timeout: 20000 }, async () => {
  const { home, repo, path } = fixture(); git(home, 'init', repo);
  const selected = [];
  const service = await startService({ home: join(home, 'state'), agentDir: home, port: 0, workerFactory: options => {
    selected.push(options.capabilities);
    return { request: async () => ({ sessionId: 'fixture' }), turn: async () => {}, stop: async () => ({ code: 0 }) };
  } });
  const post = async (path, body) => (await fetch(service.url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
  try {
    const p = await post('/projects', { name: 'guided', repoPath: repo });
    const task = await post('/tasks', { projectId: p.id, title: 'guided', instructions: 'Fixture' });
    for (const answer of [path, '']) {
      const child = spawn(process.execPath, ['--import', pathToFileURL(resolve('tests/fixtures/force-tty.mjs')).href, resolve('src/cli.mjs'),
        'run', '--home', join(home, 'state'), '--task', task.id, '--provider', 'fixture'], { windowsHide: true });
      const steps = [['Choose a number', '1'], ['This Run objective', ''], ['Skill path', ''], ['Extension path', ''], ['MCP configuration absolute path', answer]];
      let output = '', errors = '', next = 0;
      child.stdout.on('data', data => {
        output += data;
        if (next < steps.length && output.includes(steps[next][0])) {
          const response = steps[next++][1];
          if (next === steps.length) child.stdin.end(response + '\n'); else child.stdin.write(response + '\n');
        }
      });
      child.stderr.on('data', data => { errors += data; });
      const timer = setTimeout(() => child.kill(), 8000);
      try {
        const code = await new Promise(r => child.on('close', r));
        assert.equal(code, 0, errors + output); assert.equal(next, steps.length);
      } finally { clearTimeout(timer); child.stdin.destroy(); }
    }
    assert.equal(selected[0].mcp[0].path, path); assert.deepEqual(selected[1].mcp, []);
  } finally { await service.close(); }
});

test('real Pi reports connection failure, stops a pending handshake, and rejects a changed selected file', { timeout: 20000 }, async () => {
  const { home, repo, path } = fixture();
  const base = { cwd: repo, agentDir: home, provider: 'fixture', model: 'fixture' };
  save(path, { mcpServers: { bad: { command: join(home, 'does-not-exist'), exposure: 'direct' } } });
  const events = [];
  let pi = startPi({ ...base, capabilities: selectCapabilities([], [], [path]), onEvent: e => events.push(e) });
  try {
    await pi.request('get_state'); await until(() => events.some(e => e.state === 'connection_error'));
  } finally { assert.equal((await pi.stop()).code, 0); }
  const pidFile = join(home, 'pending.pid');
  save(path, { mcpServers: { slow: { command: process.execPath,
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid)); process.stdin.resume();`], exposure: 'direct' } } });
  pi = startPi({ ...base, capabilities: selectCapabilities([], [], [path]) });
  try { await pi.request('get_state'); await until(() => existsSync(pidFile)); }
  finally { const exit = await pi.stop(); assert.equal(exit.code, 0); assert.equal(exit.forced, false); }
  const pid = Number(readFileSync(pidFile, 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  const chosen = selectCapabilities([], [], [path]);
  save(path, { mcpServers: {} });
  pi = startPi({ ...base, capabilities: chosen });
  try { await assert.rejects(pi.request('get_state')); }
  finally { assert.notEqual((await pi.stop()).code, 0); }
});
