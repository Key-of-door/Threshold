#!/usr/bin/env node
// Repository hygiene check: personal local paths and broken relative Markdown links.
// Usage: node scripts/check-hygiene.mjs
// Exits 1 when a problem is found. Scans Git-tracked files only.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const BINARY = new Set(['.gif', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.mp4', '.zip', '.gz', '.tgz']);
const MAX_BYTES = 2 * 1024 * 1024;

// Placeholder names that may appear in example paths.
const SAFE_NAMES = new Set([
  'you', 'me', 'user', 'username', 'name', 'example', 'runner', 'public', 'default',
  'local_user', 'redacted_user',
]);

// A real-looking user directory: C:/Users/<name>/, C:\Users\<name>\, /Users/<name>/, /home/<name>/
const USER_PATH = /(?:[A-Za-z]:[/\\]Users[/\\]|\/Users\/|\/home\/)([A-Za-z0-9._-]+)[/\\]/g;

const problems = [];

function isText(file) {
  if (BINARY.has(extname(file).toLowerCase())) return false;
  try {
    return statSync(join(root, file)).size <= MAX_BYTES;
  } catch {
    return false;
  }
}

// 1. Personal local paths.
for (const file of tracked) {
  if (!isText(file)) continue;
  const lines = readFileSync(join(root, file), 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const match of line.matchAll(USER_PATH)) {
      const name = match[1];
      if (SAFE_NAMES.has(name.toLowerCase())) continue;
      problems.push(`${file}:${i + 1}: personal path "${match[0]}" (use LOCAL_USER or REDACTED_USER)`);
    }
  });
}

// 2. Broken relative Markdown links.
const trackedSet = new Set(tracked.map((f) => normalize(f)));
const trackedDirs = new Set();
for (const f of trackedSet) {
  let d = dirname(f);
  while (d && d !== '.' && !trackedDirs.has(d)) {
    trackedDirs.add(d);
    d = dirname(d);
  }
}

function stripCode(text) {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
}

for (const file of tracked) {
  if (extname(file).toLowerCase() !== '.md') continue;
  let text;
  try {
    text = stripCode(readFileSync(join(root, file), 'utf8'));
  } catch (error) {
    problems.push(`${file}: cannot read tracked Markdown file (${error.code})`);
    continue;
  }
  for (const match of text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    let target = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) continue;
    try {
      target = decodeURIComponent(target.split('#')[0].split('?')[0]);
    } catch {
      problems.push(`${file}: invalid URL encoding in link "${match[1]}"`);
      continue;
    }
    if (!target) continue;
    const resolved = normalize(join(dirname(file), target)).replace(/[/\\]$/, '');
    if (resolved === '.' || trackedSet.has(resolved) || trackedDirs.has(resolved)) continue;
    problems.push(`${file}: broken link "${match[1]}"`);
  }
}

if (problems.length) {
  console.error(`Hygiene check found ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log('Hygiene check passed: no personal paths, no broken relative Markdown links.');
