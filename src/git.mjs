import { execFileSync } from 'node:child_process';
export function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, maxBuffer: 1024 * 1024 }).trimEnd();
}
export function observeGit(cwd) {
  const observedAt = new Date().toISOString();
  try { return { source: 'git_observation', observedAt, head: git(cwd, 'rev-parse', 'HEAD'), branch: git(cwd, 'branch', '--show-current'), status: git(cwd, 'status', '--short') }; }
  catch { return { source: 'git_observation', observedAt, error: 'Git observation failed; recheck the workspace' }; }
}
