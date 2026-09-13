import { realpathSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';

// Local files only. Pi owns parsing/loading; this is just a Run's selection.
export function selectCapabilities(skills = [], extensions = []) {
  const files = (paths, kind) => {
    if (!Array.isArray(paths) || paths.length > 16) throw new Error(`Invalid ${kind} list`);
    return paths.map(path => {
      if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(`${kind} requires an absolute local path`);
      if (kind === 'skill' && statSync(path).isDirectory()) path = join(path, 'SKILL.md');
      path = realpathSync(path);
      if (!statSync(path).isFile()) throw new Error(`${kind} must name a file`);
      return { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
    }).filter((file, i, all) => all.findIndex(other => other.path === file.path) === i);
  };
  return { skills: files(skills, 'skill'), extensions: files(extensions, 'extension') };
}
