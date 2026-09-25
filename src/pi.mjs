import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

// A Pi process client, not a cross-runtime abstraction. No project state lives here.
export function startPi({ cwd, agentDir, provider, model, env, modelSettings = {}, capabilities = { skills: [], extensions: [] }, onEvent = () => {}, spawnProcess = spawn }) {
  const cli = fileURLToPath(new URL('../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js', import.meta.url));
  const extension = fileURLToPath(new URL('./extension.ts', import.meta.url));
  const child = spawnProcess(process.execPath, [cli, '--mode', 'rpc', '--offline', '--no-extensions',
    '--no-skills', '--no-context-files', '--no-prompt-templates', '--no-themes', '--no-approve',
    ...capabilities.skills.flatMap(file => ['--skill', file.path]),
    ...capabilities.extensions.flatMap(file => ['--extension', file.path]),
    '--extension', extension, '--provider', provider, '--model', model, '--thinking', modelSettings.thinking ?? 'low',
    '--no-session'], { cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env, PI_CODING_AGENT_DIR: agentDir, PI_TELEMETRY: '0', THRESHOLD_MODEL_SETTINGS: JSON.stringify(modelSettings) } });
  const bus = new EventEmitter(), pending = new Map();
  let buffer = '', sequence = 0, requestId = 0, closed = false, lastError, forced = false;
  const fail = error => {
    lastError = error;
    for (const p of pending.values()) p.reject(error);
    pending.clear(); bus.emit('failed', error);
  };
  child.on('error', fail); child.stdin.on('error', fail);
  child.stdout.setEncoding('utf8');
  // Drain stderr without copying diagnostic output into durable project history.
  child.stderr.resume();
  child.stdout.on('data', chunk => {
    try {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 8 * 1024 * 1024) throw new Error('Pi RPC frame exceeded 8 MiB');
      let n;
      while ((n = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, n).replace(/\r$/, ''); buffer = buffer.slice(n + 1);
        if (!line) continue;
        const event = JSON.parse(line); sequence++;
        if (event.type === 'response' && pending.has(event.id)) {
          const p = pending.get(event.id); pending.delete(event.id);
          event.success ? p.resolve(event.data) : p.reject(new Error(event.error));
        }
        bus.emit('event', event, sequence);
        onEvent(event);
      }
    } catch (error) { fail(error); forced = true; child.kill(); }
  });
  const done = new Promise(resolve => child.on('close', (code, signal) => {
    closed = true; fail(new Error('Pi process closed'));
    resolve({ code, signal, forced, partialFrame: buffer.length > 0 });
  }));
  function request(type, args = {}, timeout = 20000) {
    return new Promise((resolve, reject) => {
      if (closed || lastError) return reject(lastError ?? new Error('Pi is closed'));
      const id = String(++requestId);
      const timer = setTimeout(() => { pending.delete(id); reject(Object.assign(new Error(`Pi ${type} timeout`), { code: 'THRESHOLD_RPC_TIMEOUT' })); }, timeout);
      pending.set(id, { resolve: data => { clearTimeout(timer); resolve(data); }, reject: error => { clearTimeout(timer); reject(error); } });
      child.stdin.write(JSON.stringify({ id, type, ...args }) + '\n');
    });
  }
  let stopping;
  return {
    pid: child.pid, request, closed: done,
    async turn(message, timeout = 0) {
      const cursor = sequence;
      let clean;
      const ended = new Promise((resolve, reject) => {
        const onEvent = (event, seq) => { if (seq > cursor && event.type === 'agent_settled') { clean(); resolve(event); } };
        const onFail = error => { clean(); reject(error); };
        const timer = timeout > 0 ? setTimeout(() => onFail(Object.assign(new Error('Pi turn timed out'), { code: 'THRESHOLD_TURN_TIMEOUT', timeoutMs: timeout })), timeout) : undefined;
        clean = () => { clearTimeout(timer); bus.off('event', onEvent); bus.off('failed', onFail); };
        bus.on('event', onEvent); bus.on('failed', onFail);
      });
      // Observe both promises immediately, including errors before prompt acknowledgement.
      try { return (await Promise.all([request('prompt', { message }), ended]))[1]; }
      finally { clean(); }
    },
    stop() {
      return stopping ??= (async () => {
        if (closed) return done;
        try {
          await request('clear_queue', {}, 5000); await request('abort', {}, 5000);
          // Abort acknowledges the request; wait for Pi to report idle before EOF.
          const deadline = Date.now() + 5000;
          while ((await request('get_state', {}, 5000)).isStreaming) {
            if (Date.now() > deadline) throw new Error('Pi did not become idle');
            await new Promise(resolve => setTimeout(resolve, 50));
          }
        } catch { forced = true; }
        if (!closed) child.stdin.end();
        const timer = setTimeout(() => { if (!closed) { forced = true; child.kill(); } }, 5000);
        try { return await done; } finally { clearTimeout(timer); }
      })();
    },
  };
}
