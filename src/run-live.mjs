// Public activity only. This buffer is never written to Project storage or passed to a Run.
// Completed public replies avoid exposing thinking deltas or internal prompt/context messages.
export function liveActivity({ maxEvents = 256, maxBytes = 256 * 1024 } = {}) {
  const events = [];
  let cursor = 0, bytes = 0;
  function add(type, fields = {}) {
    const event = { cursor: ++cursor, type, ...fields };
    const size = Buffer.byteLength(JSON.stringify(event));
    events.push({ event, size }); bytes += size;
    while (events.length > maxEvents || bytes > maxBytes) bytes -= events.shift().size;
  }
  const clip = (value, limit = 12000) => {
    const text = String(value ?? '');
    return text.length > limit ? text.slice(0, limit) + '\n[Live preview truncated]' : text;
  };
  return {
    add,
    observe(event) {
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        const text = (event.message.content ?? []).filter(part => part.type === 'text').map(part => part.text).join('');
        if (text) add('reply', { text: clip(text) });
        if (['error', 'aborted'].includes(event.message.stopReason))
          add('error', { text: `Pi reported ${event.message.stopReason}. Inspect Project state before continuing.` });
      }
      if (event.type === 'tool_execution_start') {
        // A short known argument, never the whole payload (e.g. write content or tool results).
        const args = event.args ?? {};
        const context = args.path ?? args.file_path ?? args.command;
        add('tool_start', { name: clip(event.toolName, 120), context: typeof context === 'string' ? clip(context, 240) : '' });
      }
      if (event.type === 'tool_execution_end') add('tool_end', { name: clip(event.toolName, 120), failed: Boolean(event.isError) });
      if (event.type === 'auto_retry_start') add('notice', { text: 'Pi is retrying a runtime request.' });
      if (event.type === 'compaction_start') add('notice', { text: 'Pi is compacting its temporary context.' });
    },
    read(after = 0) {
      return { events: events.filter(row => row.event.cursor > after).map(row => row.event), nextCursor: cursor,
        truncated: after < (events[0]?.event.cursor ?? cursor + 1) - 1 };
    },
  };
}
