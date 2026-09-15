#!/usr/bin/env node
// Standalone fixture renderer. Does not import Threshold or contact its service.
import { readFileSync } from 'node:fs';
const scenes = JSON.parse(readFileSync(new URL('./terminal-scenes.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const color = process.stdout.isTTY && !('NO_COLOR' in process.env) && !args.includes('--mono');
const ascii = args.includes('--ascii');
const logo = args.includes('--no-logo') ? '' : ascii ? '(o O)' : ' ╭────╮\n •  ●  \n ╰────╯';
const colors = { title: '\x1b[1m', head: '\x1b[1m', dim: '\x1b[90m', accent: '\x1b[36m', ok: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' };
function plain(text) { return ascii ? text.replaceAll('●', '*').replaceAll('○', 'o').replaceAll('›', '>').replaceAll('·', '-').replaceAll('—', '-').replaceAll('…', '...') : text; }
function line(text) { return plain(text.replace('{logo}', logo).replace(/\{(\w+)\|([^}]+)\}/g, (_, tone, body) => color ? `${colors[tone] ?? ''}${body}\x1b[0m` : body)); }
function show(name) { const scene = scenes[name]; console.log(line('{dim|DESIGN FIXTURE · no service connection}\n')); console.log(line('{dim|$} '+scene.command)+'\n'); console.log(scene.lines.map(line).join('\n')); }
if(args.includes('--help')) {
  console.log('Terminal design study — fixture data only\n\nnode docs/design/terminal-preview.mjs SCENE [--mono] [--ascii] [--no-logo]\nnode docs/design/terminal-preview.mjs --tui\n\nScenes: '+Object.keys(scenes).join(', ')+'\n\nTUI: j/k or arrows, Enter detail, Esc back, q exit. No operations execute.');
} else if(args.includes('--tui')) {
  if(!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('The read-only prototype needs a TTY; use a named scene for plain output.');
  let selected=0, detail=false;
  const names=['task','run','error'];
  const titles=['CLI first-use polish       in_progress','Review the actual diff     running','Install instructions       ended + error'];
  const render=()=>{
    process.stdout.write('\x1b[2J\x1b[H');
    if(detail)show(names[selected]);
    else console.log(line('{dim|DESIGN FIXTURE · read-only TUI}\n\n{title|Threshold}  {dim|project ef2e9b18}\n\n')+titles.map((t,i)=>line((i===selected?'{accent|›} ':'  ')+t)).join('\n'));
    console.log(line('\n{dim|↑ ↓ / j k select · Enter inspect · Esc back · q exit view}\n{dim|Exiting this prototype does not stop any service.}'));
  };
  const close=()=>{process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\x1b[0m\x1b[?25h\n');};
  process.stdin.setRawMode(true);process.stdin.resume();process.stdout.write('\x1b[?25l');render();
  process.stdin.on('data',data=>{const key=data.toString();if(key==='q'||key==='\u0003'){close();return;}if(key==='j'||key==='\x1b[B')selected=(selected+1)%names.length;else if(key==='k'||key==='\x1b[A')selected=(selected+names.length-1)%names.length;else if(key==='\r')detail=true;else if(key==='\x1b')detail=false;render();});
  process.once('exit',()=>{if(process.stdin.isTTY)process.stdin.setRawMode(false);});
} else {
  const name=args.find(a=>!a.startsWith('--'))??'board';
  if(!scenes[name]){console.error('Unknown scene. Use --help.');process.exitCode=1;}else show(name);
}
