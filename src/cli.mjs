#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { startService } from './service.mjs';

const usage = 'threshold serve | project create | board | task create | task update | message send | message read | status | run | stop | decision\nSee README.md for flags and local service limits.';

async function main() {
  let args, commands;
  try {
    ({ values: args, positionals: commands } = parseArgs({ allowPositionals: true, options:
      { ...Object.fromEntries(['home', 'agent-dir', 'port', 'name', 'repo', 'project', 'title', 'instructions', 'task', 'provider', 'model', 'run', 'target', 'value', 'objective', 'status', 'note', 'body', 'after', 'limit', 'workspace', 'max-parallel-runs', 'max-runs'].map(key => [key, { type: 'string' }])),
        skill: { type: 'string', multiple: true }, extension: { type: 'string', multiple: true } } }));
  } catch (error) { console.error(error.message); return 1; }
  const home = resolve(args.home ?? '.local/threshold');
  const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  async function call(path, data, human = false) {
    const { url } = JSON.parse(readFileSync(join(home, 'server.json'), 'utf8'));
    const headers = { 'content-type': 'application/json' };
    if (human) headers.authorization = `Bearer ${readFileSync(join(home, 'human.key'), 'utf8').trim()}`;
    const response = await fetch(new URL(path, url), { method: data === undefined ? 'GET' : 'POST',
      headers, body: data === undefined ? undefined : JSON.stringify(data), redirect: 'error', signal: AbortSignal.timeout(60000) });
    const result = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error}`);
    return result;
  }
  if (!commands.length) { console.log(usage); return 0; }
  try {
    switch (commands.join(' ')) {
      case 'serve': {
        const port = Number(args.port ?? 8765);
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
        const service = await startService({ home, port, agentDir: args['agent-dir'] ?? join(homedir(), '.pi', 'agent'),
          maxParallelRuns: Number(args['max-parallel-runs'] ?? 3), maxRuns: Number(args['max-runs'] ?? 100) });
        print({ listening: service.url, home });
        for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { service.close().catch(() => { process.exitCode = 1; }); });
        break;
      }
      case 'project create': print(await call('/projects', { name: args.name, repoPath: args.repo && resolve(args.repo) })); break;
      case 'board': print(await call(`/projects/${encodeURIComponent(args.project ?? '')}/board`)); break;
      case 'task create': print(await call('/tasks', { projectId: args.project, title: args.title, instructions: args.instructions })); break;
      case 'task update': print(await call(`/tasks/${encodeURIComponent(args.task ?? '')}/status`, { status: args.status, note: args.note })); break;
      case 'message send': print(await call(`/tasks/${encodeURIComponent(args.task ?? '')}/messages`, { body: args.body })); break;
      case 'message read': print(await call(`/tasks/${encodeURIComponent(args.task ?? '')}/messages?after=${encodeURIComponent(args.after ?? '0')}&limit=${encodeURIComponent(args.limit ?? '10')}`)); break;
      case 'status': print(await call(args.task ? `/tasks/${encodeURIComponent(args.task)}` : args.run ? `/runs/${encodeURIComponent(args.run)}` : '/status')); break;
      case 'run': print(await call(`/tasks/${encodeURIComponent(args.task ?? '')}/runs`, { provider: args.provider, model: args.model, objective: args.objective,
        workspacePath: args.workspace && resolve(args.workspace), skills: args.skill?.map(path => resolve(path)), extensions: args.extension?.map(path => resolve(path)) })); break;
      case 'stop': print(await call(args.run ? `/runs/${encodeURIComponent(args.run)}/stop` : '/shutdown', {})); break;
      case 'decision': print(await call('/human/decisions', { taskId: args.task, target: args.target, decision: args.value }, true)); break;
      default:
        console.error(`Unknown command: ${commands.join(' ')}\n${usage}`);
        return 1;
    }
  } catch (error) { console.error(error.message); return 1; }
  return 0;
}

process.exitCode = await main();
