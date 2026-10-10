import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

// Local deterministic MCP peer. No network, credentials or external model.
const log = process.argv[2];
const record = value => appendFileSync(log, JSON.stringify(value) + '\n');
record({ event: 'start', pid: process.pid, cwd: process.cwd() });
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  let result;
  if (message.method === 'initialize') result = { protocolVersion: message.params.protocolVersion,
    capabilities: { tools: {} }, serverInfo: { name: 'threshold-fixture', version: '1' } };
  else if (message.method === 'tools/list') result = { tools: [{ name: 'echo', description: 'Return fixture input',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] };
  else if (message.method === 'tools/call') {
    record({ event: 'call', name: message.params.name, arguments: message.params.arguments });
    result = { content: [{ type: 'text', text: 'MCP:' + message.params.arguments.text }] };
  } else result = {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
}).on('close', () => { record({ event: 'closed' }); });
