// Observe transport facts, not Pi's private connection state. "initialized" and
// "tools_discovered" are timestamped observations, never a health guarantee.
export function observeMcpTransport(transport, emit, shuttingDown = () => false) {
  const pending = new Map(), tools = new Set();
  let failed = false;
  const error = () => { failed = true; emit('connection_error', tools.size); };
  transport.onMessage(message => {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) { error(); return; }
    if (request.method === 'initialize' && message.result?.protocolVersion) emit('initialized', 0);
    if (request.method === 'tools/list' && Array.isArray(message.result?.tools)) {
      if (!request.cursor) tools.clear();
      for (const tool of message.result.tools) tools.add(tool.name);
      emit('tools_discovered', tools.size);
    }
  });
  transport.onError(error);
  transport.onClose(() => { pending.clear(); emit(shuttingDown() ? 'closed' : failed ? 'connection_error' : 'disconnected', tools.size); });
  const start = transport.start.bind(transport), send = transport.send.bind(transport), close = transport.close.bind(transport);
  // Retain transport identity (Pi uses instanceof for stdio diagnostics).
  return Object.assign(transport, {
    async start() { emit('connecting', 0); try { await start(); } catch (e) { error(); throw e; } },
    async send(message) {
      if (['initialize', 'tools/list'].includes(message.method) && message.id !== undefined)
        pending.set(message.id, { method: message.method, cursor: message.params?.cursor });
      try { await send(message); } catch (e) { pending.delete(message.id); error(); throw e; }
    },
    async close() { await close(); if (shuttingDown()) emit('closed', tools.size); },
  });
}
