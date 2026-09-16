import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export function readServiceInfo(home) {
  try { return JSON.parse(readFileSync(join(home, 'server.json'), 'utf8')); }
  catch { return undefined; }
}
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
export async function serviceState(home) {
  const info = readServiceInfo(home);
  let lock;
  try { lock = JSON.parse(readFileSync(join(home, 'server.lock'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') return { state: 'unconfirmed', home }; }
  if (info && alive(info.pid)) {
    try {
      const response = await fetch(new URL('/status', info.url), { signal: AbortSignal.timeout(1500), redirect: 'error' });
      const data = await response.json();
      if (response.ok && Array.isArray(data.projects) && Array.isArray(data.tasks)) return { state: 'running', home, ...info };
    } catch { /* Process may be starting or unresponsive. Do not infer it is dead. */ }
  }
  if (alive(lock?.pid) || alive(info?.pid)) return { state: 'unconfirmed', home };
  return { state: info || lock ? 'stale' : 'stopped', home };
}

export async function startBackground(cli, args, home) {
  const previous = await serviceState(home);
  if (previous.state === 'running') return { ...previous, alreadyRunning: true };
  if (previous.state !== 'stopped') throw new Error(previous.state === 'stale'
    ? `Service process has exited, but runtime markers remain in ${home}. Check old workers before removing server.lock/server.json; keep project.sqlite and history. No second service was started.`
    : `Service state is unconfirmed in ${home}. Inspect the existing process before restarting. No second service was started.`);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'serve', ...args], { detached: true, windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: process.env });
    let settled = false;
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (child.connected) child.disconnect(); child.unref();
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Background startup is unconfirmed. Run threshold service status before retrying.')), 15000);
    child.once('error', () => finish(new Error('Could not launch Node for the background service. Check the installed runtime.')));
    child.once('exit', () => finish(new Error('Background service exited during startup. Run threshold serve to inspect startup.')));
    child.on('message', message => {
      if (message.ready) finish(null, { state: 'running', home, ...message.ready });
      else if (message.error) finish(new Error(message.error));
    });
  });
}
