import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';

// Only fake_deploy. No generic action registry, no gate around ordinary work.
export async function startControlledService(taskId) {
  const humanKey = randomBytes(32).toString('hex');
  const decisions = new Map(), blocks = new Map(), results = [];
  const supportedTarget = target => ['staging', 'preview'].includes(target);
  const key = (scope, target) => JSON.stringify([scope, target]);
  const operation = target => ({ action: 'fake_deploy', target, taskId });

  function fakeDeploy(target) {
    const op = operation(target);
    const decision = decisions.get(key(taskId, target));
    if (!decision || decision.decision === 'deny') {
      const result = { status: decision ? 'NO' : 'ASK', operation: op,
        reason: decision ? 'Human denied this operation' : 'Missing Human authorization for this operation and task' };
      blocks.set(target, result);
      return result;
    }
    // Check and this local effect are synchronous in the same concrete adapter call.
    const result = { id: randomUUID(), ...op, effect: 'in-memory fake deployment recorded', recordedAt: new Date().toISOString() };
    results.push(result);
    blocks.delete(target);
    return { status: 'GO', operation: op, result };
  }

  function serverFor(human) {
    return createServer((req, res) => {
      const reply = (status, body) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
      };
      if (human && req.headers.authorization !== `Bearer ${humanKey}`)
        return reply(401, { error: 'Human client credential required' });
      if (!human && req.method === 'GET' && req.url === '/state')
        return reply(200, { blocks: [...blocks.values()], results });
      if (req.method !== 'POST' || req.url !== (human ? '/decision' : '/fake-deploy'))
        return reply(404, { error: 'Route not found on this interface' });
      if (req.headers['content-type']?.split(';')[0] !== 'application/json')
        return reply(415, { error: 'Expected application/json' });
      let bytes = 0;
      const chunks = [];
      req.on('data', chunk => {
        bytes += chunk.length;
        if (res.writableEnded) return;
        if (bytes > 4096) return reply(413, { error: 'Request too large' });
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (res.writableEnded) return;
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return reply(400, { error: 'Malformed JSON' }); }
        if (!body || !supportedTarget(body.target))
          return reply(400, { error: 'Supported fake targets: staging, preview' });
        if (!human) return reply(200, fakeDeploy(body.target));
        if (typeof body.taskId !== 'string' || !body.taskId.trim() || !['allow', 'deny'].includes(body.decision))
          return reply(400, { error: 'Expected taskId and decision: allow or deny' });
        // One current decision per exact scope/target; a new Human submission replaces it.
        const decision = { action: 'fake_deploy', target: body.target, taskId: body.taskId, decision: body.decision };
        decisions.set(key(body.taskId, body.target), decision);
        reply(200, { decision }); // Does not execute the operation.
      });
      req.on('error', () => { if (!res.destroyed && !res.writableEnded) reply(400, { error: 'Request interrupted' }); });
    });
  }
  const agent = serverFor(false), human = serverFor(true);
  const listen = server => new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  await listen(agent);
  try { await listen(human); } catch (error) { agent.close(); throw error; }
  return {
    agentUrl: `http://127.0.0.1:${agent.address().port}`,
    humanUrl: `http://127.0.0.1:${human.address().port}`, humanKey,
    snapshot: () => structuredClone({ decisions: [...decisions.values()], blocks: [...blocks.values()], results }),
    close: () => Promise.all([agent, human].map(server => new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())))),
  };
}
