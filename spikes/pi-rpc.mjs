// Small process/RPC probe shared by Phase A and B; not a stable cross-runtime API.
import { spawn } from 'node:child_process';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export function connectPi({ cli, cwd, agentDir, sessionDir, label, provider, model,
  toolNames, extensions = [], env = {}, onRecord = () => {} }) {
  const events = [];
  const pending = new Map();
  let seq = 0, buffer = '', bytes = 0, closed = false, terminalError;
  const child = spawn(process.execPath, [cli, '--mode', 'rpc', '--offline',
    '--no-extensions', '--no-skills', '--no-context-files', '--no-prompt-templates', '--no-themes',
    '--no-approve', '--tools', toolNames.join(','), '--provider', provider,
    ...extensions.flatMap(path => ['--extension', path]),
    '--session-dir', sessionDir, '--name', `threshold-spike-${label}`,
    ...(model ? ['--model', model, '--thinking', 'low'] : [])], {
    cwd, shell: false, windowsHide: true,
    env: { ...process.env, ...env, PI_CODING_AGENT_DIR: agentDir, PI_TELEMETRY: '0' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const log = record => {
    const line = JSON.stringify(record);
    bytes += Buffer.byteLength(line);
    if (bytes > 4 * 1024 * 1024) throw new Error('probe telemetry size limit exceeded');
    onRecord(record);
  };
  const fail = error => {
    terminalError = error;
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', text => { try { log({ stderr: text }); } catch (e) { fail(e); child.kill(); } });
  child.stdout.on('data', chunk => {
    try {
      buffer += chunk;
      if (buffer.length > 4 * 1024 * 1024) throw new Error('unterminated RPC frame too large');
      let n;
      while ((n = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, n).replace(/\r$/, '');
        buffer = buffer.slice(n + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        log({ event }); events.push(event);
        if (event.type === 'response' && pending.has(event.id)) {
          const p = pending.get(event.id); pending.delete(event.id);
          event.success ? p.resolve(event.data) : p.reject(new Error(event.error));
        }
      }
    } catch (e) { fail(e); child.kill(); }
  });
  const done = new Promise(resolveDone => child.on('close', (code, signal) => {
    closed = true;
    const exit = { code, signal, trailingPartialFrame: buffer.length > 0 };
    fail(new Error(`Pi process closed: ${JSON.stringify(exit)}`));
    log({ exit }); resolveDone(exit);
  }));
  const request = (type, args = {}, timeout = 20000) => new Promise((resolveRequest, reject) => {
    if (closed || terminalError) return reject(terminalError ?? new Error('Pi closed'));
    const id = `${label}-${++seq}`;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`RPC timeout: ${type}`)); }, timeout);
    pending.set(id, {
      resolve: data => { clearTimeout(timer); resolveRequest(data); },
      reject: error => { clearTimeout(timer); reject(error); },
    });
    child.stdin.write(JSON.stringify({ id, type, ...args }) + '\n');
  });
  return { child, events, request, done,
    async waitFor(predicate, timeout = 90000) {
      const until = Date.now() + timeout;
      while (Date.now() < until) {
        const value = events.find(predicate);
        if (value) return value;
        if (terminalError) throw terminalError;
        await pause(50);
      }
      throw new Error('event wait timeout');
    },
    async close() {
      if (!closed) child.stdin.end();
      const timer = setTimeout(() => { if (!closed) child.kill(); }, 5000);
      try { return await done; } finally { clearTimeout(timer); }
    },
  };
}
