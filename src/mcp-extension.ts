import { createMcpExtension } from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { loadMcpSelection } from './mcp-config.mjs';
import { observeMcpTransport } from './mcp-observation.mjs';

export default async function (pi: ExtensionAPI) {
  const selected = loadMcpSelection(JSON.parse(process.env.THRESHOLD_MCP_SELECTION ?? '[]'));
  // Reuse Pi's transport, auth, retry and shutdown behavior. Like its validator,
  // this factory is a pinned internal import covered by real-process tests.
  const { createDefaultTransport } = await import(new URL('./extensions/mcp/runtime.js', import.meta.resolve('@earendil-works/pi-coding-agent')).href);
  let shuttingDown = false;
  let ui;
  const emit = (name: string, state: string, toolCount = 0) => {
    // A bounded observation event, outside model context and durable history.
    // No endpoint, headers, arguments, results or server error text leave here.
    ui?.setStatus('threshold:mcp', JSON.stringify({ name, state, toolCount }));
  };
  pi.on('session_start', (_event, ctx) => {
    ui = ctx.ui;
    for (const entry of selected.servers) emit(entry.name, entry.config.enabled === false ? 'disabled' : 'selected');
  });
  pi.on('session_shutdown', () => { shuttingDown = true; });
  await createMcpExtension({
    loadConfig: () => selected,
    // RPC cannot open Pi's interactive manager. Never let a selected file become
    // a shared mutable configuration through an upstream command/UI change.
    updateConfig: () => { throw new Error('MCP selection belongs to this Run; edit the file and start a fresh Run'); },
    createTransport: (entry, cwd, auth) => {
      try {
        return observeMcpTransport(createDefaultTransport(entry, cwd, auth),
          (state, count) => emit(entry.name, state, count), () => shuttingDown);
      } catch (error) { emit(entry.name, 'connection_error'); throw error; }
    },
  })(pi);
}
