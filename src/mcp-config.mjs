import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Pi 1.1.0's validator is not a package-root export. Keep this pinned integration
// point here instead of maintaining a second MCP configuration schema.
const { validateMcpServerConfig } = await import(new URL('./core/mcp-servers.js', import.meta.resolve('@earendil-works/pi-coding-agent')));
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// Configuration values stay in memory; only paths, hashes and safe selection
// summaries belong in the Run. Never return parser errors containing file bytes.
export function loadMcpSelection(files) {
  const servers = [], names = new Set();
  let autoEnableCodemode;
  for (const file of files) {
    if (statSync(file.path).size > 128 * 1024) throw new Error('MCP configuration exceeds 128 KiB');
    const bytes = readFileSync(file.path);
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
      throw new Error('Selected MCP configuration changed; select it again for a new Run');
    let parsed;
    try { parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
    catch { throw new Error('MCP configuration must be valid JSON'); }
    if (!record(parsed) || !record(parsed.mcpServers)) throw new Error('MCP configuration requires an mcpServers object');
    if (parsed.autoEnableCodemode !== undefined) {
      if (typeof parsed.autoEnableCodemode !== 'boolean') throw new Error('autoEnableCodemode must be boolean');
      if (autoEnableCodemode !== undefined && autoEnableCodemode !== parsed.autoEnableCodemode)
        throw new Error('Selected MCP files disagree on autoEnableCodemode');
      autoEnableCodemode = parsed.autoEnableCodemode;
    }
    for (const [name, value] of Object.entries(parsed.mcpServers)) {
      if (name.length > 100) throw new Error('MCP server names must not exceed 100 characters');
      const config = validateMcpServerConfig(name, value);
      if (typeof config === 'string') throw new Error('Invalid MCP server configuration; check names, transport and fields against Pi documentation');
      const namespace = name.replaceAll('-', '_');
      if (names.has(namespace)) throw new Error('Duplicate MCP server name or tool namespace across selected files');
      names.add(namespace);
      if (names.size > 64) throw new Error('Select at most 64 MCP servers per Run');
      servers.push({ name, config, source: file.path, scope: 'extension' });
    }
  }
  return { servers, errors: [], autoEnableCodemode: autoEnableCodemode ?? true };
}

export function mcpSummary(entry) {
  return { name: entry.name, transport: 'url' in entry.config ? 'http' : 'stdio',
    enabled: entry.config.enabled !== false, exposure: entry.config.exposure ?? 'codemode' };
}
