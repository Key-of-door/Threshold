import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const run = (...args) => promisify(execFile)(process.execPath, [cli, ...args], { windowsHide: true });
const noStack = text => !/\n\s+at /.test(text);

test('unknown option and missing option value are ordinary stderr errors without a stack trace', async () => {
  for (const args of [['--unknown-option'], ['status', '--task'], ['status', '--after']]) {
    await assert.rejects(run(...args), error => {
      assert.equal(error.code, 1);
      assert.notEqual(error.stderr.trim(), '');
      assert.ok(noStack(error.stderr), `stack trace leaked for ${args.join(' ')}`);
      return true;
    });
  }
});

test('unknown command fails with usage on stderr; no-argument usage stays successful', async () => {
  await assert.rejects(run('statuz'), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Unknown command: statuz/);
    assert.match(error.stderr, /threshold serve/);
    assert.ok(noStack(error.stderr));
    return true;
  });
  const { stdout, stderr } = await run();
  assert.match(stdout, /threshold serve/);
  assert.equal(stderr, '');
});
