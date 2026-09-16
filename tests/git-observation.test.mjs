import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { git, observeGit } from '../src/git.mjs';

test('Git observation retains branch and changes before the first commit, then observes committed and detached HEAD', () => {
  const repo = mkdtempSync(join(tmpdir(), 'threshold-git-'));
  git(repo, 'init', '--initial-branch=main');
  writeFileSync(join(repo, 'notes.txt'), 'work in progress');
  writeFileSync(join(repo, '中文.txt'), '内容');
  const unborn = observeGit(repo);
  assert.equal(unborn.source, 'git_observation');
  assert.equal(unborn.head, null); assert.equal(unborn.branch, 'main');
  assert.equal(unborn.error, undefined);
  assert.equal(unborn.status, git(repo, 'status', '--short'));
  assert.match(unborn.status, /notes.txt/);
  assert.ok(Number.isFinite(Date.parse(unborn.observedAt)));

  git(repo, 'add', '.');
  git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'First commit');
  const head = git(repo, 'rev-parse', 'HEAD');
  assert.equal(observeGit(repo).head, head);
  assert.equal(observeGit(repo).status, '');
  git(repo, 'checkout', '--detach', head);
  assert.equal(observeGit(repo).branch, '');
  assert.equal(observeGit(repo).head, head);

  // A broken commit reference is not an empty repository.
  writeFileSync(join(repo, '.git', 'HEAD'), 'f'.repeat(40)+'\n');
  const broken = observeGit(repo);
  assert.match(broken.error, /Git observation failed/);
  assert.equal('head' in broken, false);
  assert.match(observeGit(join(repo, 'missing-folder')).error, /Git observation failed/);
});
