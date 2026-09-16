import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
export function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000, maxBuffer: 1024 * 1024 }).trimEnd();
}
export function observeGit(cwd) {
  const observedAt = new Date().toISOString();
  try {
    const branch = git(cwd, 'branch', '--show-current'), status = git(cwd, 'status', '--short');
    let head;
    try { head = git(cwd, 'rev-parse', '--verify', 'HEAD^{commit}'); }
    catch (error) {
      // Git explicitly identifies an unborn branch; other HEAD failures stay failures.
      const headers = git(cwd, 'status', '--porcelain=v2', '--branch').split(/\r?\n/);
      if (!headers.includes('# branch.oid (initial)')) throw error;
      head = null;
    }
    return { source: 'git_observation', observedAt, head, branch, status };
  }
  catch { return { source: 'git_observation', observedAt, error: 'Git observation failed; recheck the workspace' }; }
}
export function worktreePath(projectRepo, requested = projectRepo) {
  const path = realpathSync(requested);
  if (realpathSync(git(path, 'rev-parse', '--show-toplevel')) !== path)
    throw new Error('Use the Git worktree root');
  const common = cwd => realpathSync(git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
  if (common(path) !== common(projectRepo)) throw new Error('Workspace must belong to the Project Git repository');
  return path;
}
