import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

// A Board excerpt is one terminal line, not an arbitrary number of code units.
// Keep grapheme clusters intact; terminal/font-specific ambiguous widths can vary.
export function preview(value, columns, ascii = false) {
  const clean = readable(value).replaceAll('\t', ' '), lines = clean.split(/\r?\n/);
  const first = lines[0].trim(), width = Math.max(0, Math.floor(columns));
  const clipped = lines.slice(1).some(line => line.trim()) || stringWidth(first) > width;
  if (!clipped) return first;
  const marker = ascii ? '.'.repeat(Math.min(3, width)) : width ? '…' : '';
  const available = Math.max(0, width - stringWidth(marker));
  let result = '', used = 0;
  for (const { segment } of graphemes.segment(first)) {
    const size = stringWidth(segment);
    if (used + size > available) break;
    result += segment; used += size;
  }
  return result.trimEnd() + marker;
}

// Presentation only: pipes never receive terminal decoration, even with FORCE_COLOR.
export function terminalOptions(stream, args = {}, env = process.env) {
  const tty = Boolean(stream.isTTY), dumb = env.TERM === 'dumb';
  return { tty, columns: stream.columns || 80, ascii: Boolean(args.ascii || dumb || !tty),
    color: tty && !dumb && !args.json && !args['no-color'] && !Object.hasOwn(env, 'NO_COLOR'),
    depth: stream.getColorDepth?.() ?? 4, logo: tty && !dumb && !args.json };
}

// Render terminal controls as text rather than letting project content repaint the UI.
// JSON retains the original strings; ordinary newlines, tabs and content remain intact.
export const readable = value => stripVTControlCharacters(String(value ?? ''))
  .replace(/\r(?!\n)/g, '\\r')
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ch => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);

export function format(options = {}) {
  const narrow = (options.columns ?? 80) < 72;
  const separator = options.ascii ? ' / ' : ' · ';
  const homeArgument = options.home ? ` --home '${readable(options.home).replaceAll('\\', '/').replaceAll("'", process.platform === 'win32' ? "''" : "'\"'\"'")}'` : '';
  const styles = { title: '1', head: '1', dim: '90', accent: '36', warn: '33', error: '31', ok: '32' };
  if (options.depth >= 24) Object.assign(styles, { accent: '38;2;133;199;181', warn: '38;2;214;183;122', error: '38;2;239;158;145' });
  const text = (tone, value) => {
    const clean = readable(value);
    return options.color && clean ? `\x1b[${styles[tone] ?? '0'}m${clean}\x1b[0m` : clean;
  };
  const short = value => readable(value).slice(0, 8);
  const pair = (label, value, tone) => narrow ? `${text('dim', label)}\n  ${text(tone, value)}`
    : `${text('dim', label.padEnd(14))}${text(tone, value)}`;
  const title = (name, metadata) => narrow ? `${text('title', name)}${metadata ? '\n'+text('dim', metadata) : ''}`
    : `${text('title', name)}${metadata ? '  '+text('dim', metadata) : ''}`;
  const first = value => readable(value).split(/\r?\n/, 1)[0].trim();
  function state(run) {
    const failedExit = typeof run.exit_code === 'number' && run.exit_code !== 0;
    if (run.error) return text('error', `! ${run.status}${separator}error/interruption`);
    if (failedExit) return text('error', `! ${run.status}${separator}exit ${run.exit_code}`);
    if (run.status === 'unknown') return text('warn', '? unknown');
    if (run.status === 'running') return text('accent', `${options.ascii ? '*' : '●'} running`);
    if (run.status === 'starting') return text('dim', `${options.ascii ? 'o' : '○'} starting`);
    return text('dim', `${options.ascii ? '-' : '—'} ${run.status}`);
  }
  return { text, short, pair, title, first, state,
    logo: () => options.logo ? text('accent', options.ascii ? '(o O)' : ' ╭────╮\n •  ●  \n ╰────╯')+'\n' : '',
    run: run => `${state(run)}  ${text('dim', short(run.id))}${run.objective ? '  '+text('', first(run.objective)) : ''}`,
    command: command => `  ${text('accent', command+homeArgument)}` };
}

export function displayError(message, options = {}) {
  const f = format({ ...options, home: message.cliHome ?? options.home });
  if (message.cliHome) return [f.text('error', '! Service address unavailable'), 'No readable service address in the selected home.', '',
    f.pair('Home', message.cliHome), '', f.text('head', 'Start the service in another terminal'), f.command('threshold serve'), '',
    f.text('dim', 'Use the same --home on both commands if you selected another home.'),
    f.text('dim', 'If Pi uses a separate config, add --agent-dir PATH when starting it.')].join('\n');
  return `${f.text('error', '!')} ${f.text('', message.message ?? message)}`;
}
