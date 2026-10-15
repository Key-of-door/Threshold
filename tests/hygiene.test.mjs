import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

function fixture(t, files) {
  const sandbox = mkdtempSync(join(tmpdir(), 'threshold-hygiene-'));
  // Only remove the exact temporary directory created for this test.
  t.after(() => rmSync(sandbox, { recursive: true, force: true }));
  const root = join(sandbox, 'repo');
  mkdirSync(join(root, 'scripts'), { recursive: true });
  const script = join(root, 'scripts/check-hygiene.mjs');
  copyFileSync(new URL('../scripts/check-hygiene.mjs', import.meta.url), script);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['add', '.'], { cwd: root, stdio: 'pipe' });
  return {
    root, sandbox,
    check() {
      const result = spawnSync(process.execPath, [script], { cwd: sandbox, encoding: 'utf8' });
      assert.equal(result.error, undefined);
      return { status: result.status, output: result.stdout + result.stderr };
    },
  };
}

test('hygiene accepts tracked files, directories, encoded links and examples, ignoring untracked drafts', t => {
  const repo = fixture(t, {
    'README.md': [
      '[guide](docs/%E4%B8%AD%E6%96%87%20guide.md#start)',
      '[docs](docs/)', '[root](./)', '[web](https://example.com/guide)',
      '[section](#start)', '`[example](missing.md)`',
      '```md\n[example](missing.md)\n```',
      ['C:', 'Users', 'LOCAL_USER', 'project'].join('/'),
    ].join('\n'),
    'docs/中文 guide.md': '[README](../README.md)',
  });
  writeFileSync(join(repo.root, 'draft.md'), '[unfinished](missing.md)');
  const result = repo.check();
  assert.equal(result.status, 0, result.output);
});

test('hygiene rejects a repository-external link even when the file exists on the local machine', t => {
  const repo = fixture(t, { 'README.md': '[local-only](../outside.md)' });
  writeFileSync(join(repo.sandbox, 'outside.md'), 'Not part of the repository.');
  const result = repo.check();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /README\.md:.*outside\.md/);
});

test('hygiene reports malformed URL encoding and continues checking other links', t => {
  const repo = fixture(t, { 'README.md': '[bad](broken%ZZ.md)\n[missing](missing.md)' });
  const result = repo.check();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /invalid URL encoding.*broken%ZZ\.md/);
  assert.match(result.output, /broken link.*missing\.md/);
  assert.doesNotMatch(result.output, /URIError/);
});

test('hygiene reports a tracked Markdown file deleted from the working tree without crashing', t => {
  const repo = fixture(t, { 'README.md': '# Example' });
  rmSync(join(repo.root, 'README.md'));
  const result = repo.check();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /README\.md: cannot read tracked Markdown file/);
  assert.doesNotMatch(result.output, /at readFileSync/);
});

test('hygiene catches personal paths in Markdown code examples and ordinary text files', t => {
  const personalHome = ['', 'home', 'hygiene-fixture', 'project'].join('/');
  const personalWindows = ['C:', 'Users', 'hygiene-fixture', 'project'].join('\\');
  const repo = fixture(t, {
    'README.md': '```sh\n' + personalHome + '\n```',
    'notes.txt': personalWindows,
  });
  const result = repo.check();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /README\.md:2: personal path/);
  assert.match(result.output, /notes\.txt:1: personal path/);
});
