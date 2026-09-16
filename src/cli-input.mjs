import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { readable } from './cli-format.mjs';

// Small terminal-only prompts. Pipes/JSON never consume answers or credentials.
export function prompts(input = process.stdin, output = process.stdout) {
  if (!input.isTTY || !output.isTTY) throw new Error('This command needs an interactive terminal. Use explicit flags for scripts.');
  async function ask(label, { fallback = '', secret = false, required = false } = {}) {
    for (;;) {
      output.write(`${readable(label)}${fallback ? ` [${readable(fallback)}]` : ''}: `);
      const sink = secret ? new Writable({ write(_chunk, _encoding, next) { next(); } }) : output;
      const rl = createInterface({ input, output: sink, terminal: true, historySize: 0 });
      const answer = await new Promise((resolve, reject) => {
        let answered = false;
        rl.once('line', line => { answered = true; resolve(line.trim()); rl.close(); });
        rl.once('SIGINT', () => { rl.close(); });
        rl.once('close', () => { if (!answered) reject(new Error('Cancelled.')); });
      }).finally(() => { rl.close(); if (secret) output.write('\n'); });
      const value = answer || fallback;
      if (!required || value) return value;
      output.write('Please enter a value. Ctrl+C cancels.\n');
    }
  }
  async function choose(label, entries, defaultId) {
    if (!entries.length) throw new Error(`No ${label.toLowerCase()} available.`);
    output.write(`\n${readable(label)}\n`);
    entries.forEach((entry, i) => output.write(`  ${i + 1}. ${readable(entry.label)}\n`));
    const defaultIndex = entries.findIndex(entry => entry.id === defaultId);
    for (;;) {
      const answer = await ask('Choose a number', { fallback: defaultIndex < 0 ? '' : String(defaultIndex + 1), required: true });
      const entry = /^\d+$/.test(answer) ? entries[Number(answer) - 1] : entries.find(row => row.id === answer);
      if (entry) return entry.id;
      output.write('Choose one of the listed numbers.\n');
    }
  }
  return { ask, choose, confirm: async label => /^(y|yes)$/i.test(await ask(`${label} (y/N)`)) };
}
