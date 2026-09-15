import { createServer } from 'node:http';

// One local project/task, one latest checkpoint. All state is process-local memory.
export async function startService(task) {
  const state = { task: structuredClone(task), checkpoint: null };
  const calls = [];
  const server = createServer((req, res) => {
    res.on('finish', () => calls.push({
      method: req.method, path: req.url, status: res.statusCode,
      toolCallId: req.headers['x-pi-tool-call-id'] ?? null,
    }));
    const reply = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/task') return reply(200, state);
    if (req.method !== 'PUT' || req.url !== '/checkpoint') return reply(404, { error: 'Route not found' });
    if (req.headers['content-type']?.split(';')[0] !== 'application/json')
      return reply(415, { error: 'Expected application/json' });
    let bytes = 0;
    const chunks = [];
    req.on('data', chunk => {
      bytes += chunk.length;
      if (res.writableEnded) return;
      if (bytes > 8192) return reply(413, { error: 'Checkpoint request is too large' });
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (res.writableEnded) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return reply(400, { error: 'Malformed JSON' }); }
      if (!body || typeof body.summary !== 'string' || !body.summary.trim() || body.summary.length > 4000)
        return reply(400, { error: 'Expected a nonempty summary of at most 4000 characters' });
      state.checkpoint = { summary: body.summary, source: 'agent', recordedAt: new Date().toISOString() };
      reply(200, { checkpoint: state.checkpoint });
    });
    req.on('error', () => { if (!res.destroyed && !res.writableEnded) reply(400, { error: 'Request interrupted' }); });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    snapshot: () => structuredClone(state), calls,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
