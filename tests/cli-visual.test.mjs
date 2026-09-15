import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { display, help } from '../src/cli-display.mjs';
import { terminalOptions, displayError, preview } from '../src/cli-format.mjs';
import stringWidth from 'string-width';

const tty = { isTTY: true, columns: 80, getColorDepth: () => 24 };
const colorful = terminalOptions(tty, {}, {});
const run = { id: 'a317c29d-full', task_id: '82e3ec1a-full', provider: 'fixture', model: 'fixture', objective: 'Review actual files',
  status: 'ended', exit_code: 0, error: null, capabilities: { skills: [], extensions: [] } };
const plain = text => stripVTControlCharacters(text);

test('terminal decorations follow destination, NO_COLOR, dumb terminals and visual flags', () => {
  assert.match(help('', colorful), /╭────╮/);
  assert.match(help('', colorful), /\x1b\[/);
  for (const [stream, args, env] of [[{}, {}, { FORCE_COLOR: '3' }], [tty, {}, { NO_COLOR: '' }], [tty, {}, { TERM: 'dumb' }], [tty, { 'no-color': true }, {}]]) {
    const options = terminalOptions(stream, args, env), output = help('', options);
    assert.doesNotMatch(output, /\x1b\[/);
    if (!stream.isTTY || env.TERM === 'dumb') assert.doesNotMatch(output, /╭|●|\(o O\)/);
  }
  assert.match(help('', terminalOptions(tty, { ascii: true }, {})), /\(o O\)/);
  assert.doesNotMatch(help('', terminalOptions(tty, { json: true }, {})), /\x1b|╭|\(o O\)/);
  assert.doesNotMatch(displayError('Technical failure', colorful), /╭|\(o O\)/);
  assert.doesNotMatch(display(run, colorful), /╭|\(o O\)/);
  assert.match(display({ listening: 'http://127.0.0.1:8765', home: '/state' }, colorful), /╭────╮/);
});

test('ended is neutral; error, nonzero exit and unknown remain distinct observations', () => {
  const ended = display(run, colorful);
  assert.match(plain(ended), /— ended/);
  assert.doesNotMatch(ended, /\x1b\[32m|\x1b\[31m|38;2;239|PASSED|success/);
  const failure = plain(display({ ...run, error: 'model turn: limit reached' }, colorful));
  assert.match(failure, /ended · error\/interruption/);
  assert.match(failure, /limit reached/);
  assert.match(failure, /checkpoint and current files/);
  assert.match(plain(display({ ...run, exit_code: 2 }, colorful)), /ended · exit 2/);
  assert.match(plain(display({ ...run, status: 'unknown', exit_code: null }, colorful)), /\? unknown/);
  assert.match(failure, /Not held in this service process/);
  assert.doesNotMatch(failure, /0 calls|no effects|Task is done/);
});

test('messages retain order, disagreement and long bodies, and expose continuation cursor', () => {
  const body = 'The file exists.\n'+('Checked the actual files. '.repeat(100))+'\nEND OF NOTE';
  const output = display({ taskId: '82e3ec1a-full', messages: [
    { id: 4, source: 'agent', from_run_id: 'a317c29d-full', body: 'The file is missing.' },
    { id: 5, source: 'agent', from_run_id: 'b028dc71-full', body }], hasMore: true, nextAfter: 5 }, colorful);
  assert.ok(plain(output).includes(body));
  assert.ok(output.indexOf('missing') < output.indexOf('exists'));
  assert.match(plain(output), /threshold message read --task 82e3ec1a --after 5/);
  assert.doesNotMatch(output, /╭|consensus|corrected automatically/);
  const control = display({ body: '\x1b[2Jdo not erase other messages\rrewrite', id: 6, source: 'client' });
  assert.doesNotMatch(control, /\x1b|\r/);
  assert.match(control, /do not erase other messages\\rrewrite/);
});

test('capability paths and SHA stay Run-local; selection and missing observations are honest', () => {
  const capabilities = { skills: [{ path: 'E:\\caps\\reviewer\\SKILL.md', sha256: 'a'.repeat(64) }], extensions: [{ path: '/caps/scheduler/index.ts', sha256: 'b'.repeat(64) }] };
  const output = plain(display({ ...run, capabilities }, { ...colorful, columns: 38 }));
  assert.match(output, /Skill\n  reviewer/);
  assert.ok(output.includes(capabilities.skills[0].path));
  assert.ok(output.includes('a'.repeat(64)));
  assert.match(output, /Extension\n  scheduler/);
  assert.match(output, /does not establish extension loading or execution/);
  assert.match(output, /next Run inherits no selection/);
  assert.match(display({ ...run, capabilities: null }), /Selection was not recorded/);
  assert.doesNotMatch(display(run), /reviewer|scheduler/);
});

test('Board keeps parallel Runs flat, budgets global and full text on Task detail', () => {
  const project = { id: 'ef2e9b18-full', name: '项目 / Project', repo_path: 'E:/项目' };
  const checkpoint = { summary: 'First line\nSecond line\nLast line', run_id: run.id };
  const task = { id: run.task_id, title: 'Review the CLI', status: 'in_progress', instructions: 'Full task', latestRun: { ...run, status: 'running' },
    unsettledRuns: [{ ...run, status: 'running' }, { ...run, id: 'b028dc71-full', status: 'unknown' }], checkpoint, messageInbox: { count: 2 } };
  const board = plain(display({ project, tasks: [task], resources: { unsettled: 3, maxParallelRuns: 3, started: 12, maxRuns: 100, remainingStarts: 88 } }, { ...colorful, columns: 38 }));
  assert.match(board, /项目 \/ Project\nproject ef2e9b18/);
  assert.equal((board.match(/a317c29d/g) ?? []).length, 1);
  assert.match(board, /unknown  b028dc71/);
  assert.match(board, /Across all Projects in this service home/);
  assert.doesNotMatch(board, /3 running|Second line/);
  const detail = plain(display({ task, project, checkpoint, recentRuns: [run], messageInbox: task.messageInbox }, colorful));
  assert.ok(detail.includes(checkpoint.summary));
  assert.match(detail, /Agent summary/);
  assert.match(display({ projects: [], tasks: [] }, { unregisteredRepo: 'E:/new-repo' }), /No Project here yet[\s\S]*threshold project create/);
});

test('Board excerpts use display columns and preserve complete Unicode graphemes', () => {
  assert.equal(preview('中文测试', 5), '中文…');
  assert.equal(preview('e\u0301e\u0301e\u0301e\u0301', 3), 'e\u0301e\u0301…');
  assert.equal(preview('👩🏽‍💻👩🏽‍💻👩🏽‍💻', 5), '👩🏽‍💻👩🏽‍💻…');
  assert.equal(preview('🇨🇳🇯🇵🇬🇧', 5), '🇨🇳🇯🇵…');
  assert.equal(preview('\x1b[31m中文测试\x1b[0m', 5), '中文…');
  assert.equal(preview('abc\tdef', 7), 'abc def');
  assert.equal(preview('abc\ncontinued', 8), 'abc…');
  assert.equal(preview('abc\n', 3), 'abc');
  assert.equal(preview('abcdef', 5, true), 'ab...');
  assert.equal(preview('abcdef', 2, true), '..');
  assert.equal(preview('中文', 1), '…');
  assert.equal(preview('中文', 0), '');
  assert.equal(preview('中文', 4), '中文');
});

test('long real Board prose stays compact without mutating data or clipping detail', () => {
  const objective = '实现 parser 👩🏽‍💻 e\u0301 '.repeat(40) + 'OBJECTIVE END';
  const summary = '核查真实文件和 Git '.repeat(40) + '\nCHECKPOINT END';
  const project = { id: '12345678', name: 'Project', repo_path: '/repo' };
  const checkpoint = { summary, run_id: run.id };
  const task = { id: run.task_id, title: 'Parse', status: 'in_progress', instructions: 'Full instructions',
    latestRun: { ...run, objective, status: 'running' }, unsettledRuns: [], checkpoint, messageInbox: { count: 0 } };
  const value = { project, tasks: [task], resources: { unsettled: 1, maxParallelRuns: 3, started: 1, maxRuns: 10, remainingStarts: 9 } };
  const original = JSON.stringify(value);
  for (const columns of [32, 72, 100]) {
    const output = plain(display(value, { ...colorful, columns }));
    const objectiveLine = output.split('\n').find(line => line.includes('实现'));
    const checkpointLine = output.split('\n').find(line => line.includes('核查'));
    assert.ok(stringWidth(objectiveLine) < columns);
    assert.ok(stringWidth(checkpointLine) < columns);
    assert.ok(objectiveLine.endsWith('…'));
    assert.ok(checkpointLine.endsWith('…'));
    assert.doesNotMatch(output, /OBJECTIVE END|CHECKPOINT END/);
    assert.match(output, /● running  a317c29d/);
  }
  assert.equal(JSON.stringify(value), original);
  const detail = plain(display({ task, project, checkpoint, recentRuns: [task.latestRun], messageInbox: task.messageInbox }, colorful));
  assert.ok(detail.includes(summary));
  assert.ok(detail.includes(objective));
  assert.ok(plain(display({ ...run, objective }, colorful)).includes(objective));
});
