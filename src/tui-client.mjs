import { readFile, realpath, stat } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runSettings } from './run-settings.mjs';
import { executionSettings } from './execution.mjs';

const exec = promisify(execFile);
export async function gitRead(workspace, ...args) {
  const { stdout } = await exec('git', ['-C', workspace, ...args], { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
  return stdout.trimEnd();
}

export function serviceClient(home, { fetchImpl = fetch, signal } = {}) {
  return async (path, data) => {
    const write = data !== undefined;
    let info;
    try { info = JSON.parse(await readFile(join(home, 'server.json'), 'utf8')); }
    catch { throw Object.assign(new Error(`No readable service address in ${home}. Use Service / start, or threshold service start --home "${home}".`), { unavailable: true }); }
    let response, result;
    try {
      response = await fetchImpl(new URL(path, info.url), { method: write ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json' }, body: write ? JSON.stringify(data) : undefined,
        redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(write ? 60000 : 5000)]) : AbortSignal.timeout(write ? 60000 : 5000) });
      result = await response.json();
    } catch {
      throw Object.assign(new Error(write ? 'Write outcome unconfirmed. Inspect the destination before sending again.' : 'Connection lost. Last snapshot retained; worker state is unconfirmed.'), { unavailable: true, uncertain: write });
    }
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}: ${result.error ?? 'Service request failed'}`),
      { status: response.status, uncertain: write && (response.status >= 500 || /unconfirmed/i.test(result.error ?? '')) });
    return result;
  };
}

export async function resolveId(call, kind, prefix, projectId) {
  if (!/^[a-f0-9-]{1,36}$/i.test(prefix ?? '')) throw new Error(`Use a ${kind} ID or unique hexadecimal prefix.`);
  const query = new URLSearchParams({ kind, prefix: prefix.toLowerCase(), ...(projectId ? { projectId } : {}) });
  const { matches, hasMore } = await call(`/lookup?${query}`);
  if (matches.length !== 1 || hasMore) throw new Error(matches.length ? `Ambiguous ${kind}:\n${matches.map(m => `${m.id} ${m.label ?? ''}`).join('\n')}` : `No matching ${kind}.`);
  return matches[0].id;
}

export async function projectAtCwd(projects, cwd) {
  let common;
  try { common = await realpath(await gitRead(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir')); } catch { return undefined; }
  const matches = [];
  for (const p of projects) {
    try { if (await realpath(await gitRead(p.repo_path, 'rev-parse', '--path-format=absolute', '--git-common-dir')) === common) matches.push(p); } catch { /* Unreadable registered roots stay inspectable in the picker. */ }
  }
  if (matches.length > 1) throw new Error('More than one Project matches cwd; select the Project explicitly.');
  return matches[0];
}

export function runDraft(project, catalog = {}, timeout = 1800) {
  return { provider: catalog.defaultProvider ?? '', model: catalog.defaultModel ?? '', thinking: 'low', contextWindow: '', maxOutputTokens: '',
    mode: 'interactive', turnTimeoutSeconds: String(timeout), objective: '', workspacePath: project.repo_path, skills: '', extensions: '' };
}

export function runPayload(draft, cwd) {
  for (const key of ['provider', 'model', 'workspacePath']) if (!draft[key]?.trim()) throw new Error(`${key} is required.`);
  if (!['interactive', 'background'].includes(draft.mode)) throw new Error('Choose interactive or background.');
  const interactive = draft.mode === 'interactive';
  let timeout;
  if (!interactive) {
    if (!/^(0|[1-9][0-9]*)$/.test(draft.turnTimeoutSeconds)) throw new Error('Timeout must be integer seconds; 0 disables it.');
    timeout = Number(draft.turnTimeoutSeconds);
  }
  executionSettings(interactive, timeout);
  const settings = { thinking: draft.thinking };
  for (const key of ['contextWindow', 'maxOutputTokens']) {
    if (!draft[key]?.trim()) continue;
    if (!/^[1-9][0-9]*$/.test(draft[key])) throw new Error(`${key} must be a positive integer or empty for Pi default.`);
    settings[key] = Number(draft[key]);
  }
  const paths = text => text.split(/\r?\n/).map(p => p.trim()).filter(Boolean).map(p => resolve(cwd, p));
  return { provider: draft.provider.trim(), model: draft.model.trim(), interactive,
    modelSettings: runSettings(settings), ...(timeout === undefined ? {} : { turnTimeoutSeconds: timeout }),
    ...(draft.objective.trim() ? { objective: draft.objective } : {}), workspacePath: resolve(cwd, draft.workspacePath),
    skills: paths(draft.skills), extensions: paths(draft.extensions) };
}

export async function workspaceObservation(workspace, kind = 'status') {
  const observedAt = new Date().toISOString();
  if (kind === 'diff') {
    const options = ['--no-pager', '-c', 'core.pager=cat', 'diff', '--no-ext-diff', '--no-textconv'];
    const unstaged = await gitRead(workspace, ...options);
    const staged = await gitRead(workspace, ...options, '--cached');
    return { workspace, observedAt, text: `Unstaged tracked changes\n${unstaged || '(none)'}\n\nStaged changes\n${staged || '(none)'}\n\nUntracked files are listed by status, not included in this diff.` };
  }
  return { workspace, observedAt, text: await gitRead(workspace, 'status', '--short', '--branch') || 'Working tree clean.' };
}

export async function workspaceFile(workspace, filename) {
  const root = await realpath(workspace), file = await realpath(resolve(root, filename));
  const rel = relative(root, file);
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Choose a file within the selected workspace.');
  const metadata = await stat(file);
  if (!metadata.isFile() || metadata.size > 128 * 1024) throw new Error('Text preview supports regular files up to 128 KiB. Use your editor for larger files.');
  const bytes = await readFile(file);
  if (bytes.includes(0)) throw new Error('Binary file; use an appropriate external viewer.');
  return { workspace: root, observedAt: new Date().toISOString(), text: `${file}\n\n${bytes.toString('utf8')}` };
}

// Write state belongs to a client operation/target, never to a Run or Task lifecycle.
export class WriteGate {
  constructor(call) { this.call = call; this.pending = false; this.uncertain = new Map(); }
  async send(key, path, data) {
    if (this.pending) throw new Error('A write is pending; no second request was sent.');
    if (this.uncertain.has(key)) throw new Error('Previous outcome is unconfirmed. Inspect the destination, then explicitly unlock retry.');
    this.pending = true;
    try { return await this.call(path, data); }
    catch (error) { if (error.uncertain) this.uncertain.set(key, { path, at: new Date().toISOString() }); throw error; }
    finally { this.pending = false; }
  }
  allowRetry(key) { if (this.pending) return; this.uncertain.delete(key); }
}
